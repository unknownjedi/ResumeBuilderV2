import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import {
  buildVerifiedFactCatalog,
  ClaimEvidenceRefSchema,
  ClaimUserEditedStateSchema,
  makeFactCatalogKey,
  PaperSizeSchema,
  ResumeTemplateSettingsSchema,
  StructuredResumeDocumentSchema,
  validateClaimAgainstCatalog,
  validateStructuredResumeFactuality,
  type ClaimEvidenceRef,
  type ClaimUserEditedState,
  type ResumeTemplateSettings,
  type StructuredResumeDocument,
  type VerifiedFactCatalog,
} from "../ai/schemas/resume-generation";
import {
  DEFAULT_RESUME_TEMPLATE_SETTINGS,
  flattenResumeClaims,
  generateTailoredResume,
  MaterialsGenerationError,
  type FlattenedResumeClaim,
  type MaterialGenerationMode,
} from "../ai/workflows/generate-materials";
import { getDb, type AppDatabase } from "../db/client";
import {
  DOCUMENT_EXPORT_TYPES,
  documentExports,
  EXPORT_FORMATS,
  RESUME_DRAFT_STATES,
  resumeClaimEvidence,
  resumeClaims,
  resumeDrafts,
  resumeVersions,
  type DocumentExportType,
  type ExportFormat,
  type ResumeDraftState,
  type UserEditedState,
} from "../db/schema/applications";
import { evidenceLinks, type VerificationStatus } from "../db/schema/career";
import { jobs, searchProfiles } from "../db/schema/jobs";
import {
  assertPathWithin,
  ensureAppDirectories,
  writeSecureFile,
} from "../files/paths";
import {
  exportHtmlToPdfBuffer,
  exportResumeToDocxBuffer,
  renderResumeHtml,
  renderResumeMarkdown,
  renderResumePlainText,
} from "../documents/resume-renderer";
import { getFullCareerProfile } from "./profile";
import {
  getSearchProfileById,
  type SearchProfileRecord,
} from "./search-profiles";

export class ResumeServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ResumeServiceError";
    this.code = code;
    this.status = status;
  }
}

export const MaterialModeSchema = z.enum([
  "auto_or_ai",
  "ai_required",
  "deterministic",
]);

export const ResumeDraftPatchSchema = z
  .object({
    structuredContent: z.unknown().optional(),
    templateSettings: z.unknown().optional(),
    state: z.enum(RESUME_DRAFT_STATES).optional(),
  })
  .strict();

export const ResumeClaimUpdateSchema = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(),
    userEditedState: ClaimUserEditedStateSchema.optional(),
    evidenceRefs: z.array(ClaimEvidenceRefSchema).max(50).optional(),
  })
  .strict();

export const ResumeExportRequestSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
    versionId: z.string().trim().min(1).max(128).optional(),
    paperSize: PaperSizeSchema.optional(),
    async: z.boolean().optional(),
  })
  .strict();

export interface SerializedDocumentExport {
  id: string;
  resumeVersionId: string | null;
  coverLetterId: string | null;
  documentType: DocumentExportType;
  format: ExportFormat;
  fileName: string;
  fileHash: string;
  fileSizeBytes: number;
  exportedAt: string;
  downloadUrl: string;
}

export interface HydratedResumeClaimEvidence {
  id: string;
  resumeClaimId: string;
  evidenceLinkId: string | null;
  factType: ClaimEvidenceRef["factType"];
  factId: string;
  excerpt: string | null;
  createdAt: string;
}

export interface HydratedResumeClaim {
  id: string;
  resumeDraftId: string;
  stableClaimId: string;
  stableEntryId: string;
  sectionId: string;
  sectionType: string;
  text: string;
  sortOrder: number;
  userEditedState: UserEditedState;
  verificationStatus: VerificationStatus;
  evidence: HydratedResumeClaimEvidence[];
  evidenceRefs: ClaimEvidenceRef[];
  createdAt: string;
  updatedAt: string;
}

export interface HydratedResumeVersion {
  id: string;
  resumeDraftId: string;
  versionNumber: number;
  jobId: string;
  searchProfileId: string;
  jobDescriptionHash: string;
  careerProfileHash: string;
  structuredContent: StructuredResumeDocument;
  templateSettings: ResumeTemplateSettings;
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  userEditedState: UserEditedState;
  contentHash: string;
  createdAt: string;
  exports: SerializedDocumentExport[];
}

export interface SafeVerifiedFactSummary {
  key: string;
  factType: ClaimEvidenceRef["factType"];
  factId: string;
  label: string;
  excerpt: string;
  defaultEvidenceLinkId: string | null;
}

export interface ResumeDraftListItem {
  id: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  locationText: string | null;
  workplaceType: string;
  searchProfileId: string;
  searchProfileName: string | null;
  state: ResumeDraftState;
  claimsCount: number;
  claimCount: number;
  verifiedClaimCount: number;
  needsReviewCount: number;
  userEditedCount: number;
  latestVersionNumber: number | null;
  latestVersionId: string | null;
  versionCount: number;
  latestExports: SerializedDocumentExport[];
  exportsCount: number;
  latestExportAt: string | null;
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  careerProfileHash: string;
  jobDescriptionHash: string;
  job: {
    id: string;
    title: string;
    companyName: string;
    locationText: string | null;
    workplaceType: string;
    status: string;
    canonicalUrl: string | null;
    applyUrl: string | null;
  } | null;
  searchProfile: {
    id: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeDraftDetail extends ResumeDraftListItem {
  structuredContent: StructuredResumeDocument;
  templateSettings: ResumeTemplateSettings & {
    fontSizePt: number;
    lineHeight: number;
    visibleSections: Record<string, boolean>;
  };
  claims: HydratedResumeClaim[];
  versions: HydratedResumeVersion[];
  exports: SerializedDocumentExport[];
  verifiedFacts: SafeVerifiedFactSummary[];
  renderedPreviewHtml: string;
  careerProfileSnapshot: unknown;
  jobSnapshot: unknown;
}

export interface ExportDownloadInfo {
  filePath: string;
  fileName: string;
  mimeType: string;
  fileHash: string;
  fileSizeBytes: number;
  documentType: DocumentExportType;
  format: ExportFormat;
}

function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function resolveCanonicalJobRow(
  db: AppDatabase,
  jobId: string
): typeof jobs.$inferSelect {
  let current = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!current) {
    throw new ResumeServiceError("JOB_NOT_FOUND", 404, `Job not found: ${jobId}`);
  }

  const visited = new Set<string>([current.id]);
  let hops = 0;
  while (current.mergedIntoJobId && hops < 10) {
    if (visited.has(current.mergedIntoJobId)) {
      break;
    }
    visited.add(current.mergedIntoJobId);
    const nextJob = db
      .select()
      .from(jobs)
      .where(eq(jobs.id, current.mergedIntoJobId))
      .get();
    if (!nextJob) break;
    current = nextJob;
    hops++;
  }

  return current;
}

export function resolveEffectiveSearchProfile(
  db: AppDatabase,
  searchProfileId?: string | null
): SearchProfileRecord {
  const trimmed = searchProfileId?.trim();
  if (trimmed) {
    const found = getSearchProfileById(trimmed, db);
    if (!found) {
      throw new ResumeServiceError(
        "SEARCH_PROFILE_NOT_FOUND",
        404,
        `Search profile not found: ${trimmed}`
      );
    }
    return found;
  }

  const all = db
    .select()
    .from(searchProfiles)
    .orderBy(asc(searchProfiles.createdAt))
    .all();
  const preferred = all.find((p) => p.enabled) ?? all[0];
  if (!preferred) {
    throw new ResumeServiceError(
      "NO_SEARCH_PROFILE",
      400,
      "Create a search profile before generating tailored application materials."
    );
  }
  const resolved = getSearchProfileById(preferred.id, db);
  if (!resolved) {
    throw new ResumeServiceError(
      "NO_SEARCH_PROFILE",
      400,
      "Search profile could not be loaded."
    );
  }
  return resolved;
}

export function serializeDocumentExport(
  row: typeof documentExports.$inferSelect
): SerializedDocumentExport {
  return {
    id: row.id,
    resumeVersionId: row.resumeVersionId,
    coverLetterId: row.coverLetterId,
    documentType: row.documentType,
    format: row.format,
    fileName: path.basename(row.filePath),
    fileHash: row.fileHash,
    fileSizeBytes: row.fileSizeBytes,
    exportedAt: row.exportedAt,
    downloadUrl: `/api/exports/${encodeURIComponent(row.id)}/download`,
  };
}

function enrichTemplateSettings(settings: ResumeTemplateSettings) {
  return {
    ...settings,
    fontSizePt: Number((settings.fontSizeScale * 10.5).toFixed(1)),
    lineHeight: Number((settings.lineHeightScale * 1.38).toFixed(2)),
    visibleSections: {
      summary: settings.showSummary,
      experience: true,
      projects: settings.showProjects,
      skills: true,
      education: true,
      achievements: settings.showAchievements,
      certifications: settings.showCertifications,
      languages: settings.showLanguages,
    },
  };
}

function normalizeIncomingTemplateSettings(
  raw: unknown,
  current: ResumeTemplateSettings
): ResumeTemplateSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ResumeServiceError(
      "INVALID_TEMPLATE_SETTINGS",
      400,
      "templateSettings must be a JSON object."
    );
  }

  const obj = raw as Record<string, unknown>;
  const vis =
    obj.visibleSections &&
    typeof obj.visibleSections === "object" &&
    !Array.isArray(obj.visibleSections)
      ? (obj.visibleSections as Record<string, unknown>)
      : null;

  const fontSizeScale =
    typeof obj.fontSizeScale === "number"
      ? obj.fontSizeScale
      : typeof obj.fontSizePt === "number"
        ? Math.min(1.15, Math.max(0.85, Number((obj.fontSizePt / 10.5).toFixed(3))))
        : current.fontSizeScale;

  const lineHeightScale =
    typeof obj.lineHeightScale === "number"
      ? obj.lineHeightScale
      : typeof obj.lineHeight === "number"
        ? Math.min(1.25, Math.max(0.9, Number((obj.lineHeight / 1.38).toFixed(3))))
        : current.lineHeightScale;

  return ResumeTemplateSettingsSchema.parse({
    paperSize: obj.paperSize ?? current.paperSize,
    fontSizeScale,
    lineHeightScale,
    marginPreset: obj.marginPreset ?? current.marginPreset,
    showSummary:
      typeof obj.showSummary === "boolean"
        ? obj.showSummary
        : typeof vis?.summary === "boolean"
          ? vis.summary
          : current.showSummary,
    showProjects:
      typeof obj.showProjects === "boolean"
        ? obj.showProjects
        : typeof vis?.projects === "boolean"
          ? vis.projects
          : current.showProjects,
    showAchievements:
      typeof obj.showAchievements === "boolean"
        ? obj.showAchievements
        : typeof vis?.achievements === "boolean"
          ? vis.achievements
          : current.showAchievements,
    showCertifications:
      typeof obj.showCertifications === "boolean"
        ? obj.showCertifications
        : typeof vis?.certifications === "boolean"
          ? vis.certifications
          : current.showCertifications,
    showLanguages:
      typeof obj.showLanguages === "boolean"
        ? obj.showLanguages
        : typeof vis?.languages === "boolean"
          ? vis.languages
          : current.showLanguages,
  });
}

function normalizeIncomingStructuredDocument(
  raw: unknown,
  existingDoc: StructuredResumeDocument,
  catalog: VerifiedFactCatalog
): StructuredResumeDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ResumeServiceError(
      "INVALID_STRUCTURED_CONTENT",
      400,
      "structuredContent must be a JSON object."
    );
  }

  const direct = StructuredResumeDocumentSchema.safeParse(raw);
  if (direct.success) {
    return direct.data;
  }

  const obj = raw as Record<string, unknown>;
  const headerObj =
    obj.header && typeof obj.header === "object" && !Array.isArray(obj.header)
      ? (obj.header as Record<string, unknown>)
      : {};

  const links: Array<{ label: string; url: string }> = [];
  if (Array.isArray(headerObj.links)) {
    for (const l of headerObj.links) {
      if (l && typeof l === "object") {
        const rec = l as Record<string, unknown>;
        if (typeof rec.label === "string" && typeof rec.url === "string" && rec.url.trim()) {
          links.push({ label: rec.label.trim(), url: rec.url.trim() });
        }
      }
    }
  } else {
    if (typeof headerObj.websiteUrl === "string" && headerObj.websiteUrl.trim()) {
      links.push({ label: "Website", url: headerObj.websiteUrl.trim() });
    }
    if (typeof headerObj.linkedinUrl === "string" && headerObj.linkedinUrl.trim()) {
      links.push({ label: "LinkedIn", url: headerObj.linkedinUrl.trim() });
    }
    if (typeof headerObj.githubUrl === "string" && headerObj.githubUrl.trim()) {
      links.push({ label: "GitHub", url: headerObj.githubUrl.trim() });
    }
    if (links.length === 0) {
      links.push(...existingDoc.header.links);
    }
  }

  const existingSkillIdByName = new Map<string, string>();
  for (const sec of existingDoc.sections) {
    for (const grp of sec.skillGroups) {
      for (const item of grp.items) {
        existingSkillIdByName.set(item.name.trim().toLowerCase(), item.factId);
      }
    }
  }
  for (const fact of catalog.byType.skill) {
    existingSkillIdByName.set(fact.label.trim().toLowerCase(), fact.factId);
  }

  const sectionsInput = Array.isArray(obj.sections) ? obj.sections : [];
  const normalizedSections = sectionsInput.map((rawSec, sIdx) => {
    const sec = (rawSec && typeof rawSec === "object" ? rawSec : {}) as Record<
      string,
      unknown
    >;
    const sectionType =
      typeof sec.type === "string" ? sec.type : "experience";
    const sectionId =
      typeof sec.id === "string" && sec.id.trim()
        ? sec.id.trim()
        : `section-${sectionType}-${sIdx}`;
    const entriesRaw = Array.isArray(sec.entries) ? sec.entries : [];
    const entries = entriesRaw.map((rawEnt, eIdx) => {
      const ent = (rawEnt && typeof rawEnt === "object" ? rawEnt : {}) as Record<
        string,
        unknown
      >;
      const entryId =
        typeof ent.id === "string" && ent.id.trim()
          ? ent.id.trim()
          : `${sectionId}-entry-${eIdx}`;
      const heading =
        (typeof ent.heading === "string" && ent.heading.trim()) ||
        (typeof ent.title === "string" && ent.title.trim()) ||
        "Entry";
      const subheading =
        typeof ent.subheading === "string"
          ? ent.subheading
          : [ent.organization, ent.subtitle]
              .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
              .join(" — ") || null;
      const dateRange =
        typeof ent.dateRange === "string"
          ? ent.dateRange
          : [
              typeof ent.startDate === "string" ? ent.startDate.trim() : "",
              ent.isCurrent
                ? "Present"
                : typeof ent.endDate === "string"
                  ? ent.endDate.trim()
                  : "",
            ]
              .filter(Boolean)
              .join(" – ") || null;

      const bulletsRaw = Array.isArray(ent.bullets) ? ent.bullets : [];
      const bullets = bulletsRaw.map((rawBullet, bIdx) => {
        const b = (
          rawBullet && typeof rawBullet === "object" ? rawBullet : {}
        ) as Record<string, unknown>;
        return {
          id:
            typeof b.id === "string" && b.id.trim()
              ? b.id.trim()
              : `${entryId}-bullet-${bIdx}`,
          sectionId,
          stableEntryId: entryId,
          text: typeof b.text === "string" ? b.text : "",
          sortOrder: typeof b.sortOrder === "number" ? b.sortOrder : bIdx,
          userEditedState: b.userEditedState ?? "generated",
          verificationStatus:
            b.verificationStatus === "verified" ||
            b.verificationStatus === "needs_review" ||
            b.verificationStatus === "rejected"
              ? b.verificationStatus
              : "needs_review",
          evidenceRefs: Array.isArray(b.evidenceRefs) ? b.evidenceRefs : [],
        };
      });

      return {
        id: entryId,
        heading,
        subheading,
        location: typeof ent.location === "string" ? ent.location : null,
        dateRange,
        sortOrder: typeof ent.sortOrder === "number" ? ent.sortOrder : eIdx,
        bullets,
      };
    });

    const skillGroupsRaw = Array.isArray(sec.skillGroups) ? sec.skillGroups : [];
    const skillGroups = skillGroupsRaw.map((rawGrp, gIdx) => {
      const grp = (rawGrp && typeof rawGrp === "object" ? rawGrp : {}) as Record<
        string,
        unknown
      >;
      const itemsRaw = Array.isArray(grp.items) ? grp.items : [];
      const items = itemsRaw
        .map((it) => {
          if (typeof it === "string") {
            const name = it.trim();
            if (!name) return null;
            const factId = existingSkillIdByName.get(name.toLowerCase());
            if (!factId) return null;
            return {
              factId,
              name,
              proficiency: null,
              evidenceRefs: [{ factType: "skill" as const, factId }],
            };
          }
          if (it && typeof it === "object") {
            return it;
          }
          return null;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      return {
        id:
          typeof grp.id === "string" && grp.id.trim()
            ? grp.id.trim()
            : `${sectionId}-group-${gIdx}`,
        label:
          (typeof grp.label === "string" && grp.label.trim()) ||
          (typeof grp.category === "string" && grp.category.trim()) ||
          "Skills",
        items,
      };
    });

    const summaryText =
      typeof sec.summaryText === "string"
        ? sec.summaryText
        : typeof sec.text === "string"
          ? sec.text
          : null;

    return {
      id: sectionId,
      type: sectionType,
      title:
        typeof sec.title === "string" && sec.title.trim()
          ? sec.title.trim()
          : sectionType,
      sortOrder: typeof sec.sortOrder === "number" ? sec.sortOrder : sIdx,
      summaryText,
      summaryClaimId:
        typeof sec.summaryClaimId === "string"
          ? sec.summaryClaimId
          : summaryText
            ? "summary"
            : null,
      summaryUserEditedState: sec.summaryUserEditedState,
      summaryVerificationStatus:
        sec.summaryVerificationStatus === "verified" ||
        sec.summaryVerificationStatus === "needs_review" ||
        sec.summaryVerificationStatus === "rejected"
          ? sec.summaryVerificationStatus
          : undefined,
      summaryEvidenceRefs: Array.isArray(sec.summaryEvidenceRefs)
        ? sec.summaryEvidenceRefs
        : Array.isArray(sec.evidenceRefs)
          ? sec.evidenceRefs
          : [],
      entries,
      skillGroups,
    };
  });

  if (obj.summary && typeof obj.summary === "object" && !Array.isArray(obj.summary)) {
    const sumObj = obj.summary as Record<string, unknown>;
    const existingSumSec = normalizedSections.find((s) => s.type === "summary");
    const sumText = typeof sumObj.text === "string" ? sumObj.text : "";
    const sumId =
      typeof sumObj.id === "string" && sumObj.id.trim()
        ? sumObj.id.trim()
        : "summary";
    const sumRefs = Array.isArray(sumObj.evidenceRefs) ? sumObj.evidenceRefs : [];
    const sumState = sumObj.userEditedState ?? "generated";
    const sumVer =
      sumObj.verificationStatus === "verified" ||
      sumObj.verificationStatus === "needs_review" ||
      sumObj.verificationStatus === "rejected"
        ? sumObj.verificationStatus
        : "needs_review";

    if (existingSumSec) {
      existingSumSec.summaryText = sumText;
      existingSumSec.summaryClaimId = sumId;
      existingSumSec.summaryEvidenceRefs = sumRefs;
      existingSumSec.summaryUserEditedState = sumState;
      existingSumSec.summaryVerificationStatus = sumVer;
    } else if (sumText.trim()) {
      normalizedSections.unshift({
        id: "section-summary",
        type: "summary",
        title: "Summary",
        sortOrder: 0,
        summaryText: sumText,
        summaryClaimId: sumId,
        summaryUserEditedState: sumState,
        summaryVerificationStatus: sumVer,
        summaryEvidenceRefs: sumRefs,
        entries: [],
        skillGroups: [],
      });
    }
  }

  return StructuredResumeDocumentSchema.parse({
    version: 1,
    header: {
      fullName:
        typeof headerObj.fullName === "string" && headerObj.fullName.trim()
          ? headerObj.fullName.trim()
          : existingDoc.header.fullName,
      headline:
        typeof headerObj.headline === "string"
          ? headerObj.headline
          : existingDoc.header.headline ?? null,
      email:
        typeof headerObj.email === "string"
          ? headerObj.email
          : existingDoc.header.email ?? null,
      phone:
        typeof headerObj.phone === "string"
          ? headerObj.phone
          : existingDoc.header.phone ?? null,
      location:
        typeof headerObj.location === "string"
          ? headerObj.location
          : existingDoc.header.location ?? null,
      links,
    },
    sections: normalizedSections,
  });
}

function validateAndNormalizeDocumentClaims(params: {
  doc: StructuredResumeDocument;
  existingClaimsByStableId: Map<string, typeof resumeClaims.$inferSelect>;
  catalog: VerifiedFactCatalog;
  isFromUpdate: boolean;
}): StructuredResumeDocument {
  const { doc, existingClaimsByStableId, catalog, isFromUpdate } = params;

  const normalizedSections = doc.sections.map((section) => {
    let nextSection = { ...section };

    if (nextSection.summaryText && nextSection.summaryText.trim()) {
      const claimId = nextSection.summaryClaimId?.trim() || `summary-${nextSection.id}`;
      const existing = existingClaimsByStableId.get(claimId);
      let nextState: ClaimUserEditedState =
        nextSection.summaryUserEditedState ?? existing?.userEditedState ?? "generated";
      let nextVerification: "verified" | "needs_review" | "rejected" =
        nextSection.summaryVerificationStatus ??
        (existing?.verificationStatus === "verified" ||
        existing?.verificationStatus === "needs_review" ||
        existing?.verificationStatus === "rejected"
          ? existing.verificationStatus
          : "needs_review");

      if (isFromUpdate) {
        if (!existing) {
          if (nextState === "generated") {
            nextState = "user_edited";
          }
        } else if (nextSection.summaryText.trim() !== existing.text.trim()) {
          if (nextState !== "user_verified") {
            nextState = "user_edited";
            nextVerification = "needs_review";
          }
        }
      }

      if (nextState === "user_verified") {
        if (nextSection.summaryEvidenceRefs.length === 0) {
          throw new ResumeServiceError(
            "EVIDENCE_REQUIRED_FOR_VERIFICATION",
            400,
            "Link at least one verified career fact before marking the summary as verified."
          );
        }
        nextVerification = "verified";
      } else if (nextState === "user_edited") {
        nextVerification = "needs_review";
      }

      nextSection = {
        ...nextSection,
        summaryClaimId: claimId,
        summaryUserEditedState: nextState,
        summaryVerificationStatus: nextVerification,
      };
    }

    const nextEntries = nextSection.entries.map((entry) => {
      const nextBullets = entry.bullets.map((bullet) => {
        const existing = existingClaimsByStableId.get(bullet.id);
        let nextState: ClaimUserEditedState = bullet.userEditedState;
        let nextVerification: "verified" | "needs_review" | "rejected" =
          bullet.verificationStatus;

        if (isFromUpdate) {
          if (!existing) {
            if (nextState === "generated") {
              nextState = "user_edited";
            }
          } else if (bullet.text.trim() !== existing.text.trim()) {
            if (nextState !== "user_verified") {
              nextState = "user_edited";
              nextVerification = "needs_review";
            }
          }
        }

        if (nextState === "user_verified") {
          if (bullet.evidenceRefs.length === 0) {
            throw new ResumeServiceError(
              "EVIDENCE_REQUIRED_FOR_VERIFICATION",
              400,
              `Bullet "${bullet.id}" requires at least one verified career fact before being marked user_verified.`
            );
          }
          nextVerification = "verified";
        } else if (nextState === "user_edited") {
          nextVerification = "needs_review";
        }

        return {
          ...bullet,
          sectionId: nextSection.id,
          stableEntryId: entry.id,
          userEditedState: nextState,
          verificationStatus: nextVerification,
        };
      });

      return {
        ...entry,
        bullets: nextBullets,
      };
    });

    return {
      ...nextSection,
      entries: nextEntries,
    };
  });

  const normalizedDoc: StructuredResumeDocument = {
    version: 1,
    header: doc.header,
    sections: normalizedSections,
  };

  // Validate all cited evidenceRefs exist and are verified in catalog,
  // and validate strict factuality for any "generated" claims.
  const factuality = validateStructuredResumeFactuality(normalizedDoc, catalog);
  if (!factuality.valid) {
    throw new ResumeServiceError(
      "FACTUALITY_VALIDATION_FAILED",
      400,
      factuality.violations[0] ?? "Resume content cites unverified facts or violates factuality rules."
    );
  }

  return normalizedDoc;
}

function syncDraftClaimsTx(
  tx: Parameters<Parameters<AppDatabase["transaction"]>[0]>[0],
  resumeDraftId: string,
  claims: FlattenedResumeClaim[],
  catalog: VerifiedFactCatalog,
  nowIso: string
): void {
  const existingRows = tx
    .select()
    .from(resumeClaims)
    .where(eq(resumeClaims.resumeDraftId, resumeDraftId))
    .all();

  const existingByStableId = new Map<string, typeof resumeClaims.$inferSelect>();
  for (const row of existingRows) {
    existingByStableId.set(row.stableClaimId, row);
  }

  const validEvidenceLinkIds = new Set(
    tx
      .select({ id: evidenceLinks.id })
      .from(evidenceLinks)
      .all()
      .map((r) => r.id)
  );

  const seenStableIds = new Set<string>();

  for (const claim of claims) {
    seenStableIds.add(claim.stableClaimId);
    const existing = existingByStableId.get(claim.stableClaimId);
    let claimRowId: string;

    if (existing) {
      claimRowId = existing.id;
      tx.update(resumeClaims)
        .set({
          stableEntryId: claim.stableEntryId,
          sectionId: claim.sectionId,
          sectionType: claim.sectionType,
          text: claim.text,
          sortOrder: claim.sortOrder,
          userEditedState: claim.userEditedState,
          verificationStatus: claim.verificationStatus,
          updatedAt: nowIso,
        })
        .where(eq(resumeClaims.id, existing.id))
        .run();

      tx.delete(resumeClaimEvidence)
        .where(eq(resumeClaimEvidence.resumeClaimId, existing.id))
        .run();
    } else {
      claimRowId = crypto.randomUUID();
      tx.insert(resumeClaims)
        .values({
          id: claimRowId,
          resumeDraftId,
          stableClaimId: claim.stableClaimId,
          stableEntryId: claim.stableEntryId,
          sectionId: claim.sectionId,
          sectionType: claim.sectionType,
          text: claim.text,
          sortOrder: claim.sortOrder,
          userEditedState: claim.userEditedState,
          verificationStatus: claim.verificationStatus,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
    }

    const seenFactKeys = new Set<string>();
    for (const ref of claim.evidenceRefs) {
      const key = makeFactCatalogKey(ref.factType, ref.factId);
      if (seenFactKeys.has(key)) continue;
      seenFactKeys.add(key);

      const fact = catalog.byKey[key];
      const candidateLinkId = ref.evidenceLinkId ?? fact?.defaultEvidenceLinkId ?? null;
      const safeEvidenceLinkId =
        candidateLinkId && validEvidenceLinkIds.has(candidateLinkId)
          ? candidateLinkId
          : null;

      tx.insert(resumeClaimEvidence)
        .values({
          id: crypto.randomUUID(),
          resumeClaimId: claimRowId,
          evidenceLinkId: safeEvidenceLinkId,
          factType: ref.factType,
          factId: ref.factId,
          excerpt: ref.excerpt ?? fact?.excerpt ?? null,
          createdAt: nowIso,
        })
        .run();
    }
  }

  for (const row of existingRows) {
    if (!seenStableIds.has(row.stableClaimId)) {
      tx.delete(resumeClaims).where(eq(resumeClaims.id, row.id)).run();
    }
  }
}

function hydrateClaimsForDraft(
  resumeDraftId: string,
  db: AppDatabase
): HydratedResumeClaim[] {
  const claimRows = db
    .select()
    .from(resumeClaims)
    .where(eq(resumeClaims.resumeDraftId, resumeDraftId))
    .orderBy(asc(resumeClaims.sortOrder), asc(resumeClaims.createdAt))
    .all();

  if (claimRows.length === 0) return [];

  const claimIds = claimRows.map((c) => c.id);
  const evidenceRows = db
    .select()
    .from(resumeClaimEvidence)
    .where(inArray(resumeClaimEvidence.resumeClaimId, claimIds))
    .orderBy(asc(resumeClaimEvidence.createdAt))
    .all();

  const evidenceByClaimId = new Map<string, HydratedResumeClaimEvidence[]>();
  for (const ev of evidenceRows) {
    const list = evidenceByClaimId.get(ev.resumeClaimId) ?? [];
    list.push({
      id: ev.id,
      resumeClaimId: ev.resumeClaimId,
      evidenceLinkId: ev.evidenceLinkId,
      factType: ev.factType,
      factId: ev.factId,
      excerpt: ev.excerpt,
      createdAt: ev.createdAt,
    });
    evidenceByClaimId.set(ev.resumeClaimId, list);
  }

  return claimRows.map((c) => {
    const evidence = evidenceByClaimId.get(c.id) ?? [];
    return {
      id: c.id,
      resumeDraftId: c.resumeDraftId,
      stableClaimId: c.stableClaimId,
      stableEntryId: c.stableEntryId,
      sectionId: c.sectionId,
      sectionType: c.sectionType,
      text: c.text,
      sortOrder: c.sortOrder,
      userEditedState: c.userEditedState,
      verificationStatus: c.verificationStatus,
      evidence,
      evidenceRefs: evidence.map((ev) => ({
        factType: ev.factType,
        factId: ev.factId,
        evidenceLinkId: ev.evidenceLinkId,
        excerpt: ev.excerpt,
      })),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });
}

function mapResumeVersionRow(
  row: typeof resumeVersions.$inferSelect,
  exportsForVersion: SerializedDocumentExport[]
): HydratedResumeVersion {
  const structuredContent = StructuredResumeDocumentSchema.parse(
    safeJsonParse(row.structuredContentJson, {
      version: 1,
      header: { fullName: "Candidate", links: [] },
      sections: [],
    })
  );
  const templateSettings = ResumeTemplateSettingsSchema.parse(
    safeJsonParse(row.templateSettingsJson, DEFAULT_RESUME_TEMPLATE_SETTINGS)
  );

  return {
    id: row.id,
    resumeDraftId: row.resumeDraftId,
    versionNumber: row.versionNumber,
    jobId: row.jobId,
    searchProfileId: row.searchProfileId,
    jobDescriptionHash: row.jobDescriptionHash,
    careerProfileHash: row.careerProfileHash,
    structuredContent,
    templateSettings,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    promptVersion: row.promptVersion,
    userEditedState: row.userEditedState,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    exports: exportsForVersion,
  };
}

/**
 * Lists all resume drafts ordered by `updatedAt DESC` with job, profile, claim,
 * version, and export summaries.
 */
export function listResumeDrafts(
  db: AppDatabase = getDb(),
  options?: {
    jobId?: string;
    searchProfileId?: string;
    state?: ResumeDraftState;
    includeArchived?: boolean;
  }
): ResumeDraftListItem[] {
  const conditions = [];
  if (options?.jobId) {
    const canonical = resolveCanonicalJobRow(db, options.jobId);
    conditions.push(eq(resumeDrafts.jobId, canonical.id));
  }
  if (options?.searchProfileId) {
    conditions.push(eq(resumeDrafts.searchProfileId, options.searchProfileId));
  }
  if (options?.state) {
    conditions.push(eq(resumeDrafts.state, options.state));
  } else if (options?.includeArchived === false) {
    conditions.push(ne(resumeDrafts.state, "archived"));
  }

  const draftRows =
    conditions.length > 0
      ? db
          .select()
          .from(resumeDrafts)
          .where(and(...conditions))
          .orderBy(desc(resumeDrafts.updatedAt))
          .all()
      : db
          .select()
          .from(resumeDrafts)
          .orderBy(desc(resumeDrafts.updatedAt))
          .all();

  if (draftRows.length === 0) {
    return [];
  }

  const jobIds = Array.from(new Set(draftRows.map((d) => d.jobId)));
  const profileIds = Array.from(new Set(draftRows.map((d) => d.searchProfileId)));
  const draftIds = draftRows.map((d) => d.id);

  const jobRows = db.select().from(jobs).where(inArray(jobs.id, jobIds)).all();
  const jobMap = new Map(jobRows.map((j) => [j.id, j]));

  const profileRows = db
    .select()
    .from(searchProfiles)
    .where(inArray(searchProfiles.id, profileIds))
    .all();
  const profileMap = new Map(profileRows.map((p) => [p.id, p]));

  const claimRows = db
    .select()
    .from(resumeClaims)
    .where(inArray(resumeClaims.resumeDraftId, draftIds))
    .all();
  const claimStatsMap = new Map<
    string,
    { total: number; verified: number; needsReview: number; userEdited: number }
  >();
  for (const c of claimRows) {
    const stat = claimStatsMap.get(c.resumeDraftId) ?? {
      total: 0,
      verified: 0,
      needsReview: 0,
      userEdited: 0,
    };
    stat.total += 1;
    if (c.verificationStatus === "verified") stat.verified += 1;
    if (c.verificationStatus === "needs_review") stat.needsReview += 1;
    if (c.userEditedState === "user_edited") stat.userEdited += 1;
    claimStatsMap.set(c.resumeDraftId, stat);
  }

  const versionRows = db
    .select()
    .from(resumeVersions)
    .where(inArray(resumeVersions.resumeDraftId, draftIds))
    .orderBy(desc(resumeVersions.versionNumber))
    .all();
  const versionIds = versionRows.map((v) => v.id);
  const versionsByDraftId = new Map<string, Array<typeof resumeVersions.$inferSelect>>();
  for (const v of versionRows) {
    const list = versionsByDraftId.get(v.resumeDraftId) ?? [];
    list.push(v);
    versionsByDraftId.set(v.resumeDraftId, list);
  }

  const exportRows =
    versionIds.length > 0
      ? db
          .select()
          .from(documentExports)
          .where(inArray(documentExports.resumeVersionId, versionIds))
          .orderBy(desc(documentExports.exportedAt))
          .all()
      : [];
  const versionIdToDraftId = new Map(versionRows.map((v) => [v.id, v.resumeDraftId]));
  const exportsByDraftId = new Map<string, SerializedDocumentExport[]>();
  for (const ex of exportRows) {
    if (!ex.resumeVersionId) continue;
    const draftId = versionIdToDraftId.get(ex.resumeVersionId);
    if (!draftId) continue;
    const list = exportsByDraftId.get(draftId) ?? [];
    list.push(serializeDocumentExport(ex));
    exportsByDraftId.set(draftId, list);
  }

  return draftRows.map((draft) => {
    const job = jobMap.get(draft.jobId) ?? null;
    const sp = profileMap.get(draft.searchProfileId) ?? null;
    const jobSnap = safeJsonParse<Record<string, unknown>>(draft.jobSnapshotJson, {});
    const stats = claimStatsMap.get(draft.id) ?? {
      total: 0,
      verified: 0,
      needsReview: 0,
      userEdited: 0,
    };
    const draftVersions = versionsByDraftId.get(draft.id) ?? [];
    const latestVersion = draftVersions[0] ?? null;
    const draftExports = exportsByDraftId.get(draft.id) ?? [];

    const jobTitle =
      job?.title ??
      (typeof jobSnap.title === "string" ? jobSnap.title : "Untitled role");
    const companyName =
      job?.companyName ??
      (typeof jobSnap.companyName === "string"
        ? jobSnap.companyName
        : "Unknown company");
    const locationText =
      job?.locationText ??
      (typeof jobSnap.locationText === "string" ? jobSnap.locationText : null);
    const workplaceType =
      job?.workplaceType ??
      (typeof jobSnap.workplaceType === "string"
        ? jobSnap.workplaceType
        : "unspecified");

    return {
      id: draft.id,
      jobId: draft.jobId,
      jobTitle,
      companyName,
      locationText,
      workplaceType,
      searchProfileId: draft.searchProfileId,
      searchProfileName: sp?.name ?? null,
      state: draft.state,
      claimsCount: stats.total,
      claimCount: stats.total,
      verifiedClaimCount: stats.verified,
      needsReviewCount: stats.needsReview,
      userEditedCount: stats.userEdited,
      latestVersionNumber: latestVersion?.versionNumber ?? null,
      latestVersionId: latestVersion?.id ?? null,
      versionCount: draftVersions.length,
      latestExports: draftExports.slice(0, 5),
      exportsCount: draftExports.length,
      latestExportAt: draftExports[0]?.exportedAt ?? null,
      modelProvider: draft.modelProvider,
      modelName: draft.modelName,
      promptVersion: draft.promptVersion,
      careerProfileHash: draft.careerProfileHash,
      jobDescriptionHash: draft.jobDescriptionHash,
      job: job
        ? {
            id: job.id,
            title: job.title,
            companyName: job.companyName,
            locationText: job.locationText,
            workplaceType: job.workplaceType,
            status: job.status,
            canonicalUrl: job.canonicalUrl,
            applyUrl: job.applyUrl,
          }
        : null,
      searchProfile: sp
        ? {
            id: sp.id,
            name: sp.name,
          }
        : null,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
  });
}

/**
 * Returns a fully hydrated resume draft detail including structured content,
 * template settings, claim evidence, immutable versions, exports, verified fact catalog,
 * and ATS-safe HTML preview.
 */
export function getResumeDraftDetail(
  id: string,
  db: AppDatabase = getDb()
): ResumeDraftDetail | null {
  const draft = db
    .select()
    .from(resumeDrafts)
    .where(eq(resumeDrafts.id, id))
    .get();
  if (!draft) {
    return null;
  }

  const job = db.select().from(jobs).where(eq(jobs.id, draft.jobId)).get() ?? null;
  const sp =
    db
      .select()
      .from(searchProfiles)
      .where(eq(searchProfiles.id, draft.searchProfileId))
      .get() ?? null;

  const claims = hydrateClaimsForDraft(draft.id, db);
  const structuredContent = StructuredResumeDocumentSchema.parse(
    safeJsonParse(draft.structuredContentJson, {
      version: 1,
      header: { fullName: "Candidate", links: [] },
      sections: [],
    })
  );
  const templateSettings = ResumeTemplateSettingsSchema.parse(
    safeJsonParse(draft.templateSettingsJson, DEFAULT_RESUME_TEMPLATE_SETTINGS)
  );

  const versionRows = db
    .select()
    .from(resumeVersions)
    .where(eq(resumeVersions.resumeDraftId, draft.id))
    .orderBy(desc(resumeVersions.versionNumber))
    .all();

  const versionIds = versionRows.map((v) => v.id);
  const exportRows =
    versionIds.length > 0
      ? db
          .select()
          .from(documentExports)
          .where(inArray(documentExports.resumeVersionId, versionIds))
          .orderBy(desc(documentExports.exportedAt))
          .all()
      : [];

  const serializedExports = exportRows.map(serializeDocumentExport);
  const exportsByVersionId = new Map<string, SerializedDocumentExport[]>();
  for (const ex of serializedExports) {
    if (!ex.resumeVersionId) continue;
    const list = exportsByVersionId.get(ex.resumeVersionId) ?? [];
    list.push(ex);
    exportsByVersionId.set(ex.resumeVersionId, list);
  }

  const versions = versionRows.map((v) =>
    mapResumeVersionRow(v, exportsByVersionId.get(v.id) ?? [])
  );

  const careerProfile = getFullCareerProfile(db);
  const catalog = buildVerifiedFactCatalog(careerProfile);
  const verifiedFacts: SafeVerifiedFactSummary[] = catalog.items.map((item) => ({
    key: item.key,
    factType: item.factType,
    factId: item.factId,
    label: item.label,
    excerpt: item.excerpt,
    defaultEvidenceLinkId: item.defaultEvidenceLinkId,
  }));

  const jobSnapshot = safeJsonParse<Record<string, unknown>>(
    draft.jobSnapshotJson,
    {}
  );
  const careerProfileSnapshot = safeJsonParse<Record<string, unknown>>(
    draft.careerProfileSnapshotJson,
    {}
  );

  const jobTitle =
    job?.title ??
    (typeof jobSnapshot.title === "string" ? jobSnapshot.title : "Untitled role");
  const companyName =
    job?.companyName ??
    (typeof jobSnapshot.companyName === "string"
      ? jobSnapshot.companyName
      : "Unknown company");
  const locationText =
    job?.locationText ??
    (typeof jobSnapshot.locationText === "string"
      ? jobSnapshot.locationText
      : null);
  const workplaceType =
    job?.workplaceType ??
    (typeof jobSnapshot.workplaceType === "string"
      ? jobSnapshot.workplaceType
      : "unspecified");

  const renderedPreviewHtml = renderResumeHtml(
    structuredContent,
    templateSettings,
    {
      title: `${structuredContent.header.fullName} - ${jobTitle}`,
    }
  );

  return {
    id: draft.id,
    jobId: draft.jobId,
    jobTitle,
    companyName,
    locationText,
    workplaceType,
    searchProfileId: draft.searchProfileId,
    searchProfileName: sp?.name ?? null,
    state: draft.state,
    claimsCount: claims.length,
    claimCount: claims.length,
    verifiedClaimCount: claims.filter((c) => c.verificationStatus === "verified").length,
    needsReviewCount: claims.filter((c) => c.verificationStatus === "needs_review").length,
    userEditedCount: claims.filter((c) => c.userEditedState === "user_edited").length,
    latestVersionNumber: versions[0]?.versionNumber ?? null,
    latestVersionId: versions[0]?.id ?? null,
    versionCount: versions.length,
    latestExports: serializedExports.slice(0, 5),
    exportsCount: serializedExports.length,
    latestExportAt: serializedExports[0]?.exportedAt ?? null,
    modelProvider: draft.modelProvider,
    modelName: draft.modelName,
    promptVersion: draft.promptVersion,
    careerProfileHash: draft.careerProfileHash,
    jobDescriptionHash: draft.jobDescriptionHash,
    job: job
      ? {
          id: job.id,
          title: job.title,
          companyName: job.companyName,
          locationText: job.locationText,
          workplaceType: job.workplaceType,
          status: job.status,
          canonicalUrl: job.canonicalUrl,
          applyUrl: job.applyUrl,
        }
      : null,
    searchProfile: sp
      ? {
          id: sp.id,
          name: sp.name,
        }
      : null,
    structuredContent,
    templateSettings: enrichTemplateSettings(templateSettings),
    claims,
    versions,
    exports: serializedExports,
    verifiedFacts,
    renderedPreviewHtml,
    careerProfileSnapshot,
    jobSnapshot,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

export interface CreateOrTailorResumeDraftInput {
  jobId: string;
  searchProfileId?: string | null;
  mode?: MaterialGenerationMode;
  templateSettings?: Partial<ResumeTemplateSettings>;
  regenerate?: boolean;
  taskId?: string;
  db?: AppDatabase;
  now?: () => Date;
}

/**
 * Creates or returns an existing non-archived tailored resume draft for `(jobId, searchProfileId)`.
 * When `regenerate` is true, regenerates the working draft and syncs claims without mutating
 * any existing immutable `resumeVersions`.
 */
export async function createOrTailorResumeDraft(
  input: CreateOrTailorResumeDraftInput
): Promise<ResumeDraftDetail> {
  const db = input.db ?? getDb();
  const canonicalJob = resolveCanonicalJobRow(db, input.jobId);
  const searchProfile = resolveEffectiveSearchProfile(db, input.searchProfileId);

  const existing = db
    .select()
    .from(resumeDrafts)
    .where(
      and(
        eq(resumeDrafts.jobId, canonicalJob.id),
        eq(resumeDrafts.searchProfileId, searchProfile.id),
        ne(resumeDrafts.state, "archived")
      )
    )
    .orderBy(desc(resumeDrafts.updatedAt))
    .get();

  if (existing && !input.regenerate) {
    const hydrated = getResumeDraftDetail(existing.id, db);
    if (hydrated) return hydrated;
  }

  let generated;
  try {
    generated = await generateTailoredResume({
      jobId: canonicalJob.id,
      searchProfileId: searchProfile.id,
      mode: input.mode,
      templateSettings: input.templateSettings,
      taskId: input.taskId,
      db,
      now: input.now,
    });
  } catch (err) {
    if (err instanceof MaterialsGenerationError) {
      throw new ResumeServiceError(err.code, err.status, err.message);
    }
    throw err;
  }

  const catalog = buildVerifiedFactCatalog(getFullCareerProfile(db));
  const nowIso = (input.now ? input.now() : new Date()).toISOString();
  const structuredContentJson = JSON.stringify(generated.document);
  const templateSettingsJson = JSON.stringify(generated.templateSettings);

  const draftId = existing?.id ?? crypto.randomUUID();

  db.transaction(
    (tx) => {
      if (existing) {
        tx.update(resumeDrafts)
          .set({
            careerProfileSnapshotJson: generated.careerProfileSnapshotJson,
            careerProfileHash: generated.careerProfileHash,
            jobSnapshotJson: generated.jobSnapshotJson,
            jobDescriptionHash: generated.jobDescriptionHash,
            structuredContentJson,
            templateSettingsJson,
            modelProvider: generated.modelProvider,
            modelName: generated.modelName,
            promptVersion: generated.promptVersion,
            state: "draft",
            updatedAt: nowIso,
          })
          .where(eq(resumeDrafts.id, existing.id))
          .run();
      } else {
        tx.insert(resumeDrafts)
          .values({
            id: draftId,
            jobId: canonicalJob.id,
            searchProfileId: searchProfile.id,
            careerProfileSnapshotJson: generated.careerProfileSnapshotJson,
            careerProfileHash: generated.careerProfileHash,
            jobSnapshotJson: generated.jobSnapshotJson,
            jobDescriptionHash: generated.jobDescriptionHash,
            structuredContentJson,
            templateSettingsJson,
            modelProvider: generated.modelProvider,
            modelName: generated.modelName,
            promptVersion: generated.promptVersion,
            state: "draft",
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .run();
      }

      syncDraftClaimsTx(tx, draftId, generated.claims, catalog, nowIso);
    },
    { behavior: "immediate" }
  );

  const detail = getResumeDraftDetail(draftId, db);
  if (!detail) {
    throw new ResumeServiceError(
      "RESUME_NOT_FOUND",
      404,
      "Tailored resume draft could not be reloaded."
    );
  }
  return detail;
}

/**
 * Updates a working resume draft's structured content, template settings, and/or state
 * while preserving `stableClaimId`s on reorder, marking edited text as `user_edited`,
 * and validating cited facts against the verified career catalog.
 */
export function updateResumeDraft(
  id: string,
  rawPatch: unknown,
  db: AppDatabase = getDb(),
  now: () => Date = () => new Date()
): ResumeDraftDetail {
  const patch = ResumeDraftPatchSchema.parse(rawPatch);

  const existingDraft = db
    .select()
    .from(resumeDrafts)
    .where(eq(resumeDrafts.id, id))
    .get();
  if (!existingDraft) {
    throw new ResumeServiceError(
      "RESUME_NOT_FOUND",
      404,
      `Resume draft not found: ${id}`
    );
  }

  const currentDoc = StructuredResumeDocumentSchema.parse(
    safeJsonParse(existingDraft.structuredContentJson, {
      version: 1,
      header: { fullName: "Candidate", links: [] },
      sections: [],
    })
  );
  const currentSettings = ResumeTemplateSettingsSchema.parse(
    safeJsonParse(
      existingDraft.templateSettingsJson,
      DEFAULT_RESUME_TEMPLATE_SETTINGS
    )
  );

  const catalog = buildVerifiedFactCatalog(getFullCareerProfile(db));

  const nextSettings =
    patch.templateSettings !== undefined
      ? normalizeIncomingTemplateSettings(patch.templateSettings, currentSettings)
      : currentSettings;

  let nextDoc = currentDoc;
  let flattenedClaims: FlattenedResumeClaim[] | null = null;

  if (patch.structuredContent !== undefined) {
    const parsedIncoming = normalizeIncomingStructuredDocument(
      patch.structuredContent,
      currentDoc,
      catalog
    );

    const existingClaimRows = db
      .select()
      .from(resumeClaims)
      .where(eq(resumeClaims.resumeDraftId, existingDraft.id))
      .all();
    const existingByStableId = new Map(
      existingClaimRows.map((c) => [c.stableClaimId, c])
    );

    nextDoc = validateAndNormalizeDocumentClaims({
      doc: parsedIncoming,
      existingClaimsByStableId: existingByStableId,
      catalog,
      isFromUpdate: true,
    });
    flattenedClaims = flattenResumeClaims(nextDoc);
  }

  const nowIso = now().toISOString();
  const nextStructuredJson = JSON.stringify(nextDoc);
  const nextSettingsJson = JSON.stringify(nextSettings);
  const nextState = patch.state ?? existingDraft.state;

  db.transaction(
    (tx) => {
      tx.update(resumeDrafts)
        .set({
          structuredContentJson: nextStructuredJson,
          templateSettingsJson: nextSettingsJson,
          state: nextState,
          updatedAt: nowIso,
        })
        .where(eq(resumeDrafts.id, existingDraft.id))
        .run();

      if (flattenedClaims !== null) {
        syncDraftClaimsTx(
          tx,
          existingDraft.id,
          flattenedClaims,
          catalog,
          nowIso
        );
      }
    },
    { behavior: "immediate" }
  );

  const detail = getResumeDraftDetail(existingDraft.id, db);
  if (!detail) {
    throw new ResumeServiceError(
      "RESUME_NOT_FOUND",
      404,
      `Resume draft not found: ${id}`
    );
  }
  return detail;
}

export interface UpdateResumeClaimInput {
  resumeDraftId: string;
  claimId: string;
  text?: string;
  userEditedState?: ClaimUserEditedState;
  evidenceRefs?: ClaimEvidenceRef[];
}

/**
 * Updates a single resume claim's wording, verification confirmation, and/or verified
 * career evidence links, keeping `resumeClaims`, `resumeClaimEvidence`, and `structuredContentJson`
 * synchronized inside a single transaction.
 */
export function updateResumeClaim(
  input: UpdateResumeClaimInput,
  db: AppDatabase = getDb(),
  now: () => Date = () => new Date()
): ResumeDraftDetail {
  const parsed = ResumeClaimUpdateSchema.parse({
    text: input.text,
    userEditedState: input.userEditedState,
    evidenceRefs: input.evidenceRefs,
  });

  const draft = db
    .select()
    .from(resumeDrafts)
    .where(eq(resumeDrafts.id, input.resumeDraftId))
    .get();
  if (!draft) {
    throw new ResumeServiceError(
      "RESUME_NOT_FOUND",
      404,
      `Resume draft not found: ${input.resumeDraftId}`
    );
  }

  const draftClaims = db
    .select()
    .from(resumeClaims)
    .where(eq(resumeClaims.resumeDraftId, draft.id))
    .all();

  const targetClaim = draftClaims.find(
    (c) => c.id === input.claimId || c.stableClaimId === input.claimId
  );
  if (!targetClaim) {
    throw new ResumeServiceError(
      "CLAIM_NOT_FOUND",
      404,
      `Resume claim not found: ${input.claimId}`
    );
  }

  const existingEvidence = db
    .select()
    .from(resumeClaimEvidence)
    .where(eq(resumeClaimEvidence.resumeClaimId, targetClaim.id))
    .all();

  const catalog = buildVerifiedFactCatalog(getFullCareerProfile(db));

  const nextEvidenceRefs: ClaimEvidenceRef[] =
    parsed.evidenceRefs !== undefined
      ? parsed.evidenceRefs
      : existingEvidence.map((ev) => ({
          factType: ev.factType,
          factId: ev.factId,
          evidenceLinkId: ev.evidenceLinkId,
          excerpt: ev.excerpt,
        }));

  for (const ref of nextEvidenceRefs) {
    const key = makeFactCatalogKey(ref.factType, ref.factId);
    if (!catalog.byKey[key]) {
      throw new ResumeServiceError(
        "UNVERIFIED_EVIDENCE_REF",
        400,
        `Cannot link unverified, rejected, or non-existent career fact "${key}".`
      );
    }
  }

  const nextText = parsed.text !== undefined ? parsed.text.trim() : targetClaim.text;
  if (!nextText) {
    throw new ResumeServiceError(
      "EMPTY_CLAIM_TEXT",
      400,
      "Claim text must not be empty."
    );
  }

  const textChanged = nextText !== targetClaim.text.trim();
  let nextUserEditedState: ClaimUserEditedState = targetClaim.userEditedState;
  if (parsed.userEditedState !== undefined) {
    nextUserEditedState = parsed.userEditedState;
  } else if (textChanged) {
    nextUserEditedState = "user_edited";
  }

  if (nextUserEditedState === "user_verified" && nextEvidenceRefs.length === 0) {
    throw new ResumeServiceError(
      "EVIDENCE_REQUIRED_FOR_VERIFICATION",
      400,
      "Link at least one verified career fact before marking this claim as verified."
    );
  }

  const violations = validateClaimAgainstCatalog({
    text: nextText,
    userEditedState: nextUserEditedState,
    evidenceRefs: nextEvidenceRefs,
    catalog,
    claimLabel: `claim "${targetClaim.stableClaimId}"`,
  });
  if (violations.length > 0) {
    throw new ResumeServiceError(
      "FACTUALITY_VALIDATION_FAILED",
      400,
      violations[0]
    );
  }

  const nextVerificationStatus: VerificationStatus =
    nextUserEditedState === "user_verified"
      ? "verified"
      : nextUserEditedState === "user_edited"
        ? "needs_review"
        : targetClaim.verificationStatus;

  const doc = StructuredResumeDocumentSchema.parse(
    safeJsonParse(draft.structuredContentJson, {
      version: 1,
      header: { fullName: "Candidate", links: [] },
      sections: [],
    })
  );

  const hydratedRefs: ClaimEvidenceRef[] = nextEvidenceRefs.map((ref) => {
    const fact = catalog.byKey[makeFactCatalogKey(ref.factType, ref.factId)];
    return {
      factType: ref.factType,
      factId: ref.factId,
      evidenceLinkId: ref.evidenceLinkId ?? fact?.defaultEvidenceLinkId ?? null,
      excerpt: ref.excerpt ?? fact?.excerpt ?? null,
    };
  });

  let updatedInDoc = false;
  const updatedDoc: StructuredResumeDocument = {
    ...doc,
    sections: doc.sections.map((section) => {
      if (section.summaryClaimId === targetClaim.stableClaimId) {
        updatedInDoc = true;
        return {
          ...section,
          summaryText: nextText,
          summaryUserEditedState: nextUserEditedState,
          summaryVerificationStatus:
            nextVerificationStatus === "archived"
              ? "needs_review"
              : nextVerificationStatus,
          summaryEvidenceRefs: hydratedRefs,
        };
      }
      return {
        ...section,
        entries: section.entries.map((entry) => ({
          ...entry,
          bullets: entry.bullets.map((bullet) => {
            if (bullet.id === targetClaim.stableClaimId) {
              updatedInDoc = true;
              return {
                ...bullet,
                text: nextText,
                userEditedState: nextUserEditedState,
                verificationStatus:
                  nextVerificationStatus === "archived"
                    ? "needs_review"
                    : nextVerificationStatus,
                evidenceRefs: hydratedRefs,
              };
            }
            return bullet;
          }),
        })),
      };
    }),
  };

  if (!updatedInDoc) {
    throw new ResumeServiceError(
      "CLAIM_NOT_IN_DOCUMENT",
      409,
      `Claim "${targetClaim.stableClaimId}" is no longer present in the resume document.`
    );
  }

  const nowIso = now().toISOString();
  const nextStructuredJson = JSON.stringify(updatedDoc);

  db.transaction(
    (tx) => {
      const validEvidenceLinkIds = new Set(
        tx
          .select({ id: evidenceLinks.id })
          .from(evidenceLinks)
          .all()
          .map((r) => r.id)
      );

      tx.update(resumeClaims)
        .set({
          text: nextText,
          userEditedState: nextUserEditedState,
          verificationStatus: nextVerificationStatus,
          updatedAt: nowIso,
        })
        .where(eq(resumeClaims.id, targetClaim.id))
        .run();

      tx.delete(resumeClaimEvidence)
        .where(eq(resumeClaimEvidence.resumeClaimId, targetClaim.id))
        .run();

      const seenKeys = new Set<string>();
      for (const ref of hydratedRefs) {
        const key = makeFactCatalogKey(ref.factType, ref.factId);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const safeLinkId =
          ref.evidenceLinkId && validEvidenceLinkIds.has(ref.evidenceLinkId)
            ? ref.evidenceLinkId
            : null;

        tx.insert(resumeClaimEvidence)
          .values({
            id: crypto.randomUUID(),
            resumeClaimId: targetClaim.id,
            evidenceLinkId: safeLinkId,
            factType: ref.factType,
            factId: ref.factId,
            excerpt: ref.excerpt ?? null,
            createdAt: nowIso,
          })
          .run();
      }

      tx.update(resumeDrafts)
        .set({
          structuredContentJson: nextStructuredJson,
          updatedAt: nowIso,
        })
        .where(eq(resumeDrafts.id, draft.id))
        .run();
    },
    { behavior: "immediate" }
  );

  const detail = getResumeDraftDetail(draft.id, db);
  if (!detail) {
    throw new ResumeServiceError(
      "RESUME_NOT_FOUND",
      404,
      `Resume draft not found: ${input.resumeDraftId}`
    );
  }
  return detail;
}

/**
 * Deletes a working resume draft that has no immutable exported versions.
 */
export function deleteResumeDraft(
  id: string,
  db: AppDatabase = getDb()
): { deletedId: string } {
  const existing = db
    .select()
    .from(resumeDrafts)
    .where(eq(resumeDrafts.id, id))
    .get();
  if (!existing) {
    throw new ResumeServiceError(
      "RESUME_NOT_FOUND",
      404,
      `Resume draft not found: ${id}`
    );
  }

  const versionRow = db
    .select({ id: resumeVersions.id })
    .from(resumeVersions)
    .where(eq(resumeVersions.resumeDraftId, id))
    .get();

  if (versionRow) {
    throw new ResumeServiceError(
      "DRAFT_HAS_VERSIONS",
      409,
      "This resume draft has immutable versions and cannot be deleted; archive it instead."
    );
  }

  db.transaction(
    (tx) => {
      tx.delete(resumeDrafts).where(eq(resumeDrafts.id, id)).run();
    },
    { behavior: "immediate" }
  );

  return { deletedId: id };
}

/**
 * Creates an immutable `resumeVersions` snapshot for `resumeDraftId`, or returns the
 * latest version idempotently if its canonical content hash matches.
 */
export function createImmutableResumeVersion(
  resumeDraftId: string,
  db: AppDatabase = getDb(),
  options?: { now?: () => Date }
): { created: boolean; version: HydratedResumeVersion } {
  const draft = db
    .select()
    .from(resumeDrafts)
    .where(eq(resumeDrafts.id, resumeDraftId))
    .get();
  if (!draft) {
    throw new ResumeServiceError(
      "RESUME_NOT_FOUND",
      404,
      `Resume draft not found: ${resumeDraftId}`
    );
  }

  const structuredContent = StructuredResumeDocumentSchema.parse(
    safeJsonParse(draft.structuredContentJson, {
      version: 1,
      header: { fullName: "Candidate", links: [] },
      sections: [],
    })
  );
  const templateSettings = ResumeTemplateSettingsSchema.parse(
    safeJsonParse(draft.templateSettingsJson, DEFAULT_RESUME_TEMPLATE_SETTINGS)
  );

  const canonicalContentJson = JSON.stringify(structuredContent);
  const canonicalSettingsJson = JSON.stringify(templateSettings);
  const contentHash = sha256Hex(canonicalContentJson + canonicalSettingsJson);

  const latest = db
    .select()
    .from(resumeVersions)
    .where(eq(resumeVersions.resumeDraftId, draft.id))
    .orderBy(desc(resumeVersions.versionNumber))
    .get();

  if (latest && latest.contentHash === contentHash) {
    const existingExports = db
      .select()
      .from(documentExports)
      .where(eq(documentExports.resumeVersionId, latest.id))
      .orderBy(desc(documentExports.exportedAt))
      .all()
      .map(serializeDocumentExport);
    return {
      created: false,
      version: mapResumeVersionRow(latest, existingExports),
    };
  }

  const claims = hydrateClaimsForDraft(draft.id, db);
  const aggregateUserEditedState: UserEditedState = claims.some(
    (c) => c.userEditedState === "user_edited"
  )
    ? "user_edited"
    : claims.length > 0 && claims.every((c) => c.userEditedState === "user_verified")
      ? "user_verified"
      : "generated";

  const nowIso = (options?.now ? options.now() : new Date()).toISOString();
  const versionId = crypto.randomUUID();
  const claimEvidenceSnapshotJson = JSON.stringify(
    claims.map((c) => ({
      stableClaimId: c.stableClaimId,
      stableEntryId: c.stableEntryId,
      sectionId: c.sectionId,
      sectionType: c.sectionType,
      text: c.text,
      sortOrder: c.sortOrder,
      userEditedState: c.userEditedState,
      verificationStatus: c.verificationStatus,
      evidenceRefs: c.evidenceRefs,
    }))
  );

  const inserted = db.transaction(
    (tx) => {
      const currentLatest = tx
        .select()
        .from(resumeVersions)
        .where(eq(resumeVersions.resumeDraftId, draft.id))
        .orderBy(desc(resumeVersions.versionNumber))
        .get();

      if (currentLatest && currentLatest.contentHash === contentHash) {
        return { created: false as const, row: currentLatest };
      }

      const nextVersionNumber = (currentLatest?.versionNumber ?? 0) + 1;
      const rowValues: typeof resumeVersions.$inferInsert = {
        id: versionId,
        resumeDraftId: draft.id,
        versionNumber: nextVersionNumber,
        jobId: draft.jobId,
        searchProfileId: draft.searchProfileId,
        jobDescriptionSnapshotJson: draft.jobSnapshotJson,
        jobDescriptionHash: draft.jobDescriptionHash,
        careerProfileSnapshotJson: draft.careerProfileSnapshotJson,
        careerProfileHash: draft.careerProfileHash,
        structuredContentJson: canonicalContentJson,
        claimEvidenceSnapshotJson,
        templateSettingsJson: canonicalSettingsJson,
        modelProvider: draft.modelProvider,
        modelName: draft.modelName,
        promptVersion: draft.promptVersion,
        userEditedState: aggregateUserEditedState,
        contentHash,
        createdAt: nowIso,
      };

      tx.insert(resumeVersions).values(rowValues).run();

      if (draft.state === "draft") {
        tx.update(resumeDrafts)
          .set({ state: "reviewed", updatedAt: nowIso })
          .where(eq(resumeDrafts.id, draft.id))
          .run();
      }

      return { created: true as const, row: rowValues as typeof resumeVersions.$inferSelect };
    },
    { behavior: "immediate" }
  );

  if (!inserted.created) {
    const existingExports = db
      .select()
      .from(documentExports)
      .where(eq(documentExports.resumeVersionId, inserted.row.id))
      .orderBy(desc(documentExports.exportedAt))
      .all()
      .map(serializeDocumentExport);
    return {
      created: false,
      version: mapResumeVersionRow(inserted.row, existingExports),
    };
  }

  return {
    created: true,
    version: mapResumeVersionRow(inserted.row, []),
  };
}

export interface ExportResumeDocumentInput {
  resumeDraftId: string;
  format: ExportFormat;
  versionId?: string;
  paperSize?: "A4" | "Letter";
  db?: AppDatabase;
  appDataDir?: string;
  now?: () => Date;
}

export interface ExportResumeDocumentResult {
  exportRecord: SerializedDocumentExport;
  version: HydratedResumeVersion;
  downloadUrl: string;
}

/**
 * Exports a resume draft (via an immutable `resumeVersion`) as DOCX, PDF, TXT, or Markdown,
 * storing the file securely inside `APP_DATA_DIR/exports/resumes` and recording an immutable
 * `documentExports` row.
 */
export async function exportResumeDocument(
  input: ExportResumeDocumentInput
): Promise<ExportResumeDocumentResult> {
  if (!EXPORT_FORMATS.includes(input.format)) {
    throw new ResumeServiceError(
      "INVALID_EXPORT_FORMAT",
      400,
      `Unsupported export format: ${String(input.format)}`
    );
  }

  const db = input.db ?? getDb();

  let version: HydratedResumeVersion;
  if (input.versionId) {
    const versionRow = db
      .select()
      .from(resumeVersions)
      .where(
        and(
          eq(resumeVersions.id, input.versionId),
          eq(resumeVersions.resumeDraftId, input.resumeDraftId)
        )
      )
      .get();
    if (!versionRow) {
      throw new ResumeServiceError(
        "VERSION_NOT_FOUND",
        404,
        `Resume version not found: ${input.versionId}`
      );
    }
    const existingExports = db
      .select()
      .from(documentExports)
      .where(eq(documentExports.resumeVersionId, versionRow.id))
      .orderBy(desc(documentExports.exportedAt))
      .all()
      .map(serializeDocumentExport);
    version = mapResumeVersionRow(versionRow, existingExports);
  } else {
    version = createImmutableResumeVersion(input.resumeDraftId, db, {
      now: input.now,
    }).version;
  }

  const catalog = buildVerifiedFactCatalog(getFullCareerProfile(db));
  const factuality = validateStructuredResumeFactuality(
    version.structuredContent,
    catalog
  );
  if (!factuality.valid) {
    throw new ResumeServiceError(
      "FACTUALITY_VALIDATION_FAILED",
      400,
      factuality.violations[0] ?? "Cannot export resume with unverified fact references."
    );
  }

  const effectiveSettings: ResumeTemplateSettings = input.paperSize
    ? ResumeTemplateSettingsSchema.parse({
        ...version.templateSettings,
        paperSize: input.paperSize,
      })
    : version.templateSettings;

  let buffer: Buffer;
  switch (input.format) {
    case "docx":
      buffer = await exportResumeToDocxBuffer(
        version.structuredContent,
        effectiveSettings
      );
      break;
    case "pdf": {
      const html = renderResumeHtml(version.structuredContent, effectiveSettings, {
        title: `${version.structuredContent.header.fullName} - Resume`,
      });
      buffer = await exportHtmlToPdfBuffer(html, effectiveSettings.paperSize);
      break;
    }
    case "txt":
      buffer = Buffer.from(
        renderResumePlainText(version.structuredContent, effectiveSettings),
        "utf-8"
      );
      break;
    case "md":
      buffer = Buffer.from(
        renderResumeMarkdown(version.structuredContent, effectiveSettings),
        "utf-8"
      );
      break;
  }

  const exportId = crypto.randomUUID();
  const paths = ensureAppDirectories(input.appDataDir);
  const fileName = `resume-v${version.versionNumber}-${exportId.slice(0, 8)}.${input.format}`;
  const targetPath = assertPathWithin(paths.resumeExports, fileName);
  writeSecureFile(targetPath, buffer);

  const relativePath = path.relative(paths.base, targetPath);
  const fileHash = sha256Hex(buffer);
  const fileSizeBytes = buffer.byteLength;
  const nowIso = (input.now ? input.now() : new Date()).toISOString();

  const rowValues: typeof documentExports.$inferInsert = {
    id: exportId,
    resumeVersionId: version.id,
    coverLetterId: null,
    documentType: "resume",
    format: input.format,
    filePath: relativePath,
    fileHash,
    fileSizeBytes,
    exportedAt: nowIso,
  };

  db.transaction(
    (tx) => {
      tx.insert(documentExports).values(rowValues).run();
      tx.update(resumeDrafts)
        .set({ state: "exported", updatedAt: nowIso })
        .where(eq(resumeDrafts.id, input.resumeDraftId))
        .run();
    },
    { behavior: "immediate" }
  );

  const exportRecord = serializeDocumentExport(
    rowValues as typeof documentExports.$inferSelect
  );
  return {
    exportRecord,
    version: {
      ...version,
      exports: [exportRecord, ...version.exports],
    },
    downloadUrl: exportRecord.downloadUrl,
  };
}

export function getExportMimeType(format: ExportFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt":
      return "text/plain; charset=utf-8";
    case "md":
      return "text/markdown; charset=utf-8";
  }
}

/**
 * Resolves and validates a `documentExports` file path cleanly within `APP_DATA_DIR`
 * for safe local streaming downloads.
 */
export function getExportDownloadInfo(
  exportId: string,
  db: AppDatabase = getDb(),
  options?: { appDataDir?: string }
): ExportDownloadInfo {
  const row = db
    .select()
    .from(documentExports)
    .where(eq(documentExports.id, exportId))
    .get();
  if (!row) {
    throw new ResumeServiceError(
      "EXPORT_NOT_FOUND",
      404,
      `Export not found: ${exportId}`
    );
  }

  if (!DOCUMENT_EXPORT_TYPES.includes(row.documentType)) {
    throw new ResumeServiceError(
      "INVALID_EXPORT_TYPE",
      400,
      "Unsupported exported document type."
    );
  }

  const paths = ensureAppDirectories(options?.appDataDir);
  let safePath: string;
  try {
    safePath = assertPathWithin(paths.base, row.filePath);
  } catch {
    throw new ResumeServiceError(
      "INVALID_EXPORT_PATH",
      403,
      "Export file path escapes the local application workspace."
    );
  }

  if (!fs.existsSync(safePath)) {
    throw new ResumeServiceError(
      "EXPORT_FILE_MISSING",
      404,
      "Exported document file was not found on disk."
    );
  }

  const rawBase = path.basename(safePath).replace(/[^a-zA-Z0-9._-]/g, "_");
  return {
    filePath: safePath,
    fileName: rawBase || `export-${row.id.slice(0, 8)}.${row.format}`,
    mimeType: getExportMimeType(row.format),
    fileHash: row.fileHash,
    fileSizeBytes: row.fileSizeBytes,
    documentType: row.documentType,
    format: row.format,
  };
}

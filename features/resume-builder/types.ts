import type { EvidenceTargetType, VerificationStatus } from "@/features/career-profile/types";

export const RESUME_DRAFT_STATES = [
  "draft",
  "reviewed",
  "exported",
  "archived",
] as const;
export type ResumeDraftState = (typeof RESUME_DRAFT_STATES)[number];

export const USER_EDITED_STATES = [
  "generated",
  "user_edited",
  "user_verified",
] as const;
export type UserEditedState = (typeof USER_EDITED_STATES)[number];

export const EXPORT_FORMATS = ["docx", "pdf", "txt", "md"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const PAPER_SIZES = ["A4", "Letter"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export const MARGIN_PRESETS = ["compact", "standard", "relaxed"] as const;
export type MarginPreset = (typeof MARGIN_PRESETS)[number];

export const RESUME_SECTION_TYPES = [
  "summary",
  "experience",
  "projects",
  "skills",
  "education",
  "achievements",
  "certifications",
  "languages",
] as const;
export type ResumeSectionType = (typeof RESUME_SECTION_TYPES)[number];

export type ClaimVerificationStatus = "verified" | "needs_review" | "rejected";

export interface ResumeEvidenceRef {
  id?: string;
  evidenceLinkId?: string | null;
  factType: EvidenceTargetType;
  factId: string;
  excerpt?: string | null;
  label?: string | null;
}

export interface ResumeBullet {
  id: string;
  sectionId: string;
  stableEntryId: string;
  text: string;
  sortOrder: number;
  evidenceRefs: ResumeEvidenceRef[];
  userEditedState: UserEditedState;
  verificationStatus: ClaimVerificationStatus;
  flaggedIssues?: string[];
}

export interface ResumeEntry {
  id: string;
  heading: string;
  subheading?: string | null;
  location?: string | null;
  dateRange?: string | null;
  sortOrder: number;
  bullets: ResumeBullet[];
}

export interface ResumeSkillItem {
  factId: string;
  name: string;
  proficiency?: string | null;
  evidenceRefs: ResumeEvidenceRef[];
}

export interface ResumeSkillGroup {
  id: string;
  label: string;
  items: ResumeSkillItem[];
}

export interface ResumeSection {
  id: string;
  type: ResumeSectionType;
  title: string;
  sortOrder: number;
  summaryText?: string | null;
  summaryClaimId?: string | null;
  summaryUserEditedState?: UserEditedState;
  summaryVerificationStatus?: ClaimVerificationStatus;
  summaryEvidenceRefs: ResumeEvidenceRef[];
  entries: ResumeEntry[];
  skillGroups: ResumeSkillGroup[];
}

export interface ResumeHeaderLink {
  label: string;
  url: string;
}

export interface ResumeHeader {
  fullName: string;
  headline?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  links: ResumeHeaderLink[];
}

export interface ResumeGapItem {
  requirementId?: string;
  text: string;
  priority?: string;
  status?: string;
}

export interface StructuredResumeContent {
  version: 1;
  header: ResumeHeader;
  sections: ResumeSection[];
  gapAnalysis?: ResumeGapItem[];
}

export interface ResumeTemplateSettings {
  paperSize: PaperSize;
  fontSizeScale: number;
  lineHeightScale: number;
  marginPreset: MarginPreset;
  showSummary: boolean;
  showProjects: boolean;
  showAchievements: boolean;
  showCertifications: boolean;
  showLanguages: boolean;
}

export interface ResumeClaimRecord {
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
  evidenceRefs: ResumeEvidenceRef[];
  createdAt: string;
  updatedAt: string;
}

export interface DocumentExportRecord {
  id: string;
  resumeVersionId: string | null;
  coverLetterId: string | null;
  documentType: "resume" | "cover_letter" | "application_answers";
  format: ExportFormat;
  filePath: string;
  fileHash: string;
  fileSizeBytes: number;
  exportedAt: string;
  downloadUrl: string | null;
}

export interface ResumeVersionRecord {
  id: string;
  resumeDraftId: string;
  versionNumber: number;
  contentHash: string;
  userEditedState: UserEditedState;
  templateSettings: ResumeTemplateSettings;
  createdAt: string;
  exports: DocumentExportRecord[];
}

export interface ResumeDraftSummary {
  id: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  searchProfileId: string;
  searchProfileName: string | null;
  state: ResumeDraftState;
  claimCount: number;
  verifiedClaimCount: number;
  versionCount: number;
  latestExportAt: string | null;
  modelProvider: string | null;
  modelName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeDraftDetail extends ResumeDraftSummary {
  careerProfileHash: string;
  jobDescriptionHash: string;
  promptVersion: string | null;
  structuredContent: StructuredResumeContent;
  templateSettings: ResumeTemplateSettings;
  renderedPreviewHtml: string | null;
  estimatedPages: number | null;
  claims: ResumeClaimRecord[];
  versions: ResumeVersionRecord[];
  exports: DocumentExportRecord[];
  jobSnapshot: {
    title?: string;
    companyName?: string;
    locationText?: string | null;
    workplaceType?: string | null;
    applyUrl?: string | null;
    canonicalUrl?: string | null;
  } | null;
}

export const DEFAULT_TEMPLATE_SETTINGS: ResumeTemplateSettings = {
  paperSize: "A4",
  fontSizeScale: 1,
  lineHeightScale: 1,
  marginPreset: "standard",
  showSummary: true,
  showProjects: true,
  showAchievements: true,
  showCertifications: true,
  showLanguages: false,
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeEvidenceRef(raw: unknown): ResumeEvidenceRef | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const factType = asString(
    obj.factType || obj.targetType || "experience"
  ) as EvidenceTargetType;
  const factId = asString(obj.factId || obj.targetId);
  if (!factId) return null;
  return {
    id: asNullableString(obj.id) ?? undefined,
    evidenceLinkId: asNullableString(obj.evidenceLinkId),
    factType,
    factId,
    excerpt: asNullableString(obj.excerpt),
    label: asNullableString(obj.label),
  };
}

export function normalizeTemplateSettings(raw: unknown): ResumeTemplateSettings {
  const obj = asRecord(raw) ?? {};
  const paperRaw = asString(obj.paperSize, "A4");
  const paperSize: PaperSize =
    paperRaw.toLowerCase() === "letter" ? "Letter" : "A4";
  const marginRaw = asString(obj.marginPreset, "standard").toLowerCase();
  const marginPreset: MarginPreset =
    marginRaw === "compact" || marginRaw === "relaxed" ? marginRaw : "standard";

  const visObj = asRecord(obj.visibleSections) ?? {};
  const fontSizeScale = Math.min(
    1.15,
    Math.max(0.85, asNumber(obj.fontSizeScale, 1))
  );
  const lineHeightScale = Math.min(
    1.25,
    Math.max(0.9, asNumber(obj.lineHeightScale, 1))
  );

  return {
    paperSize,
    fontSizeScale,
    lineHeightScale,
    marginPreset,
    showSummary: asBoolean(obj.showSummary, asBoolean(visObj.summary, true)),
    showProjects: asBoolean(obj.showProjects, asBoolean(visObj.projects, true)),
    showAchievements: asBoolean(
      obj.showAchievements,
      asBoolean(visObj.achievements, true)
    ),
    showCertifications: asBoolean(
      obj.showCertifications,
      asBoolean(visObj.certifications, true)
    ),
    showLanguages: asBoolean(
      obj.showLanguages,
      asBoolean(visObj.languages, false)
    ),
  };
}

function normalizeClaimVerificationStatus(
  raw: unknown,
  hasRefs: boolean
): ClaimVerificationStatus {
  const s = asString(raw);
  if (s === "verified" || s === "needs_review" || s === "rejected") {
    return s;
  }
  return hasRefs ? "verified" : "needs_review";
}

function normalizeBullet(
  raw: unknown,
  sectionId: string,
  entryId: string,
  index: number
): ResumeBullet {
  const obj = asRecord(raw) ?? {};
  const refsRaw = Array.isArray(obj.evidenceRefs)
    ? obj.evidenceRefs
    : Array.isArray(obj.sourceItemIds)
      ? obj.sourceItemIds.map((id) => ({ factType: "experience", factId: id }))
      : [];
  const evidenceRefs = refsRaw
    .map(normalizeEvidenceRef)
    .filter((r): r is ResumeEvidenceRef => r !== null);

  const editedRaw = asString(obj.userEditedState, "generated");
  const userEditedState: UserEditedState =
    editedRaw === "user_edited" || editedRaw === "user_verified"
      ? editedRaw
      : "generated";

  return {
    id: asString(obj.id || obj.stableClaimId, `${entryId}-bullet-${index}`),
    sectionId: asString(obj.sectionId, sectionId),
    stableEntryId: asString(obj.stableEntryId, entryId),
    text: asString(obj.text),
    sortOrder: asNumber(obj.sortOrder, index),
    evidenceRefs,
    userEditedState,
    verificationStatus: normalizeClaimVerificationStatus(
      obj.verificationStatus,
      evidenceRefs.length > 0
    ),
    flaggedIssues: Array.isArray(obj.flaggedIssues)
      ? obj.flaggedIssues.filter((x): x is string => typeof x === "string")
      : undefined,
  };
}

function normalizeEntry(
  raw: unknown,
  sectionId: string,
  entryIdx: number
): ResumeEntry {
  const obj = asRecord(raw) ?? {};
  const bulletsRaw = Array.isArray(obj.bullets) ? obj.bullets : [];
  const entryId = asString(
    obj.id || obj.stableEntryId,
    `${sectionId}-entry-${entryIdx}`
  );

  const heading = asString(
    obj.heading || obj.title || obj.role || obj.name || obj.qualification,
    "Entry"
  );
  const subheading =
    asNullableString(obj.subheading) ??
    asNullableString(
      [obj.organization || obj.employer || obj.institution, obj.subtitle]
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .join(" · ")
    );
  const dateRange =
    asNullableString(obj.dateRange) ??
    asNullableString(
      [
        asNullableString(obj.startDate),
        obj.isCurrent ? "Present" : asNullableString(obj.endDate),
      ]
        .filter(Boolean)
        .join(" – ")
    );

  return {
    id: entryId,
    heading,
    subheading,
    location: asNullableString(obj.location),
    dateRange,
    sortOrder: asNumber(obj.sortOrder, entryIdx),
    bullets: bulletsRaw.map((b, bIdx) =>
      normalizeBullet(b, sectionId, entryId, bIdx)
    ),
  };
}

/**
 * Normalizes a structured resume document, preserving Track A's canonical
 * `StructuredResumeDocument` schema (`version: 1`, `header.links`, `sections`, etc.).
 */
export function normalizeStructuredContent(
  raw: unknown,
  claims: ResumeClaimRecord[] = []
): StructuredResumeContent {
  const obj = asRecord(raw) ?? {};
  const headerObj = asRecord(obj.header) ?? {};
  const claimMap = new Map<string, ResumeClaimRecord>();
  for (const c of claims) {
    claimMap.set(c.stableClaimId, c);
  }

  const rawLinks = Array.isArray(headerObj.links) ? headerObj.links : [];
  const links: ResumeHeaderLink[] = rawLinks
    .map((l): ResumeHeaderLink | null => {
      const lObj = asRecord(l);
      if (!lObj) return null;
      const url = asString(lObj.url);
      if (!url) return null;
      return {
        label: asString(lObj.label, url),
        url,
      };
    })
    .filter((l): l is ResumeHeaderLink => l !== null);

  if (links.length === 0) {
    for (const [label, key] of [
      ["Website", "websiteUrl"],
      ["LinkedIn", "linkedinUrl"],
      ["GitHub", "githubUrl"],
    ] as const) {
      const url = asNullableString(headerObj[key]);
      if (url) links.push({ label, url });
    }
  }

  const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
  const sections: ResumeSection[] = sectionsRaw.map((sec, sIdx) => {
    const secObj = asRecord(sec) ?? {};
    const secTypeRaw = asString(secObj.type, "experience").toLowerCase();
    const secType: ResumeSectionType = (
      RESUME_SECTION_TYPES as readonly string[]
    ).includes(secTypeRaw)
      ? (secTypeRaw as ResumeSectionType)
      : "experience";
    const secId = asString(secObj.id, `section-${secType}-${sIdx}`);

    const entriesRaw = Array.isArray(secObj.entries) ? secObj.entries : [];
    const entries = entriesRaw.map((ent, eIdx) => {
      const normalized = normalizeEntry(ent, secId, eIdx);
      return {
        ...normalized,
        bullets: normalized.bullets.map((b) => {
          const claim = claimMap.get(b.id);
          if (!claim) return b;
          const refs =
            b.evidenceRefs.length > 0 ? b.evidenceRefs : claim.evidenceRefs;
          return {
            ...b,
            evidenceRefs: refs,
            userEditedState: claim.userEditedState ?? b.userEditedState,
            verificationStatus: normalizeClaimVerificationStatus(
              claim.verificationStatus ?? b.verificationStatus,
              refs.length > 0
            ),
          };
        }),
      };
    });

    const skillGroupsRaw = Array.isArray(secObj.skillGroups)
      ? secObj.skillGroups
      : [];
    const skillGroups: ResumeSkillGroup[] = skillGroupsRaw.map((sg, sgIdx) => {
      const sgObj = asRecord(sg) ?? {};
      const itemsRaw = Array.isArray(sgObj.items) ? sgObj.items : [];
      const items: ResumeSkillItem[] = itemsRaw
        .map((it, itIdx): ResumeSkillItem | null => {
          if (typeof it === "string") {
            return {
              factId: `${secId}-skill-${sgIdx}-${itIdx}`,
              name: it,
              proficiency: null,
              evidenceRefs: [],
            };
          }
          const itObj = asRecord(it);
          if (!itObj) return null;
          const name = asString(itObj.name);
          if (!name) return null;
          const refsRaw = Array.isArray(itObj.evidenceRefs)
            ? itObj.evidenceRefs
            : [];
          return {
            factId: asString(itObj.factId, `${secId}-skill-${sgIdx}-${itIdx}`),
            name,
            proficiency: asNullableString(itObj.proficiency),
            evidenceRefs: refsRaw
              .map(normalizeEvidenceRef)
              .filter((r): r is ResumeEvidenceRef => r !== null),
          };
        })
        .filter((it): it is ResumeSkillItem => it !== null);

      return {
        id: asString(sgObj.id, `${secId}-sg-${sgIdx}`),
        label: asString(sgObj.label || sgObj.category, "Skills"),
        items,
      };
    });

    const secSummaryClaimId = asNullableString(secObj.summaryClaimId);
    const secClaim = secSummaryClaimId
      ? claimMap.get(secSummaryClaimId)
      : undefined;
    const secRefsRaw = Array.isArray(secObj.summaryEvidenceRefs)
      ? secObj.summaryEvidenceRefs
      : Array.isArray(secObj.evidenceRefs)
        ? secObj.evidenceRefs
        : [];
    const summaryEvidenceRefs =
      secRefsRaw.length > 0
        ? secRefsRaw
            .map(normalizeEvidenceRef)
            .filter((r): r is ResumeEvidenceRef => r !== null)
        : secClaim?.evidenceRefs ?? [];

    return {
      id: secId,
      type: secType,
      title: asString(secObj.title, secType),
      sortOrder: asNumber(secObj.sortOrder, sIdx),
      summaryText:
        asNullableString(secObj.summaryText) ?? asNullableString(secObj.text),
      summaryClaimId: secSummaryClaimId,
      summaryUserEditedState: (asNullableString(secObj.summaryUserEditedState) ??
        asNullableString(secObj.userEditedState) ??
        secClaim?.userEditedState) as UserEditedState | undefined,
      summaryVerificationStatus: secSummaryClaimId
        ? normalizeClaimVerificationStatus(
            secObj.summaryVerificationStatus ??
              secObj.verificationStatus ??
              secClaim?.verificationStatus,
            summaryEvidenceRefs.length > 0
          )
        : undefined,
      summaryEvidenceRefs,
      entries,
      skillGroups,
    };
  });

  const gapRaw = Array.isArray(obj.gapAnalysis) ? obj.gapAnalysis : [];
  const gapAnalysis: ResumeGapItem[] = gapRaw
    .map((g): ResumeGapItem | null => {
      const gObj = asRecord(g);
      if (!gObj) return null;
      return {
        requirementId: asNullableString(gObj.requirementId) ?? undefined,
        text: asString(gObj.text),
        priority: asNullableString(gObj.priority) ?? undefined,
        status: asNullableString(gObj.status) ?? undefined,
      };
    })
    .filter((g): g is ResumeGapItem => g !== null && g.text.length > 0);

  return {
    version: 1,
    header: {
      fullName: asString(headerObj.fullName, "Candidate Name"),
      headline: asNullableString(headerObj.headline),
      email: asNullableString(headerObj.email),
      phone: asNullableString(headerObj.phone),
      location: asNullableString(headerObj.location),
      links,
    },
    sections,
    gapAnalysis: gapAnalysis.length > 0 ? gapAnalysis : undefined,
  };
}

/**
 * Recomputes consecutive `sortOrder` fields across sections, entries, and bullets
 * before saving so backend validators and renderers receive canonical order.
 */
export function reindexStructuredContent(
  content: StructuredResumeContent
): StructuredResumeContent {
  return {
    ...content,
    version: 1,
    sections: content.sections.map((sec, sIdx) => ({
      ...sec,
      sortOrder: sIdx,
      entries: sec.entries.map((ent, eIdx) => ({
        ...ent,
        sortOrder: eIdx,
        bullets: ent.bullets.map((b, bIdx) => ({
          ...b,
          sectionId: sec.id,
          stableEntryId: ent.id,
          sortOrder: bIdx,
        })),
      })),
    })),
  };
}

export function normalizeResumeClaim(raw: unknown): ResumeClaimRecord | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = asString(obj.id);
  const stableClaimId = asString(obj.stableClaimId, id);
  if (!id && !stableClaimId) return null;
  const refsRaw = Array.isArray(obj.evidenceRefs)
    ? obj.evidenceRefs
    : Array.isArray(obj.evidence)
      ? obj.evidence
      : [];

  return {
    id: id || stableClaimId,
    resumeDraftId: asString(obj.resumeDraftId),
    stableClaimId,
    stableEntryId: asString(obj.stableEntryId),
    sectionId: asString(obj.sectionId),
    sectionType: asString(obj.sectionType),
    text: asString(obj.text),
    sortOrder: asNumber(obj.sortOrder, 0),
    userEditedState: asString(obj.userEditedState, "generated") as UserEditedState,
    verificationStatus: asString(
      obj.verificationStatus,
      "needs_review"
    ) as VerificationStatus,
    evidenceRefs: refsRaw
      .map(normalizeEvidenceRef)
      .filter((r): r is ResumeEvidenceRef => r !== null),
    createdAt: asString(obj.createdAt),
    updatedAt: asString(obj.updatedAt),
  };
}

export function normalizeDocumentExport(raw: unknown): DocumentExportRecord | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = asString(obj.id);
  if (!id) return null;
  return {
    id,
    resumeVersionId: asNullableString(obj.resumeVersionId),
    coverLetterId: asNullableString(obj.coverLetterId),
    documentType: asString(
      obj.documentType,
      "resume"
    ) as DocumentExportRecord["documentType"],
    format: asString(obj.format, "docx") as ExportFormat,
    filePath: asString(obj.filePath || obj.fileName || ""),
    fileHash: asString(obj.fileHash),
    fileSizeBytes: asNumber(obj.fileSizeBytes, 0),
    exportedAt: asString(obj.exportedAt),
    downloadUrl:
      asNullableString(obj.downloadUrl) ??
      `/api/exports/${encodeURIComponent(id)}/download`,
  };
}

export function normalizeResumeVersion(raw: unknown): ResumeVersionRecord | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = asString(obj.id);
  if (!id) return null;
  const exportsRaw = Array.isArray(obj.exports) ? obj.exports : [];
  let templateRaw: unknown = obj.templateSettings ?? obj.templateSettingsJson;
  if (typeof templateRaw === "string") {
    try {
      templateRaw = JSON.parse(templateRaw);
    } catch {
      templateRaw = {};
    }
  }
  return {
    id,
    resumeDraftId: asString(obj.resumeDraftId),
    versionNumber: asNumber(obj.versionNumber, 1),
    contentHash: asString(obj.contentHash),
    userEditedState: asString(obj.userEditedState, "generated") as UserEditedState,
    templateSettings: normalizeTemplateSettings(templateRaw),
    createdAt: asString(obj.createdAt),
    exports: exportsRaw
      .map(normalizeDocumentExport)
      .filter((e): e is DocumentExportRecord => e !== null),
  };
}

export function normalizeResumeDraftSummary(raw: unknown): ResumeDraftSummary | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = asString(obj.id);
  if (!id) return null;

  let jobSnap: Record<string, unknown> | null = asRecord(obj.jobSnapshot);
  if (!jobSnap && typeof obj.jobSnapshotJson === "string") {
    try {
      jobSnap = asRecord(JSON.parse(obj.jobSnapshotJson));
    } catch {
      jobSnap = null;
    }
  }

  return {
    id,
    jobId: asString(obj.jobId),
    jobTitle: asString(obj.jobTitle || jobSnap?.title, "Untitled role"),
    companyName: asString(
      obj.companyName || jobSnap?.companyName,
      "Unknown company"
    ),
    searchProfileId: asString(obj.searchProfileId),
    searchProfileName: asNullableString(obj.searchProfileName),
    state: asString(obj.state, "draft") as ResumeDraftState,
    claimCount: asNumber(obj.claimCount, 0),
    verifiedClaimCount: asNumber(obj.verifiedClaimCount, 0),
    versionCount: asNumber(obj.versionCount, 0),
    latestExportAt: asNullableString(obj.latestExportAt),
    modelProvider: asNullableString(obj.modelProvider),
    modelName: asNullableString(obj.modelName),
    createdAt: asString(obj.createdAt),
    updatedAt: asString(obj.updatedAt),
  };
}

export function normalizeResumeDraftDetail(raw: unknown): ResumeDraftDetail | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const summary = normalizeResumeDraftSummary(obj);
  if (!summary) return null;

  const claimsRaw = Array.isArray(obj.claims) ? obj.claims : [];
  const claims = claimsRaw
    .map(normalizeResumeClaim)
    .filter((c): c is ResumeClaimRecord => c !== null);

  let structuredRaw: unknown = obj.structuredContent ?? obj.structuredContentJson;
  if (typeof structuredRaw === "string") {
    try {
      structuredRaw = JSON.parse(structuredRaw);
    } catch {
      structuredRaw = {};
    }
  }
  const structuredContent = normalizeStructuredContent(structuredRaw, claims);

  let templateRaw: unknown = obj.templateSettings ?? obj.templateSettingsJson;
  if (typeof templateRaw === "string") {
    try {
      templateRaw = JSON.parse(templateRaw);
    } catch {
      templateRaw = {};
    }
  }
  const templateSettings = normalizeTemplateSettings(templateRaw);

  const versionsRaw = Array.isArray(obj.versions) ? obj.versions : [];
  const versions = versionsRaw
    .map(normalizeResumeVersion)
    .filter((v): v is ResumeVersionRecord => v !== null);

  const exportsRaw = Array.isArray(obj.exports) ? obj.exports : [];
  const exportsList = exportsRaw
    .map(normalizeDocumentExport)
    .filter((e): e is DocumentExportRecord => e !== null);

  let jobSnap: ResumeDraftDetail["jobSnapshot"] = null;
  let jobSnapObj = asRecord(obj.jobSnapshot);
  if (!jobSnapObj && typeof obj.jobSnapshotJson === "string") {
    try {
      jobSnapObj = asRecord(JSON.parse(obj.jobSnapshotJson));
    } catch {
      jobSnapObj = null;
    }
  }
  if (jobSnapObj) {
    jobSnap = {
      title: asNullableString(jobSnapObj.title) ?? undefined,
      companyName: asNullableString(jobSnapObj.companyName) ?? undefined,
      locationText: asNullableString(jobSnapObj.locationText),
      workplaceType: asNullableString(jobSnapObj.workplaceType),
      applyUrl: asNullableString(jobSnapObj.applyUrl),
      canonicalUrl: asNullableString(jobSnapObj.canonicalUrl),
    };
  }

  let allBulletsCount = 0;
  let verifiedBulletsCount = 0;
  for (const sec of structuredContent.sections) {
    if (sec.type === "summary" && sec.summaryText) {
      allBulletsCount += 1;
      if (
        sec.summaryEvidenceRefs.length > 0 &&
        sec.summaryVerificationStatus === "verified"
      ) {
        verifiedBulletsCount += 1;
      }
    }
    for (const ent of sec.entries) {
      for (const b of ent.bullets) {
        allBulletsCount += 1;
        if (b.evidenceRefs.length > 0 && b.verificationStatus === "verified") {
          verifiedBulletsCount += 1;
        }
      }
    }
  }

  return {
    ...summary,
    claimCount:
      claims.length > 0 ? claims.length : summary.claimCount || allBulletsCount,
    verifiedClaimCount:
      claims.length > 0
        ? claims.filter(
            (c) =>
              c.verificationStatus === "verified" && c.evidenceRefs.length > 0
          ).length
        : summary.verifiedClaimCount || verifiedBulletsCount,
    versionCount: versions.length > 0 ? versions.length : summary.versionCount,
    careerProfileHash: asString(obj.careerProfileHash),
    jobDescriptionHash: asString(obj.jobDescriptionHash),
    promptVersion: asNullableString(obj.promptVersion),
    structuredContent,
    templateSettings,
    renderedPreviewHtml: asNullableString(obj.renderedPreviewHtml),
    estimatedPages:
      typeof obj.estimatedPages === "number" ? obj.estimatedPages : null,
    claims,
    versions,
    exports: exportsList,
    jobSnapshot: jobSnap,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isResumeSectionVisible(
  sectionType: ResumeSectionType,
  settings: ResumeTemplateSettings
): boolean {
  switch (sectionType) {
    case "summary":
      return settings.showSummary;
    case "projects":
      return settings.showProjects;
    case "achievements":
      return settings.showAchievements;
    case "certifications":
      return settings.showCertifications;
    case "languages":
      return settings.showLanguages;
    default:
      return true;
  }
}

/**
 * Estimates page count from word & line density and paper/margin configuration.
 */
export function estimateResumePages(
  content: StructuredResumeContent,
  settings: ResumeTemplateSettings
): number {
  let words = 0;
  let lines = 4;
  for (const sec of content.sections) {
    if (!isResumeSectionVisible(sec.type, settings)) continue;
    lines += 2.2;
    if (sec.summaryText) {
      const w = sec.summaryText.trim().split(/\s+/).filter(Boolean).length;
      words += w;
      lines += Math.max(1, Math.ceil(w / 14));
    }
    for (const sg of sec.skillGroups) {
      const w = sg.items
        .map((i) => i.name)
        .join(", ")
        .split(/\s+/)
        .filter(Boolean).length;
      words += w;
      lines += Math.max(1.3, Math.ceil(w / 13));
    }
    for (const ent of sec.entries) {
      lines += 2;
      for (const b of ent.bullets) {
        const w = b.text.trim().split(/\s+/).filter(Boolean).length;
        words += w;
        lines += Math.max(1, Math.ceil(w / 13));
      }
    }
  }
  const marginLinesBonus =
    settings.marginPreset === "compact"
      ? 4
      : settings.marginPreset === "relaxed"
        ? -4
        : 0;
  const paperFactor = settings.paperSize === "A4" ? 1.04 : 1.0;
  const linesPerPage = Math.max(
    28,
    (46 + marginLinesBonus) *
      paperFactor *
      (1 / settings.fontSizeScale) *
      (1 / settings.lineHeightScale)
  );
  if (words === 0 && lines <= 5) return 1;
  return Math.max(1, Math.ceil(lines / linesPerPage));
}

/**
 * Generates clean, ATS-safe single-column HTML for the sandboxed live preview iframe.
 */
export function buildClientResumePreviewHtml(
  content: StructuredResumeContent,
  settings: ResumeTemplateSettings
): string {
  const marginMm =
    settings.marginPreset === "compact"
      ? "12mm 14mm"
      : settings.marginPreset === "relaxed"
        ? "20mm 22mm"
        : "16mm 18mm";

  const fontSizePt = Number((10.5 * settings.fontSizeScale).toFixed(2));
  const lineHeight = Number((1.38 * settings.lineHeightScale).toFixed(2));

  const contactItems = [
    content.header.email,
    content.header.phone,
    content.header.location,
    ...content.header.links.map((l) => l.url),
  ]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => `<span>${escapeHtml(v.trim())}</span>`)
    .join('<span class="sep">·</span>');

  const sectionsHtml = content.sections
    .filter((sec) => isResumeSectionVisible(sec.type, settings))
    .map((sec) => {
      if (sec.type === "summary" && sec.summaryText?.trim()) {
        return `<section class="section">
          <h2>${escapeHtml(sec.title || "Summary")}</h2>
          <p class="body-text">${escapeHtml(sec.summaryText.trim())}</p>
        </section>`;
      }

      const skillGroupsHtml =
        sec.skillGroups.length > 0
          ? `<div class="skills-list">${sec.skillGroups
              .map(
                (sg) =>
                  `<div class="skill-row"><strong>${escapeHtml(sg.label)}:</strong> ${escapeHtml(
                    sg.items
                      .map((i) =>
                        i.proficiency ? `${i.name} (${i.proficiency})` : i.name
                      )
                      .join(", ")
                  )}</div>`
              )
              .join("")}</div>`
          : "";

      const entriesHtml = sec.entries
        .map((ent) => {
          const bulletsHtml =
            ent.bullets.length > 0
              ? `<ul>${ent.bullets
                  .filter((b) => b.text.trim().length > 0)
                  .map((b) => `<li>${escapeHtml(b.text.trim())}</li>`)
                  .join("")}</ul>`
              : "";

          return `<div class="entry">
            <div class="entry-header">
              <div class="entry-title-wrap">
                <span class="entry-title">${escapeHtml(ent.heading)}</span>
                ${ent.subheading ? `<span class="entry-org"> · ${escapeHtml(ent.subheading)}</span>` : ""}
              </div>
              ${ent.dateRange ? `<span class="entry-dates">${escapeHtml(ent.dateRange)}</span>` : ""}
            </div>
            ${ent.location ? `<div class="entry-subtitle">${escapeHtml(ent.location)}</div>` : ""}
            ${bulletsHtml}
          </div>`;
        })
        .join("");

      const textFallback =
        !entriesHtml && !skillGroupsHtml && sec.summaryText?.trim()
          ? `<p class="body-text">${escapeHtml(sec.summaryText.trim())}</p>`
          : "";

      if (!entriesHtml && !skillGroupsHtml && !textFallback) return "";

      return `<section class="section">
        <h2>${escapeHtml(sec.title)}</h2>
        ${skillGroupsHtml}
        ${entriesHtml}
        ${textFallback}
      </section>`;
    })
    .join("");

  const pageSizeCss = settings.paperSize === "Letter" ? "letter" : "A4";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @page {
    size: ${pageSizeCss};
    margin: ${marginMm};
  }
  * {
    box-sizing: border-box;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #FFFFFF;
    color: #1F201D;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: ${fontSizePt}pt;
    line-height: ${lineHeight};
    -webkit-font-smoothing: antialiased;
  }
  .page {
    padding: ${marginMm};
  }
  header {
    border-bottom: 1.5px solid #416653;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  h1 {
    margin: 0;
    font-size: ${(fontSizePt * 1.85).toFixed(1)}pt;
    font-weight: 700;
    letter-spacing: -0.015em;
    color: #111210;
  }
  .headline {
    margin-top: 2px;
    font-size: ${(fontSizePt * 1.05).toFixed(1)}pt;
    color: #464840;
    font-weight: 500;
  }
  .contact {
    margin-top: 5px;
    font-size: ${(fontSizePt * 0.88).toFixed(1)}pt;
    color: #4A4C45;
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;
  }
  .sep {
    color: #9A9C94;
  }
  .section {
    margin-bottom: 11px;
  }
  h2 {
    margin: 0 0 6px 0;
    font-size: ${(fontSizePt * 1.02).toFixed(1)}pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #416653;
    border-bottom: 1px solid #E2E1DA;
    padding-bottom: 2px;
  }
  .entry {
    margin-bottom: 8px;
    page-break-inside: avoid;
  }
  .entry-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }
  .entry-title-wrap {
    font-weight: 600;
    color: #1A1B18;
  }
  .entry-org {
    font-weight: 400;
    color: #44463F;
  }
  .entry-dates {
    font-size: ${(fontSizePt * 0.88).toFixed(1)}pt;
    color: #55584F;
    white-space: nowrap;
  }
  .entry-subtitle {
    font-size: ${(fontSizePt * 0.92).toFixed(1)}pt;
    color: #55584F;
    margin-top: 1px;
  }
  .body-text {
    margin: 3px 0 0 0;
    color: #242622;
  }
  ul {
    margin: 3px 0 0 0;
    padding-left: 16px;
  }
  li {
    margin: 2px 0;
    color: #242622;
  }
  .skills-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .skill-row {
    color: #242622;
  }
</style>
</head>
<body>
  <div class="page">
    <header>
      <h1>${escapeHtml(content.header.fullName || "Candidate Name")}</h1>
      ${content.header.headline ? `<div class="headline">${escapeHtml(content.header.headline)}</div>` : ""}
      ${contactItems ? `<div class="contact">${contactItems}</div>` : ""}
    </header>
    ${sectionsHtml}
  </div>
</body>
</html>`;
}

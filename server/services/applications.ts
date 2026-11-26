import crypto from "node:crypto";
import path from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  buildVerifiedFactCatalog,
  ClaimEvidenceRefSchema,
  CoverLetterContentSchema,
  isSensitiveApplicationPrompt,
  makeFactCatalogKey,
  PaperSizeSchema,
  ResumeTemplateSettingsSchema,
  type ClaimEvidenceRef,
  type CoverLetterContent,
  type PaperSize,
} from "../ai/schemas/resume-generation";
import {
  DEFAULT_RESUME_TEMPLATE_SETTINGS,
  generateApplicationAnswersDraft,
  generateCoverLetterDraft,
  MaterialsGenerationError,
  type ApplicationAnswerPromptInput,
  type MaterialGenerationMode,
} from "../ai/workflows/generate-materials";
import { getDb, type AppDatabase } from "../db/client";
import {
  APPLICATION_STATUSES,
  applicationAnswers,
  applicationEvents,
  applications,
  coverLetters,
  documentExports,
  EXPORT_FORMATS,
  resumeDrafts,
  resumeVersions,
  USER_EDITED_STATES,
  type ApplicationStatus,
  type ExportFormat,
  type UserEditedState,
} from "../db/schema/applications";
import { jobs, searchProfiles } from "../db/schema/jobs";
import {
  exportCoverLetterToDocxBuffer,
  exportHtmlToPdfBuffer,
  PdfBrowserMissingError,
  renderCoverLetterHtml,
  renderCoverLetterMarkdown,
  renderCoverLetterPlainText,
  type CoverLetterRenderMeta,
} from "../documents/resume-renderer";
import {
  assertPathWithin,
  ensureAppDirectories,
  writeSecureFile,
} from "../files/paths";
import { getFullCareerProfile } from "./profile";
import {
  MaterialModeSchema,
  resolveCanonicalJobRow,
  resolveEffectiveSearchProfile,
  ResumeServiceError,
  serializeDocumentExport,
  type SafeVerifiedFactSummary,
  type SerializedDocumentExport,
} from "./resumes";

export class ApplicationServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ApplicationServiceError";
    this.code = code;
    this.status = status;
  }
}

export const CreateOrPrepareApplicationSchema = z
  .object({
    jobId: z.string().trim().min(1).max(128),
    searchProfileId: z.string().trim().min(1).max(128).nullable().optional(),
    resumeVersionId: z.string().trim().min(1).max(128).nullable().optional(),
    originalApplyUrl: z.string().trim().max(2048).nullable().optional(),
    notes: z.string().max(20_000).nullable().optional(),
  })
  .strict();

export const UpdateApplicationMetadataSchema = z
  .object({
    notes: z.string().max(20_000).nullable().optional(),
    resumeVersionId: z.string().trim().min(1).max(128).nullable().optional(),
    originalApplyUrl: z.string().trim().max(2048).nullable().optional(),
  })
  .strict();

export const TransitionApplicationStatusSchema = z
  .object({
    newStatus: z.enum(APPLICATION_STATUSES).optional(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    note: z.string().max(4000).nullable().optional(),
    resumeVersionId: z.string().trim().min(1).max(128).nullable().optional(),
    coverLetterId: z.string().trim().min(1).max(128).nullable().optional(),
    answerIds: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
    confirmSubmission: z.boolean().optional(),
    appliedAt: z.string().trim().max(64).nullable().optional(),
  })
  .strict();

export const GenerateCoverLetterRequestSchema = z
  .object({
    searchProfileId: z.string().trim().min(1).max(128).nullable().optional(),
    applicationId: z.string().trim().min(1).max(128).nullable().optional(),
    mode: MaterialModeSchema.optional(),
    tone: z.string().trim().max(80).nullable().optional(),
    length: z.enum(["short", "medium", "long", "detailed"]).optional(),
    regenerate: z.boolean().optional(),
    async: z.boolean().optional(),
  })
  .strict();

export const UpdateCoverLetterSchema = z
  .object({
    content: z.unknown().optional(),
    structuredContent: z.unknown().optional(),
    text: z.string().max(40_000).optional(),
    userEditedState: z.enum(USER_EDITED_STATES).optional(),
  })
  .strict();

export const ExportCoverLetterRequestSchema = z
  .object({
    format: z.enum(EXPORT_FORMATS),
    paperSize: PaperSizeSchema.optional(),
    async: z.boolean().optional(),
  })
  .strict();

export const GenerateApplicationAnswersRequestSchema = z
  .object({
    searchProfileId: z.string().trim().min(1).max(128).nullable().optional(),
    applicationId: z.string().trim().min(1).max(128).nullable().optional(),
    prompts: z
      .array(
        z.object({
          promptKey: z.string().trim().min(1).max(128),
          promptText: z.string().trim().min(1).max(1000),
        })
      )
      .max(20)
      .optional(),
    promptKeys: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
    customPrompt: z.string().trim().max(1000).optional(),
    mode: MaterialModeSchema.optional(),
    regenerate: z.boolean().optional(),
  })
  .strict();

export const UpdateApplicationAnswerSchema = z
  .object({
    answerText: z.string().max(20_000).optional(),
    promptText: z.string().trim().min(1).max(1000).optional(),
    evidenceRefs: z.array(ClaimEvidenceRefSchema).max(50).optional(),
    userEditedState: z.enum(USER_EDITED_STATES).optional(),
  })
  .strict();

const STANDARD_PROMPT_LABELS: Record<string, string> = {
  why_interested: "Why are you interested in this role?",
  why_this_role: "Why are you interested in this role?",
  why_company: "Why this company?",
  why_good_fit: "Why are you a good fit for this role?",
  relevant_experience: "Describe your most relevant experience for this role.",
};

export interface CoverLetterDetail {
  id: string;
  jobId: string;
  searchProfileId: string;
  applicationId: string | null;
  content: CoverLetterContent;
  structuredContent: {
    greeting: string;
    paragraphs: string[];
    closing: string;
    signature: string;
    items: CoverLetterContent["paragraphs"];
  };
  text: string;
  evidenceRefs: ClaimEvidenceRef[];
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  userEditedState: UserEditedState;
  contentHash: string;
  exports: SerializedDocumentExport[];
  renderedPreviewHtml: string;
  verifiedFacts: SafeVerifiedFactSummary[];
  job: {
    id: string;
    title: string;
    companyName: string;
    locationText: string | null;
    workplaceType: string;
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

export interface HydratedApplicationAnswer {
  id: string;
  jobId: string;
  searchProfileId: string;
  applicationId: string | null;
  promptKey: string;
  promptText: string;
  answerText: string;
  evidenceRefs: ClaimEvidenceRef[];
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  userEditedState: UserEditedState;
  requiresManualInput: boolean;
  requiresHumanInput: boolean;
  withheldReason: string | null;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationListItem {
  id: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  locationText: string | null;
  workplaceType: string;
  searchProfileId: string;
  searchProfileName: string | null;
  status: ApplicationStatus;
  appliedAt: string | null;
  resumeVersionId: string | null;
  resumeVersionNumber: number | null;
  originalApplyUrl: string | null;
  submittedMaterialsSnapshot: unknown | null;
  submittedMaterialsHash: string | null;
  notes: string | null;
  eventsCount: number;
  coverLettersCount: number;
  answersCount: number;
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

export interface ApplicationDetail extends ApplicationListItem {
  events: Array<{
    id: string;
    applicationId: string;
    priorStatus: ApplicationStatus | null;
    newStatus: ApplicationStatus;
    note: string | null;
    occurredAt: string;
  }>;
  resumeVersion: {
    id: string;
    resumeDraftId: string;
    versionNumber: number;
    contentHash: string;
    userEditedState: UserEditedState;
    createdAt: string;
    exports: SerializedDocumentExport[];
  } | null;
  resumeVersions: Array<{
    id: string;
    resumeDraftId: string;
    versionNumber: number;
    contentHash: string;
    userEditedState: UserEditedState;
    createdAt: string;
    exports: SerializedDocumentExport[];
  }>;
  latestResumeDraftId: string | null;
  coverLetter: CoverLetterDetail | null;
  coverLetters: CoverLetterDetail[];
  answers: HydratedApplicationAnswer[];
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

function resolveCanonicalJobForApp(
  db: AppDatabase,
  jobId: string
): typeof jobs.$inferSelect {
  try {
    return resolveCanonicalJobRow(db, jobId);
  } catch (err) {
    if (err instanceof ResumeServiceError) {
      throw new ApplicationServiceError(err.code, err.status, err.message);
    }
    throw err;
  }
}

function resolveSearchProfileForApp(
  db: AppDatabase,
  searchProfileId?: string | null
) {
  try {
    return resolveEffectiveSearchProfile(db, searchProfileId);
  } catch (err) {
    if (err instanceof ResumeServiceError) {
      throw new ApplicationServiceError(err.code, err.status, err.message);
    }
    throw err;
  }
}

/**
 * Validates that an apply URL uses `http:` or `https:` and embeds no credentials.
 */
export function validateSafeApplyUrl(
  rawUrl: string | null | undefined
): string | null {
  if (rawUrl === undefined || rawUrl === null) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApplicationServiceError(
      "INVALID_APPLY_URL",
      400,
      "Apply URL must be a valid http or https URL."
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApplicationServiceError(
      "INVALID_APPLY_URL",
      400,
      "Apply URL protocol must be http or https."
    );
  }
  if (parsed.username || parsed.password) {
    throw new ApplicationServiceError(
      "INVALID_APPLY_URL",
      400,
      "Apply URL must not contain embedded credentials."
    );
  }
  return parsed.toString();
}

function renderCoverLetterMeta(
  db: AppDatabase,
  job: typeof jobs.$inferSelect | null,
  createdAtIso: string
): CoverLetterRenderMeta {
  const career = getFullCareerProfile(db);
  const p = career.profile;
  return {
    senderName: p?.fullName ?? null,
    senderEmail: p?.email ?? null,
    senderPhone: p?.phone ?? null,
    senderLocation: p?.location ?? null,
    dateText: createdAtIso.slice(0, 10),
    companyName: job?.companyName ?? null,
    roleTitle: job?.title ?? null,
  };
}

function coverLetterContentToPlainBody(content: CoverLetterContent): string {
  return [
    content.greeting,
    ...content.paragraphs.map((p) => p.text),
    content.closing,
    content.signature,
  ]
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
}

function hydrateCoverLetterRow(
  row: typeof coverLetters.$inferSelect,
  db: AppDatabase,
  cachedExports?: SerializedDocumentExport[],
  cachedVerifiedFacts?: SafeVerifiedFactSummary[]
): CoverLetterDetail {
  const content = CoverLetterContentSchema.parse(
    safeJsonParse(row.structuredContentJson, {
      greeting: "Dear Hiring Team,",
      paragraphs: [{ id: "p-1", text: "Application cover letter.", evidenceRefs: [] }],
      closing: "Sincerely,",
      signature: "Candidate",
    })
  );
  const evidenceRefs = z
    .array(ClaimEvidenceRefSchema)
    .catch([])
    .parse(safeJsonParse(row.evidenceRefsJson, []));

  const job = db.select().from(jobs).where(eq(jobs.id, row.jobId)).get() ?? null;
  const sp =
    db
      .select()
      .from(searchProfiles)
      .where(eq(searchProfiles.id, row.searchProfileId))
      .get() ?? null;

  const exportsList =
    cachedExports ??
    db
      .select()
      .from(documentExports)
      .where(eq(documentExports.coverLetterId, row.id))
      .orderBy(desc(documentExports.exportedAt))
      .all()
      .map(serializeDocumentExport);

  const meta = renderCoverLetterMeta(db, job, row.createdAt);
  const renderedPreviewHtml = renderCoverLetterHtml(
    content,
    meta,
    DEFAULT_RESUME_TEMPLATE_SETTINGS
  );

  const verifiedFacts =
    cachedVerifiedFacts ??
    buildVerifiedFactCatalog(getFullCareerProfile(db)).items.map((item) => ({
      key: item.key,
      factType: item.factType,
      factId: item.factId,
      label: item.label,
      excerpt: item.excerpt,
      defaultEvidenceLinkId: item.defaultEvidenceLinkId,
    }));

  return {
    id: row.id,
    jobId: row.jobId,
    searchProfileId: row.searchProfileId,
    applicationId: row.applicationId,
    content,
    structuredContent: {
      greeting: content.greeting,
      paragraphs: content.paragraphs.map((p) => p.text),
      closing: content.closing,
      signature: content.signature,
      items: content.paragraphs,
    },
    text: coverLetterContentToPlainBody(content),
    evidenceRefs,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    promptVersion: row.promptVersion,
    userEditedState: row.userEditedState,
    contentHash: row.contentHash,
    exports: exportsList,
    renderedPreviewHtml,
    verifiedFacts,
    job: job
      ? {
          id: job.id,
          title: job.title,
          companyName: job.companyName,
          locationText: job.locationText,
          workplaceType: job.workplaceType,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hydrateApplicationAnswerRow(
  row: typeof applicationAnswers.$inferSelect
): HydratedApplicationAnswer {
  const evidenceRefs = z
    .array(ClaimEvidenceRefSchema)
    .catch([])
    .parse(safeJsonParse(row.evidenceRefsJson, []));

  const sensitivity = isSensitiveApplicationPrompt(row.promptText);
  return {
    id: row.id,
    jobId: row.jobId,
    searchProfileId: row.searchProfileId,
    applicationId: row.applicationId,
    promptKey: row.promptKey,
    promptText: row.promptText,
    answerText: row.answerText,
    evidenceRefs,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    promptVersion: row.promptVersion,
    userEditedState: row.userEditedState,
    requiresManualInput: sensitivity.sensitive,
    requiresHumanInput: sensitivity.sensitive,
    withheldReason: sensitivity.reason,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Lists applications ordered by `updatedAt DESC` with job, search profile,
 * resume version, and material counts.
 */
export function listApplications(
  db: AppDatabase = getDb(),
  options?: { status?: ApplicationStatus; searchProfileId?: string }
): ApplicationListItem[] {
  const conditions = [];
  if (options?.status) {
    conditions.push(eq(applications.status, options.status));
  }
  if (options?.searchProfileId) {
    conditions.push(eq(applications.searchProfileId, options.searchProfileId));
  }

  const appRows =
    conditions.length > 0
      ? db
          .select()
          .from(applications)
          .where(and(...conditions))
          .orderBy(desc(applications.updatedAt))
          .all()
      : db
          .select()
          .from(applications)
          .orderBy(desc(applications.updatedAt))
          .all();

  if (appRows.length === 0) return [];

  const jobIds = Array.from(new Set(appRows.map((a) => a.jobId)));
  const profileIds = Array.from(new Set(appRows.map((a) => a.searchProfileId)));
  const appIds = appRows.map((a) => a.id);
  const versionIds = appRows
    .map((a) => a.resumeVersionId)
    .filter((id): id is string => Boolean(id));

  const jobMap = new Map(
    db.select().from(jobs).where(inArray(jobs.id, jobIds)).all().map((j) => [j.id, j])
  );
  const profileMap = new Map(
    db
      .select()
      .from(searchProfiles)
      .where(inArray(searchProfiles.id, profileIds))
      .all()
      .map((p) => [p.id, p])
  );
  const versionMap = new Map(
    versionIds.length > 0
      ? db
          .select()
          .from(resumeVersions)
          .where(inArray(resumeVersions.id, versionIds))
          .all()
          .map((v) => [v.id, v])
      : []
  );

  const eventRows = db
    .select()
    .from(applicationEvents)
    .where(inArray(applicationEvents.applicationId, appIds))
    .all();
  const eventsCountMap = new Map<string, number>();
  for (const ev of eventRows) {
    eventsCountMap.set(ev.applicationId, (eventsCountMap.get(ev.applicationId) ?? 0) + 1);
  }

  const coverLetterRows = db
    .select()
    .from(coverLetters)
    .where(inArray(coverLetters.jobId, jobIds))
    .all();
  const coverLetterCountMap = new Map<string, number>();
  for (const cl of coverLetterRows) {
    const key = `${cl.jobId}:${cl.searchProfileId}`;
    coverLetterCountMap.set(key, (coverLetterCountMap.get(key) ?? 0) + 1);
  }

  const answerRows = db
    .select()
    .from(applicationAnswers)
    .where(inArray(applicationAnswers.jobId, jobIds))
    .all();
  const answersCountMap = new Map<string, number>();
  for (const ans of answerRows) {
    const key = `${ans.jobId}:${ans.searchProfileId}`;
    answersCountMap.set(key, (answersCountMap.get(key) ?? 0) + 1);
  }

  return appRows.map((app) => {
    const job = jobMap.get(app.jobId) ?? null;
    const sp = profileMap.get(app.searchProfileId) ?? null;
    const ver = app.resumeVersionId
      ? versionMap.get(app.resumeVersionId) ?? null
      : null;
    const key = `${app.jobId}:${app.searchProfileId}`;

    return {
      id: app.id,
      jobId: app.jobId,
      jobTitle: job?.title ?? "Untitled role",
      companyName: job?.companyName ?? "Unknown company",
      locationText: job?.locationText ?? null,
      workplaceType: job?.workplaceType ?? "unspecified",
      searchProfileId: app.searchProfileId,
      searchProfileName: sp?.name ?? null,
      status: app.status,
      appliedAt: app.appliedAt,
      resumeVersionId: app.resumeVersionId,
      resumeVersionNumber: ver?.versionNumber ?? null,
      originalApplyUrl:
        app.originalApplyUrl ?? job?.applyUrl ?? job?.canonicalUrl ?? null,
      submittedMaterialsSnapshot: app.submittedMaterialsSnapshotJson
        ? safeJsonParse(app.submittedMaterialsSnapshotJson, null)
        : null,
      submittedMaterialsHash: app.submittedMaterialsHash,
      notes: app.notes,
      eventsCount: eventsCountMap.get(app.id) ?? 0,
      coverLettersCount: coverLetterCountMap.get(key) ?? 0,
      answersCount: answersCountMap.get(key) ?? 0,
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
      searchProfile: sp ? { id: sp.id, name: sp.name } : null,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  });
}

/**
 * Returns full application detail including status timeline events, available
 * resume versions, linked cover letters, and application answers.
 */
export function getApplicationDetail(
  id: string,
  db: AppDatabase = getDb()
): ApplicationDetail | null {
  const app = db
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .get();
  if (!app) return null;

  const job = db.select().from(jobs).where(eq(jobs.id, app.jobId)).get() ?? null;
  const sp =
    db
      .select()
      .from(searchProfiles)
      .where(eq(searchProfiles.id, app.searchProfileId))
      .get() ?? null;

  const eventRows = db
    .select()
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, app.id))
    .orderBy(desc(applicationEvents.occurredAt), desc(applicationEvents.id))
    .all();

  const versionRows = db
    .select()
    .from(resumeVersions)
    .where(
      and(
        eq(resumeVersions.jobId, app.jobId),
        eq(resumeVersions.searchProfileId, app.searchProfileId)
      )
    )
    .orderBy(desc(resumeVersions.versionNumber))
    .all();

  const versionIds = versionRows.map((v) => v.id);
  const versionExportRows =
    versionIds.length > 0
      ? db
          .select()
          .from(documentExports)
          .where(inArray(documentExports.resumeVersionId, versionIds))
          .orderBy(desc(documentExports.exportedAt))
          .all()
      : [];
  const exportsByVersion = new Map<string, SerializedDocumentExport[]>();
  for (const ex of versionExportRows) {
    if (!ex.resumeVersionId) continue;
    const list = exportsByVersion.get(ex.resumeVersionId) ?? [];
    list.push(serializeDocumentExport(ex));
    exportsByVersion.set(ex.resumeVersionId, list);
  }

  const hydratedVersions = versionRows.map((v) => ({
    id: v.id,
    resumeDraftId: v.resumeDraftId,
    versionNumber: v.versionNumber,
    contentHash: v.contentHash,
    userEditedState: v.userEditedState,
    createdAt: v.createdAt,
    exports: exportsByVersion.get(v.id) ?? [],
  }));

  const attachedVersionRow = app.resumeVersionId
    ? db
        .select()
        .from(resumeVersions)
        .where(eq(resumeVersions.id, app.resumeVersionId))
        .get() ?? null
    : null;

  const attachedVersionExports = attachedVersionRow
    ? db
        .select()
        .from(documentExports)
        .where(eq(documentExports.resumeVersionId, attachedVersionRow.id))
        .orderBy(desc(documentExports.exportedAt))
        .all()
        .map(serializeDocumentExport)
    : [];

  const latestDraft = db
    .select()
    .from(resumeDrafts)
    .where(
      and(
        eq(resumeDrafts.jobId, app.jobId),
        eq(resumeDrafts.searchProfileId, app.searchProfileId)
      )
    )
    .orderBy(desc(resumeDrafts.updatedAt))
    .get();

  const coverLetterRows = db
    .select()
    .from(coverLetters)
    .where(
      and(
        eq(coverLetters.jobId, app.jobId),
        eq(coverLetters.searchProfileId, app.searchProfileId)
      )
    )
    .orderBy(desc(coverLetters.updatedAt))
    .all();

  const coverLetterIds = coverLetterRows.map((c) => c.id);
  const clExportRows =
    coverLetterIds.length > 0
      ? db
          .select()
          .from(documentExports)
          .where(inArray(documentExports.coverLetterId, coverLetterIds))
          .orderBy(desc(documentExports.exportedAt))
          .all()
      : [];
  const exportsByCoverLetter = new Map<string, SerializedDocumentExport[]>();
  for (const ex of clExportRows) {
    if (!ex.coverLetterId) continue;
    const list = exportsByCoverLetter.get(ex.coverLetterId) ?? [];
    list.push(serializeDocumentExport(ex));
    exportsByCoverLetter.set(ex.coverLetterId, list);
  }

  const verifiedFacts: SafeVerifiedFactSummary[] =
    coverLetterRows.length > 0
      ? buildVerifiedFactCatalog(getFullCareerProfile(db)).items.map((item) => ({
          key: item.key,
          factType: item.factType,
          factId: item.factId,
          label: item.label,
          excerpt: item.excerpt,
          defaultEvidenceLinkId: item.defaultEvidenceLinkId,
        }))
      : [];

  const hydratedCoverLetters = coverLetterRows.map((cl) =>
    hydrateCoverLetterRow(
      cl,
      db,
      exportsByCoverLetter.get(cl.id) ?? [],
      verifiedFacts
    )
  );

  const answerRows = db
    .select()
    .from(applicationAnswers)
    .where(
      and(
        eq(applicationAnswers.jobId, app.jobId),
        eq(applicationAnswers.searchProfileId, app.searchProfileId)
      )
    )
    .orderBy(asc(applicationAnswers.createdAt))
    .all();

  const hydratedAnswers = answerRows.map(hydrateApplicationAnswerRow);

  return {
    id: app.id,
    jobId: app.jobId,
    jobTitle: job?.title ?? "Untitled role",
    companyName: job?.companyName ?? "Unknown company",
    locationText: job?.locationText ?? null,
    workplaceType: job?.workplaceType ?? "unspecified",
    searchProfileId: app.searchProfileId,
    searchProfileName: sp?.name ?? null,
    status: app.status,
    appliedAt: app.appliedAt,
    resumeVersionId: app.resumeVersionId,
    resumeVersionNumber: attachedVersionRow?.versionNumber ?? null,
    originalApplyUrl:
      app.originalApplyUrl ?? job?.applyUrl ?? job?.canonicalUrl ?? null,
    submittedMaterialsSnapshot: app.submittedMaterialsSnapshotJson
      ? safeJsonParse(app.submittedMaterialsSnapshotJson, null)
      : null,
    submittedMaterialsHash: app.submittedMaterialsHash,
    notes: app.notes,
    eventsCount: eventRows.length,
    coverLettersCount: hydratedCoverLetters.length,
    answersCount: hydratedAnswers.length,
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
    searchProfile: sp ? { id: sp.id, name: sp.name } : null,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    events: eventRows.map((ev) => ({
      id: ev.id,
      applicationId: ev.applicationId,
      priorStatus: ev.priorStatus,
      newStatus: ev.newStatus,
      note: ev.note,
      occurredAt: ev.occurredAt,
    })),
    resumeVersion: attachedVersionRow
      ? {
          id: attachedVersionRow.id,
          resumeDraftId: attachedVersionRow.resumeDraftId,
          versionNumber: attachedVersionRow.versionNumber,
          contentHash: attachedVersionRow.contentHash,
          userEditedState: attachedVersionRow.userEditedState,
          createdAt: attachedVersionRow.createdAt,
          exports: attachedVersionExports,
        }
      : null,
    resumeVersions: hydratedVersions,
    latestResumeDraftId: latestDraft?.id ?? null,
    coverLetter: hydratedCoverLetters[0] ?? null,
    coverLetters: hydratedCoverLetters,
    answers: hydratedAnswers,
  };
}

export interface CreateOrPrepareApplicationInput {
  jobId: string;
  searchProfileId?: string | null;
  resumeVersionId?: string | null;
  originalApplyUrl?: string | null;
  notes?: string | null;
}

/**
 * Creates or returns an application record for `(jobId, searchProfileId)`,
 * starting at `"preparing"` (never `"saved"`) with an initial audit event.
 */
export function createOrPrepareApplication(
  rawInput: CreateOrPrepareApplicationInput,
  db: AppDatabase = getDb(),
  now: () => Date = () => new Date()
): ApplicationDetail {
  const input = CreateOrPrepareApplicationSchema.parse(rawInput);
  const canonicalJob = resolveCanonicalJobForApp(db, input.jobId);
  const searchProfile = resolveSearchProfileForApp(db, input.searchProfileId);

  const safeApplyUrl =
    input.originalApplyUrl !== undefined
      ? validateSafeApplyUrl(input.originalApplyUrl)
      : validateSafeApplyUrl(canonicalJob.applyUrl ?? canonicalJob.canonicalUrl);

  if (input.resumeVersionId) {
    const version = db
      .select()
      .from(resumeVersions)
      .where(
        and(
          eq(resumeVersions.id, input.resumeVersionId),
          eq(resumeVersions.jobId, canonicalJob.id)
        )
      )
      .get();
    if (!version) {
      throw new ApplicationServiceError(
        "VERSION_NOT_FOUND",
        404,
        `Resume version not found for this job: ${input.resumeVersionId}`
      );
    }
  }

  const nowIso = now().toISOString();

  const applicationId = db.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(applications)
        .where(
          and(
            eq(applications.jobId, canonicalJob.id),
            eq(applications.searchProfileId, searchProfile.id)
          )
        )
        .get();

      if (existing) {
        const updates: Partial<typeof applications.$inferInsert> = {};
        if (input.resumeVersionId !== undefined) {
          updates.resumeVersionId = input.resumeVersionId;
        }
        if (input.originalApplyUrl !== undefined) {
          updates.originalApplyUrl = safeApplyUrl;
        }
        if (input.notes !== undefined) {
          updates.notes = input.notes;
        }
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = nowIso;
          tx.update(applications)
            .set(updates)
            .where(eq(applications.id, existing.id))
            .run();
        }
        return existing.id;
      }

      const id = crypto.randomUUID();
      tx.insert(applications)
        .values({
          id,
          jobId: canonicalJob.id,
          searchProfileId: searchProfile.id,
          status: "preparing",
          appliedAt: null,
          resumeVersionId: input.resumeVersionId ?? null,
          originalApplyUrl: safeApplyUrl,
          submittedMaterialsSnapshotJson: null,
          submittedMaterialsHash: null,
          notes: input.notes ?? null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();

      tx.insert(applicationEvents)
        .values({
          id: crypto.randomUUID(),
          applicationId: id,
          priorStatus: null,
          newStatus: "preparing",
          note: "Started preparing application.",
          occurredAt: nowIso,
        })
        .run();

      return id;
    },
    { behavior: "immediate" }
  );

  const detail = getApplicationDetail(applicationId, db);
  if (!detail) {
    throw new ApplicationServiceError(
      "APPLICATION_NOT_FOUND",
      404,
      "Application could not be reloaded."
    );
  }
  return detail;
}

/**
 * Updates editable metadata (`notes`, `resumeVersionId`, `originalApplyUrl`) on an
 * application without mutating any previously frozen `submittedMaterialsSnapshotJson`.
 */
export function updateApplicationMetadata(
  id: string,
  rawPatch: {
    notes?: string | null;
    resumeVersionId?: string | null;
    originalApplyUrl?: string | null;
  },
  db: AppDatabase = getDb(),
  now: () => Date = () => new Date()
): ApplicationDetail {
  const patch = UpdateApplicationMetadataSchema.parse(rawPatch);
  const existing = db
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .get();
  if (!existing) {
    throw new ApplicationServiceError(
      "APPLICATION_NOT_FOUND",
      404,
      `Application not found: ${id}`
    );
  }

  const nextApplyUrl =
    patch.originalApplyUrl !== undefined
      ? validateSafeApplyUrl(patch.originalApplyUrl)
      : existing.originalApplyUrl;

  if (patch.resumeVersionId) {
    const version = db
      .select()
      .from(resumeVersions)
      .where(
        and(
          eq(resumeVersions.id, patch.resumeVersionId),
          eq(resumeVersions.jobId, existing.jobId)
        )
      )
      .get();
    if (!version) {
      throw new ApplicationServiceError(
        "VERSION_NOT_FOUND",
        404,
        `Resume version not found for this job: ${patch.resumeVersionId}`
      );
    }
  }

  const nowIso = now().toISOString();
  db.transaction(
    (tx) => {
      tx.update(applications)
        .set({
          notes: patch.notes !== undefined ? patch.notes : existing.notes,
          resumeVersionId:
            patch.resumeVersionId !== undefined
              ? patch.resumeVersionId
              : existing.resumeVersionId,
          originalApplyUrl: nextApplyUrl,
          updatedAt: nowIso,
        })
        .where(eq(applications.id, existing.id))
        .run();
    },
    { behavior: "immediate" }
  );

  const detail = getApplicationDetail(existing.id, db);
  if (!detail) {
    throw new ApplicationServiceError(
      "APPLICATION_NOT_FOUND",
      404,
      `Application not found: ${id}`
    );
  }
  return detail;
}

export interface TransitionApplicationStatusInput {
  applicationId: string;
  newStatus: ApplicationStatus;
  note?: string | null;
  resumeVersionId?: string | null;
  coverLetterId?: string | null;
  answerIds?: string[];
  confirmSubmission?: boolean;
  appliedAt?: string | null;
}

/**
 * Transitions an application's status and writes an audit row in `applicationEvents`.
 * Transitioning to `"applied"` requires `confirmSubmission === true` and freezes an
 * immutable `submittedMaterialsSnapshotJson` + SHA-256 `submittedMaterialsHash`.
 */
export function transitionApplicationStatus(
  input: TransitionApplicationStatusInput,
  db: AppDatabase = getDb(),
  now: () => Date = () => new Date()
): ApplicationDetail {
  if (!APPLICATION_STATUSES.includes(input.newStatus)) {
    throw new ApplicationServiceError(
      "INVALID_APPLICATION_STATUS",
      400,
      `Invalid application status: ${String(input.newStatus)}`
    );
  }

  const existing = db
    .select()
    .from(applications)
    .where(eq(applications.id, input.applicationId))
    .get();
  if (!existing) {
    throw new ApplicationServiceError(
      "APPLICATION_NOT_FOUND",
      404,
      `Application not found: ${input.applicationId}`
    );
  }

  if (input.newStatus === "applied" && input.confirmSubmission !== true) {
    throw new ApplicationServiceError(
      "CONFIRMATION_REQUIRED",
      400,
      "Explicit user confirmation is required before marking an application as applied."
    );
  }

  if (input.resumeVersionId) {
    const verCheck = db
      .select()
      .from(resumeVersions)
      .where(
        and(
          eq(resumeVersions.id, input.resumeVersionId),
          eq(resumeVersions.jobId, existing.jobId)
        )
      )
      .get();
    if (!verCheck) {
      throw new ApplicationServiceError(
        "VERSION_NOT_FOUND",
        404,
        `Resume version not found for this job: ${input.resumeVersionId}`
      );
    }
  }

  const nowIso = now().toISOString();
  let effectiveResumeVersionId =
    input.resumeVersionId !== undefined
      ? input.resumeVersionId
      : existing.resumeVersionId;

  let nextAppliedAt = existing.appliedAt;
  let nextSnapshotJson = existing.submittedMaterialsSnapshotJson;
  let nextSnapshotHash = existing.submittedMaterialsHash;

  if (input.newStatus === "applied") {
    nextAppliedAt = input.appliedAt?.trim() || existing.appliedAt || nowIso;

    if (!effectiveResumeVersionId && input.resumeVersionId !== null) {
      const latestVer = db
        .select()
        .from(resumeVersions)
        .where(
          and(
            eq(resumeVersions.jobId, existing.jobId),
            eq(resumeVersions.searchProfileId, existing.searchProfileId)
          )
        )
        .orderBy(desc(resumeVersions.versionNumber))
        .get();
      if (latestVer) {
        effectiveResumeVersionId = latestVer.id;
      }
    }

    const job = db.select().from(jobs).where(eq(jobs.id, existing.jobId)).get();
    const attachedVersion = effectiveResumeVersionId
      ? db
          .select()
          .from(resumeVersions)
          .where(eq(resumeVersions.id, effectiveResumeVersionId))
          .get() ?? null
      : null;
    const versionExports = attachedVersion
      ? db
          .select()
          .from(documentExports)
          .where(eq(documentExports.resumeVersionId, attachedVersion.id))
          .orderBy(desc(documentExports.exportedAt))
          .all()
          .map(serializeDocumentExport)
      : [];

    const coverLetter = input.coverLetterId
      ? db
          .select()
          .from(coverLetters)
          .where(
            and(
              eq(coverLetters.id, input.coverLetterId),
              eq(coverLetters.jobId, existing.jobId)
            )
          )
          .get() ?? null
      : db
          .select()
          .from(coverLetters)
          .where(
            and(
              eq(coverLetters.jobId, existing.jobId),
              eq(coverLetters.searchProfileId, existing.searchProfileId)
            )
          )
          .orderBy(desc(coverLetters.updatedAt))
          .get() ?? null;

    const coverLetterContent = coverLetter
      ? CoverLetterContentSchema.safeParse(
          safeJsonParse(coverLetter.structuredContentJson, null)
        )
      : null;
    const coverLetterText =
      coverLetterContent && coverLetterContent.success
        ? coverLetterContentToPlainBody(coverLetterContent.data)
        : null;

    const answers =
      input.answerIds && input.answerIds.length > 0
        ? db
            .select()
            .from(applicationAnswers)
            .where(
              and(
                eq(applicationAnswers.jobId, existing.jobId),
                inArray(applicationAnswers.id, input.answerIds)
              )
            )
            .orderBy(asc(applicationAnswers.createdAt))
            .all()
        : db
            .select()
            .from(applicationAnswers)
            .where(
              and(
                eq(applicationAnswers.jobId, existing.jobId),
                eq(applicationAnswers.searchProfileId, existing.searchProfileId)
              )
            )
            .orderBy(asc(applicationAnswers.createdAt))
            .all();

    const snapshot = {
      confirmedAt: nowIso,
      appliedAt: nextAppliedAt,
      originalApplyUrl:
        existing.originalApplyUrl ?? job?.applyUrl ?? job?.canonicalUrl ?? null,
      resumeVersionId: attachedVersion?.id ?? null,
      resumeVersionNumber: attachedVersion?.versionNumber ?? null,
      resumeContentHash: attachedVersion?.contentHash ?? null,
      coverLetterId: coverLetter?.id ?? null,
      coverLetterContentHash: coverLetter?.contentHash ?? null,
      coverLetterText,
      answerIds: answers.map((a) => a.id),
      answers: answers.map((a) => ({
        id: a.id,
        promptKey: a.promptKey,
        promptText: a.promptText,
        answerText: a.answerText,
        contentHash: a.contentHash,
        userEditedState: a.userEditedState,
      })),
      job: job
        ? {
            id: job.id,
            title: job.title,
            companyName: job.companyName,
            canonicalUrl: job.canonicalUrl,
            applyUrl: existing.originalApplyUrl ?? job.applyUrl,
          }
        : null,
      resumeVersion: attachedVersion
        ? {
            id: attachedVersion.id,
            resumeDraftId: attachedVersion.resumeDraftId,
            versionNumber: attachedVersion.versionNumber,
            contentHash: attachedVersion.contentHash,
            jobDescriptionHash: attachedVersion.jobDescriptionHash,
            careerProfileHash: attachedVersion.careerProfileHash,
            structuredContent: safeJsonParse(
              attachedVersion.structuredContentJson,
              null
            ),
            exports: versionExports,
          }
        : null,
      coverLetter: coverLetter
        ? {
            id: coverLetter.id,
            contentHash: coverLetter.contentHash,
            structuredContent: safeJsonParse(
              coverLetter.structuredContentJson,
              null
            ),
            text: coverLetterText,
            userEditedState: coverLetter.userEditedState,
          }
        : null,
    };

    nextSnapshotJson = JSON.stringify(snapshot);
    nextSnapshotHash = sha256Hex(nextSnapshotJson);
  }

  db.transaction(
    (tx) => {
      tx.update(applications)
        .set({
          status: input.newStatus,
          appliedAt: nextAppliedAt,
          resumeVersionId: effectiveResumeVersionId,
          submittedMaterialsSnapshotJson: nextSnapshotJson,
          submittedMaterialsHash: nextSnapshotHash,
          updatedAt: nowIso,
        })
        .where(eq(applications.id, existing.id))
        .run();

      tx.insert(applicationEvents)
        .values({
          id: crypto.randomUUID(),
          applicationId: existing.id,
          priorStatus: existing.status,
          newStatus: input.newStatus,
          note: input.note ?? null,
          occurredAt: nowIso,
        })
        .run();
    },
    { behavior: "immediate" }
  );

  const detail = getApplicationDetail(existing.id, db);
  if (!detail) {
    throw new ApplicationServiceError(
      "APPLICATION_NOT_FOUND",
      404,
      `Application not found: ${input.applicationId}`
    );
  }
  return detail;
}

export interface GenerateAndSaveCoverLetterInput {
  jobId: string;
  searchProfileId?: string | null;
  applicationId?: string | null;
  mode?: MaterialGenerationMode;
  tone?: string | null;
  length?: "short" | "medium" | "long" | "detailed";
  regenerate?: boolean;
  taskId?: string;
  db?: AppDatabase;
  now?: () => Date;
}

/**
 * Generates (or returns existing when `!regenerate`) a cover letter draft for
 * `(jobId, searchProfileId)` grounded in verified profile facts.
 */
export async function generateAndSaveCoverLetter(
  input: GenerateAndSaveCoverLetterInput
): Promise<CoverLetterDetail> {
  const db = input.db ?? getDb();
  const canonicalJob = resolveCanonicalJobForApp(db, input.jobId);
  const searchProfile = resolveSearchProfileForApp(db, input.searchProfileId);

  const existing = db
    .select()
    .from(coverLetters)
    .where(
      and(
        eq(coverLetters.jobId, canonicalJob.id),
        eq(coverLetters.searchProfileId, searchProfile.id)
      )
    )
    .orderBy(desc(coverLetters.updatedAt))
    .get();

  if (existing && !input.regenerate) {
    const hydrated = getCoverLetterDetail(existing.id, db);
    if (hydrated) return hydrated;
  }

  const normalizedLength =
    input.length === "detailed" ? "long" : input.length;

  let generated;
  try {
    generated = await generateCoverLetterDraft({
      jobId: canonicalJob.id,
      searchProfileId: searchProfile.id,
      mode: input.mode,
      tone: input.tone,
      length: normalizedLength,
      taskId: input.taskId,
      db,
      now: input.now,
    });
  } catch (err) {
    if (err instanceof MaterialsGenerationError) {
      throw new ApplicationServiceError(err.code, err.status, err.message);
    }
    throw err;
  }

  const linkedApp =
    input.applicationId !== undefined
      ? input.applicationId
      : db
          .select({ id: applications.id })
          .from(applications)
          .where(
            and(
              eq(applications.jobId, canonicalJob.id),
              eq(applications.searchProfileId, searchProfile.id)
            )
          )
          .get()?.id ?? null;

  const nowIso = (input.now ? input.now() : new Date()).toISOString();
  const coverLetterId = existing?.id ?? crypto.randomUUID();
  const structuredContentJson = JSON.stringify(generated.content);
  const evidenceRefsJson = JSON.stringify(generated.evidenceRefs);

  db.transaction(
    (tx) => {
      if (existing) {
        tx.update(coverLetters)
          .set({
            applicationId: linkedApp ?? existing.applicationId,
            structuredContentJson,
            evidenceRefsJson,
            modelProvider: generated.modelProvider,
            modelName: generated.modelName,
            promptVersion: generated.promptVersion,
            userEditedState: "generated",
            contentHash: generated.contentHash,
            updatedAt: nowIso,
          })
          .where(eq(coverLetters.id, existing.id))
          .run();
      } else {
        tx.insert(coverLetters)
          .values({
            id: coverLetterId,
            jobId: canonicalJob.id,
            searchProfileId: searchProfile.id,
            applicationId: linkedApp,
            structuredContentJson,
            evidenceRefsJson,
            modelProvider: generated.modelProvider,
            modelName: generated.modelName,
            promptVersion: generated.promptVersion,
            userEditedState: "generated",
            contentHash: generated.contentHash,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .run();
      }
    },
    { behavior: "immediate" }
  );

  const detail = getCoverLetterDetail(coverLetterId, db);
  if (!detail) {
    throw new ApplicationServiceError(
      "COVER_LETTER_NOT_FOUND",
      404,
      "Generated cover letter could not be reloaded."
    );
  }
  return detail;
}

export function getCoverLetterDetail(
  id: string,
  db: AppDatabase = getDb()
): CoverLetterDetail | null {
  const row = db
    .select()
    .from(coverLetters)
    .where(eq(coverLetters.id, id))
    .get();
  if (!row) return null;
  return hydrateCoverLetterRow(row, db);
}

function normalizeIncomingCoverLetterContent(
  raw: {
    content?: unknown;
    structuredContent?: unknown;
    text?: string;
  },
  existing: CoverLetterContent
): CoverLetterContent {
  const candidate = raw.content ?? raw.structuredContent;
  if (candidate !== undefined) {
    const direct = CoverLetterContentSchema.safeParse(candidate);
    if (direct.success) {
      return direct.data;
    }

    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const obj = candidate as Record<string, unknown>;
      const rawParas = Array.isArray(obj.paragraphs) ? obj.paragraphs : [];
      const paragraphs = rawParas
        .map((p, idx) => {
          if (typeof p === "string" && p.trim()) {
            const prev = existing.paragraphs[idx];
            return {
              id: prev?.id ?? `p-${idx + 1}`,
              text: p.trim(),
              evidenceRefs: prev?.evidenceRefs ?? [],
            };
          }
          if (p && typeof p === "object") {
            return p;
          }
          return null;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      return CoverLetterContentSchema.parse({
        greeting:
          typeof obj.greeting === "string" && obj.greeting.trim()
            ? obj.greeting.trim()
            : existing.greeting,
        paragraphs:
          paragraphs.length > 0 ? paragraphs : existing.paragraphs,
        closing:
          typeof obj.closing === "string" && obj.closing.trim()
            ? obj.closing.trim()
            : existing.closing,
        signature:
          typeof obj.signature === "string" && obj.signature.trim()
            ? obj.signature.trim()
            : existing.signature,
      });
    }
  }

  if (typeof raw.text === "string" && raw.text.trim()) {
    const blocks = raw.text
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean);
    if (blocks.length >= 1) {
      let start = 0;
      let end = blocks.length;
      let greeting = existing.greeting;
      let closing = existing.closing;
      let signature = existing.signature;

      if (blocks.length >= 3 && /^(dear|hello|hi)\b/i.test(blocks[0])) {
        greeting = blocks[0];
        start = 1;
      }
      if (
        end - start >= 3 &&
        /^(sincerely|regards|best|warmly|thank you|respectfully)/i.test(
          blocks[end - 2]
        )
      ) {
        closing = blocks[end - 2];
        signature = blocks[end - 1];
        end -= 2;
      }
      const bodyBlocks = blocks.slice(start, end);
      const paragraphs = (bodyBlocks.length > 0 ? bodyBlocks : [raw.text.trim()]).map(
        (text, idx) => ({
          id: existing.paragraphs[idx]?.id ?? `p-${idx + 1}`,
          text,
          evidenceRefs: existing.paragraphs[idx]?.evidenceRefs ?? [],
        })
      );
      return CoverLetterContentSchema.parse({
        greeting,
        paragraphs,
        closing,
        signature,
      });
    }
  }

  return existing;
}

/**
 * Updates a cover letter's text/structured content, verifying all cited facts
 * against the verified career catalog and marking edited text as `user_edited`.
 */
export function updateCoverLetter(
  id: string,
  rawPatch: unknown,
  db: AppDatabase = getDb(),
  now: () => Date = () => new Date()
): CoverLetterDetail {
  const patch = UpdateCoverLetterSchema.parse(rawPatch);
  const existing = db
    .select()
    .from(coverLetters)
    .where(eq(coverLetters.id, id))
    .get();
  if (!existing) {
    throw new ApplicationServiceError(
      "COVER_LETTER_NOT_FOUND",
      404,
      `Cover letter not found: ${id}`
    );
  }

  const currentContent = CoverLetterContentSchema.parse(
    safeJsonParse(existing.structuredContentJson, {
      greeting: "Dear Hiring Team,",
      paragraphs: [{ id: "p-1", text: "Cover letter.", evidenceRefs: [] }],
      closing: "Sincerely,",
      signature: "Candidate",
    })
  );

  const nextContent = normalizeIncomingCoverLetterContent(patch, currentContent);
  const catalog = buildVerifiedFactCatalog(getFullCareerProfile(db));

  const flatRefs: ClaimEvidenceRef[] = [];
  const seenKeys = new Set<string>();
  for (const para of nextContent.paragraphs) {
    for (const ref of para.evidenceRefs) {
      const key = makeFactCatalogKey(ref.factType, ref.factId);
      if (!catalog.byKey[key]) {
        throw new ApplicationServiceError(
          "UNVERIFIED_EVIDENCE_REF",
          400,
          `Cover letter cites unverified, rejected, or non-existent fact "${key}".`
        );
      }
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        flatRefs.push(ref);
      }
    }
  }

  const nextStructuredJson = JSON.stringify(nextContent);
  const nextRefsJson = JSON.stringify(flatRefs);
  const nextHash = sha256Hex(nextStructuredJson);
  const contentChanged = nextHash !== existing.contentHash;

  let nextUserEditedState: UserEditedState = existing.userEditedState;
  if (patch.userEditedState !== undefined) {
    nextUserEditedState = patch.userEditedState;
  } else if (contentChanged) {
    nextUserEditedState = "user_edited";
  }

  const nowIso = now().toISOString();
  db.transaction(
    (tx) => {
      tx.update(coverLetters)
        .set({
          structuredContentJson: nextStructuredJson,
          evidenceRefsJson: nextRefsJson,
          userEditedState: nextUserEditedState,
          contentHash: nextHash,
          updatedAt: nowIso,
        })
        .where(eq(coverLetters.id, existing.id))
        .run();
    },
    { behavior: "immediate" }
  );

  const detail = getCoverLetterDetail(existing.id, db);
  if (!detail) {
    throw new ApplicationServiceError(
      "COVER_LETTER_NOT_FOUND",
      404,
      `Cover letter not found: ${id}`
    );
  }
  return detail;
}

export interface ExportCoverLetterInput {
  coverLetterId: string;
  format: ExportFormat;
  paperSize?: PaperSize;
  db?: AppDatabase;
  appDataDir?: string;
  now?: () => Date;
}

/**
 * Exports a cover letter as DOCX, PDF, TXT, or Markdown inside
 * `APP_DATA_DIR/exports/cover-letters` and inserts a `documentExports` row.
 */
export async function exportCoverLetter(
  input: ExportCoverLetterInput
): Promise<{
  exportRecord: SerializedDocumentExport;
  coverLetter: CoverLetterDetail;
  downloadUrl: string;
}> {
  if (!EXPORT_FORMATS.includes(input.format)) {
    throw new ApplicationServiceError(
      "INVALID_EXPORT_FORMAT",
      400,
      `Unsupported export format: ${String(input.format)}`
    );
  }

  const db = input.db ?? getDb();
  const row = db
    .select()
    .from(coverLetters)
    .where(eq(coverLetters.id, input.coverLetterId))
    .get();
  if (!row) {
    throw new ApplicationServiceError(
      "COVER_LETTER_NOT_FOUND",
      404,
      `Cover letter not found: ${input.coverLetterId}`
    );
  }

  const content = CoverLetterContentSchema.parse(
    safeJsonParse(row.structuredContentJson, {
      greeting: "Dear Hiring Team,",
      paragraphs: [{ id: "p-1", text: "Cover letter.", evidenceRefs: [] }],
      closing: "Sincerely,",
      signature: "Candidate",
    })
  );

  const job = db.select().from(jobs).where(eq(jobs.id, row.jobId)).get() ?? null;
  const searchProfile = resolveSearchProfileForApp(db, row.searchProfileId);
  const effectivePaperSize: PaperSize =
    input.paperSize ?? searchProfile.resumePreferences.paperSize ?? "A4";
  const settings = ResumeTemplateSettingsSchema.parse({
    paperSize: effectivePaperSize,
  });
  const meta = renderCoverLetterMeta(db, job, row.createdAt);

  let buffer: Buffer;
  switch (input.format) {
    case "docx":
      buffer = await exportCoverLetterToDocxBuffer(content, meta, settings);
      break;
    case "pdf": {
      const html = renderCoverLetterHtml(content, meta, settings);
      buffer = await exportHtmlToPdfBuffer(html, effectivePaperSize);
      break;
    }
    case "txt":
      buffer = Buffer.from(renderCoverLetterPlainText(content, meta), "utf-8");
      break;
    case "md":
      buffer = Buffer.from(renderCoverLetterMarkdown(content, meta), "utf-8");
      break;
  }

  const exportId = crypto.randomUUID();
  const paths = ensureAppDirectories(input.appDataDir);
  const fileName = `cover-letter-${row.id.slice(0, 8)}-${exportId.slice(0, 8)}.${input.format}`;
  const targetPath = assertPathWithin(paths.coverLetterExports, fileName);
  writeSecureFile(targetPath, buffer);

  const relativePath = path.relative(paths.base, targetPath);
  const fileHash = sha256Hex(buffer);
  const fileSizeBytes = buffer.byteLength;
  const nowIso = (input.now ? input.now() : new Date()).toISOString();

  const exportValues: typeof documentExports.$inferInsert = {
    id: exportId,
    resumeVersionId: null,
    coverLetterId: row.id,
    documentType: "cover_letter",
    format: input.format,
    filePath: relativePath,
    fileHash,
    fileSizeBytes,
    exportedAt: nowIso,
  };

  db.transaction(
    (tx) => {
      tx.insert(documentExports).values(exportValues).run();
    },
    { behavior: "immediate" }
  );

  const exportRecord = serializeDocumentExport(
    exportValues as typeof documentExports.$inferSelect
  );
  const coverLetter = getCoverLetterDetail(row.id, db)!;
  return {
    exportRecord,
    coverLetter,
    downloadUrl: exportRecord.downloadUrl,
  };
}

export interface GenerateAndSaveApplicationAnswersInput {
  jobId: string;
  searchProfileId?: string | null;
  applicationId?: string | null;
  prompts?: ApplicationAnswerPromptInput[];
  promptKeys?: string[];
  customPrompt?: string;
  mode?: MaterialGenerationMode;
  regenerate?: boolean;
  taskId?: string;
  db?: AppDatabase;
  now?: () => Date;
}

function resolvePromptList(
  input: GenerateAndSaveApplicationAnswersInput
): ApplicationAnswerPromptInput[] | undefined {
  if (input.prompts && input.prompts.length > 0) {
    return input.prompts;
  }
  const collected: ApplicationAnswerPromptInput[] = [];
  if (input.promptKeys && input.promptKeys.length > 0) {
    for (const key of input.promptKeys) {
      const trimmedKey = key.trim();
      if (!trimmedKey) continue;
      collected.push({
        promptKey: trimmedKey,
        promptText: STANDARD_PROMPT_LABELS[trimmedKey] ?? trimmedKey,
      });
    }
  }
  if (input.customPrompt && input.customPrompt.trim()) {
    const customText = input.customPrompt.trim();
    const key = `custom_${sha256Hex(customText).slice(0, 8)}`;
    collected.push({
      promptKey: key,
      promptText: customText,
    });
  }
  return collected.length > 0 ? collected : undefined;
}

/**
 * Generates and persists application answer drafts for a job, withholding
 * automatic answers for sensitive legal/work-authorization/demographic prompts.
 */
export async function generateAndSaveApplicationAnswers(
  input: GenerateAndSaveApplicationAnswersInput
): Promise<{
  items: HydratedApplicationAnswer[];
  modelProvider: string;
  modelName: string | null;
  promptVersion: string;
  usedAi: boolean;
  fallbackReason: string | null;
}> {
  const db = input.db ?? getDb();
  const canonicalJob = resolveCanonicalJobForApp(db, input.jobId);
  const searchProfile = resolveSearchProfileForApp(db, input.searchProfileId);
  const prompts = resolvePromptList(input);

  let generated;
  try {
    generated = await generateApplicationAnswersDraft({
      jobId: canonicalJob.id,
      searchProfileId: searchProfile.id,
      prompts,
      mode: input.mode,
      taskId: input.taskId,
      db,
      now: input.now,
    });
  } catch (err) {
    if (err instanceof MaterialsGenerationError) {
      throw new ApplicationServiceError(err.code, err.status, err.message);
    }
    throw err;
  }

  const linkedAppId =
    input.applicationId !== undefined
      ? input.applicationId
      : db
          .select({ id: applications.id })
          .from(applications)
          .where(
            and(
              eq(applications.jobId, canonicalJob.id),
              eq(applications.searchProfileId, searchProfile.id)
            )
          )
          .get()?.id ?? null;

  const nowIso = (input.now ? input.now() : new Date()).toISOString();

  const savedIds = db.transaction(
    (tx) => {
      const existingRows = tx
        .select()
        .from(applicationAnswers)
        .where(
          and(
            eq(applicationAnswers.jobId, canonicalJob.id),
            eq(applicationAnswers.searchProfileId, searchProfile.id)
          )
        )
        .all();
      const existingByKey = new Map(existingRows.map((r) => [r.promptKey, r]));

      const ids: string[] = [];
      for (const item of generated.items) {
        const existing = existingByKey.get(item.promptKey);
        const evidenceRefsJson = JSON.stringify(item.evidenceRefs);
        const answerText = item.requiresHumanInput ? "" : item.answerText;
        const contentHash = item.requiresHumanInput
          ? sha256Hex("")
          : item.contentHash;

        if (existing) {
          if (
            !input.regenerate &&
            (existing.userEditedState === "user_edited" ||
              existing.userEditedState === "user_verified")
          ) {
            ids.push(existing.id);
            continue;
          }
          tx.update(applicationAnswers)
            .set({
              applicationId: linkedAppId ?? existing.applicationId,
              promptText: item.promptText,
              answerText,
              evidenceRefsJson,
              modelProvider: generated.modelProvider,
              modelName: generated.modelName,
              promptVersion: generated.promptVersion,
              userEditedState: "generated",
              contentHash,
              updatedAt: nowIso,
            })
            .where(eq(applicationAnswers.id, existing.id))
            .run();
          ids.push(existing.id);
        } else {
          const newId = crypto.randomUUID();
          tx.insert(applicationAnswers)
            .values({
              id: newId,
              jobId: canonicalJob.id,
              searchProfileId: searchProfile.id,
              applicationId: linkedAppId,
              promptKey: item.promptKey,
              promptText: item.promptText,
              answerText,
              evidenceRefsJson,
              modelProvider: generated.modelProvider,
              modelName: generated.modelName,
              promptVersion: generated.promptVersion,
              userEditedState: "generated",
              contentHash,
              createdAt: nowIso,
              updatedAt: nowIso,
            })
            .run();
          ids.push(newId);
        }
      }
      return ids;
    },
    { behavior: "immediate" }
  );

  const savedRows =
    savedIds.length > 0
      ? db
          .select()
          .from(applicationAnswers)
          .where(inArray(applicationAnswers.id, savedIds))
          .all()
      : [];
  const rowMap = new Map(savedRows.map((r) => [r.id, r]));
  const items = savedIds
    .map((id) => rowMap.get(id))
    .filter((r): r is typeof applicationAnswers.$inferSelect => Boolean(r))
    .map(hydrateApplicationAnswerRow);

  return {
    items,
    modelProvider: generated.modelProvider,
    modelName: generated.modelName,
    promptVersion: generated.promptVersion,
    usedAi: generated.usedAi,
    fallbackReason: generated.fallbackReason,
  };
}

export function getApplicationAnswerDetail(
  id: string,
  db: AppDatabase = getDb()
): HydratedApplicationAnswer | null {
  const row = db
    .select()
    .from(applicationAnswers)
    .where(eq(applicationAnswers.id, id))
    .get();
  if (!row) return null;
  return hydrateApplicationAnswerRow(row);
}

/**
 * Updates an individual application answer's text, prompt text, evidence refs,
 * or verification confirmation.
 */
export function updateApplicationAnswer(
  id: string,
  rawPatch: unknown,
  db: AppDatabase = getDb(),
  now: () => Date = () => new Date()
): HydratedApplicationAnswer {
  const patch = UpdateApplicationAnswerSchema.parse(rawPatch);
  const existing = db
    .select()
    .from(applicationAnswers)
    .where(eq(applicationAnswers.id, id))
    .get();
  if (!existing) {
    throw new ApplicationServiceError(
      "ANSWER_NOT_FOUND",
      404,
      `Application answer not found: ${id}`
    );
  }

  const catalog = buildVerifiedFactCatalog(getFullCareerProfile(db));
  let nextRefsJson = existing.evidenceRefsJson;
  if (patch.evidenceRefs !== undefined) {
    for (const ref of patch.evidenceRefs) {
      const key = makeFactCatalogKey(ref.factType, ref.factId);
      if (!catalog.byKey[key]) {
        throw new ApplicationServiceError(
          "UNVERIFIED_EVIDENCE_REF",
          400,
          `Application answer cites unverified, rejected, or non-existent fact "${key}".`
        );
      }
    }
    nextRefsJson = JSON.stringify(patch.evidenceRefs);
  }

  const nextPromptText =
    patch.promptText !== undefined ? patch.promptText.trim() : existing.promptText;
  const nextAnswerText =
    patch.answerText !== undefined ? patch.answerText : existing.answerText;
  const nextHash = sha256Hex(nextAnswerText);
  const answerChanged = nextAnswerText !== existing.answerText;

  let nextUserEditedState: UserEditedState = existing.userEditedState;
  if (patch.userEditedState !== undefined) {
    nextUserEditedState = patch.userEditedState;
  } else if (answerChanged) {
    nextUserEditedState = "user_edited";
  }

  const nowIso = now().toISOString();
  db.transaction(
    (tx) => {
      tx.update(applicationAnswers)
        .set({
          promptText: nextPromptText,
          answerText: nextAnswerText,
          evidenceRefsJson: nextRefsJson,
          userEditedState: nextUserEditedState,
          contentHash: nextHash,
          updatedAt: nowIso,
        })
        .where(eq(applicationAnswers.id, existing.id))
        .run();
    },
    { behavior: "immediate" }
  );

  const updated = getApplicationAnswerDetail(existing.id, db);
  if (!updated) {
    throw new ApplicationServiceError(
      "ANSWER_NOT_FOUND",
      404,
      `Application answer not found: ${id}`
    );
  }
  return updated;
}

export const ExportApplicationAnswersSchema = z
  .object({
    answerIds: z.array(z.string().trim().min(1).max(128)).min(1).max(50),
    format: z.enum(["txt", "md"]).optional().default("md"),
  })
  .strict();

export function exportApplicationAnswers(input: {
  answerIds: string[];
  format: "txt" | "md";
  db?: AppDatabase;
  appDataDir?: string;
  now?: () => Date;
}): {
  exportRecord: SerializedDocumentExport;
  downloadUrl: string;
} {
  const parsed = ExportApplicationAnswersSchema.parse({
    answerIds: input.answerIds,
    format: input.format,
  });
  const db = input.db ?? getDb();
  const rows = db
    .select()
    .from(applicationAnswers)
    .where(inArray(applicationAnswers.id, parsed.answerIds))
    .orderBy(asc(applicationAnswers.createdAt))
    .all();

  if (rows.length === 0) {
    throw new ApplicationServiceError(
      "ANSWER_NOT_FOUND",
      404,
      "No matching application answers were found to export."
    );
  }

  const lines: string[] = [];
  if (parsed.format === "md") {
    lines.push("# Application Answers", "");
    for (const row of rows) {
      lines.push(`## ${row.promptText}`, "", row.answerText.trim() || "_Manual input required._", "");
    }
  } else {
    lines.push("APPLICATION ANSWERS", "===================", "");
    for (const row of rows) {
      lines.push(`Q: ${row.promptText}`, row.answerText.trim() || "[Manual input required]", "");
    }
  }

  const buffer = Buffer.from(lines.join("\n"), "utf-8");
  const exportId = crypto.randomUUID();
  const paths = ensureAppDirectories(input.appDataDir);
  const fileName = `application-answers-${exportId.slice(0, 8)}.${parsed.format}`;
  const targetPath = assertPathWithin(paths.coverLetterExports, fileName);
  writeSecureFile(targetPath, buffer);

  const relativePath = path.relative(paths.base, targetPath);
  const fileHash = sha256Hex(buffer);
  const nowIso = (input.now ? input.now() : new Date()).toISOString();

  const exportValues = {
    id: exportId,
    resumeVersionId: null,
    coverLetterId: null,
    documentType: "application_answers" as const,
    format: parsed.format,
    filePath: relativePath,
    fileHash,
    fileSizeBytes: buffer.byteLength,
    exportedAt: nowIso,
  };

  db.transaction(
    (tx) => {
      tx.insert(documentExports).values(exportValues).run();
    },
    { behavior: "immediate" }
  );

  return {
    exportRecord: serializeDocumentExport(exportValues),
    downloadUrl: `/api/exports/${exportId}/download`,
  };
}

/**
 * Converts service, validation, AI-generation, and PDF-browser errors into
 * uniform HTTP status + JSON payloads without importing Next.js modules.
 */
export function mapMaterialsServiceError(
  err: unknown,
  fallbackMessage = "Operation failed."
): {
  status: number;
  body: {
    ok: false;
    error: {
      code: string;
      message: string;
      issues?: unknown;
    };
  };
} {
  if (err instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: err.issues[0]?.message ?? "Invalid request payload.",
          issues: err.issues,
        },
      },
    };
  }
  if (err instanceof PdfBrowserMissingError) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: "PDF_BROWSER_MISSING",
          message: err.message,
        },
      },
    };
  }
  if (
    err instanceof ResumeServiceError ||
    err instanceof ApplicationServiceError ||
    err instanceof MaterialsGenerationError
  ) {
    return {
      status: err.status,
      body: {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: "MATERIALS_INTERNAL_ERROR",
        message: fallbackMessage,
      },
    },
  };
}

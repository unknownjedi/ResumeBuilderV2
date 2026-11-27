import crypto from "node:crypto";
import fs from "node:fs";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, type AppDatabase } from "../db/client";
import {
  EVIDENCE_TARGET_TYPES,
  FACT_ORIGINS,
  VERIFICATION_STATUSES,
  achievementSkills,
  achievements,
  certifications,
  education,
  evidenceLinks,
  experienceSkills,
  experiences,
  languages,
  profile,
  projectSkills,
  projects,
  skills,
  sourceDocuments,
  type EvidenceTargetType,
  type ExtractionStatus,
  type FactOrigin,
  type VerificationStatus,
} from "../db/schema/career";
import { assertPathWithin, resolveAppDataDir } from "../files/paths";
import { redactPaths } from "../security/redaction";

const EXTRACTED_TEXT_PREVIEW_MAX_CHARS = 500;
const EXTRACTED_TEXT_PREVIEW_MAX_BYTES = 4096;

export class ProfileServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ProfileServiceError";
    this.code = code;
    this.status = status;
  }
}

export const VerificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export const FactOriginSchema = z.enum(FACT_ORIGINS);
export const EvidenceTargetTypeSchema = z.enum(EVIDENCE_TARGET_TYPES);

export const PROFILE_VERIFIABLE_ENTITIES = [
  ...EVIDENCE_TARGET_TYPES,
  "evidence_link",
] as const;
export type ProfileVerifiableEntity = (typeof PROFILE_VERIFIABLE_ENTITIES)[number];

function nullableTrimmedString(maxLength: number) {
  return z
    .union([z.string().trim().max(maxLength), z.null()])
    .optional()
    .transform((val) => {
      if (val === undefined) return undefined;
      if (val === null || val === "") return null;
      return val;
    });
}

function nullableSafeHttpUrl(maxLength: number) {
  return nullableTrimmedString(maxLength).refine(
    (val) => {
      if (val === undefined || val === null) return true;
      try {
        const parsed = new URL(val);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return false;
        }
        if (parsed.username || parsed.password) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    { message: "Only valid http:// or https:// URLs without credentials are allowed." }
  );
}

export const ProfileUpsertSchema = z
  .object({
    fullName: z.string().trim().max(200).optional(),
    email: nullableTrimmedString(320),
    phone: nullableTrimmedString(64),
    location: nullableTrimmedString(200),
    headline: nullableTrimmedString(300),
    summary: nullableTrimmedString(4000),
    websiteUrl: nullableSafeHttpUrl(512),
    linkedinUrl: nullableSafeHttpUrl(512),
    githubUrl: nullableSafeHttpUrl(512),
    noticePeriod: nullableTrimmedString(120),
    workAuthorizationSummary: nullableTrimmedString(300),
    additionalDetails: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(),
    additionalDetailsJson: nullableTrimmedString(16000),
    verificationStatus: VerificationStatusSchema.optional(),
    origin: FactOriginSchema.optional(),
  })
  .strict();
export type ProfileUpsertInput = z.input<typeof ProfileUpsertSchema>;

export const ExperienceCreateSchema = z
  .object({
    employer: z.string().trim().min(1, "Employer is required.").max(200),
    title: z.string().trim().min(1, "Title is required.").max(200),
    location: nullableTrimmedString(200),
    startDate: nullableTrimmedString(64),
    endDate: nullableTrimmedString(64),
    isCurrent: z.boolean().optional(),
    employmentType: nullableTrimmedString(80),
    description: nullableTrimmedString(10000),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    skillIds: z.array(z.string().trim().min(1)).max(200).optional(),
    verificationStatus: VerificationStatusSchema.optional(),
    origin: FactOriginSchema.optional(),
  })
  .strict();
export type ExperienceCreateInput = z.input<typeof ExperienceCreateSchema>;

export const ExperienceUpdateSchema = ExperienceCreateSchema.partial().strict();
export type ExperienceUpdateInput = z.input<typeof ExperienceUpdateSchema>;

export const ProjectCreateSchema = z
  .object({
    experienceId: nullableTrimmedString(128),
    name: z.string().trim().min(1, "Project name is required.").max(200),
    problem: nullableTrimmedString(4000),
    description: nullableTrimmedString(8000),
    roleContribution: nullableTrimmedString(4000),
    architecture: nullableTrimmedString(6000),
    challengesSolved: nullableTrimmedString(6000),
    outcomes: nullableTrimmedString(6000),
    metrics: z
      .union([
        z.record(z.string(), z.unknown()),
        z.array(z.unknown()),
        z.null(),
      ])
      .optional(),
    metricsJson: nullableTrimmedString(16000),
    startDate: nullableTrimmedString(64),
    endDate: nullableTrimmedString(64),
    url: nullableSafeHttpUrl(512),
    targetRoles: z.union([z.array(z.string().trim().min(1).max(120)), z.null()]).optional(),
    targetRolesJson: nullableTrimmedString(4000),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    skillIds: z.array(z.string().trim().min(1)).max(200).optional(),
    verificationStatus: VerificationStatusSchema.optional(),
    origin: FactOriginSchema.optional(),
  })
  .strict();
export type ProjectCreateInput = z.input<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = ProjectCreateSchema.partial().strict();
export type ProjectUpdateInput = z.input<typeof ProjectUpdateSchema>;

export const AchievementCreateSchema = z
  .object({
    experienceId: nullableTrimmedString(128),
    projectId: nullableTrimmedString(128),
    text: z.string().trim().min(1, "Achievement text is required.").max(2000),
    metricValue: z.union([z.number().finite(), z.null()]).optional(),
    metricUnit: nullableTrimmedString(64),
    metricContext: nullableTrimmedString(300),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    skillIds: z.array(z.string().trim().min(1)).max(200).optional(),
    verificationStatus: VerificationStatusSchema.optional(),
    origin: FactOriginSchema.optional(),
  })
  .strict();
export type AchievementCreateInput = z.input<typeof AchievementCreateSchema>;

export const AchievementUpdateSchema = AchievementCreateSchema.partial().strict();
export type AchievementUpdateInput = z.input<typeof AchievementUpdateSchema>;

export const SkillCreateSchema = z
  .object({
    canonicalName: z.string().trim().min(1, "Skill name is required.").max(120),
    aliases: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    aliasesJson: z.string().max(4000).optional(),
    category: nullableTrimmedString(120),
    proficiency: nullableTrimmedString(80),
    verificationStatus: VerificationStatusSchema.optional(),
    origin: FactOriginSchema.optional(),
  })
  .strict();
export type SkillCreateInput = z.input<typeof SkillCreateSchema>;

export const SkillUpdateSchema = SkillCreateSchema.partial()
  .extend({
    mergeIntoSkillId: z.string().trim().min(1).optional(),
  })
  .strict();
export type SkillUpdateInput = z.input<typeof SkillUpdateSchema>;

export const SkillMergeSchema = z
  .object({
    sourceSkillId: z.string().trim().min(1),
    targetSkillId: z.string().trim().min(1),
  })
  .strict();
export type SkillMergeInput = z.input<typeof SkillMergeSchema>;

export const EducationCreateSchema = z
  .object({
    institution: z.string().trim().min(1, "Institution is required.").max(200),
    qualification: z.string().trim().min(1, "Qualification is required.").max(200),
    fieldOfStudy: nullableTrimmedString(200),
    startDate: nullableTrimmedString(64),
    endDate: nullableTrimmedString(64),
    details: nullableTrimmedString(4000),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    verificationStatus: VerificationStatusSchema.optional(),
    origin: FactOriginSchema.optional(),
  })
  .strict();
export type EducationCreateInput = z.input<typeof EducationCreateSchema>;

export const EducationUpdateSchema = EducationCreateSchema.partial().strict();
export type EducationUpdateInput = z.input<typeof EducationUpdateSchema>;

export const CertificationCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Certification name is required.").max(200),
    issuer: nullableTrimmedString(200),
    issueDate: nullableTrimmedString(64),
    expiryDate: nullableTrimmedString(64),
    credentialUrl: nullableSafeHttpUrl(512),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    verificationStatus: VerificationStatusSchema.optional(),
    origin: FactOriginSchema.optional(),
  })
  .strict();
export type CertificationCreateInput = z.input<typeof CertificationCreateSchema>;

export const CertificationUpdateSchema = CertificationCreateSchema.partial().strict();
export type CertificationUpdateInput = z.input<typeof CertificationUpdateSchema>;

export const LanguageCreateSchema = z
  .object({
    language: z.string().trim().min(1, "Language is required.").max(100),
    proficiency: nullableTrimmedString(80),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    verificationStatus: VerificationStatusSchema.optional(),
    origin: FactOriginSchema.optional(),
  })
  .strict();
export type LanguageCreateInput = z.input<typeof LanguageCreateSchema>;

export const LanguageUpdateSchema = LanguageCreateSchema.partial().strict();
export type LanguageUpdateInput = z.input<typeof LanguageUpdateSchema>;

export const EvidenceLinkCreateSchema = z
  .object({
    sourceDocumentId: nullableTrimmedString(128),
    excerpt: nullableTrimmedString(4000),
    targetType: EvidenceTargetTypeSchema,
    targetId: z.string().trim().min(1, "Target ID is required.").max(128),
    extractionConfidence: z.union([z.number().min(0).max(1), z.null()]).optional(),
    verificationStatus: VerificationStatusSchema.optional(),
    origin: FactOriginSchema.optional(),
  })
  .strict();
export type EvidenceLinkCreateInput = z.input<typeof EvidenceLinkCreateSchema>;

export const EvidenceLinkUpdateSchema = z
  .object({
    sourceDocumentId: nullableTrimmedString(128),
    excerpt: nullableTrimmedString(4000),
    targetType: EvidenceTargetTypeSchema.optional(),
    targetId: z.string().trim().min(1).max(128).optional(),
    extractionConfidence: z.union([z.number().min(0).max(1), z.null()]).optional(),
    verificationStatus: VerificationStatusSchema.optional(),
  })
  .strict();
export type EvidenceLinkUpdateInput = z.input<typeof EvidenceLinkUpdateSchema>;

export const VerificationPatchSchema = z
  .object({
    verificationStatus: VerificationStatusSchema,
  })
  .strict();

export interface EvidenceLinkRecord {
  id: string;
  sourceDocumentId: string | null;
  excerpt: string | null;
  targetType: EvidenceTargetType;
  targetId: string;
  extractionConfidence: number | null;
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface SkillRef {
  id: string;
  canonicalName: string;
  normalizedKey: string;
  category: string | null;
  proficiency: string | null;
  verificationStatus: VerificationStatus;
}

export interface SkillRecord extends SkillRef {
  aliasesJson: string;
  aliases: string[];
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  evidenceLinks: EvidenceLinkRecord[];
}

export interface ProfileRecord {
  id: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  noticePeriod: string | null;
  workAuthorizationSummary: string | null;
  additionalDetailsJson: string | null;
  additionalDetails: Record<string, unknown> | null;
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  evidenceLinks: EvidenceLinkRecord[];
}

export interface ExperienceRecord {
  id: string;
  employer: string;
  title: string;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  employmentType: string | null;
  description: string | null;
  sortOrder: number;
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  skillIds: string[];
  skills: SkillRef[];
  evidenceLinks: EvidenceLinkRecord[];
}

export interface ProjectRecord {
  id: string;
  experienceId: string | null;
  name: string;
  problem: string | null;
  description: string | null;
  roleContribution: string | null;
  architecture: string | null;
  challengesSolved: string | null;
  outcomes: string | null;
  metricsJson: string | null;
  metrics: Record<string, unknown> | unknown[] | null;
  startDate: string | null;
  endDate: string | null;
  url: string | null;
  targetRolesJson: string | null;
  targetRoles: string[];
  sortOrder: number;
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  skillIds: string[];
  skills: SkillRef[];
  evidenceLinks: EvidenceLinkRecord[];
}

export interface AchievementRecord {
  id: string;
  experienceId: string | null;
  projectId: string | null;
  text: string;
  metricValue: number | null;
  metricUnit: string | null;
  metricContext: string | null;
  sortOrder: number;
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  skillIds: string[];
  skills: SkillRef[];
  evidenceLinks: EvidenceLinkRecord[];
}

export interface EducationRecord {
  id: string;
  institution: string;
  qualification: string;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  details: string | null;
  sortOrder: number;
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  evidenceLinks: EvidenceLinkRecord[];
}

export interface CertificationRecord {
  id: string;
  name: string;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  credentialUrl: string | null;
  sortOrder: number;
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  evidenceLinks: EvidenceLinkRecord[];
}

export interface LanguageRecord {
  id: string;
  language: string;
  proficiency: string | null;
  sortOrder: number;
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  evidenceLinks: EvidenceLinkRecord[];
}

export interface SafeSourceDocument {
  id: string;
  displayFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  extractionStatus: ExtractionStatus;
  parserVersion: string | null;
  errorMessage: string | null;
  importedAt: string;
  hasExtractedText: boolean;
  extractedTextPreview: string | null;
}

export interface SafeSourceDocumentWithText extends SafeSourceDocument {
  extractedText: string | null;
}

export interface FullCareerProfile {
  profile: ProfileRecord | null;
  experiences: ExperienceRecord[];
  projects: ProjectRecord[];
  achievements: AchievementRecord[];
  skills: SkillRecord[];
  education: EducationRecord[];
  certifications: CertificationRecord[];
  languages: LanguageRecord[];
  sourceDocuments: SafeSourceDocument[];
  evidenceLinks: EvidenceLinkRecord[];
  needsReviewCount: number;
}

/**
 * Produces a deterministic normalized lookup key for candidate skills while
 * preserving meaningful technical symbols such as `+`, `#`, `.`, `/`, and `-`.
 */
export function normalizeSkillKey(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Maps singular or plural route entity segments into canonical profile entity types.
 */
export function normalizeProfileEntityType(
  rawEntity: string
): ProfileVerifiableEntity {
  const normalized = rawEntity.trim().toLowerCase();
  const mapping: Record<string, ProfileVerifiableEntity> = {
    profile: "profile",
    experience: "experience",
    experiences: "experience",
    project: "project",
    projects: "project",
    achievement: "achievement",
    achievements: "achievement",
    skill: "skill",
    skills: "skill",
    education: "education",
    certification: "certification",
    certifications: "certification",
    language: "language",
    languages: "language",
    evidence_link: "evidence_link",
    "evidence-link": "evidence_link",
    "evidence-links": "evidence_link",
    evidence_links: "evidence_link",
  };

  const match = mapping[normalized];
  if (!match) {
    throw new ProfileServiceError(
      "INVALID_ENTITY_TYPE",
      400,
      `Unsupported profile entity type: ${rawEntity}`
    );
  }
  return match;
}

function resolveCreateVerification(input: {
  origin?: FactOrigin;
  verificationStatus?: VerificationStatus;
}): {
  origin: FactOrigin;
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
} {
  const origin: FactOrigin = input.origin ?? "manual";
  const verificationStatus: VerificationStatus =
    input.verificationStatus ?? (origin === "manual" ? "verified" : "needs_review");
  const nowIso = new Date().toISOString();
  return {
    origin,
    verificationStatus,
    verifiedAt: verificationStatus === "verified" ? nowIso : null,
  };
}

function resolveUpdateVerification(
  currentStatus: VerificationStatus,
  currentVerifiedAt: string | null,
  nextStatus: VerificationStatus | undefined,
  nowIso: string
): {
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
} {
  if (!nextStatus) {
    return {
      verificationStatus: currentStatus,
      verifiedAt: currentVerifiedAt,
    };
  }
  if (nextStatus === "verified") {
    return {
      verificationStatus: "verified",
      verifiedAt: currentVerifiedAt ?? nowIso,
    };
  }
  return {
    verificationStatus: nextStatus,
    verifiedAt: null,
  };
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseJsonObjectOrArray(
  raw: string | null | undefined
): Record<string, unknown> | unknown[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown> | unknown[];
    }
    return null;
  } catch {
    return null;
  }
}

function parseJsonObject(
  raw: string | null | undefined
): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeJsonInput(
  structuredValue: unknown,
  jsonString: string | null | undefined
): string | null | undefined {
  if (structuredValue !== undefined) {
    return structuredValue === null ? null : JSON.stringify(structuredValue);
  }
  if (jsonString !== undefined) {
    if (jsonString === null) return null;
    try {
      JSON.parse(jsonString);
    } catch {
      throw new ProfileServiceError(
        "VALIDATION_ERROR",
        400,
        "Invalid JSON field payload."
      );
    }
    return jsonString;
  }
  return undefined;
}

function deduplicateAliases(
  aliases: string[],
  canonicalName: string
): string[] {
  const canonicalKey = normalizeSkillKey(canonicalName);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawAlias of aliases) {
    const trimmed = rawAlias.trim();
    if (!trimmed) continue;
    const key = normalizeSkillKey(trimmed);
    if (!key || key === canonicalKey || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function readExtractedTextPreview(extractedTextPath: string | null): {
  hasExtractedText: boolean;
  extractedTextPreview: string | null;
} {
  if (!extractedTextPath) {
    return { hasExtractedText: false, extractedTextPreview: null };
  }
  try {
    const safePath = assertPathWithin(resolveAppDataDir(), extractedTextPath);
    if (!fs.existsSync(safePath)) {
      return { hasExtractedText: false, extractedTextPreview: null };
    }
    const stat = fs.statSync(safePath);
    if (!stat.isFile() || stat.size === 0) {
      return { hasExtractedText: false, extractedTextPreview: null };
    }
    const fd = fs.openSync(safePath, "r");
    try {
      const bytesToRead = Math.min(stat.size, EXTRACTED_TEXT_PREVIEW_MAX_BYTES);
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, 0);
      const rawText = buffer.subarray(0, bytesRead).toString("utf8");
      const preview =
        rawText.length > EXTRACTED_TEXT_PREVIEW_MAX_CHARS
          ? rawText.slice(0, EXTRACTED_TEXT_PREVIEW_MAX_CHARS)
          : rawText;
      return {
        hasExtractedText: rawText.length > 0,
        extractedTextPreview: preview.length > 0 ? preview : null,
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { hasExtractedText: false, extractedTextPreview: null };
  }
}

function readFullExtractedText(extractedTextPath: string | null): string | null {
  if (!extractedTextPath) return null;
  try {
    const safePath = assertPathWithin(resolveAppDataDir(), extractedTextPath);
    if (!fs.existsSync(safePath)) return null;
    const stat = fs.statSync(safePath);
    if (!stat.isFile()) return null;
    return fs.readFileSync(safePath, "utf8");
  } catch {
    return null;
  }
}

function safeUnlinkWithinAppDataDir(filePath: string | null): void {
  if (!filePath) return;
  try {
    const safePath = assertPathWithin(resolveAppDataDir(), filePath);
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
    }
  } catch {
    // Do not unlink paths outside APP_DATA_DIR or fail after DB deletion.
  }
}

function mapSourceDocumentSafe(
  row: typeof sourceDocuments.$inferSelect
): SafeSourceDocument {
  const preview = readExtractedTextPreview(row.extractedTextPath);
  return {
    id: row.id,
    displayFilename: row.displayFilename,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    fileHash: row.fileHash,
    extractionStatus: row.extractionStatus,
    parserVersion: row.parserVersion,
    errorMessage: row.errorMessage ? redactPaths(row.errorMessage) : null,
    importedAt: row.importedAt,
    hasExtractedText: preview.hasExtractedText,
    extractedTextPreview: preview.extractedTextPreview,
  };
}

function buildEvidenceMap(
  rows: EvidenceLinkRecord[]
): Map<string, EvidenceLinkRecord[]> {
  const map = new Map<string, EvidenceLinkRecord[]>();
  for (const row of rows) {
    const key = `${row.targetType}:${row.targetId}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(row);
    } else {
      map.set(key, [row]);
    }
  }
  return map;
}

function getEvidenceFor(
  evidenceMap: Map<string, EvidenceLinkRecord[]>,
  targetType: EvidenceTargetType,
  targetId: string
): EvidenceLinkRecord[] {
  return evidenceMap.get(`${targetType}:${targetId}`) ?? [];
}

function loadEvidenceLinks(
  db: AppDatabase,
  options?: { includeRejected?: boolean }
): EvidenceLinkRecord[] {
  const includeRejected = options?.includeRejected ?? false;
  const rows = db
    .select()
    .from(evidenceLinks)
    .orderBy(asc(evidenceLinks.createdAt))
    .all();

  return rows.filter(
    (row) => includeRejected || row.verificationStatus !== "rejected"
  );
}

function assertValidSkillIds(db: AppDatabase, skillIds: string[]): string[] {
  const uniqueIds = Array.from(new Set(skillIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const existing = db
    .select({ id: skills.id })
    .from(skills)
    .where(inArray(skills.id, uniqueIds))
    .all();
  if (existing.length !== uniqueIds.length) {
    const foundSet = new Set(existing.map((r) => r.id));
    const missing = uniqueIds.filter((id) => !foundSet.has(id));
    throw new ProfileServiceError(
      "INVALID_REFERENCE",
      400,
      `Referenced skill ID(s) do not exist: ${missing.join(", ")}`
    );
  }
  return uniqueIds;
}

function assertExperienceExists(db: AppDatabase, experienceId: string): void {
  const row = db
    .select({ id: experiences.id })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .get();
  if (!row) {
    throw new ProfileServiceError(
      "INVALID_REFERENCE",
      400,
      `Referenced experience does not exist: ${experienceId}`
    );
  }
}

function assertProjectExists(db: AppDatabase, projectId: string): void {
  const row = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!row) {
    throw new ProfileServiceError(
      "INVALID_REFERENCE",
      400,
      `Referenced project does not exist: ${projectId}`
    );
  }
}

function assertSourceDocumentExists(db: AppDatabase, sourceDocumentId: string): void {
  const row = db
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.id, sourceDocumentId))
    .get();
  if (!row) {
    throw new ProfileServiceError(
      "INVALID_REFERENCE",
      400,
      `Referenced source document does not exist: ${sourceDocumentId}`
    );
  }
}

function assertEvidenceTargetExists(
  db: AppDatabase,
  targetType: EvidenceTargetType,
  targetId: string
): void {
  switch (targetType) {
    case "profile": {
      if (targetId !== "1") {
        throw new ProfileServiceError(
          "INVALID_REFERENCE",
          400,
          "Profile evidence targetId must be '1'."
        );
      }
      const row = db
        .select({ id: profile.id })
        .from(profile)
        .where(eq(profile.id, 1))
        .get();
      if (!row) {
        throw new ProfileServiceError(
          "INVALID_REFERENCE",
          400,
          "Profile singleton does not exist yet."
        );
      }
      return;
    }
    case "experience":
      assertExperienceExists(db, targetId);
      return;
    case "project":
      assertProjectExists(db, targetId);
      return;
    case "achievement": {
      const row = db
        .select({ id: achievements.id })
        .from(achievements)
        .where(eq(achievements.id, targetId))
        .get();
      if (!row) {
        throw new ProfileServiceError(
          "INVALID_REFERENCE",
          400,
          `Referenced achievement does not exist: ${targetId}`
        );
      }
      return;
    }
    case "skill": {
      const row = db
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.id, targetId))
        .get();
      if (!row) {
        throw new ProfileServiceError(
          "INVALID_REFERENCE",
          400,
          `Referenced skill does not exist: ${targetId}`
        );
      }
      return;
    }
    case "education": {
      const row = db
        .select({ id: education.id })
        .from(education)
        .where(eq(education.id, targetId))
        .get();
      if (!row) {
        throw new ProfileServiceError(
          "INVALID_REFERENCE",
          400,
          `Referenced education record does not exist: ${targetId}`
        );
      }
      return;
    }
    case "certification": {
      const row = db
        .select({ id: certifications.id })
        .from(certifications)
        .where(eq(certifications.id, targetId))
        .get();
      if (!row) {
        throw new ProfileServiceError(
          "INVALID_REFERENCE",
          400,
          `Referenced certification does not exist: ${targetId}`
        );
      }
      return;
    }
    case "language": {
      const row = db
        .select({ id: languages.id })
        .from(languages)
        .where(eq(languages.id, targetId))
        .get();
      if (!row) {
        throw new ProfileServiceError(
          "INVALID_REFERENCE",
          400,
          `Referenced language does not exist: ${targetId}`
        );
      }
      return;
    }
  }
}

function buildSkillRefMap(
  db: AppDatabase,
  includeRejected: boolean
): Map<string, SkillRef> {
  const rows = db.select().from(skills).orderBy(asc(skills.canonicalName)).all();
  const map = new Map<string, SkillRef>();
  for (const row of rows) {
    if (!includeRejected && row.verificationStatus === "rejected") continue;
    map.set(row.id, {
      id: row.id,
      canonicalName: row.canonicalName,
      normalizedKey: row.normalizedKey,
      category: row.category,
      proficiency: row.proficiency,
      verificationStatus: row.verificationStatus,
    });
  }
  return map;
}

function hydrateSkillLinksForRows(
  links: Array<{ parentId: string; skillId: string }>,
  skillMap: Map<string, SkillRef>
): Map<string, SkillRef[]> {
  const result = new Map<string, SkillRef[]>();
  for (const link of links) {
    const skill = skillMap.get(link.skillId);
    if (!skill) continue;
    const list = result.get(link.parentId);
    if (list) {
      list.push(skill);
    } else {
      result.set(link.parentId, [skill]);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Aggregated Career Profile Read
// ---------------------------------------------------------------------------

/**
 * Returns the full hydrated career profile including experiences, projects,
 * achievements, skills, education, certifications, languages, safe source
 * document metadata/previews, evidence links, and pending review count.
 */
export function getFullCareerProfile(
  db: AppDatabase = getDb(),
  options?: { includeRejected?: boolean }
): FullCareerProfile {
  const includeRejected = options?.includeRejected ?? false;

  const allEvidence = loadEvidenceLinks(db, { includeRejected });
  const evidenceMap = buildEvidenceMap(allEvidence);
  const skillRefMap = buildSkillRefMap(db, includeRejected);

  const profileRow = db.select().from(profile).where(eq(profile.id, 1)).get();
  const hydratedProfile: ProfileRecord | null =
    profileRow && (includeRejected || profileRow.verificationStatus !== "rejected")
      ? {
          ...profileRow,
          additionalDetails: parseJsonObject(profileRow.additionalDetailsJson),
          evidenceLinks: getEvidenceFor(evidenceMap, "profile", "1"),
        }
      : null;

  const allExperiences = db
    .select()
    .from(experiences)
    .orderBy(asc(experiences.sortOrder), asc(experiences.createdAt))
    .all();
  const expSkillLinks = db.select().from(experienceSkills).all();
  const expSkillsMap = hydrateSkillLinksForRows(
    expSkillLinks.map((l) => ({ parentId: l.experienceId, skillId: l.skillId })),
    skillRefMap
  );

  const allProjects = db
    .select()
    .from(projects)
    .orderBy(asc(projects.sortOrder), asc(projects.createdAt))
    .all();
  const projSkillLinks = db.select().from(projectSkills).all();
  const projSkillsMap = hydrateSkillLinksForRows(
    projSkillLinks.map((l) => ({ parentId: l.projectId, skillId: l.skillId })),
    skillRefMap
  );

  const allAchievements = db
    .select()
    .from(achievements)
    .orderBy(asc(achievements.sortOrder), asc(achievements.createdAt))
    .all();
  const achSkillLinks = db.select().from(achievementSkills).all();
  const achSkillsMap = hydrateSkillLinksForRows(
    achSkillLinks.map((l) => ({ parentId: l.achievementId, skillId: l.skillId })),
    skillRefMap
  );

  const allSkills = db
    .select()
    .from(skills)
    .orderBy(asc(skills.canonicalName))
    .all();

  const allEducation = db
    .select()
    .from(education)
    .orderBy(asc(education.sortOrder), asc(education.createdAt))
    .all();

  const allCertifications = db
    .select()
    .from(certifications)
    .orderBy(asc(certifications.sortOrder), asc(certifications.createdAt))
    .all();

  const allLanguages = db
    .select()
    .from(languages)
    .orderBy(asc(languages.sortOrder), asc(languages.createdAt))
    .all();

  const docRows = db
    .select()
    .from(sourceDocuments)
    .orderBy(desc(sourceDocuments.importedAt), desc(sourceDocuments.createdAt))
    .all();

  const visibleExperiences: ExperienceRecord[] = allExperiences
    .filter((row) => includeRejected || row.verificationStatus !== "rejected")
    .map((row) => {
      const linkedSkills = expSkillsMap.get(row.id) ?? [];
      return {
        ...row,
        skillIds: linkedSkills.map((s) => s.id),
        skills: linkedSkills,
        evidenceLinks: getEvidenceFor(evidenceMap, "experience", row.id),
      };
    });

  const visibleProjects: ProjectRecord[] = allProjects
    .filter((row) => includeRejected || row.verificationStatus !== "rejected")
    .map((row) => {
      const linkedSkills = projSkillsMap.get(row.id) ?? [];
      return {
        ...row,
        metrics: parseJsonObjectOrArray(row.metricsJson),
        targetRoles: parseJsonStringArray(row.targetRolesJson),
        skillIds: linkedSkills.map((s) => s.id),
        skills: linkedSkills,
        evidenceLinks: getEvidenceFor(evidenceMap, "project", row.id),
      };
    });

  const visibleAchievements: AchievementRecord[] = allAchievements
    .filter((row) => includeRejected || row.verificationStatus !== "rejected")
    .map((row) => {
      const linkedSkills = achSkillsMap.get(row.id) ?? [];
      return {
        ...row,
        skillIds: linkedSkills.map((s) => s.id),
        skills: linkedSkills,
        evidenceLinks: getEvidenceFor(evidenceMap, "achievement", row.id),
      };
    });

  const visibleSkills: SkillRecord[] = allSkills
    .filter((row) => includeRejected || row.verificationStatus !== "rejected")
    .map((row) => ({
      ...row,
      aliases: parseJsonStringArray(row.aliasesJson),
      evidenceLinks: getEvidenceFor(evidenceMap, "skill", row.id),
    }));

  const visibleEducation: EducationRecord[] = allEducation
    .filter((row) => includeRejected || row.verificationStatus !== "rejected")
    .map((row) => ({
      ...row,
      evidenceLinks: getEvidenceFor(evidenceMap, "education", row.id),
    }));

  const visibleCertifications: CertificationRecord[] = allCertifications
    .filter((row) => includeRejected || row.verificationStatus !== "rejected")
    .map((row) => ({
      ...row,
      evidenceLinks: getEvidenceFor(evidenceMap, "certification", row.id),
    }));

  const visibleLanguages: LanguageRecord[] = allLanguages
    .filter((row) => includeRejected || row.verificationStatus !== "rejected")
    .map((row) => ({
      ...row,
      evidenceLinks: getEvidenceFor(evidenceMap, "language", row.id),
    }));

  const countNeedsReview = (items: Array<{ verificationStatus: VerificationStatus }>) =>
    items.reduce(
      (acc, item) => acc + (item.verificationStatus === "needs_review" ? 1 : 0),
      0
    );

  const needsReviewCount =
    (profileRow?.verificationStatus === "needs_review" ? 1 : 0) +
    countNeedsReview(allExperiences) +
    countNeedsReview(allProjects) +
    countNeedsReview(allAchievements) +
    countNeedsReview(allSkills) +
    countNeedsReview(allEducation) +
    countNeedsReview(allCertifications) +
    countNeedsReview(allLanguages);

  return {
    profile: hydratedProfile,
    experiences: visibleExperiences,
    projects: visibleProjects,
    achievements: visibleAchievements,
    skills: visibleSkills,
    education: visibleEducation,
    certifications: visibleCertifications,
    languages: visibleLanguages,
    sourceDocuments: docRows.map(mapSourceDocumentSafe),
    evidenceLinks: allEvidence,
    needsReviewCount,
  };
}

// ---------------------------------------------------------------------------
// Profile Singleton
// ---------------------------------------------------------------------------

export function getProfileSingleton(
  db: AppDatabase = getDb()
): ProfileRecord | null {
  const row = db.select().from(profile).where(eq(profile.id, 1)).get();
  if (!row) return null;
  const links = db
    .select()
    .from(evidenceLinks)
    .where(eq(evidenceLinks.targetType, "profile"))
    .orderBy(asc(evidenceLinks.createdAt))
    .all()
    .filter((link) => link.targetId === "1");

  return {
    ...row,
    additionalDetails: parseJsonObject(row.additionalDetailsJson),
    evidenceLinks: links,
  };
}

export function upsertProfile(
  input: ProfileUpsertInput,
  db: AppDatabase = getDb()
): ProfileRecord {
  const parsed = ProfileUpsertSchema.parse(input);
  const nowIso = new Date().toISOString();
  const additionalDetailsJson = normalizeJsonInput(
    parsed.additionalDetails,
    parsed.additionalDetailsJson
  );

  db.transaction((tx) => {
    const existing = tx.select().from(profile).where(eq(profile.id, 1)).get();
    if (!existing) {
      const verification = resolveCreateVerification({
        origin: parsed.origin,
        verificationStatus: parsed.verificationStatus,
      });
      tx.insert(profile)
        .values({
          id: 1,
          fullName: parsed.fullName ?? "",
          email: parsed.email ?? null,
          phone: parsed.phone ?? null,
          location: parsed.location ?? null,
          headline: parsed.headline ?? null,
          summary: parsed.summary ?? null,
          websiteUrl: parsed.websiteUrl ?? null,
          linkedinUrl: parsed.linkedinUrl ?? null,
          githubUrl: parsed.githubUrl ?? null,
          noticePeriod: parsed.noticePeriod ?? null,
          workAuthorizationSummary: parsed.workAuthorizationSummary ?? null,
          additionalDetailsJson: additionalDetailsJson ?? null,
          verificationStatus: verification.verificationStatus,
          origin: verification.origin,
          verifiedAt: verification.verifiedAt,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
      return;
    }

    const verification = resolveUpdateVerification(
      existing.verificationStatus,
      existing.verifiedAt,
      parsed.verificationStatus,
      nowIso
    );

    tx.update(profile)
      .set({
        fullName: parsed.fullName !== undefined ? parsed.fullName : existing.fullName,
        email: parsed.email !== undefined ? parsed.email : existing.email,
        phone: parsed.phone !== undefined ? parsed.phone : existing.phone,
        location: parsed.location !== undefined ? parsed.location : existing.location,
        headline: parsed.headline !== undefined ? parsed.headline : existing.headline,
        summary: parsed.summary !== undefined ? parsed.summary : existing.summary,
        websiteUrl:
          parsed.websiteUrl !== undefined ? parsed.websiteUrl : existing.websiteUrl,
        linkedinUrl:
          parsed.linkedinUrl !== undefined ? parsed.linkedinUrl : existing.linkedinUrl,
        githubUrl:
          parsed.githubUrl !== undefined ? parsed.githubUrl : existing.githubUrl,
        noticePeriod:
          parsed.noticePeriod !== undefined
            ? parsed.noticePeriod
            : existing.noticePeriod,
        workAuthorizationSummary:
          parsed.workAuthorizationSummary !== undefined
            ? parsed.workAuthorizationSummary
            : existing.workAuthorizationSummary,
        additionalDetailsJson:
          additionalDetailsJson !== undefined
            ? additionalDetailsJson
            : existing.additionalDetailsJson,
        verificationStatus: verification.verificationStatus,
        origin: parsed.origin ?? existing.origin,
        verifiedAt: verification.verifiedAt,
        updatedAt: nowIso,
      })
      .where(eq(profile.id, 1))
      .run();
  });

  const updated = getProfileSingleton(db);
  if (!updated) {
    throw new ProfileServiceError(
      "PROFILE_UPSERT_FAILED",
      500,
      "Failed to load career profile after save."
    );
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Experiences CRUD
// ---------------------------------------------------------------------------

export function listExperiences(
  db: AppDatabase = getDb(),
  options?: { includeRejected?: boolean }
): ExperienceRecord[] {
  return getFullCareerProfile(db, options).experiences;
}

export function getExperienceById(
  id: string,
  db: AppDatabase = getDb()
): ExperienceRecord | null {
  const row = db.select().from(experiences).where(eq(experiences.id, id)).get();
  if (!row) return null;

  const skillRefMap = buildSkillRefMap(db, true);
  const links = db
    .select()
    .from(experienceSkills)
    .where(eq(experienceSkills.experienceId, id))
    .all();
  const linkedSkills = links
    .map((l) => skillRefMap.get(l.skillId))
    .filter((s): s is SkillRef => Boolean(s));

  const evLinks = db
    .select()
    .from(evidenceLinks)
    .where(eq(evidenceLinks.targetType, "experience"))
    .orderBy(asc(evidenceLinks.createdAt))
    .all()
    .filter((l) => l.targetId === id);

  return {
    ...row,
    skillIds: linkedSkills.map((s) => s.id),
    skills: linkedSkills,
    evidenceLinks: evLinks,
  };
}

export function createExperience(
  input: ExperienceCreateInput,
  db: AppDatabase = getDb()
): ExperienceRecord {
  const parsed = ExperienceCreateSchema.parse(input);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const verification = resolveCreateVerification({
    origin: parsed.origin,
    verificationStatus: parsed.verificationStatus,
  });

  db.transaction((tx) => {
    const validSkillIds = parsed.skillIds
      ? assertValidSkillIds(tx, parsed.skillIds)
      : [];

    tx.insert(experiences)
      .values({
        id,
        employer: parsed.employer,
        title: parsed.title,
        location: parsed.location ?? null,
        startDate: parsed.startDate ?? null,
        endDate: parsed.endDate ?? null,
        isCurrent: parsed.isCurrent ?? false,
        employmentType: parsed.employmentType ?? null,
        description: parsed.description ?? null,
        sortOrder: parsed.sortOrder ?? 0,
        verificationStatus: verification.verificationStatus,
        origin: verification.origin,
        verifiedAt: verification.verifiedAt,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();

    for (const skillId of validSkillIds) {
      tx.insert(experienceSkills)
        .values({ experienceId: id, skillId })
        .onConflictDoNothing()
        .run();
    }
  });

  return getExperienceById(id, db)!;
}

export function updateExperience(
  id: string,
  input: ExperienceUpdateInput,
  db: AppDatabase = getDb()
): ExperienceRecord {
  const parsed = ExperienceUpdateSchema.parse(input);
  const nowIso = new Date().toISOString();

  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(experiences)
      .where(eq(experiences.id, id))
      .get();
    if (!existing) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Experience not found: ${id}`
      );
    }

    const verification = resolveUpdateVerification(
      existing.verificationStatus,
      existing.verifiedAt,
      parsed.verificationStatus,
      nowIso
    );

    tx.update(experiences)
      .set({
        employer: parsed.employer ?? existing.employer,
        title: parsed.title ?? existing.title,
        location: parsed.location !== undefined ? parsed.location : existing.location,
        startDate: parsed.startDate !== undefined ? parsed.startDate : existing.startDate,
        endDate: parsed.endDate !== undefined ? parsed.endDate : existing.endDate,
        isCurrent: parsed.isCurrent !== undefined ? parsed.isCurrent : existing.isCurrent,
        employmentType:
          parsed.employmentType !== undefined
            ? parsed.employmentType
            : existing.employmentType,
        description:
          parsed.description !== undefined ? parsed.description : existing.description,
        sortOrder: parsed.sortOrder !== undefined ? parsed.sortOrder : existing.sortOrder,
        verificationStatus: verification.verificationStatus,
        origin: parsed.origin ?? existing.origin,
        verifiedAt: verification.verifiedAt,
        updatedAt: nowIso,
      })
      .where(eq(experiences.id, id))
      .run();

    if (parsed.skillIds !== undefined) {
      const validSkillIds = assertValidSkillIds(tx, parsed.skillIds);
      tx.delete(experienceSkills)
        .where(eq(experienceSkills.experienceId, id))
        .run();
      for (const skillId of validSkillIds) {
        tx.insert(experienceSkills)
          .values({ experienceId: id, skillId })
          .onConflictDoNothing()
          .run();
      }
    }
  });

  return getExperienceById(id, db)!;
}

export function deleteExperience(id: string, db: AppDatabase = getDb()): boolean {
  const res = db.transaction((tx) => {
    tx.delete(evidenceLinks)
      .where(
        and(
          eq(evidenceLinks.targetType, "experience"),
          eq(evidenceLinks.targetId, id)
        )
      )
      .run();
    return tx.delete(experiences).where(eq(experiences.id, id)).run();
  });
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------

export function listProjects(
  db: AppDatabase = getDb(),
  options?: { includeRejected?: boolean }
): ProjectRecord[] {
  return getFullCareerProfile(db, options).projects;
}

export function getProjectById(
  id: string,
  db: AppDatabase = getDb()
): ProjectRecord | null {
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) return null;

  const skillRefMap = buildSkillRefMap(db, true);
  const links = db
    .select()
    .from(projectSkills)
    .where(eq(projectSkills.projectId, id))
    .all();
  const linkedSkills = links
    .map((l) => skillRefMap.get(l.skillId))
    .filter((s): s is SkillRef => Boolean(s));

  const evLinks = db
    .select()
    .from(evidenceLinks)
    .where(eq(evidenceLinks.targetType, "project"))
    .orderBy(asc(evidenceLinks.createdAt))
    .all()
    .filter((l) => l.targetId === id);

  return {
    ...row,
    metrics: parseJsonObjectOrArray(row.metricsJson),
    targetRoles: parseJsonStringArray(row.targetRolesJson),
    skillIds: linkedSkills.map((s) => s.id),
    skills: linkedSkills,
    evidenceLinks: evLinks,
  };
}

export function createProject(
  input: ProjectCreateInput,
  db: AppDatabase = getDb()
): ProjectRecord {
  const parsed = ProjectCreateSchema.parse(input);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const verification = resolveCreateVerification({
    origin: parsed.origin,
    verificationStatus: parsed.verificationStatus,
  });
  const metricsJson = normalizeJsonInput(parsed.metrics, parsed.metricsJson);
  const targetRolesJson = normalizeJsonInput(
    parsed.targetRoles,
    parsed.targetRolesJson
  );

  db.transaction((tx) => {
    if (parsed.experienceId) {
      assertExperienceExists(tx, parsed.experienceId);
    }
    const validSkillIds = parsed.skillIds
      ? assertValidSkillIds(tx, parsed.skillIds)
      : [];

    tx.insert(projects)
      .values({
        id,
        experienceId: parsed.experienceId ?? null,
        name: parsed.name,
        problem: parsed.problem ?? null,
        description: parsed.description ?? null,
        roleContribution: parsed.roleContribution ?? null,
        architecture: parsed.architecture ?? null,
        challengesSolved: parsed.challengesSolved ?? null,
        outcomes: parsed.outcomes ?? null,
        metricsJson: metricsJson ?? null,
        startDate: parsed.startDate ?? null,
        endDate: parsed.endDate ?? null,
        url: parsed.url ?? null,
        targetRolesJson: targetRolesJson ?? null,
        sortOrder: parsed.sortOrder ?? 0,
        verificationStatus: verification.verificationStatus,
        origin: verification.origin,
        verifiedAt: verification.verifiedAt,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();

    for (const skillId of validSkillIds) {
      tx.insert(projectSkills)
        .values({ projectId: id, skillId })
        .onConflictDoNothing()
        .run();
    }
  });

  return getProjectById(id, db)!;
}

export function updateProject(
  id: string,
  input: ProjectUpdateInput,
  db: AppDatabase = getDb()
): ProjectRecord {
  const parsed = ProjectUpdateSchema.parse(input);
  const nowIso = new Date().toISOString();
  const metricsJson = normalizeJsonInput(parsed.metrics, parsed.metricsJson);
  const targetRolesJson = normalizeJsonInput(
    parsed.targetRoles,
    parsed.targetRolesJson
  );

  db.transaction((tx) => {
    const existing = tx.select().from(projects).where(eq(projects.id, id)).get();
    if (!existing) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Project not found: ${id}`
      );
    }

    if (parsed.experienceId) {
      assertExperienceExists(tx, parsed.experienceId);
    }

    const verification = resolveUpdateVerification(
      existing.verificationStatus,
      existing.verifiedAt,
      parsed.verificationStatus,
      nowIso
    );

    tx.update(projects)
      .set({
        experienceId:
          parsed.experienceId !== undefined
            ? parsed.experienceId
            : existing.experienceId,
        name: parsed.name ?? existing.name,
        problem: parsed.problem !== undefined ? parsed.problem : existing.problem,
        description:
          parsed.description !== undefined ? parsed.description : existing.description,
        roleContribution:
          parsed.roleContribution !== undefined
            ? parsed.roleContribution
            : existing.roleContribution,
        architecture:
          parsed.architecture !== undefined ? parsed.architecture : existing.architecture,
        challengesSolved:
          parsed.challengesSolved !== undefined
            ? parsed.challengesSolved
            : existing.challengesSolved,
        outcomes: parsed.outcomes !== undefined ? parsed.outcomes : existing.outcomes,
        metricsJson: metricsJson !== undefined ? metricsJson : existing.metricsJson,
        startDate: parsed.startDate !== undefined ? parsed.startDate : existing.startDate,
        endDate: parsed.endDate !== undefined ? parsed.endDate : existing.endDate,
        url: parsed.url !== undefined ? parsed.url : existing.url,
        targetRolesJson:
          targetRolesJson !== undefined ? targetRolesJson : existing.targetRolesJson,
        sortOrder: parsed.sortOrder !== undefined ? parsed.sortOrder : existing.sortOrder,
        verificationStatus: verification.verificationStatus,
        origin: parsed.origin ?? existing.origin,
        verifiedAt: verification.verifiedAt,
        updatedAt: nowIso,
      })
      .where(eq(projects.id, id))
      .run();

    if (parsed.skillIds !== undefined) {
      const validSkillIds = assertValidSkillIds(tx, parsed.skillIds);
      tx.delete(projectSkills).where(eq(projectSkills.projectId, id)).run();
      for (const skillId of validSkillIds) {
        tx.insert(projectSkills)
          .values({ projectId: id, skillId })
          .onConflictDoNothing()
          .run();
      }
    }
  });

  return getProjectById(id, db)!;
}

export function deleteProject(id: string, db: AppDatabase = getDb()): boolean {
  const res = db.transaction((tx) => {
    tx.delete(evidenceLinks)
      .where(
        and(
          eq(evidenceLinks.targetType, "project"),
          eq(evidenceLinks.targetId, id)
        )
      )
      .run();
    return tx.delete(projects).where(eq(projects.id, id)).run();
  });
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Achievements CRUD
// ---------------------------------------------------------------------------

export function listAchievements(
  db: AppDatabase = getDb(),
  options?: { includeRejected?: boolean }
): AchievementRecord[] {
  return getFullCareerProfile(db, options).achievements;
}

export function getAchievementById(
  id: string,
  db: AppDatabase = getDb()
): AchievementRecord | null {
  const row = db.select().from(achievements).where(eq(achievements.id, id)).get();
  if (!row) return null;

  const skillRefMap = buildSkillRefMap(db, true);
  const links = db
    .select()
    .from(achievementSkills)
    .where(eq(achievementSkills.achievementId, id))
    .all();
  const linkedSkills = links
    .map((l) => skillRefMap.get(l.skillId))
    .filter((s): s is SkillRef => Boolean(s));

  const evLinks = db
    .select()
    .from(evidenceLinks)
    .where(eq(evidenceLinks.targetType, "achievement"))
    .orderBy(asc(evidenceLinks.createdAt))
    .all()
    .filter((l) => l.targetId === id);

  return {
    ...row,
    skillIds: linkedSkills.map((s) => s.id),
    skills: linkedSkills,
    evidenceLinks: evLinks,
  };
}

export function createAchievement(
  input: AchievementCreateInput,
  db: AppDatabase = getDb()
): AchievementRecord {
  const parsed = AchievementCreateSchema.parse(input);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const verification = resolveCreateVerification({
    origin: parsed.origin,
    verificationStatus: parsed.verificationStatus,
  });

  db.transaction((tx) => {
    if (parsed.experienceId) {
      assertExperienceExists(tx, parsed.experienceId);
    }
    if (parsed.projectId) {
      assertProjectExists(tx, parsed.projectId);
    }
    const validSkillIds = parsed.skillIds
      ? assertValidSkillIds(tx, parsed.skillIds)
      : [];

    tx.insert(achievements)
      .values({
        id,
        experienceId: parsed.experienceId ?? null,
        projectId: parsed.projectId ?? null,
        text: parsed.text,
        metricValue: parsed.metricValue ?? null,
        metricUnit: parsed.metricUnit ?? null,
        metricContext: parsed.metricContext ?? null,
        sortOrder: parsed.sortOrder ?? 0,
        verificationStatus: verification.verificationStatus,
        origin: verification.origin,
        verifiedAt: verification.verifiedAt,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();

    for (const skillId of validSkillIds) {
      tx.insert(achievementSkills)
        .values({ achievementId: id, skillId })
        .onConflictDoNothing()
        .run();
    }
  });

  return getAchievementById(id, db)!;
}

export function updateAchievement(
  id: string,
  input: AchievementUpdateInput,
  db: AppDatabase = getDb()
): AchievementRecord {
  const parsed = AchievementUpdateSchema.parse(input);
  const nowIso = new Date().toISOString();

  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(achievements)
      .where(eq(achievements.id, id))
      .get();
    if (!existing) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Achievement not found: ${id}`
      );
    }

    if (parsed.experienceId) {
      assertExperienceExists(tx, parsed.experienceId);
    }
    if (parsed.projectId) {
      assertProjectExists(tx, parsed.projectId);
    }

    const verification = resolveUpdateVerification(
      existing.verificationStatus,
      existing.verifiedAt,
      parsed.verificationStatus,
      nowIso
    );

    tx.update(achievements)
      .set({
        experienceId:
          parsed.experienceId !== undefined
            ? parsed.experienceId
            : existing.experienceId,
        projectId:
          parsed.projectId !== undefined ? parsed.projectId : existing.projectId,
        text: parsed.text ?? existing.text,
        metricValue:
          parsed.metricValue !== undefined ? parsed.metricValue : existing.metricValue,
        metricUnit:
          parsed.metricUnit !== undefined ? parsed.metricUnit : existing.metricUnit,
        metricContext:
          parsed.metricContext !== undefined
            ? parsed.metricContext
            : existing.metricContext,
        sortOrder: parsed.sortOrder !== undefined ? parsed.sortOrder : existing.sortOrder,
        verificationStatus: verification.verificationStatus,
        origin: parsed.origin ?? existing.origin,
        verifiedAt: verification.verifiedAt,
        updatedAt: nowIso,
      })
      .where(eq(achievements.id, id))
      .run();

    if (parsed.skillIds !== undefined) {
      const validSkillIds = assertValidSkillIds(tx, parsed.skillIds);
      tx.delete(achievementSkills)
        .where(eq(achievementSkills.achievementId, id))
        .run();
      for (const skillId of validSkillIds) {
        tx.insert(achievementSkills)
          .values({ achievementId: id, skillId })
          .onConflictDoNothing()
          .run();
      }
    }
  });

  return getAchievementById(id, db)!;
}

export function deleteAchievement(id: string, db: AppDatabase = getDb()): boolean {
  const res = db.transaction((tx) => {
    tx.delete(evidenceLinks)
      .where(
        and(
          eq(evidenceLinks.targetType, "achievement"),
          eq(evidenceLinks.targetId, id)
        )
      )
      .run();
    return tx.delete(achievements).where(eq(achievements.id, id)).run();
  });
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Skills CRUD + Merge
// ---------------------------------------------------------------------------

export function listSkills(
  db: AppDatabase = getDb(),
  options?: { includeRejected?: boolean }
): SkillRecord[] {
  return getFullCareerProfile(db, options).skills;
}

export function getSkillById(
  id: string,
  db: AppDatabase = getDb()
): SkillRecord | null {
  const row = db.select().from(skills).where(eq(skills.id, id)).get();
  if (!row) return null;

  const evLinks = db
    .select()
    .from(evidenceLinks)
    .where(eq(evidenceLinks.targetType, "skill"))
    .orderBy(asc(evidenceLinks.createdAt))
    .all()
    .filter((l) => l.targetId === id);

  return {
    ...row,
    aliases: parseJsonStringArray(row.aliasesJson),
    evidenceLinks: evLinks,
  };
}

export function createSkill(
  input: SkillCreateInput,
  db: AppDatabase = getDb()
): SkillRecord {
  const parsed = SkillCreateSchema.parse(input);
  const normalizedKey = normalizeSkillKey(parsed.canonicalName);
  if (!normalizedKey) {
    throw new ProfileServiceError(
      "VALIDATION_ERROR",
      400,
      "Skill name cannot be blank."
    );
  }

  const rawAliases =
    parsed.aliases ??
    (parsed.aliasesJson ? parseJsonStringArray(parsed.aliasesJson) : []);
  const aliases = deduplicateAliases(rawAliases, parsed.canonicalName);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const verification = resolveCreateVerification({
    origin: parsed.origin,
    verificationStatus: parsed.verificationStatus,
  });

  db.transaction((tx) => {
    const conflict = tx
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.normalizedKey, normalizedKey))
      .get();
    if (conflict) {
      throw new ProfileServiceError(
        "SKILL_CONFLICT",
        409,
        `A skill with normalized key "${normalizedKey}" already exists.`
      );
    }

    tx.insert(skills)
      .values({
        id,
        canonicalName: parsed.canonicalName,
        normalizedKey,
        aliasesJson: JSON.stringify(aliases),
        category: parsed.category ?? null,
        proficiency: parsed.proficiency ?? null,
        verificationStatus: verification.verificationStatus,
        origin: verification.origin,
        verifiedAt: verification.verifiedAt,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();
  });

  return getSkillById(id, db)!;
}

export function updateSkill(
  id: string,
  input: SkillUpdateInput,
  db: AppDatabase = getDb()
): SkillRecord {
  const parsed = SkillUpdateSchema.parse(input);
  if (parsed.mergeIntoSkillId) {
    return mergeSkills(id, parsed.mergeIntoSkillId, db);
  }

  const nowIso = new Date().toISOString();

  db.transaction((tx) => {
    const existing = tx.select().from(skills).where(eq(skills.id, id)).get();
    if (!existing) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Skill not found: ${id}`
      );
    }

    const nextCanonicalName = parsed.canonicalName ?? existing.canonicalName;
    const nextNormalizedKey = normalizeSkillKey(nextCanonicalName);
    if (!nextNormalizedKey) {
      throw new ProfileServiceError(
        "VALIDATION_ERROR",
        400,
        "Skill name cannot be blank."
      );
    }

    if (nextNormalizedKey !== existing.normalizedKey) {
      const conflict = tx
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.normalizedKey, nextNormalizedKey))
        .get();
      if (conflict && conflict.id !== id) {
        throw new ProfileServiceError(
          "SKILL_CONFLICT",
          409,
          `A skill with normalized key "${nextNormalizedKey}" already exists.`
        );
      }
    }

    const nextAliasesRaw =
      parsed.aliases !== undefined
        ? parsed.aliases
        : parsed.aliasesJson !== undefined
          ? parseJsonStringArray(parsed.aliasesJson)
          : parseJsonStringArray(existing.aliasesJson);
    const aliases = deduplicateAliases(nextAliasesRaw, nextCanonicalName);

    const verification = resolveUpdateVerification(
      existing.verificationStatus,
      existing.verifiedAt,
      parsed.verificationStatus,
      nowIso
    );

    tx.update(skills)
      .set({
        canonicalName: nextCanonicalName,
        normalizedKey: nextNormalizedKey,
        aliasesJson: JSON.stringify(aliases),
        category: parsed.category !== undefined ? parsed.category : existing.category,
        proficiency:
          parsed.proficiency !== undefined ? parsed.proficiency : existing.proficiency,
        verificationStatus: verification.verificationStatus,
        origin: parsed.origin ?? existing.origin,
        verifiedAt: verification.verifiedAt,
        updatedAt: nowIso,
      })
      .where(eq(skills.id, id))
      .run();
  });

  return getSkillById(id, db)!;
}

/**
 * Transactionally merges `sourceSkillId` into `targetSkillId`, transferring
 * aliases, experience/project/achievement skill links, and evidence links,
 * then deleting the source skill row.
 */
export function mergeSkills(
  sourceSkillId: string,
  targetSkillId: string,
  db: AppDatabase = getDb()
): SkillRecord {
  if (sourceSkillId === targetSkillId) {
    throw new ProfileServiceError(
      "SKILL_MERGE_INVALID",
      400,
      "Cannot merge a skill into itself."
    );
  }

  const nowIso = new Date().toISOString();

  db.transaction((tx) => {
    const source = tx
      .select()
      .from(skills)
      .where(eq(skills.id, sourceSkillId))
      .get();
    if (!source) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Source skill not found: ${sourceSkillId}`
      );
    }

    const target = tx
      .select()
      .from(skills)
      .where(eq(skills.id, targetSkillId))
      .get();
    if (!target) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Target skill not found: ${targetSkillId}`
      );
    }

    const mergedAliases = deduplicateAliases(
      [
        ...parseJsonStringArray(target.aliasesJson),
        source.canonicalName,
        ...parseJsonStringArray(source.aliasesJson),
      ],
      target.canonicalName
    );

    const expLinks = tx
      .select()
      .from(experienceSkills)
      .where(eq(experienceSkills.skillId, sourceSkillId))
      .all();
    for (const link of expLinks) {
      tx.insert(experienceSkills)
        .values({ experienceId: link.experienceId, skillId: targetSkillId })
        .onConflictDoNothing()
        .run();
    }

    const projLinks = tx
      .select()
      .from(projectSkills)
      .where(eq(projectSkills.skillId, sourceSkillId))
      .all();
    for (const link of projLinks) {
      tx.insert(projectSkills)
        .values({ projectId: link.projectId, skillId: targetSkillId })
        .onConflictDoNothing()
        .run();
    }

    const achLinks = tx
      .select()
      .from(achievementSkills)
      .where(eq(achievementSkills.skillId, sourceSkillId))
      .all();
    for (const link of achLinks) {
      tx.insert(achievementSkills)
        .values({ achievementId: link.achievementId, skillId: targetSkillId })
        .onConflictDoNothing()
        .run();
    }

    const sourceEvidence = tx
      .select()
      .from(evidenceLinks)
      .where(eq(evidenceLinks.targetId, sourceSkillId))
      .all()
      .filter((ev) => ev.targetType === "skill");
    for (const ev of sourceEvidence) {
      tx.update(evidenceLinks)
        .set({ targetId: targetSkillId, updatedAt: nowIso })
        .where(eq(evidenceLinks.id, ev.id))
        .run();
    }

    tx.update(skills)
      .set({
        aliasesJson: JSON.stringify(mergedAliases),
        category: target.category ?? source.category,
        proficiency: target.proficiency ?? source.proficiency,
        updatedAt: nowIso,
      })
      .where(eq(skills.id, targetSkillId))
      .run();

    tx.delete(skills).where(eq(skills.id, sourceSkillId)).run();
  });

  return getSkillById(targetSkillId, db)!;
}

export function deleteSkill(id: string, db: AppDatabase = getDb()): boolean {
  const res = db.transaction((tx) => {
    tx.delete(evidenceLinks)
      .where(
        and(
          eq(evidenceLinks.targetType, "skill"),
          eq(evidenceLinks.targetId, id)
        )
      )
      .run();
    return tx.delete(skills).where(eq(skills.id, id)).run();
  });
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Education CRUD
// ---------------------------------------------------------------------------

export function listEducation(
  db: AppDatabase = getDb(),
  options?: { includeRejected?: boolean }
): EducationRecord[] {
  return getFullCareerProfile(db, options).education;
}

export function getEducationById(
  id: string,
  db: AppDatabase = getDb()
): EducationRecord | null {
  const row = db.select().from(education).where(eq(education.id, id)).get();
  if (!row) return null;

  const evLinks = db
    .select()
    .from(evidenceLinks)
    .where(eq(evidenceLinks.targetType, "education"))
    .orderBy(asc(evidenceLinks.createdAt))
    .all()
    .filter((l) => l.targetId === id);

  return {
    ...row,
    evidenceLinks: evLinks,
  };
}

export function createEducation(
  input: EducationCreateInput,
  db: AppDatabase = getDb()
): EducationRecord {
  const parsed = EducationCreateSchema.parse(input);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const verification = resolveCreateVerification({
    origin: parsed.origin,
    verificationStatus: parsed.verificationStatus,
  });

  db.insert(education)
    .values({
      id,
      institution: parsed.institution,
      qualification: parsed.qualification,
      fieldOfStudy: parsed.fieldOfStudy ?? null,
      startDate: parsed.startDate ?? null,
      endDate: parsed.endDate ?? null,
      details: parsed.details ?? null,
      sortOrder: parsed.sortOrder ?? 0,
      verificationStatus: verification.verificationStatus,
      origin: verification.origin,
      verifiedAt: verification.verifiedAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();

  return getEducationById(id, db)!;
}

export function updateEducation(
  id: string,
  input: EducationUpdateInput,
  db: AppDatabase = getDb()
): EducationRecord {
  const parsed = EducationUpdateSchema.parse(input);
  const nowIso = new Date().toISOString();

  db.transaction((tx) => {
    const existing = tx.select().from(education).where(eq(education.id, id)).get();
    if (!existing) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Education record not found: ${id}`
      );
    }

    const verification = resolveUpdateVerification(
      existing.verificationStatus,
      existing.verifiedAt,
      parsed.verificationStatus,
      nowIso
    );

    tx.update(education)
      .set({
        institution: parsed.institution ?? existing.institution,
        qualification: parsed.qualification ?? existing.qualification,
        fieldOfStudy:
          parsed.fieldOfStudy !== undefined ? parsed.fieldOfStudy : existing.fieldOfStudy,
        startDate: parsed.startDate !== undefined ? parsed.startDate : existing.startDate,
        endDate: parsed.endDate !== undefined ? parsed.endDate : existing.endDate,
        details: parsed.details !== undefined ? parsed.details : existing.details,
        sortOrder: parsed.sortOrder !== undefined ? parsed.sortOrder : existing.sortOrder,
        verificationStatus: verification.verificationStatus,
        origin: parsed.origin ?? existing.origin,
        verifiedAt: verification.verifiedAt,
        updatedAt: nowIso,
      })
      .where(eq(education.id, id))
      .run();
  });

  return getEducationById(id, db)!;
}

export function deleteEducation(id: string, db: AppDatabase = getDb()): boolean {
  const res = db.transaction((tx) => {
    tx.delete(evidenceLinks)
      .where(
        and(
          eq(evidenceLinks.targetType, "education"),
          eq(evidenceLinks.targetId, id)
        )
      )
      .run();
    return tx.delete(education).where(eq(education.id, id)).run();
  });
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Certifications CRUD
// ---------------------------------------------------------------------------

export function listCertifications(
  db: AppDatabase = getDb(),
  options?: { includeRejected?: boolean }
): CertificationRecord[] {
  return getFullCareerProfile(db, options).certifications;
}

export function getCertificationById(
  id: string,
  db: AppDatabase = getDb()
): CertificationRecord | null {
  const row = db
    .select()
    .from(certifications)
    .where(eq(certifications.id, id))
    .get();
  if (!row) return null;

  const evLinks = db
    .select()
    .from(evidenceLinks)
    .where(eq(evidenceLinks.targetType, "certification"))
    .orderBy(asc(evidenceLinks.createdAt))
    .all()
    .filter((l) => l.targetId === id);

  return {
    ...row,
    evidenceLinks: evLinks,
  };
}

export function createCertification(
  input: CertificationCreateInput,
  db: AppDatabase = getDb()
): CertificationRecord {
  const parsed = CertificationCreateSchema.parse(input);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const verification = resolveCreateVerification({
    origin: parsed.origin,
    verificationStatus: parsed.verificationStatus,
  });

  db.insert(certifications)
    .values({
      id,
      name: parsed.name,
      issuer: parsed.issuer ?? null,
      issueDate: parsed.issueDate ?? null,
      expiryDate: parsed.expiryDate ?? null,
      credentialUrl: parsed.credentialUrl ?? null,
      sortOrder: parsed.sortOrder ?? 0,
      verificationStatus: verification.verificationStatus,
      origin: verification.origin,
      verifiedAt: verification.verifiedAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();

  return getCertificationById(id, db)!;
}

export function updateCertification(
  id: string,
  input: CertificationUpdateInput,
  db: AppDatabase = getDb()
): CertificationRecord {
  const parsed = CertificationUpdateSchema.parse(input);
  const nowIso = new Date().toISOString();

  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(certifications)
      .where(eq(certifications.id, id))
      .get();
    if (!existing) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Certification not found: ${id}`
      );
    }

    const verification = resolveUpdateVerification(
      existing.verificationStatus,
      existing.verifiedAt,
      parsed.verificationStatus,
      nowIso
    );

    tx.update(certifications)
      .set({
        name: parsed.name ?? existing.name,
        issuer: parsed.issuer !== undefined ? parsed.issuer : existing.issuer,
        issueDate: parsed.issueDate !== undefined ? parsed.issueDate : existing.issueDate,
        expiryDate:
          parsed.expiryDate !== undefined ? parsed.expiryDate : existing.expiryDate,
        credentialUrl:
          parsed.credentialUrl !== undefined
            ? parsed.credentialUrl
            : existing.credentialUrl,
        sortOrder: parsed.sortOrder !== undefined ? parsed.sortOrder : existing.sortOrder,
        verificationStatus: verification.verificationStatus,
        origin: parsed.origin ?? existing.origin,
        verifiedAt: verification.verifiedAt,
        updatedAt: nowIso,
      })
      .where(eq(certifications.id, id))
      .run();
  });

  return getCertificationById(id, db)!;
}

export function deleteCertification(id: string, db: AppDatabase = getDb()): boolean {
  const res = db.transaction((tx) => {
    tx.delete(evidenceLinks)
      .where(
        and(
          eq(evidenceLinks.targetType, "certification"),
          eq(evidenceLinks.targetId, id)
        )
      )
      .run();
    return tx.delete(certifications).where(eq(certifications.id, id)).run();
  });
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Languages CRUD
// ---------------------------------------------------------------------------

export function listLanguages(
  db: AppDatabase = getDb(),
  options?: { includeRejected?: boolean }
): LanguageRecord[] {
  return getFullCareerProfile(db, options).languages;
}

export function getLanguageById(
  id: string,
  db: AppDatabase = getDb()
): LanguageRecord | null {
  const row = db.select().from(languages).where(eq(languages.id, id)).get();
  if (!row) return null;

  const evLinks = db
    .select()
    .from(evidenceLinks)
    .where(eq(evidenceLinks.targetType, "language"))
    .orderBy(asc(evidenceLinks.createdAt))
    .all()
    .filter((l) => l.targetId === id);

  return {
    ...row,
    evidenceLinks: evLinks,
  };
}

export function createLanguage(
  input: LanguageCreateInput,
  db: AppDatabase = getDb()
): LanguageRecord {
  const parsed = LanguageCreateSchema.parse(input);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const verification = resolveCreateVerification({
    origin: parsed.origin,
    verificationStatus: parsed.verificationStatus,
  });

  db.insert(languages)
    .values({
      id,
      language: parsed.language,
      proficiency: parsed.proficiency ?? null,
      sortOrder: parsed.sortOrder ?? 0,
      verificationStatus: verification.verificationStatus,
      origin: verification.origin,
      verifiedAt: verification.verifiedAt,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();

  return getLanguageById(id, db)!;
}

export function updateLanguage(
  id: string,
  input: LanguageUpdateInput,
  db: AppDatabase = getDb()
): LanguageRecord {
  const parsed = LanguageUpdateSchema.parse(input);
  const nowIso = new Date().toISOString();

  db.transaction((tx) => {
    const existing = tx.select().from(languages).where(eq(languages.id, id)).get();
    if (!existing) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Language not found: ${id}`
      );
    }

    const verification = resolveUpdateVerification(
      existing.verificationStatus,
      existing.verifiedAt,
      parsed.verificationStatus,
      nowIso
    );

    tx.update(languages)
      .set({
        language: parsed.language ?? existing.language,
        proficiency:
          parsed.proficiency !== undefined ? parsed.proficiency : existing.proficiency,
        sortOrder: parsed.sortOrder !== undefined ? parsed.sortOrder : existing.sortOrder,
        verificationStatus: verification.verificationStatus,
        origin: parsed.origin ?? existing.origin,
        verifiedAt: verification.verifiedAt,
        updatedAt: nowIso,
      })
      .where(eq(languages.id, id))
      .run();
  });

  return getLanguageById(id, db)!;
}

export function deleteLanguage(id: string, db: AppDatabase = getDb()): boolean {
  const res = db.transaction((tx) => {
    tx.delete(evidenceLinks)
      .where(
        and(
          eq(evidenceLinks.targetType, "language"),
          eq(evidenceLinks.targetId, id)
        )
      )
      .run();
    return tx.delete(languages).where(eq(languages.id, id)).run();
  });
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Source Documents (Safe DTOs + Deletion)
// ---------------------------------------------------------------------------

export function listSourceDocuments(
  db: AppDatabase = getDb()
): SafeSourceDocument[] {
  const rows = db
    .select()
    .from(sourceDocuments)
    .orderBy(desc(sourceDocuments.importedAt), desc(sourceDocuments.createdAt))
    .all();
  return rows.map(mapSourceDocumentSafe);
}

/**
 * Reads a source document's safe metadata along with extracted text from
 * `extractedTextPath` (verified to stay inside APP_DATA_DIR).
 */
export function getSourceDocumentWithText(
  id: string,
  db: AppDatabase = getDb()
): SafeSourceDocumentWithText | null {
  const row = db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.id, id))
    .get();
  if (!row) return null;

  const extractedText = readFullExtractedText(row.extractedTextPath);
  const preview =
    extractedText !== null
      ? extractedText.slice(0, EXTRACTED_TEXT_PREVIEW_MAX_CHARS) || null
      : null;

  return {
    id: row.id,
    displayFilename: row.displayFilename,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    fileHash: row.fileHash,
    extractionStatus: row.extractionStatus,
    parserVersion: row.parserVersion,
    errorMessage: row.errorMessage ? redactPaths(row.errorMessage) : null,
    importedAt: row.importedAt,
    hasExtractedText: Boolean(extractedText && extractedText.length > 0),
    extractedTextPreview: preview,
    extractedText,
  };
}

/**
 * Deletes a source document DB record and safely unlinks its original and
 * extracted files if they reside within APP_DATA_DIR.
 */
export function deleteSourceDocument(
  id: string,
  db: AppDatabase = getDb()
): boolean {
  const existing = db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.id, id))
    .get();
  if (!existing) return false;

  const res = db.delete(sourceDocuments).where(eq(sourceDocuments.id, id)).run();
  if (res.changes === 0) return false;

  safeUnlinkWithinAppDataDir(existing.originalFilePath);
  safeUnlinkWithinAppDataDir(existing.extractedTextPath);
  return true;
}

// ---------------------------------------------------------------------------
// Evidence Links CRUD
// ---------------------------------------------------------------------------

export function listEvidenceLinks(
  db: AppDatabase = getDb(),
  filters?: {
    targetType?: EvidenceTargetType;
    targetId?: string;
    sourceDocumentId?: string;
    includeRejected?: boolean;
  }
): EvidenceLinkRecord[] {
  const rows = loadEvidenceLinks(db, {
    includeRejected: filters?.includeRejected ?? false,
  });
  return rows.filter((row) => {
    if (filters?.targetType && row.targetType !== filters.targetType) return false;
    if (filters?.targetId && row.targetId !== filters.targetId) return false;
    if (
      filters?.sourceDocumentId &&
      row.sourceDocumentId !== filters.sourceDocumentId
    ) {
      return false;
    }
    return true;
  });
}

export function getEvidenceLinkById(
  id: string,
  db: AppDatabase = getDb()
): EvidenceLinkRecord | null {
  return db.select().from(evidenceLinks).where(eq(evidenceLinks.id, id)).get() ?? null;
}

export function createEvidenceLink(
  input: EvidenceLinkCreateInput,
  db: AppDatabase = getDb()
): EvidenceLinkRecord {
  const parsed = EvidenceLinkCreateSchema.parse(input);
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const verification = resolveCreateVerification({
    origin: parsed.origin,
    verificationStatus: parsed.verificationStatus,
  });

  db.transaction((tx) => {
    if (parsed.sourceDocumentId) {
      assertSourceDocumentExists(tx, parsed.sourceDocumentId);
    }
    assertEvidenceTargetExists(tx, parsed.targetType, parsed.targetId);

    tx.insert(evidenceLinks)
      .values({
        id,
        sourceDocumentId: parsed.sourceDocumentId ?? null,
        excerpt: parsed.excerpt ?? null,
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        extractionConfidence: parsed.extractionConfidence ?? null,
        verificationStatus: verification.verificationStatus,
        origin: verification.origin,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();
  });

  return getEvidenceLinkById(id, db)!;
}

export function updateEvidenceLink(
  id: string,
  input: EvidenceLinkUpdateInput,
  db: AppDatabase = getDb()
): EvidenceLinkRecord {
  const parsed = EvidenceLinkUpdateSchema.parse(input);
  const nowIso = new Date().toISOString();

  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(evidenceLinks)
      .where(eq(evidenceLinks.id, id))
      .get();
    if (!existing) {
      throw new ProfileServiceError(
        "PROFILE_ENTITY_NOT_FOUND",
        404,
        `Evidence link not found: ${id}`
      );
    }

    if (parsed.sourceDocumentId) {
      assertSourceDocumentExists(tx, parsed.sourceDocumentId);
    }
    const nextTargetType = parsed.targetType ?? existing.targetType;
    const nextTargetId = parsed.targetId ?? existing.targetId;
    if (parsed.targetType !== undefined || parsed.targetId !== undefined) {
      assertEvidenceTargetExists(tx, nextTargetType, nextTargetId);
    }

    tx.update(evidenceLinks)
      .set({
        sourceDocumentId:
          parsed.sourceDocumentId !== undefined
            ? parsed.sourceDocumentId
            : existing.sourceDocumentId,
        excerpt: parsed.excerpt !== undefined ? parsed.excerpt : existing.excerpt,
        targetType: nextTargetType,
        targetId: nextTargetId,
        extractionConfidence:
          parsed.extractionConfidence !== undefined
            ? parsed.extractionConfidence
            : existing.extractionConfidence,
        verificationStatus:
          parsed.verificationStatus ?? existing.verificationStatus,
        updatedAt: nowIso,
      })
      .where(eq(evidenceLinks.id, id))
      .run();
  });

  return getEvidenceLinkById(id, db)!;
}

export function deleteEvidenceLink(id: string, db: AppDatabase = getDb()): boolean {
  const res = db.delete(evidenceLinks).where(eq(evidenceLinks.id, id)).run();
  return res.changes > 0;
}

// ---------------------------------------------------------------------------
// Verification Transitions
// ---------------------------------------------------------------------------

export interface VerificationUpdateResult {
  entityType: ProfileVerifiableEntity;
  id: string;
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  updatedAt: string;
}

/**
 * Updates `verificationStatus` (and `verifiedAt` when applicable) for any
 * career profile entity type.
 */
export function updateEntityVerification(
  entityTypeInput: string,
  id: string,
  statusInput: VerificationStatus,
  db: AppDatabase = getDb()
): VerificationUpdateResult {
  const entityType = normalizeProfileEntityType(entityTypeInput);
  const status = VerificationStatusSchema.parse(statusInput);
  const nowIso = new Date().toISOString();
  const nextVerifiedAt = status === "verified" ? nowIso : null;

  db.transaction((tx) => {
    switch (entityType) {
      case "profile": {
        if (id !== "1") {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            `Profile record not found: ${id}`
          );
        }
        const res = tx
          .update(profile)
          .set({
            verificationStatus: status,
            verifiedAt: nextVerifiedAt,
            updatedAt: nowIso,
          })
          .where(eq(profile.id, 1))
          .run();
        if (res.changes === 0) {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            "Profile singleton not found."
          );
        }
        return;
      }
      case "experience": {
        const res = tx
          .update(experiences)
          .set({
            verificationStatus: status,
            verifiedAt: nextVerifiedAt,
            updatedAt: nowIso,
          })
          .where(eq(experiences.id, id))
          .run();
        if (res.changes === 0) {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            `Experience not found: ${id}`
          );
        }
        return;
      }
      case "project": {
        const res = tx
          .update(projects)
          .set({
            verificationStatus: status,
            verifiedAt: nextVerifiedAt,
            updatedAt: nowIso,
          })
          .where(eq(projects.id, id))
          .run();
        if (res.changes === 0) {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            `Project not found: ${id}`
          );
        }
        return;
      }
      case "achievement": {
        const res = tx
          .update(achievements)
          .set({
            verificationStatus: status,
            verifiedAt: nextVerifiedAt,
            updatedAt: nowIso,
          })
          .where(eq(achievements.id, id))
          .run();
        if (res.changes === 0) {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            `Achievement not found: ${id}`
          );
        }
        return;
      }
      case "skill": {
        const res = tx
          .update(skills)
          .set({
            verificationStatus: status,
            verifiedAt: nextVerifiedAt,
            updatedAt: nowIso,
          })
          .where(eq(skills.id, id))
          .run();
        if (res.changes === 0) {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            `Skill not found: ${id}`
          );
        }
        return;
      }
      case "education": {
        const res = tx
          .update(education)
          .set({
            verificationStatus: status,
            verifiedAt: nextVerifiedAt,
            updatedAt: nowIso,
          })
          .where(eq(education.id, id))
          .run();
        if (res.changes === 0) {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            `Education record not found: ${id}`
          );
        }
        return;
      }
      case "certification": {
        const res = tx
          .update(certifications)
          .set({
            verificationStatus: status,
            verifiedAt: nextVerifiedAt,
            updatedAt: nowIso,
          })
          .where(eq(certifications.id, id))
          .run();
        if (res.changes === 0) {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            `Certification not found: ${id}`
          );
        }
        return;
      }
      case "language": {
        const res = tx
          .update(languages)
          .set({
            verificationStatus: status,
            verifiedAt: nextVerifiedAt,
            updatedAt: nowIso,
          })
          .where(eq(languages.id, id))
          .run();
        if (res.changes === 0) {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            `Language not found: ${id}`
          );
        }
        return;
      }
      case "evidence_link": {
        const res = tx
          .update(evidenceLinks)
          .set({
            verificationStatus: status,
            updatedAt: nowIso,
          })
          .where(eq(evidenceLinks.id, id))
          .run();
        if (res.changes === 0) {
          throw new ProfileServiceError(
            "PROFILE_ENTITY_NOT_FOUND",
            404,
            `Evidence link not found: ${id}`
          );
        }
        return;
      }
    }
  });

  return {
    entityType,
    id,
    verificationStatus: status,
    verifiedAt: entityType === "evidence_link" ? null : nextVerifiedAt,
    updatedAt: nowIso,
  };
}

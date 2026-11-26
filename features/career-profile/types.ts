export const VERIFICATION_STATUSES = [
  "needs_review",
  "verified",
  "rejected",
  "archived",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const FACT_ORIGINS = [
  "manual",
  "resume_import",
  "document_import",
] as const;
export type FactOrigin = (typeof FACT_ORIGINS)[number];

export const EXTRACTION_STATUSES = [
  "pending",
  "extracted",
  "failed",
  "scanned_pdf",
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const EVIDENCE_TARGET_TYPES = [
  "profile",
  "experience",
  "project",
  "achievement",
  "skill",
  "education",
  "certification",
  "language",
] as const;
export type EvidenceTargetType = (typeof EVIDENCE_TARGET_TYPES)[number];

export type ProfileEntityRoute =
  | "experiences"
  | "projects"
  | "achievements"
  | "skills"
  | "education"
  | "certifications"
  | "languages";

export type VerificationFilter =
  | "all"
  | "needs_review"
  | "verified"
  | "archived_rejected";

export type ProfileTabKey =
  | "contact"
  | "experiences"
  | "projects"
  | "achievements"
  | "skills"
  | "credentials"
  | "documents";

export interface CareerProfileHeader {
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
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  skillIds: string[];
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMetricItem {
  label: string;
  value: string;
  unit?: string;
  context?: string;
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
  startDate: string | null;
  endDate: string | null;
  url: string | null;
  targetRolesJson: string | null;
  sortOrder: number;
  skillIds: string[];
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  skillIds: string[];
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillRecord {
  id: string;
  canonicalName: string;
  normalizedKey: string;
  aliasesJson: string;
  category: string | null;
  proficiency: string | null;
  verificationStatus: VerificationStatus;
  origin: FactOrigin;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
}

export interface SourceDocumentRecord {
  id: string;
  displayFilename: string;
  originalFilePath: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  extractedTextPath: string | null;
  extractionStatus: ExtractionStatus;
  parserVersion: string | null;
  errorMessage: string | null;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
}

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

export interface CareerProfilePayload {
  profile: CareerProfileHeader;
  experiences: ExperienceRecord[];
  projects: ProjectRecord[];
  achievements: AchievementRecord[];
  skills: SkillRecord[];
  education: EducationRecord[];
  certifications: CertificationRecord[];
  languages: LanguageRecord[];
  sourceDocuments: SourceDocumentRecord[];
  evidenceLinks: EvidenceLinkRecord[];
  needsReviewCount: number;
}

export interface ProfileSuggestionField {
  value: string;
  excerpt?: string | null;
  confidence?: number | null;
}

export interface ImportResumeResponse {
  sourceDocument: SourceDocumentRecord;
  extractedText: string;
  extractionStatus: ExtractionStatus;
  aiStatus: string | null;
  createdCounts: Record<string, number>;
  profileSuggestions: {
    headline?: ProfileSuggestionField | null;
    summary?: ProfileSuggestionField | null;
    location?: ProfileSuggestionField | null;
  } | null;
  aiError: string | null;
}

export interface SourceDocumentDetailResponse {
  sourceDocument: SourceDocumentRecord;
  extractedText: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asVerificationStatus(value: unknown): VerificationStatus {
  if (
    value === "needs_review" ||
    value === "verified" ||
    value === "rejected" ||
    value === "archived"
  ) {
    return value;
  }
  return "needs_review";
}

function asOrigin(value: unknown): FactOrigin {
  if (
    value === "manual" ||
    value === "resume_import" ||
    value === "document_import"
  ) {
    return value;
  }
  return "manual";
}

function asExtractionStatus(value: unknown): ExtractionStatus {
  if (
    value === "pending" ||
    value === "extracted" ||
    value === "failed" ||
    value === "scanned_pdf"
  ) {
    return value;
  }
  return "pending";
}

function asEvidenceTargetType(value: unknown): EvidenceTargetType {
  if (
    typeof value === "string" &&
    (EVIDENCE_TARGET_TYPES as readonly string[]).includes(value)
  ) {
    return value as EvidenceTargetType;
  }
  return "experience";
}

function extractSkillIds(
  row: Record<string, unknown>,
  joinRows?: Array<{ parentId: string; skillId: string }>,
  rowId?: string
): string[] {
  const fromIds = Array.isArray(row.skillIds)
    ? row.skillIds.filter((x): x is string => typeof x === "string")
    : [];
  const fromSkills = Array.isArray(row.skills)
    ? row.skills
        .map((s) => {
          if (typeof s === "string") return s;
          const sr = asRecord(s);
          return sr && typeof sr.id === "string" ? sr.id : null;
        })
        .filter((x): x is string => Boolean(x))
    : [];
  const fromJoin =
    joinRows && rowId
      ? joinRows.filter((j) => j.parentId === rowId).map((j) => j.skillId)
      : [];

  return Array.from(new Set([...fromIds, ...fromSkills, ...fromJoin]));
}

export function createEmptyProfileHeader(): CareerProfileHeader {
  const now = new Date().toISOString();
  return {
    id: 1,
    fullName: "",
    email: null,
    phone: null,
    location: null,
    headline: null,
    summary: null,
    websiteUrl: null,
    linkedinUrl: null,
    githubUrl: null,
    noticePeriod: null,
    workAuthorizationSummary: null,
    additionalDetailsJson: null,
    verificationStatus: "needs_review",
    origin: "manual",
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeSourceDocument(raw: unknown): SourceDocumentRecord {
  const r = asRecord(raw) ?? {};
  const now = new Date().toISOString();
  return {
    id: asString(r.id) ?? "",
    displayFilename: asString(r.displayFilename) ?? "Untitled document",
    originalFilePath: asString(r.originalFilePath) ?? "",
    mimeType: asString(r.mimeType) ?? "application/octet-stream",
    fileSizeBytes: asNumber(r.fileSizeBytes) ?? 0,
    fileHash: asString(r.fileHash) ?? "",
    extractedTextPath: asString(r.extractedTextPath),
    extractionStatus: asExtractionStatus(r.extractionStatus),
    parserVersion: asString(r.parserVersion),
    errorMessage: asString(r.errorMessage),
    importedAt: asString(r.importedAt) ?? now,
    createdAt: asString(r.createdAt) ?? now,
    updatedAt: asString(r.updatedAt) ?? now,
  };
}

export function normalizeCareerProfilePayload(raw: unknown): CareerProfilePayload {
  const root = asRecord(raw) ?? {};
  const data = asRecord(root.data) ?? root;
  const rawProfile = asRecord(data.profile) ?? {};
  const now = new Date().toISOString();

  const profile: CareerProfileHeader = {
    id: asNumber(rawProfile.id) ?? 1,
    fullName: asString(rawProfile.fullName) ?? "",
    email: asString(rawProfile.email),
    phone: asString(rawProfile.phone),
    location: asString(rawProfile.location),
    headline: asString(rawProfile.headline),
    summary: asString(rawProfile.summary),
    websiteUrl: asString(rawProfile.websiteUrl),
    linkedinUrl: asString(rawProfile.linkedinUrl),
    githubUrl: asString(rawProfile.githubUrl),
    noticePeriod: asString(rawProfile.noticePeriod),
    workAuthorizationSummary: asString(rawProfile.workAuthorizationSummary),
    additionalDetailsJson: asString(rawProfile.additionalDetailsJson),
    verificationStatus: asVerificationStatus(rawProfile.verificationStatus),
    origin: asOrigin(rawProfile.origin),
    verifiedAt: asString(rawProfile.verifiedAt),
    createdAt: asString(rawProfile.createdAt) ?? now,
    updatedAt: asString(rawProfile.updatedAt) ?? now,
  };

  const expSkillJoins = Array.isArray(data.experienceSkills)
    ? data.experienceSkills
        .map((j) => asRecord(j))
        .filter((j): j is Record<string, unknown> => Boolean(j))
        .map((j) => ({
          parentId: asString(j.experienceId) ?? "",
          skillId: asString(j.skillId) ?? "",
        }))
        .filter((j) => j.parentId && j.skillId)
    : [];

  const projSkillJoins = Array.isArray(data.projectSkills)
    ? data.projectSkills
        .map((j) => asRecord(j))
        .filter((j): j is Record<string, unknown> => Boolean(j))
        .map((j) => ({
          parentId: asString(j.projectId) ?? "",
          skillId: asString(j.skillId) ?? "",
        }))
        .filter((j) => j.parentId && j.skillId)
    : [];

  const achSkillJoins = Array.isArray(data.achievementSkills)
    ? data.achievementSkills
        .map((j) => asRecord(j))
        .filter((j): j is Record<string, unknown> => Boolean(j))
        .map((j) => ({
          parentId: asString(j.achievementId) ?? "",
          skillId: asString(j.skillId) ?? "",
        }))
        .filter((j) => j.parentId && j.skillId)
    : [];

  const experiences: ExperienceRecord[] = Array.isArray(data.experiences)
    ? data.experiences
        .map((item) => asRecord(item))
        .filter((r): r is Record<string, unknown> => Boolean(r && asString(r.id)))
        .map((r) => {
          const id = asString(r.id) ?? "";
          return {
            id,
            employer: asString(r.employer) ?? "",
            title: asString(r.title) ?? "",
            location: asString(r.location),
            startDate: asString(r.startDate),
            endDate: asString(r.endDate),
            isCurrent: Boolean(r.isCurrent),
            employmentType: asString(r.employmentType),
            description: asString(r.description),
            sortOrder: asNumber(r.sortOrder) ?? 0,
            skillIds: extractSkillIds(r, expSkillJoins, id),
            verificationStatus: asVerificationStatus(r.verificationStatus),
            origin: asOrigin(r.origin),
            verifiedAt: asString(r.verifiedAt),
            createdAt: asString(r.createdAt) ?? now,
            updatedAt: asString(r.updatedAt) ?? now,
          };
        })
    : [];

  const projects: ProjectRecord[] = Array.isArray(data.projects)
    ? data.projects
        .map((item) => asRecord(item))
        .filter((r): r is Record<string, unknown> => Boolean(r && asString(r.id)))
        .map((r) => {
          const id = asString(r.id) ?? "";
          return {
            id,
            experienceId: asString(r.experienceId),
            name: asString(r.name) ?? "",
            problem: asString(r.problem),
            description: asString(r.description),
            roleContribution: asString(r.roleContribution),
            architecture: asString(r.architecture),
            challengesSolved: asString(r.challengesSolved),
            outcomes: asString(r.outcomes),
            metricsJson: asString(r.metricsJson),
            startDate: asString(r.startDate),
            endDate: asString(r.endDate),
            url: asString(r.url),
            targetRolesJson: asString(r.targetRolesJson),
            sortOrder: asNumber(r.sortOrder) ?? 0,
            skillIds: extractSkillIds(r, projSkillJoins, id),
            verificationStatus: asVerificationStatus(r.verificationStatus),
            origin: asOrigin(r.origin),
            verifiedAt: asString(r.verifiedAt),
            createdAt: asString(r.createdAt) ?? now,
            updatedAt: asString(r.updatedAt) ?? now,
          };
        })
    : [];

  const achievements: AchievementRecord[] = Array.isArray(data.achievements)
    ? data.achievements
        .map((item) => asRecord(item))
        .filter((r): r is Record<string, unknown> => Boolean(r && asString(r.id)))
        .map((r) => {
          const id = asString(r.id) ?? "";
          return {
            id,
            experienceId: asString(r.experienceId),
            projectId: asString(r.projectId),
            text: asString(r.text) ?? "",
            metricValue: asNumber(r.metricValue),
            metricUnit: asString(r.metricUnit),
            metricContext: asString(r.metricContext),
            sortOrder: asNumber(r.sortOrder) ?? 0,
            skillIds: extractSkillIds(r, achSkillJoins, id),
            verificationStatus: asVerificationStatus(r.verificationStatus),
            origin: asOrigin(r.origin),
            verifiedAt: asString(r.verifiedAt),
            createdAt: asString(r.createdAt) ?? now,
            updatedAt: asString(r.updatedAt) ?? now,
          };
        })
    : [];

  const skills: SkillRecord[] = Array.isArray(data.skills)
    ? data.skills
        .map((item) => asRecord(item))
        .filter((r): r is Record<string, unknown> => Boolean(r && asString(r.id)))
        .map((r) => ({
          id: asString(r.id) ?? "",
          canonicalName: asString(r.canonicalName) ?? "",
          normalizedKey: asString(r.normalizedKey) ?? "",
          aliasesJson: asString(r.aliasesJson) ?? "[]",
          category: asString(r.category),
          proficiency: asString(r.proficiency),
          verificationStatus: asVerificationStatus(r.verificationStatus),
          origin: asOrigin(r.origin),
          verifiedAt: asString(r.verifiedAt),
          createdAt: asString(r.createdAt) ?? now,
          updatedAt: asString(r.updatedAt) ?? now,
        }))
    : [];

  const education: EducationRecord[] = Array.isArray(data.education)
    ? data.education
        .map((item) => asRecord(item))
        .filter((r): r is Record<string, unknown> => Boolean(r && asString(r.id)))
        .map((r) => ({
          id: asString(r.id) ?? "",
          institution: asString(r.institution) ?? "",
          qualification: asString(r.qualification) ?? "",
          fieldOfStudy: asString(r.fieldOfStudy),
          startDate: asString(r.startDate),
          endDate: asString(r.endDate),
          details: asString(r.details),
          sortOrder: asNumber(r.sortOrder) ?? 0,
          verificationStatus: asVerificationStatus(r.verificationStatus),
          origin: asOrigin(r.origin),
          verifiedAt: asString(r.verifiedAt),
          createdAt: asString(r.createdAt) ?? now,
          updatedAt: asString(r.updatedAt) ?? now,
        }))
    : [];

  const certifications: CertificationRecord[] = Array.isArray(data.certifications)
    ? data.certifications
        .map((item) => asRecord(item))
        .filter((r): r is Record<string, unknown> => Boolean(r && asString(r.id)))
        .map((r) => ({
          id: asString(r.id) ?? "",
          name: asString(r.name) ?? "",
          issuer: asString(r.issuer),
          issueDate: asString(r.issueDate),
          expiryDate: asString(r.expiryDate),
          credentialUrl: asString(r.credentialUrl),
          sortOrder: asNumber(r.sortOrder) ?? 0,
          verificationStatus: asVerificationStatus(r.verificationStatus),
          origin: asOrigin(r.origin),
          verifiedAt: asString(r.verifiedAt),
          createdAt: asString(r.createdAt) ?? now,
          updatedAt: asString(r.updatedAt) ?? now,
        }))
    : [];

  const languages: LanguageRecord[] = Array.isArray(data.languages)
    ? data.languages
        .map((item) => asRecord(item))
        .filter((r): r is Record<string, unknown> => Boolean(r && asString(r.id)))
        .map((r) => ({
          id: asString(r.id) ?? "",
          language: asString(r.language) ?? "",
          proficiency: asString(r.proficiency),
          sortOrder: asNumber(r.sortOrder) ?? 0,
          verificationStatus: asVerificationStatus(r.verificationStatus),
          origin: asOrigin(r.origin),
          verifiedAt: asString(r.verifiedAt),
          createdAt: asString(r.createdAt) ?? now,
          updatedAt: asString(r.updatedAt) ?? now,
        }))
    : [];

  const sourceDocuments: SourceDocumentRecord[] = Array.isArray(
    data.sourceDocuments
  )
    ? data.sourceDocuments
        .map((item) => normalizeSourceDocument(item))
        .filter((d) => d.id.length > 0)
    : [];

  const evidenceLinks: EvidenceLinkRecord[] = Array.isArray(data.evidenceLinks)
    ? data.evidenceLinks
        .map((item) => asRecord(item))
        .filter((r): r is Record<string, unknown> => Boolean(r && asString(r.id)))
        .map((r) => ({
          id: asString(r.id) ?? "",
          sourceDocumentId: asString(r.sourceDocumentId),
          excerpt: asString(r.excerpt),
          targetType: asEvidenceTargetType(r.targetType),
          targetId: asString(r.targetId) ?? "",
          extractionConfidence: asNumber(r.extractionConfidence),
          verificationStatus: asVerificationStatus(r.verificationStatus),
          origin: asOrigin(r.origin),
          createdAt: asString(r.createdAt) ?? now,
          updatedAt: asString(r.updatedAt) ?? now,
        }))
    : [];

  const computedNeedsReview = [
    ...experiences,
    ...projects,
    ...achievements,
    ...skills,
    ...education,
    ...certifications,
    ...languages,
  ].filter((item) => item.verificationStatus === "needs_review").length;

  const needsReviewCount =
    asNumber(data.needsReviewCount) ?? computedNeedsReview;

  return {
    profile,
    experiences,
    projects,
    achievements,
    skills,
    education,
    certifications,
    languages,
    sourceDocuments,
    evidenceLinks,
    needsReviewCount,
  };
}

export function safeJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
    }
  } catch {
    // Fallback to comma-separated string if malformed JSON
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function safeJsonMetrics(
  raw: string | null | undefined
): ProjectMetricItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const results: ProjectMetricItem[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && item.trim()) {
        results.push({ label: "Metric", value: item.trim() });
      } else {
        const rec = asRecord(item);
        if (!rec) continue;
        const label =
          asString(rec.label) ??
          asString(rec.name) ??
          asString(rec.metric) ??
          "Metric";
        const rawVal = rec.value;
        const value =
          typeof rawVal === "string"
            ? rawVal
            : typeof rawVal === "number"
              ? String(rawVal)
              : "";
        if (!value && !label) continue;
        results.push({
          label,
          value,
          unit: asString(rec.unit) ?? undefined,
          context: asString(rec.context) ?? undefined,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

export function matchesVerificationFilter(
  status: VerificationStatus,
  filter: VerificationFilter
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_review":
      return status === "needs_review";
    case "verified":
      return status === "verified";
    case "archived_rejected":
      return status === "archived" || status === "rejected";
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateRange(
  start?: string | null,
  end?: string | null,
  isCurrent?: boolean
): string {
  const s = start?.trim();
  const e = isCurrent ? "Present" : end?.trim();
  if (s && e) return `${s} – ${e}`;
  if (s) return s;
  if (e) return e;
  return "";
}

export function extractApiError(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  const rec = asRecord(payload);
  if (!rec) return fallback;
  const errField = rec.error;
  if (typeof errField === "string" && errField.trim()) return errField.trim();
  const errRec = asRecord(errField);
  if (errRec) {
    const msg = asString(errRec.message);
    if (msg && msg.trim()) return msg.trim();
  }
  const msg = asString(rec.message);
  if (msg && msg.trim()) return msg.trim();
  return fallback;
}

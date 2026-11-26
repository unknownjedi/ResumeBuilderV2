import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import {
  getDb,
  getSqlite,
  type AppDatabase,
  type SqliteDatabase,
} from "../db/client";
import * as schema from "../db/schema/index";
import { applications } from "../db/schema/applications";
import {
  companies,
  jobCompensationOverrides,
  jobDuplicateCandidates,
  jobRequirements,
  jobSourceRecords,
  jobSources,
  jobs,
  matchRuns,
  SALARY_PERIODS,
  searchProfiles,
  USER_JOB_DISCOVERY_STATES,
  userJobStates,
  WORKPLACE_TYPES,
  type DuplicateState,
  type JobStatus,
  type SalaryPeriod,
  type SourceType,
  type UserJobDiscoveryState,
  type WorkplaceType,
} from "../db/schema/jobs";
import {
  ConnectorError,
  parseManualJobImport,
} from "../connectors/index";
import { redactPaths, redactString } from "../security/redaction";
import type { DnsLookupFn } from "../security/ssrf";

export class JobServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "JobServiceError";
    this.code = code;
    this.status = status;
  }
}

export const JOB_SORT_OPTIONS = [
  "recommended",
  "documented_fit",
  "employer_posted_at",
  "first_seen_at",
  "company_title",
] as const;
export type JobSortOption = (typeof JOB_SORT_OPTIONS)[number];

export const JOB_FRESHNESS_LABELS = [
  "very_recent",
  "recent",
  "this_week",
  "older",
  "date_unknown",
] as const;
export type JobFreshnessLabel = (typeof JOB_FRESHNESS_LABELS)[number];

export const USER_JOB_STATE_INPUTS = [
  ...USER_JOB_DISCOVERY_STATES,
  "active",
] as const;
export type UserJobStateInputValue = (typeof USER_JOB_STATE_INPUTS)[number];

export const ManualJobImportSchema = z
  .object({
    url: z
      .union([z.string().trim().max(2048), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    title: z
      .union([z.string().trim().max(300), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    companyName: z
      .union([z.string().trim().max(200), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    descriptionText: z
      .union([z.string().trim().max(200_000), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    descriptionHtml: z
      .union([z.string().trim().max(400_000), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    canonicalUrl: z
      .union([z.string().trim().max(2048), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    applyUrl: z
      .union([z.string().trim().max(2048), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    locationText: z
      .union([z.string().trim().max(300), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    countryCode: z
      .union([z.string().trim().max(16), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    workplaceType: z.enum(WORKPLACE_TYPES).optional().default("unspecified"),
    employmentType: z
      .union([z.string().trim().max(100), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    seniorityLevel: z
      .union([z.string().trim().max(100), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    salaryMin: z.number().finite().nonnegative().nullable().optional(),
    salaryMax: z.number().finite().nonnegative().nullable().optional(),
    salaryCurrency: z
      .union([z.string().trim().max(10), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
    salaryPeriod: z.enum(SALARY_PERIODS).nullable().optional(),
    salarySourceType: z
      .enum(["employer_disclosed", "unknown"])
      .nullable()
      .optional(),
    employerPostedAt: z
      .union([z.string().trim().max(64), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v)),
  })
  .strict()
  .refine(
    (data) =>
      Boolean(data.descriptionText) ||
      Boolean(data.descriptionHtml) ||
      Boolean(data.url) ||
      Boolean(data.canonicalUrl),
    {
      message: "Provide job description text or a public job URL.",
    }
  );

export type ManualJobImportInput = z.input<typeof ManualJobImportSchema>;

export const SetUserJobStateSchema = z
  .object({
    searchProfileId: z.string().trim().min(1).max(128).optional(),
    state: z.enum(USER_JOB_STATE_INPUTS),
    notes: z.union([z.string().trim().max(4000), z.null()]).optional(),
  })
  .strict();

export const MergeDuplicateSchema = z
  .object({
    keepJobId: z.string().trim().min(1, "keepJobId is required.").max(128),
  })
  .strict();

export interface NormalizedJobInput {
  externalId: string;
  title: string;
  companyName: string;
  descriptionText: string;
  descriptionHtmlSanitized?: string | null;
  descriptionHash?: string;
  locationText?: string | null;
  countryCode?: string | null;
  workplaceType?: WorkplaceType;
  employmentType?: string | null;
  seniorityLevel?: string | null;
  seniorityMin?: number | null;
  seniorityMax?: number | null;
  seniorityMinYears?: number | null;
  seniorityMaxYears?: number | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: SalaryPeriod | null;
  salarySourceType?: "employer_disclosed" | "unknown" | null;
  employerPostedAt?: string | null;
  sourcePostedAtText?: string | null;
  sourceUpdatedAt?: string | null;
  status?: JobStatus;
  canonicalUrl?: string | null;
  applyUrl?: string | null;
  sourceUrl?: string | null;
  rawMetadata?: Record<string, unknown>;
  rawJson?: unknown;
}

export interface IngestBatchInput {
  jobs: NormalizedJobInput[];
  isCompleteSnapshot: boolean;
  fetchedAt: string;
  notModified?: boolean;
  sourceEtag?: string | null;
  sourceLastModified?: string | null;
}

export interface SourceRecordForIngestion {
  id: string;
  sourceType: SourceType;
  displayName: string;
  companyId?: string | null;
  refreshIntervalMinutes: number;
  lastSuccessfulFullScanAt?: string | null;
}

export interface IngestSourceBatchParams {
  db?: AppDatabase;
  sqlite?: SqliteDatabase;
  source: SourceRecordForIngestion;
  batch: IngestBatchInput;
  now?: Date;
}

export interface IngestBatchResult {
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  reopenedCount: number;
  closedCount: number;
  possiblyClosedCount: number;
  autoMergedCount: number;
  duplicateCandidatesCreated: number;
  touchedJobIds: string[];
}

export interface SearchJobsFilters {
  q?: string;
  searchProfileId?: string;
  sourceId?: string;
  company?: string;
  workplaceType?: WorkplaceType | WorkplaceType[];
  employmentType?: string | string[];
  status?: JobStatus | JobStatus[];
  salaryPresent?: boolean;
  postedSince?: string;
  firstSeenSince?: string;
  discoveryState?: UserJobDiscoveryState | "unreviewed" | "active" | "all";
  sort?: JobSortOption;
  limit?: number;
  offset?: number;
}

const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
  "src",
  "gh_src",
  "lever-source",
  "lever-origin",
]);

const JOB_SPECIFIC_QUERY_PARAMS = new Set([
  "gh_jid",
  "jid",
  "jobid",
  "job_id",
  "postingid",
  "posting_id",
  "req",
  "reqid",
  "requisitionid",
  "id",
]);

const GENERIC_PORTAL_PATHS = new Set([
  "",
  "/",
  "/careers",
  "/jobs",
  "/apply",
  "/openings",
  "/positions",
  "/work-with-us",
  "/join-us",
  "/join",
  "/opportunities",
]);

const ATS_BOARD_ROOT_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
]);

const DISCOVERY_PRECEDENCE: Record<UserJobDiscoveryState, number> = {
  saved: 3,
  hidden: 2,
  dismissed: 1,
};

const DATE_CONFLICT_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const MAX_RAW_JSON_BYTES = 64 * 1024;

function resolveDbAndSqlite(
  dbArg?: AppDatabase,
  sqliteArg?: SqliteDatabase
): { db: AppDatabase; sqlite: SqliteDatabase } {
  if (sqliteArg && dbArg) {
    return { db: dbArg, sqlite: sqliteArg };
  }
  if (sqliteArg) {
    return { db: drizzle(sqliteArg, { schema }), sqlite: sqliteArg };
  }
  if (dbArg) {
    const client = (dbArg as unknown as { $client?: SqliteDatabase }).$client;
    return { db: dbArg, sqlite: client ?? getSqlite() };
  }
  const sqlite = getSqlite();
  return { db: getDb(), sqlite };
}

export function normalizeTextForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function computeDescriptionHash(descriptionText: string): string {
  const normalized = normalizeTextForHash(descriptionText);
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[.,/\\|()]+/g, " ")
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|gmbh|plc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeJobTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[-_/|()[\]]+/g, " ")
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLocation(location: string | null | undefined): string {
  if (!location) return "";
  return location
    .toLowerCase()
    .replace(/[-_,./()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeFreshnessLabel(
  employerPostedAt: string | null | undefined,
  now: Date = new Date()
): JobFreshnessLabel {
  if (!employerPostedAt) {
    return "date_unknown";
  }
  const postedMs = Date.parse(employerPostedAt);
  if (Number.isNaN(postedMs)) {
    return "date_unknown";
  }
  const ageMs = now.getTime() - postedMs;
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (ageMs < oneDayMs) {
    return "very_recent";
  }
  if (ageMs <= 3 * oneDayMs) {
    return "recent";
  }
  if (ageMs <= 7 * oneDayMs) {
    return "this_week";
  }
  return "older";
}

/**
 * Canonicalizes a URL and returns null if it is invalid or a generic career/ATS portal root
 * rather than a job-specific posting/application URL.
 */
export function canonicalizeJobSpecificUrl(
  rawUrl: string | null | undefined
): string | null {
  if (!rawUrl || typeof rawUrl !== "string") {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  if (parsed.username || parsed.password) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return null;
  }

  parsed.hash = "";
  parsed.hostname = host;

  const keptParams: Array<[string, string]> = [];
  let hasJobSpecificParam = false;

  for (const [key, value] of parsed.searchParams.entries()) {
    const lowerKey = key.toLowerCase();
    if (TRACKING_QUERY_PARAMS.has(lowerKey)) {
      continue;
    }
    if (JOB_SPECIFIC_QUERY_PARAMS.has(lowerKey) && value.trim().length > 0) {
      hasJobSpecificParam = true;
    }
    keptParams.push([key, value]);
  }

  keptParams.sort(([a], [b]) => a.localeCompare(b));
  parsed.search = "";
  for (const [k, v] of keptParams) {
    parsed.searchParams.append(k, v);
  }

  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (!pathname) {
    pathname = "/";
  }
  parsed.pathname = pathname;

  const lowerPath = pathname.toLowerCase();
  const segments = lowerPath.split("/").filter(Boolean);

  if (GENERIC_PORTAL_PATHS.has(lowerPath) && !hasJobSpecificParam) {
    return null;
  }

  // Known ATS board roots: e.g. boards.greenhouse.io/<slug> or jobs.lever.co/<slug>
  if (ATS_BOARD_ROOT_HOSTS.has(host)) {
    if (segments.length <= 1 && !hasJobSpecificParam) {
      return null;
    }
    if (
      segments.length === 2 &&
      (segments[1] === "jobs" || segments[1] === "apply") &&
      !hasJobSpecificParam
    ) {
      return null;
    }
  }

  // Generic single-segment /careers/<company> or /company/careers without job ID
  if (
    !hasJobSpecificParam &&
    segments.length === 2 &&
    (segments[1] === "careers" ||
      segments[1] === "jobs" ||
      segments[1] === "openings")
  ) {
    return null;
  }

  // Must have either a non-trivial path or a job-specific query param
  if (segments.length === 0 && !hasJobSpecificParam) {
    return null;
  }

  return parsed.toString();
}

function validateOptionalReferenceUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new JobServiceError(
      "VALIDATION_ERROR",
      400,
      `Invalid URL format: ${rawUrl}`
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new JobServiceError(
      "VALIDATION_ERROR",
      400,
      "Only http and https URLs are permitted."
    );
  }
  if (parsed.username || parsed.password) {
    throw new JobServiceError(
      "VALIDATION_ERROR",
      400,
      "URLs with embedded credentials are not permitted."
    );
  }
  return parsed.toString();
}

function serializeBoundedRawJson(raw: unknown): string {
  if (typeof raw === "string") {
    return raw.length <= MAX_RAW_JSON_BYTES
      ? raw
      : raw.slice(0, MAX_RAW_JSON_BYTES);
  }
  try {
    const json = JSON.stringify(raw ?? {});
    if (json.length <= MAX_RAW_JSON_BYTES) {
      return json;
    }
    return JSON.stringify({
      truncated: true,
      preview: json.slice(0, MAX_RAW_JSON_BYTES - 128),
    });
  } catch {
    return "{}";
  }
}

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function locationsCompatible(
  locA: string | null | undefined,
  workplaceA: WorkplaceType,
  locB: string | null | undefined,
  workplaceB: WorkplaceType
): boolean {
  const normA = normalizeLocation(locA);
  const normB = normalizeLocation(locB);

  if (!normA && !normB) {
    return workplaceA === workplaceB || workplaceA === "unspecified" || workplaceB === "unspecified";
  }
  if (!normA || !normB) {
    // One side missing location: only compatible if workplace types do not contradict
    return (
      workplaceA === workplaceB ||
      workplaceA === "unspecified" ||
      workplaceB === "unspecified"
    );
  }

  if (normA === normB || normA.includes(normB) || normB.includes(normA)) {
    return true;
  }

  const tokensA = new Set(normA.split(" ").filter((t) => t.length > 1));
  const tokensB = new Set(normB.split(" ").filter((t) => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) {
    return false;
  }
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.min(tokensA.size, tokensB.size) >= 0.6;
}

function tokenizeForSimilarity(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface DateConflictValue {
  sourceId: string;
  sourceName: string;
  postedAt: string;
  postedAtText: string | null;
}

interface DateConflictRecord {
  hasConflict: boolean;
  canonicalValue: string;
  values: DateConflictValue[];
}

function mergeDateConflict(
  existingPostedAt: string | null,
  existingConflictJson: string | null,
  incomingPostedAt: string | null,
  incomingPostedAtText: string | null,
  sourceId: string,
  sourceName: string,
  existingSourceId: string | null
): { employerPostedAt: string | null; dateConflictJson: string | null } {
  if (!incomingPostedAt) {
    return {
      employerPostedAt: existingPostedAt,
      dateConflictJson: existingConflictJson,
    };
  }

  if (!existingPostedAt) {
    return {
      employerPostedAt: incomingPostedAt,
      dateConflictJson: existingConflictJson,
    };
  }

  const existingMs = Date.parse(existingPostedAt);
  const incomingMs = Date.parse(incomingPostedAt);
  if (Number.isNaN(existingMs) || Number.isNaN(incomingMs)) {
    return {
      employerPostedAt: existingPostedAt,
      dateConflictJson: existingConflictJson,
    };
  }

  if (Math.abs(existingMs - incomingMs) <= DATE_CONFLICT_THRESHOLD_MS) {
    return {
      employerPostedAt: existingPostedAt,
      dateConflictJson: existingConflictJson,
    };
  }

  // Material disagreement (> 24 hours): preserve both values as an explicit conflict
  let parsed: DateConflictRecord | null = null;
  if (existingConflictJson) {
    try {
      parsed = JSON.parse(existingConflictJson) as DateConflictRecord;
    } catch {
      parsed = null;
    }
  }

  const values: DateConflictValue[] = parsed?.values ? [...parsed.values] : [];
  if (values.length === 0) {
    values.push({
      sourceId: existingSourceId ?? "existing",
      sourceName: existingSourceId ?? "Existing source",
      postedAt: existingPostedAt,
      postedAtText: null,
    });
  }

  const alreadyRecorded = values.some(
    (v) => v.sourceId === sourceId && v.postedAt === incomingPostedAt
  );
  if (!alreadyRecorded) {
    values.push({
      sourceId,
      sourceName,
      postedAt: incomingPostedAt,
      postedAtText: incomingPostedAtText,
    });
  }

  return {
    employerPostedAt: existingPostedAt,
    dateConflictJson: JSON.stringify({
      hasConflict: true,
      canonicalValue: existingPostedAt,
      values,
    }),
  };
}

function orderedPair(id1: string, id2: string): [string, string] {
  return id1 < id2 ? [id1, id2] : [id2, id1];
}

function resolveCanonicalJobIdSync(
  sqlite: SqliteDatabase,
  jobId: string
): string | null {
  let currentId = jobId;
  const visited = new Set<string>();

  for (let depth = 0; depth < 10; depth++) {
    if (visited.has(currentId)) return null;
    visited.add(currentId);

    const row = sqlite
      .prepare(`SELECT id, merged_into_job_id FROM jobs WHERE id = ?`)
      .get(currentId) as { id: string; merged_into_job_id: string | null } | undefined;

    if (!row) return null;
    if (!row.merged_into_job_id) return row.id;
    currentId = row.merged_into_job_id;
  }

  return null;
}

function deleteJobFromFts(sqlite: SqliteDatabase, jobId: string): void {
  sqlite
    .prepare(
      `INSERT INTO job_fts(job_fts, rowid, id, title, company_name, location_text, description_text)
       SELECT 'delete', rowid, id, title, company_name, COALESCE(location_text, ''), description_text
       FROM jobs
       WHERE id = ?`
    )
    .run(jobId);
}

function upsertDuplicateCandidateSync(
  sqlite: SqliteDatabase,
  params: {
    jobA: { id: string; descriptionHash: string };
    jobB: { id: string; descriptionHash: string };
    matchMethod: string;
    similarityScore: number;
    evidence: Record<string, unknown>;
    nowIso: string;
  }
): boolean {
  const [firstId, secondId] = orderedPair(params.jobA.id, params.jobB.id);
  const firstHash =
    firstId === params.jobA.id
      ? params.jobA.descriptionHash
      : params.jobB.descriptionHash;
  const secondHash =
    secondId === params.jobB.id
      ? params.jobB.descriptionHash
      : params.jobA.descriptionHash;

  const existing = sqlite
    .prepare(
      `SELECT id, state, job_a_description_hash, job_b_description_hash
       FROM job_duplicate_candidates
       WHERE job_a_id = ? AND job_b_id = ?`
    )
    .get(firstId, secondId) as
    | {
        id: string;
        state: DuplicateState;
        job_a_description_hash: string | null;
        job_b_description_hash: string | null;
      }
    | undefined;

  const evidenceJson = JSON.stringify(params.evidence);

  if (!existing) {
    sqlite
      .prepare(
        `INSERT INTO job_duplicate_candidates (
          id, job_a_id, job_b_id, match_method, evidence_json, similarity_score,
          state, job_a_description_hash, job_b_description_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        firstId,
        secondId,
        params.matchMethod,
        evidenceJson,
        params.similarityScore,
        firstHash,
        secondHash,
        params.nowIso
      );
    return true;
  }

  if (existing.state === "merged") {
    return false;
  }

  if (existing.state === "dismissed") {
    // Section 7.8: Do not re-suggest a dismissed pair unless normalized content hash changed materially.
    if (
      existing.job_a_description_hash === firstHash &&
      existing.job_b_description_hash === secondHash
    ) {
      return false;
    }

    sqlite
      .prepare(
        `UPDATE job_duplicate_candidates
         SET match_method = ?,
             evidence_json = ?,
             similarity_score = ?,
             state = 'proposed',
             job_a_description_hash = ?,
             job_b_description_hash = ?,
             dismissed_at = NULL
         WHERE id = ?`
      )
      .run(
        params.matchMethod,
        evidenceJson,
        params.similarityScore,
        firstHash,
        secondHash,
        existing.id
      );
    return true;
  }

  // Already proposed: refresh evidence/score if stronger
  sqlite
    .prepare(
      `UPDATE job_duplicate_candidates
       SET match_method = ?,
           evidence_json = ?,
           similarity_score = ?,
           job_a_description_hash = ?,
           job_b_description_hash = ?
       WHERE id = ?`
    )
    .run(
      params.matchMethod,
      evidenceJson,
      params.similarityScore,
      firstHash,
      secondHash,
      existing.id
    );
  return false;
}

function resolveOrCreateCompanyIdSync(
  sqlite: SqliteDatabase,
  companyName: string,
  preferredCompanyId: string | null | undefined,
  nowIso: string
): string | null {
  if (preferredCompanyId) {
    const existingById = sqlite
      .prepare(`SELECT id FROM companies WHERE id = ?`)
      .get(preferredCompanyId) as { id: string } | undefined;
    if (existingById) {
      return existingById.id;
    }
  }

  const norm = normalizeCompanyName(companyName);
  if (!norm) return null;

  const existing = sqlite
    .prepare(`SELECT id FROM companies WHERE normalized_name = ? LIMIT 1`)
    .get(norm) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }

  const companyId = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO companies (
        id, canonical_name, normalized_name, aliases_json, industry_tags_json, created_at, updated_at
      ) VALUES (?, ?, ?, '[]', '[]', ?, ?)`
    )
    .run(companyId, companyName.trim(), norm, nowIso, nowIso);
  return companyId;
}

interface ActiveJobSnapshot {
  id: string;
  company_id: string | null;
  company_name: string;
  primary_source_id: string | null;
  title: string;
  description_text: string;
  description_hash: string;
  location_text: string | null;
  workplace_type: WorkplaceType;
  employer_posted_at: string | null;
  date_conflict_json: string | null;
  first_seen_at: string;
  status: JobStatus;
  canonical_url: string | null;
  apply_url: string | null;
}

function detectDuplicateCandidatesForJobSync(
  sqlite: SqliteDatabase,
  targetJob: ActiveJobSnapshot,
  activeJobs: ActiveJobSnapshot[],
  nowIso: string
): number {
  let createdCount = 0;
  const normCompany = normalizeCompanyName(targetJob.company_name);
  const normTitle = normalizeJobTitle(targetJob.title);
  const titleTokens = tokenizeForSimilarity(targetJob.title);
  const descTokens = tokenizeForSimilarity(targetJob.description_text);

  for (const existingJob of activeJobs) {
    if (existingJob.id === targetJob.id) continue;

    const sameCompany =
      (targetJob.company_id && existingJob.company_id === targetJob.company_id) ||
      (normCompany.length > 0 &&
        normCompany === normalizeCompanyName(existingJob.company_name));

    if (!sameCompany) continue;

    const existingNormTitle = normalizeJobTitle(existingJob.title);
    if (
      normTitle.length > 0 &&
      normTitle === existingNormTitle &&
      locationsCompatible(
        targetJob.location_text,
        targetJob.workplace_type,
        existingJob.location_text,
        existingJob.workplace_type
      )
    ) {
      const created = upsertDuplicateCandidateSync(sqlite, {
        jobA: { id: targetJob.id, descriptionHash: targetJob.description_hash },
        jobB: {
          id: existingJob.id,
          descriptionHash: existingJob.description_hash,
        },
        matchMethod: "exact_company_title_location",
        similarityScore: 0.95,
        evidence: {
          method: "exact_company_title_location",
          normalizedCompany: normCompany,
          normalizedTitle: normTitle,
          locationA: targetJob.location_text,
          locationB: existingJob.location_text,
        },
        nowIso,
      });
      if (created) createdCount++;
      continue;
    }

    const existingTitleTokens = tokenizeForSimilarity(existingJob.title);
    const titleSim = jaccardSimilarity(titleTokens, existingTitleTokens);
    if (titleSim < 0.5) continue;

    const existingDescTokens = tokenizeForSimilarity(existingJob.description_text);
    const descSim = jaccardSimilarity(descTokens, existingDescTokens);

    const isFuzzyDuplicate =
      (titleSim >= 0.75 && descSim >= 0.6) ||
      (titleSim >= 0.5 && descSim >= 0.8);

    if (isFuzzyDuplicate) {
      const score = Number((titleSim * 0.4 + descSim * 0.6).toFixed(4));
      const created = upsertDuplicateCandidateSync(sqlite, {
        jobA: { id: targetJob.id, descriptionHash: targetJob.description_hash },
        jobB: {
          id: existingJob.id,
          descriptionHash: existingJob.description_hash,
        },
        matchMethod: "fuzzy_title_description",
        similarityScore: score,
        evidence: {
          method: "fuzzy_title_description",
          titleSimilarity: Number(titleSim.toFixed(4)),
          descriptionSimilarity: Number(descSim.toFixed(4)),
          titleA: targetJob.title,
          titleB: existingJob.title,
        },
        nowIso,
      });
      if (created) createdCount++;
    }
  }

  return createdCount;
}

/**
 * Runs a candidate duplicate detection pass across active canonical jobs (or for a specific jobId).
 */
export function runJobDeduplicationPass(
  sqlite: SqliteDatabase,
  options?: { jobId?: string }
): { scannedJobs: number; duplicateCandidatesCreated: number } {
  const nowIso = new Date().toISOString();
  const tx = sqlite.transaction(() => {
    const activeJobs = sqlite
      .prepare(
        `SELECT id, company_id, company_name, primary_source_id, title,
                description_text, description_hash, location_text, workplace_type,
                employer_posted_at, date_conflict_json, first_seen_at, status,
                canonical_url, apply_url
         FROM jobs
         WHERE merged_into_job_id IS NULL`
      )
      .all() as ActiveJobSnapshot[];

    if (options?.jobId) {
      const target = activeJobs.find((j) => j.id === options.jobId);
      if (!target) {
        return { scannedJobs: 0, duplicateCandidatesCreated: 0 };
      }
      const created = detectDuplicateCandidatesForJobSync(
        sqlite,
        target,
        activeJobs,
        nowIso
      );
      return { scannedJobs: 1, duplicateCandidatesCreated: created };
    }

    let created = 0;
    for (let i = 0; i < activeJobs.length; i++) {
      created += detectDuplicateCandidatesForJobSync(
        sqlite,
        activeJobs[i],
        activeJobs.slice(i + 1),
        nowIso
      );
    }
    return { scannedJobs: activeJobs.length, duplicateCandidatesCreated: created };
  });

  return tx.immediate();
}

function recomputeCanonicalJobStatusSync(
  sqlite: SqliteDatabase,
  jobId: string,
  nowIso: string
): { previousStatus: JobStatus; newStatus: JobStatus } {
  const jobRow = sqlite
    .prepare(`SELECT status FROM jobs WHERE id = ?`)
    .get(jobId) as { status: JobStatus } | undefined;
  if (!jobRow) {
    return { previousStatus: "unknown", newStatus: "unknown" };
  }

  const records = sqlite
    .prepare(`SELECT record_status FROM job_source_records WHERE job_id = ?`)
    .all(jobId) as Array<{ record_status: "open" | "possibly_closed" | "closed" }>;

  if (records.length === 0) {
    return { previousStatus: jobRow.status, newStatus: jobRow.status };
  }

  let nextStatus: JobStatus = "closed";
  if (records.some((r) => r.record_status === "open")) {
    nextStatus = "open";
  } else if (records.some((r) => r.record_status === "possibly_closed")) {
    nextStatus = "possibly_closed";
  }

  if (nextStatus !== jobRow.status) {
    sqlite
      .prepare(`UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?`)
      .run(nextStatus, nowIso, jobId);
  }

  return { previousStatus: jobRow.status, newStatus: nextStatus };
}

/**
 * Ingests a normalized batch of jobs for a source inside a synchronous SQLite transaction.
 * Follows Section 7.5–7.8 rules for deduplication, date conflicts, and closure/reopen.
 */
export function ingestSourceBatch(
  params: IngestSourceBatchParams
): IngestBatchResult {
  const { sqlite } = resolveDbAndSqlite(params.db, params.sqlite);
  const { source, batch } = params;
  const now = params.now ?? new Date(batch.fetchedAt || Date.now());
  const nowIso = now.toISOString();
  const nowMs = now.getTime();

  const tx = sqlite.transaction((): IngestBatchResult => {
    let newCount = 0;
    let updatedCount = 0;
    let reopenedCount = 0;
    let closedCount = 0;
    let possiblyClosedCount = 0;
    let autoMergedCount = 0;
    let duplicateCandidatesCreated = 0;
    const touchedJobIds = new Set<string>();
    const seenExternalIds = new Set<string>();

    // Preload active canonical jobs for URL and candidate matching
    const activeJobs = sqlite
      .prepare(
        `SELECT id, company_id, company_name, primary_source_id, title,
                description_text, description_hash, location_text, workplace_type,
                employer_posted_at, date_conflict_json, first_seen_at, status,
                canonical_url, apply_url
         FROM jobs
         WHERE merged_into_job_id IS NULL`
      )
      .all() as Array<{
      id: string;
      company_id: string | null;
      company_name: string;
      primary_source_id: string | null;
      title: string;
      description_text: string;
      description_hash: string;
      location_text: string | null;
      workplace_type: WorkplaceType;
      employer_posted_at: string | null;
      date_conflict_json: string | null;
      first_seen_at: string;
      status: JobStatus;
      canonical_url: string | null;
      apply_url: string | null;
    }>;

    const urlToJobId = new Map<string, string>();
    for (const j of activeJobs) {
      const cUrl = canonicalizeJobSpecificUrl(j.canonical_url);
      if (cUrl) urlToJobId.set(cUrl, j.id);
      const aUrl = canonicalizeJobSpecificUrl(j.apply_url);
      if (aUrl) urlToJobId.set(aUrl, j.id);
    }

    const sourceRecordUrls = sqlite
      .prepare(
        `SELECT jsr.job_id, jsr.source_url, jsr.apply_url
         FROM job_source_records jsr
         JOIN jobs j ON j.id = jsr.job_id
         WHERE j.merged_into_job_id IS NULL`
      )
      .all() as Array<{
      job_id: string;
      source_url: string | null;
      apply_url: string | null;
    }>;

    for (const sr of sourceRecordUrls) {
      const sUrl = canonicalizeJobSpecificUrl(sr.source_url);
      if (sUrl && !urlToJobId.has(sUrl)) urlToJobId.set(sUrl, sr.job_id);
      const aUrl = canonicalizeJobSpecificUrl(sr.apply_url);
      if (aUrl && !urlToJobId.has(aUrl)) urlToJobId.set(aUrl, sr.job_id);
    }

    const activeJobMap = new Map(activeJobs.map((j) => [j.id, j]));

    for (const item of batch.jobs) {
      const externalId = item.externalId.trim();
      if (!externalId) continue;
      seenExternalIds.add(externalId);

      const title = item.title.trim();
      const companyName = item.companyName.trim();
      const descriptionText = item.descriptionText.trim();
      const descriptionHash =
        item.descriptionHash || computeDescriptionHash(descriptionText);
      const workplaceType: WorkplaceType = item.workplaceType ?? "unspecified";
      const incomingPostedAt = toIsoOrNull(item.employerPostedAt);
      const incomingUpdatedAt = toIsoOrNull(item.sourceUpdatedAt);
      const incomingCanonicalUrl = item.canonicalUrl?.trim() || null;
      const incomingApplyUrl = item.applyUrl?.trim() || null;
      const incomingSourceUrl =
        item.sourceUrl?.trim() || incomingCanonicalUrl || null;
      const explicitClosed = item.status === "closed";
      const recordStatus = explicitClosed ? "closed" : "open";
      const rawJson = serializeBoundedRawJson(
        item.rawJson ?? item.rawMetadata ?? item
      );
      const seniorityMinYears = item.seniorityMinYears ?? item.seniorityMin ?? null;
      const seniorityMaxYears = item.seniorityMaxYears ?? item.seniorityMax ?? null;

      // (1) Exact (sourceId, externalId) in job_source_records
      const existingSourceRecord = sqlite
        .prepare(
          `SELECT id, job_id, record_status, first_seen_at
           FROM job_source_records
           WHERE source_id = ? AND external_id = ?`
        )
        .get(source.id, externalId) as
        | {
            id: string;
            job_id: string;
            record_status: "open" | "possibly_closed" | "closed";
            first_seen_at: string;
          }
        | undefined;

      if (existingSourceRecord) {
        const canonicalJobId =
          resolveCanonicalJobIdSync(sqlite, existingSourceRecord.job_id) ??
          existingSourceRecord.job_id;
        const canonicalJob = activeJobMap.get(canonicalJobId);

        const wasClosedOrPossiblyClosed =
          existingSourceRecord.record_status !== "open" ||
          canonicalJob?.status === "closed" ||
          canonicalJob?.status === "possibly_closed";

        sqlite
          .prepare(
            `UPDATE job_source_records
             SET source_url = COALESCE(?, source_url),
                 apply_url = COALESCE(?, apply_url),
                 raw_json = ?,
                 source_posted_at_text = COALESCE(?, source_posted_at_text),
                 source_posted_at = COALESCE(?, source_posted_at),
                 source_updated_at = COALESCE(?, source_updated_at),
                 last_seen_at = ?,
                 missing_run_count = 0,
                 record_status = ?,
                 updated_at = ?
             WHERE id = ?`
          )
          .run(
            incomingSourceUrl,
            incomingApplyUrl,
            rawJson,
            item.sourcePostedAtText ?? null,
            incomingPostedAt,
            incomingUpdatedAt,
            nowIso,
            recordStatus,
            nowIso,
            existingSourceRecord.id
          );

        if (canonicalJob) {
          const dateMerged = mergeDateConflict(
            canonicalJob.employer_posted_at,
            canonicalJob.date_conflict_json,
            incomingPostedAt,
            item.sourcePostedAtText ?? null,
            source.id,
            source.displayName,
            canonicalJob.primary_source_id
          );

          const isPrimarySource =
            !canonicalJob.primary_source_id ||
            canonicalJob.primary_source_id === source.id;

          if (isPrimarySource) {
            sqlite
              .prepare(
                `UPDATE jobs
                 SET title = ?,
                     company_name = ?,
                     description_text = ?,
                     description_html_sanitized = COALESCE(?, description_html_sanitized),
                     description_hash = ?,
                     location_text = COALESCE(?, location_text),
                     country_code = COALESCE(?, country_code),
                     workplace_type = CASE WHEN ? != 'unspecified' THEN ? ELSE workplace_type END,
                     employment_type = COALESCE(?, employment_type),
                     seniority_level = COALESCE(?, seniority_level),
                     seniority_min_years = COALESCE(?, seniority_min_years),
                     seniority_max_years = COALESCE(?, seniority_max_years),
                     salary_min = COALESCE(?, salary_min),
                     salary_max = COALESCE(?, salary_max),
                     salary_currency = COALESCE(?, salary_currency),
                     salary_period = COALESCE(?, salary_period),
                     salary_source_type = COALESCE(?, salary_source_type),
                     employer_posted_at = ?,
                     date_conflict_json = ?,
                     source_updated_at = COALESCE(?, source_updated_at),
                     last_seen_at = ?,
                     last_verified_at = ?,
                     canonical_url = COALESCE(?, canonical_url),
                     apply_url = COALESCE(?, apply_url),
                     updated_at = ?
                 WHERE id = ?`
              )
              .run(
                title,
                companyName,
                descriptionText,
                item.descriptionHtmlSanitized ?? null,
                descriptionHash,
                item.locationText ?? null,
                item.countryCode ?? null,
                workplaceType,
                workplaceType,
                item.employmentType ?? null,
                item.seniorityLevel ?? null,
                seniorityMinYears,
                seniorityMaxYears,
                item.salaryMin ?? null,
                item.salaryMax ?? null,
                item.salaryCurrency ?? null,
                item.salaryPeriod ?? null,
                item.salarySourceType ?? null,
                dateMerged.employerPostedAt,
                dateMerged.dateConflictJson,
                incomingUpdatedAt,
                nowIso,
                nowIso,
                incomingCanonicalUrl,
                incomingApplyUrl,
                nowIso,
                canonicalJobId
              );
            const hashChanged = canonicalJob.description_hash !== descriptionHash;
            canonicalJob.description_hash = descriptionHash;
            canonicalJob.title = title;
            canonicalJob.description_text = descriptionText;
            canonicalJob.employer_posted_at = dateMerged.employerPostedAt;
            canonicalJob.date_conflict_json = dateMerged.dateConflictJson;
            if (hashChanged) {
              duplicateCandidatesCreated += detectDuplicateCandidatesForJobSync(
                sqlite,
                canonicalJob,
                activeJobs,
                nowIso
              );
            }
          } else {
            sqlite
              .prepare(
                `UPDATE jobs
                 SET employer_posted_at = ?,
                     date_conflict_json = ?,
                     last_seen_at = ?,
                     last_verified_at = ?,
                     updated_at = ?
                 WHERE id = ?`
              )
              .run(
                dateMerged.employerPostedAt,
                dateMerged.dateConflictJson,
                nowIso,
                nowIso,
                nowIso,
                canonicalJobId
              );
            canonicalJob.employer_posted_at = dateMerged.employerPostedAt;
            canonicalJob.date_conflict_json = dateMerged.dateConflictJson;
          }

          const { previousStatus, newStatus } = recomputeCanonicalJobStatusSync(
            sqlite,
            canonicalJobId,
            nowIso
          );
          if (
            wasClosedOrPossiblyClosed &&
            !explicitClosed &&
            newStatus === "open" &&
            previousStatus !== "open"
          ) {
            reopenedCount++;
          }
          canonicalJob.status = newStatus;
        }

        updatedCount++;
        touchedJobIds.add(canonicalJobId);
        continue;
      }

      // (2) Exact canonicalized job-specific canonicalUrl / applyUrl (not generic portal roots)
      const candCanonicalUrl = canonicalizeJobSpecificUrl(incomingCanonicalUrl);
      const candApplyUrl = canonicalizeJobSpecificUrl(incomingApplyUrl);
      const candSourceUrl = canonicalizeJobSpecificUrl(incomingSourceUrl);
      const matchedJobIdByUrl =
        (candCanonicalUrl && urlToJobId.get(candCanonicalUrl)) ||
        (candApplyUrl && urlToJobId.get(candApplyUrl)) ||
        (candSourceUrl && urlToJobId.get(candSourceUrl)) ||
        null;

      if (matchedJobIdByUrl) {
        const canonicalJob = activeJobMap.get(matchedJobIdByUrl);
        sqlite
          .prepare(
            `INSERT INTO job_source_records (
              id, job_id, source_id, external_id, source_url, apply_url, raw_json,
              source_posted_at_text, source_posted_at, source_updated_at,
              first_seen_at, last_seen_at, missing_run_count, record_status,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            matchedJobIdByUrl,
            source.id,
            externalId,
            incomingSourceUrl,
            incomingApplyUrl,
            rawJson,
            item.sourcePostedAtText ?? null,
            incomingPostedAt,
            incomingUpdatedAt,
            nowIso,
            nowIso,
            recordStatus,
            nowIso,
            nowIso
          );

        if (canonicalJob) {
          const dateMerged = mergeDateConflict(
            canonicalJob.employer_posted_at,
            canonicalJob.date_conflict_json,
            incomingPostedAt,
            item.sourcePostedAtText ?? null,
            source.id,
            source.displayName,
            canonicalJob.primary_source_id
          );

          sqlite
            .prepare(
              `UPDATE jobs
               SET employer_posted_at = ?,
                   date_conflict_json = ?,
                   last_seen_at = ?,
                   last_verified_at = ?,
                   canonical_url = COALESCE(canonical_url, ?),
                   apply_url = COALESCE(apply_url, ?),
                   updated_at = ?
               WHERE id = ?`
            )
            .run(
              dateMerged.employerPostedAt,
              dateMerged.dateConflictJson,
              nowIso,
              nowIso,
              incomingCanonicalUrl,
              incomingApplyUrl,
              nowIso,
              matchedJobIdByUrl
            );
          canonicalJob.employer_posted_at = dateMerged.employerPostedAt;
          canonicalJob.date_conflict_json = dateMerged.dateConflictJson;

          const { previousStatus, newStatus } = recomputeCanonicalJobStatusSync(
            sqlite,
            matchedJobIdByUrl,
            nowIso
          );
          if (
            !explicitClosed &&
            newStatus === "open" &&
            previousStatus !== "open"
          ) {
            reopenedCount++;
          }
          canonicalJob.status = newStatus;
        }

        if (candCanonicalUrl) urlToJobId.set(candCanonicalUrl, matchedJobIdByUrl);
        if (candApplyUrl) urlToJobId.set(candApplyUrl, matchedJobIdByUrl);
        if (candSourceUrl) urlToJobId.set(candSourceUrl, matchedJobIdByUrl);

        autoMergedCount++;
        updatedCount++;
        touchedJobIds.add(matchedJobIdByUrl);
        continue;
      }

      // Create new canonical job + source record
      const companyId = resolveOrCreateCompanyIdSync(
        sqlite,
        companyName,
        source.companyId,
        nowIso
      );
      const jobId = crypto.randomUUID();
      const initialStatus: JobStatus = explicitClosed ? "closed" : "open";

      sqlite
        .prepare(
          `INSERT INTO jobs (
            id, company_id, company_name, primary_source_id, title,
            description_text, description_html_sanitized, description_hash,
            location_text, country_code, workplace_type, employment_type,
            seniority_level, seniority_min_years, seniority_max_years,
            salary_min, salary_max, salary_currency, salary_period, salary_source_type,
            employer_posted_at, date_conflict_json, source_updated_at,
            first_seen_at, last_seen_at, last_verified_at, status,
            canonical_url, apply_url, analysis_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .run(
          jobId,
          companyId,
          companyName,
          source.id,
          title,
          descriptionText,
          item.descriptionHtmlSanitized ?? null,
          descriptionHash,
          item.locationText ?? null,
          item.countryCode ?? null,
          workplaceType,
          item.employmentType ?? null,
          item.seniorityLevel ?? null,
          seniorityMinYears,
          seniorityMaxYears,
          item.salaryMin ?? null,
          item.salaryMax ?? null,
          item.salaryCurrency ?? null,
          item.salaryPeriod ?? null,
          item.salarySourceType ?? null,
          incomingPostedAt,
          incomingUpdatedAt,
          nowIso,
          nowIso,
          nowIso,
          initialStatus,
          incomingCanonicalUrl,
          incomingApplyUrl,
          nowIso,
          nowIso
        );

      sqlite
        .prepare(
          `INSERT INTO job_source_records (
            id, job_id, source_id, external_id, source_url, apply_url, raw_json,
            source_posted_at_text, source_posted_at, source_updated_at,
            first_seen_at, last_seen_at, missing_run_count, record_status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          jobId,
          source.id,
          externalId,
          incomingSourceUrl,
          incomingApplyUrl,
          rawJson,
          item.sourcePostedAtText ?? null,
          incomingPostedAt,
          incomingUpdatedAt,
          nowIso,
          nowIso,
          recordStatus,
          nowIso,
          nowIso
        );

      const newJobEntry = {
        id: jobId,
        company_id: companyId,
        company_name: companyName,
        primary_source_id: source.id,
        title,
        description_text: descriptionText,
        description_hash: descriptionHash,
        location_text: item.locationText ?? null,
        workplace_type: workplaceType,
        employer_posted_at: incomingPostedAt,
        date_conflict_json: null,
        first_seen_at: nowIso,
        status: initialStatus,
        canonical_url: incomingCanonicalUrl,
        apply_url: incomingApplyUrl,
      };

      // (3) Exact company + normalized title + compatible location -> candidate duplicate (no auto-merge)
      // (4) Fuzzy title/description similarity -> candidate duplicate (no auto-merge)
      duplicateCandidatesCreated += detectDuplicateCandidatesForJobSync(
        sqlite,
        newJobEntry,
        activeJobs,
        nowIso
      );

      activeJobs.push(newJobEntry);
      activeJobMap.set(jobId, newJobEntry);
      if (candCanonicalUrl) urlToJobId.set(candCanonicalUrl, jobId);
      if (candApplyUrl) urlToJobId.set(candApplyUrl, jobId);
      if (candSourceUrl) urlToJobId.set(candSourceUrl, jobId);

      newCount++;
      touchedJobIds.add(jobId);
    }

    // Section 7.7 Closure rules: ONLY when batch.isCompleteSnapshot === true and not 304 Not Modified
    if (batch.isCompleteSnapshot && !batch.notModified) {
      const intervalMs = Math.max(1, source.refreshIntervalMinutes) * 60_000;
      const existingSourceRecords = sqlite
        .prepare(
          `SELECT id, job_id, external_id, missing_run_count, record_status, last_seen_at, updated_at
           FROM job_source_records
           WHERE source_id = ? AND record_status != 'closed'`
        )
        .all(source.id) as Array<{
        id: string;
        job_id: string;
        external_id: string;
        missing_run_count: number;
        record_status: "open" | "possibly_closed" | "closed";
        last_seen_at: string;
        updated_at: string;
      }>;

      for (const rec of existingSourceRecords) {
        if (seenExternalIds.has(rec.external_id)) {
          continue;
        }

        const canonicalJobId =
          resolveCanonicalJobIdSync(sqlite, rec.job_id) ?? rec.job_id;

        if (rec.record_status === "open" || rec.missing_run_count === 0) {
          sqlite
            .prepare(
              `UPDATE job_source_records
               SET missing_run_count = 1,
                   record_status = 'possibly_closed',
                   updated_at = ?
               WHERE id = ?`
            )
            .run(nowIso, rec.id);

          const { previousStatus, newStatus } = recomputeCanonicalJobStatusSync(
            sqlite,
            canonicalJobId,
            nowIso
          );
          if (newStatus === "possibly_closed" && previousStatus !== "possibly_closed") {
            possiblyClosedCount++;
          }
          touchedJobIds.add(canonicalJobId);
        } else {
          // Already missing in at least 1 complete snapshot (`possibly_closed`).
          // Close only when separated from the prior missing snapshot by the source's refresh interval.
          const firstMissingMs = Date.parse(rec.updated_at);
          const elapsedSinceFirstMissing = Number.isNaN(firstMissingMs)
            ? intervalMs
            : nowMs - firstMissingMs;

          if (elapsedSinceFirstMissing >= intervalMs) {
            sqlite
              .prepare(
                `UPDATE job_source_records
                 SET missing_run_count = missing_run_count + 1,
                     record_status = 'closed',
                     updated_at = ?
                 WHERE id = ?`
              )
              .run(nowIso, rec.id);

            const { previousStatus, newStatus } = recomputeCanonicalJobStatusSync(
              sqlite,
              canonicalJobId,
              nowIso
            );
            if (newStatus === "closed" && previousStatus !== "closed") {
              closedCount++;
            }
            touchedJobIds.add(canonicalJobId);
          } else {
            // Keep updated_at anchored at the initial missing snapshot until interval elapses
            sqlite
              .prepare(
                `UPDATE job_source_records
                 SET missing_run_count = missing_run_count + 1
                 WHERE id = ?`
              )
              .run(rec.id);
          }
        }
      }
    }

    return {
      fetchedCount: batch.jobs.length,
      newCount,
      updatedCount,
      reopenedCount,
      closedCount,
      possiblyClosedCount,
      autoMergedCount,
      duplicateCandidatesCreated,
      touchedJobIds: Array.from(touchedJobIds),
    };
  });

  return tx.immediate();
}

function ensureManualSourceSync(sqlite: SqliteDatabase, nowIso: string): SourceRecordForIngestion {
  const existing = sqlite
    .prepare(
      `SELECT id, source_type, display_name, company_id, refresh_interval_minutes, last_successful_full_scan_at
       FROM job_sources
       WHERE source_type = 'manual'
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get() as
    | {
        id: string;
        source_type: SourceType;
        display_name: string;
        company_id: string | null;
        refresh_interval_minutes: number;
        last_successful_full_scan_at: string | null;
      }
    | undefined;

  if (existing) {
    return {
      id: existing.id,
      sourceType: existing.source_type,
      displayName: existing.display_name,
      companyId: existing.company_id,
      refreshIntervalMinutes: existing.refresh_interval_minutes,
      lastSuccessfulFullScanAt: existing.last_successful_full_scan_at,
    };
  }

  const manualSourceId = "manual-imports";
  sqlite
    .prepare(
      `INSERT INTO job_sources (
        id, source_type, display_name, source_identifier, config_json,
        enabled, refresh_interval_minutes, health_state, created_at, updated_at
      ) VALUES (?, 'manual', 'Manual Imports', 'manual', '{}', 0, 360, 'healthy', ?, ?)`
    )
    .run(manualSourceId, nowIso, nowIso);

  return {
    id: manualSourceId,
    sourceType: "manual",
    displayName: "Manual Imports",
    companyId: null,
    refreshIntervalMinutes: 360,
    lastSuccessfulFullScanAt: null,
  };
}

/**
 * Imports a manually pasted job description and/or a public job URL.
 * Never fetches restricted sites (LinkedIn/Naukri) when description text is pasted;
 * blocks automated fetching of restricted URLs with RESTRICTED_SOURCE.
 */
export async function ingestManualJob(
  rawInput: ManualJobImportInput,
  db: AppDatabase = getDb(),
  sqliteArg?: SqliteDatabase,
  transportOptions?: {
    fetchImpl?: typeof fetch;
    lookup?: DnsLookupFn;
    timeoutMs?: number;
  }
) {
  const input = ManualJobImportSchema.parse(rawInput);
  const { db: resolvedDb, sqlite } = resolveDbAndSqlite(db, sqliteArg);

  const referenceUrl = validateOptionalReferenceUrl(
    input.url ?? input.canonicalUrl
  );
  const applyUrl = validateOptionalReferenceUrl(input.applyUrl);
  const postedAt = input.employerPostedAt
    ? toIsoOrNull(input.employerPostedAt)
    : null;

  if (input.employerPostedAt && !postedAt) {
    throw new JobServiceError(
      "VALIDATION_ERROR",
      400,
      "employerPostedAt must be a valid ISO-8601 date/time string."
    );
  }

  let normalized;
  try {
    normalized = await parseManualJobImport({
      url: referenceUrl,
      title: input.title ?? null,
      companyName: input.companyName ?? null,
      locationText: input.locationText ?? null,
      workplaceType: input.workplaceType,
      employmentType: input.employmentType ?? null,
      descriptionText: input.descriptionText ?? null,
      descriptionHtml: input.descriptionHtml ?? null,
      employerPostedAt: postedAt,
      salaryMin: input.salaryMin ?? null,
      salaryMax: input.salaryMax ?? null,
      salaryCurrency: input.salaryCurrency ?? null,
      salaryPeriod: input.salaryPeriod ?? null,
      fetchImpl: transportOptions?.fetchImpl,
      lookup: transportOptions?.lookup,
      timeoutMs: transportOptions?.timeoutMs,
    });
  } catch (err) {
    if (err instanceof ConnectorError) {
      const status =
        err.code === "RESTRICTED_SOURCE"
          ? 403
          : err.code === "NOT_FOUND"
            ? 404
            : err.code === "RATE_LIMITED"
              ? 429
              : err.code === "NETWORK_TIMEOUT"
                ? 504
                : 400;
      throw new JobServiceError(err.code, status, err.message);
    }
    throw err;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const descriptionHash = computeDescriptionHash(normalized.descriptionText);

  const source = sqlite.transaction(() =>
    ensureManualSourceSync(sqlite, nowIso)
  ).immediate();

  const finalCanonicalUrl = normalized.canonicalUrl ?? referenceUrl;
  const finalApplyUrl = applyUrl ?? normalized.applyUrl ?? finalCanonicalUrl;
  const jobSpecificUrl =
    canonicalizeJobSpecificUrl(finalCanonicalUrl) ||
    canonicalizeJobSpecificUrl(finalApplyUrl);

  const externalId = jobSpecificUrl
    ? `url:${crypto.createHash("sha256").update(jobSpecificUrl).digest("hex").slice(0, 32)}`
    : normalized.externalId;

  const batchResult = ingestSourceBatch({
    db: resolvedDb,
    sqlite,
    source,
    now,
    batch: {
      isCompleteSnapshot: false,
      fetchedAt: nowIso,
      jobs: [
        {
          ...normalized,
          externalId,
          descriptionHash,
          countryCode: input.countryCode ?? normalized.countryCode,
          seniorityLevel: input.seniorityLevel ?? null,
          salarySourceType:
            input.salarySourceType ?? normalized.salarySourceType,
          canonicalUrl: finalCanonicalUrl,
          applyUrl: finalApplyUrl,
          sourceUrl: finalCanonicalUrl,
        },
      ],
    },
  });

  const jobId = batchResult.touchedJobIds[0];
  const detail = jobId ? getJobDetail(jobId, resolvedDb) : null;

  return {
    job: detail?.job ?? null,
    detail,
    created: batchResult.newCount > 0,
    deduplicated:
      batchResult.autoMergedCount > 0 || batchResult.updatedCount > 0,
    duplicateCandidatesCreated: batchResult.duplicateCandidatesCreated,
  };
}

function buildSafeFtsQuery(rawQuery: string): string | null {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["*^()[\]{}:]/g, "").trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  return tokens
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(" ");
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function searchJobs(
  filters: SearchJobsFilters = {},
  db: AppDatabase = getDb(),
  sqliteArg?: SqliteDatabase
) {
  const { sqlite } = resolveDbAndSqlite(db, sqliteArg);
  const now = new Date();

  const limit = Math.max(1, Math.min(200, Math.floor(filters.limit ?? 50)));
  const offset = Math.max(0, Math.floor(filters.offset ?? 0));
  const sort: JobSortOption = JOB_SORT_OPTIONS.includes(
    filters.sort as JobSortOption
  )
    ? (filters.sort as JobSortOption)
    : "recommended";

  const ftsQuery = filters.q ? buildSafeFtsQuery(filters.q) : null;
  const searchProfileId = filters.searchProfileId?.trim() || null;

  const whereClauses: string[] = ["j.merged_into_job_id IS NULL"];
  const whereParams: unknown[] = [];

  let fromSql = `FROM jobs j`;
  if (ftsQuery) {
    fromSql += ` JOIN job_fts ON job_fts.rowid = j.rowid`;
    whereClauses.push(`job_fts MATCH ?`);
    whereParams.push(ftsQuery);
  }

  if (searchProfileId) {
    fromSql += `
      LEFT JOIN match_runs mr ON mr.id = (
        SELECT mr2.id FROM match_runs mr2
        WHERE mr2.job_id = j.id AND mr2.search_profile_id = ?
        ORDER BY mr2.created_at DESC
        LIMIT 1
      )
      LEFT JOIN user_job_states ujs
        ON ujs.job_id = j.id AND ujs.search_profile_id = ?`;
  } else {
    fromSql += `
      LEFT JOIN match_runs mr ON mr.id = (
        SELECT mr2.id FROM match_runs mr2
        WHERE mr2.job_id = j.id
        ORDER BY mr2.created_at DESC
        LIMIT 1
      )`;
  }

  fromSql += `
    LEFT JOIN job_compensation_overrides jco ON jco.job_id = j.id`;

  if (filters.sourceId) {
    whereClauses.push(
      `(j.primary_source_id = ? OR EXISTS (SELECT 1 FROM job_source_records jsr WHERE jsr.job_id = j.id AND jsr.source_id = ?))`
    );
    whereParams.push(filters.sourceId, filters.sourceId);
  }

  if (filters.company && filters.company.trim().length > 0) {
    const comp = filters.company.trim();
    whereClauses.push(
      `(j.company_id = ? OR LOWER(j.company_name) LIKE '%' || LOWER(?) || '%' ESCAPE '\\')`
    );
    whereParams.push(comp, escapeLikePattern(comp));
  }

  if (filters.workplaceType) {
    const list = Array.isArray(filters.workplaceType)
      ? filters.workplaceType
      : [filters.workplaceType];
    if (list.length > 0) {
      whereClauses.push(
        `j.workplace_type IN (${list.map(() => "?").join(", ")})`
      );
      whereParams.push(...list);
    }
  }

  if (filters.employmentType) {
    const list = (
      Array.isArray(filters.employmentType)
        ? filters.employmentType
        : [filters.employmentType]
    )
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (list.length > 0) {
      whereClauses.push(
        `LOWER(COALESCE(j.employment_type, '')) IN (${list.map(() => "?").join(", ")})`
      );
      whereParams.push(...list);
    }
  }

  if (filters.status) {
    const list = Array.isArray(filters.status) ? filters.status : [filters.status];
    if (list.length > 0) {
      whereClauses.push(`j.status IN (${list.map(() => "?").join(", ")})`);
      whereParams.push(...list);
    }
  }

  if (filters.salaryPresent === true) {
    whereClauses.push(
      `(j.salary_min IS NOT NULL OR j.salary_max IS NOT NULL OR jco.min_amount IS NOT NULL OR jco.max_amount IS NOT NULL)`
    );
  } else if (filters.salaryPresent === false) {
    whereClauses.push(
      `(j.salary_min IS NULL AND j.salary_max IS NULL AND jco.min_amount IS NULL AND jco.max_amount IS NULL)`
    );
  }

  if (filters.postedSince) {
    whereClauses.push(
      `j.employer_posted_at IS NOT NULL AND j.employer_posted_at >= ?`
    );
    whereParams.push(filters.postedSince);
  }

  if (filters.firstSeenSince) {
    whereClauses.push(`j.first_seen_at >= ?`);
    whereParams.push(filters.firstSeenSince);
  }

  if (filters.discoveryState && filters.discoveryState !== "all") {
    if (searchProfileId) {
      if (filters.discoveryState === "unreviewed") {
        whereClauses.push(`ujs.discovery_state IS NULL`);
      } else if (filters.discoveryState === "active") {
        whereClauses.push(
          `(ujs.discovery_state IS NULL OR ujs.discovery_state = 'saved')`
        );
      } else {
        whereClauses.push(`ujs.discovery_state = ?`);
        whereParams.push(filters.discoveryState);
      }
    } else if (filters.discoveryState === "unreviewed") {
      whereClauses.push(
        `NOT EXISTS (SELECT 1 FROM user_job_states ujs2 WHERE ujs2.job_id = j.id)`
      );
    } else if (filters.discoveryState === "active") {
      whereClauses.push(
        `NOT EXISTS (SELECT 1 FROM user_job_states ujs2 WHERE ujs2.job_id = j.id AND ujs2.discovery_state IN ('dismissed', 'hidden'))`
      );
    } else {
      whereClauses.push(
        `EXISTS (SELECT 1 FROM user_job_states ujs2 WHERE ujs2.job_id = j.id AND ujs2.discovery_state = ?)`
      );
      whereParams.push(filters.discoveryState);
    }
  }

  const joinParams: unknown[] = searchProfileId
    ? [searchProfileId, searchProfileId]
    : [];

  const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

  const countRow = sqlite
    .prepare(`SELECT COUNT(*) AS total ${fromSql} ${whereSql}`)
    .get(...joinParams, ...whereParams) as { total: number };

  let orderBySql: string;
  switch (sort) {
    case "documented_fit":
      orderBySql = `(mr.documented_fit_score IS NULL) ASC, mr.documented_fit_score DESC, COALESCE(j.employer_posted_at, j.first_seen_at) DESC, j.created_at DESC`;
      break;
    case "employer_posted_at":
      orderBySql = `(j.employer_posted_at IS NULL) ASC, j.employer_posted_at DESC, j.first_seen_at DESC, j.created_at DESC`;
      break;
    case "first_seen_at":
      orderBySql = `j.first_seen_at DESC, j.created_at DESC`;
      break;
    case "company_title":
      orderBySql = `LOWER(j.company_name) ASC, LOWER(j.title) ASC, j.created_at DESC`;
      break;
    case "recommended":
    default:
      orderBySql = ftsQuery
        ? `(mr.priority_score IS NULL) ASC, mr.priority_score DESC, bm25(job_fts) ASC, COALESCE(j.employer_posted_at, j.first_seen_at) DESC, j.created_at DESC`
        : `(mr.priority_score IS NULL) ASC, mr.priority_score DESC, COALESCE(j.employer_posted_at, j.first_seen_at) DESC, j.created_at DESC`;
      break;
  }

  const discoverySelect = searchProfileId
    ? `ujs.discovery_state AS discovery_state`
    : `(SELECT ujs2.discovery_state FROM user_job_states ujs2 WHERE ujs2.job_id = j.id ORDER BY ujs2.updated_at DESC LIMIT 1) AS discovery_state`;

  const rows = sqlite
    .prepare(
      `SELECT
        j.id,
        j.company_id,
        j.company_name,
        j.primary_source_id,
        j.title,
        j.location_text,
        j.country_code,
        j.workplace_type,
        j.employment_type,
        j.seniority_level,
        j.salary_min,
        j.salary_max,
        j.salary_currency,
        j.salary_period,
        j.salary_source_type,
        j.employer_posted_at,
        j.date_conflict_json,
        j.source_updated_at,
        j.first_seen_at,
        j.last_seen_at,
        j.last_verified_at,
        j.status,
        j.canonical_url,
        j.apply_url,
        j.analysis_status,
        j.created_at,
        j.updated_at,
        jco.min_amount AS override_salary_min,
        jco.max_amount AS override_salary_max,
        jco.currency AS override_salary_currency,
        jco.period AS override_salary_period,
        mr.documented_fit_score,
        mr.search_skill_alignment_score,
        mr.priority_score,
        mr.hard_filter_passed,
        mr.hard_filter_status,
        ${discoverySelect}
      ${fromSql}
      ${whereSql}
      ORDER BY ${orderBySql}
      LIMIT ? OFFSET ?`
    )
    .all(...joinParams, ...whereParams, limit, offset) as Array<{
    id: string;
    company_id: string | null;
    company_name: string;
    primary_source_id: string | null;
    title: string;
    location_text: string | null;
    country_code: string | null;
    workplace_type: WorkplaceType;
    employment_type: string | null;
    seniority_level: string | null;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string | null;
    salary_period: SalaryPeriod | null;
    salary_source_type: string | null;
    employer_posted_at: string | null;
    date_conflict_json: string | null;
    source_updated_at: string | null;
    first_seen_at: string;
    last_seen_at: string;
    last_verified_at: string;
    status: JobStatus;
    canonical_url: string | null;
    apply_url: string | null;
    analysis_status: string;
    created_at: string;
    updated_at: string;
    override_salary_min: number | null;
    override_salary_max: number | null;
    override_salary_currency: string | null;
    override_salary_period: SalaryPeriod | null;
    documented_fit_score: number | null;
    search_skill_alignment_score: number | null;
    priority_score: number | null;
    hard_filter_passed: number | null;
    hard_filter_status: string | null;
    discovery_state: UserJobDiscoveryState | null;
  }>;

  const items = rows.map((row) => {
    let dateConflict: DateConflictRecord | null = null;
    if (row.date_conflict_json) {
      try {
        dateConflict = JSON.parse(row.date_conflict_json) as DateConflictRecord;
      } catch {
        dateConflict = null;
      }
    }

    return {
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      primarySourceId: row.primary_source_id,
      title: row.title,
      locationText: row.location_text,
      countryCode: row.country_code,
      workplaceType: row.workplace_type,
      employmentType: row.employment_type,
      seniorityLevel: row.seniority_level,
      salaryMin: row.salary_min,
      salaryMax: row.salary_max,
      salaryCurrency: row.salary_currency,
      salaryPeriod: row.salary_period,
      salarySourceType: row.salary_source_type,
      compensationOverride:
        row.override_salary_min !== null || row.override_salary_max !== null
          ? {
              minAmount: row.override_salary_min,
              maxAmount: row.override_salary_max,
              currency: row.override_salary_currency,
              period: row.override_salary_period,
            }
          : null,
      employerPostedAt: row.employer_posted_at,
      freshnessLabel: computeFreshnessLabel(row.employer_posted_at, now),
      dateConflict,
      sourceUpdatedAt: row.source_updated_at,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      lastVerifiedAt: row.last_verified_at,
      status: row.status,
      canonicalUrl: row.canonical_url,
      applyUrl: row.apply_url,
      analysisStatus: row.analysis_status,
      discoveryState: row.discovery_state ?? null,
      match:
        row.documented_fit_score !== null ||
        row.priority_score !== null ||
        row.hard_filter_status !== null
          ? {
              documentedFitScore: row.documented_fit_score,
              searchSkillAlignmentScore: row.search_skill_alignment_score,
              priorityScore: row.priority_score,
              hardFilterPassed:
                row.hard_filter_passed === null
                  ? true
                  : Boolean(row.hard_filter_passed),
              hardFilterStatus: row.hard_filter_status ?? "eligible",
            }
          : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return {
    items,
    total: countRow.total,
    limit,
    offset,
  };
}

/**
 * Loads full job detail, following `mergedIntoJobId` alias redirects cleanly.
 */
export function getJobDetail(
  id: string,
  db: AppDatabase = getDb(),
  options?: { searchProfileId?: string }
) {
  let current = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!current) {
    return null;
  }

  let redirectedFromJobId: string | null = null;
  const visited = new Set<string>([current.id]);

  while (current.mergedIntoJobId) {
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
    redirectedFromJobId = redirectedFromJobId ?? id;
    current = nextJob;
  }

  const canonicalJobId = current.id;

  const company = current.companyId
    ? db
        .select()
        .from(companies)
        .where(eq(companies.id, current.companyId))
        .get() ?? null
    : null;

  const sourceRecordRows = db
    .select({
      id: jobSourceRecords.id,
      jobId: jobSourceRecords.jobId,
      sourceId: jobSourceRecords.sourceId,
      externalId: jobSourceRecords.externalId,
      sourceUrl: jobSourceRecords.sourceUrl,
      applyUrl: jobSourceRecords.applyUrl,
      sourcePostedAtText: jobSourceRecords.sourcePostedAtText,
      sourcePostedAt: jobSourceRecords.sourcePostedAt,
      sourceUpdatedAt: jobSourceRecords.sourceUpdatedAt,
      firstSeenAt: jobSourceRecords.firstSeenAt,
      lastSeenAt: jobSourceRecords.lastSeenAt,
      missingRunCount: jobSourceRecords.missingRunCount,
      recordStatus: jobSourceRecords.recordStatus,
      createdAt: jobSourceRecords.createdAt,
      updatedAt: jobSourceRecords.updatedAt,
      sourceDisplayName: jobSources.displayName,
      sourceType: jobSources.sourceType,
    })
    .from(jobSourceRecords)
    .leftJoin(jobSources, eq(jobSourceRecords.sourceId, jobSources.id))
    .where(eq(jobSourceRecords.jobId, canonicalJobId))
    .orderBy(asc(jobSourceRecords.firstSeenAt))
    .all();

  const requirements = db
    .select()
    .from(jobRequirements)
    .where(eq(jobRequirements.jobId, canonicalJobId))
    .orderBy(asc(jobRequirements.sortOrder), asc(jobRequirements.createdAt))
    .all();

  const compensationOverride =
    db
      .select()
      .from(jobCompensationOverrides)
      .where(eq(jobCompensationOverrides.jobId, canonicalJobId))
      .get() ?? null;

  const allUserJobStates = db
    .select()
    .from(userJobStates)
    .where(eq(userJobStates.jobId, canonicalJobId))
    .all();

  const userJobState = options?.searchProfileId
    ? allUserJobStates.find(
        (s) => s.searchProfileId === options.searchProfileId
      ) ?? null
    : allUserJobStates[0] ?? null;

  const allApplications = db
    .select()
    .from(applications)
    .where(eq(applications.jobId, canonicalJobId))
    .all();

  const application = options?.searchProfileId
    ? allApplications.find(
        (a) => a.searchProfileId === options.searchProfileId
      ) ?? null
    : allApplications[0] ?? null;

  const latestMatch = options?.searchProfileId
    ? db
        .select()
        .from(matchRuns)
        .where(
          and(
            eq(matchRuns.jobId, canonicalJobId),
            eq(matchRuns.searchProfileId, options.searchProfileId)
          )
        )
        .orderBy(desc(matchRuns.createdAt))
        .get() ?? null
    : db
        .select()
        .from(matchRuns)
        .where(eq(matchRuns.jobId, canonicalJobId))
        .orderBy(desc(matchRuns.createdAt))
        .get() ?? null;

  const duplicateCandidateRows = db
    .select()
    .from(jobDuplicateCandidates)
    .where(
      and(
        eq(jobDuplicateCandidates.state, "proposed"),
        or(
          eq(jobDuplicateCandidates.jobAId, canonicalJobId),
          eq(jobDuplicateCandidates.jobBId, canonicalJobId)
        )
      )
    )
    .orderBy(desc(jobDuplicateCandidates.similarityScore))
    .all();

  const otherJobIds = duplicateCandidateRows.map((c) =>
    c.jobAId === canonicalJobId ? c.jobBId : c.jobAId
  );

  const otherJobsMap = new Map<
    string,
    {
      id: string;
      title: string;
      companyName: string;
      locationText: string | null;
      status: JobStatus;
      canonicalUrl: string | null;
      firstSeenAt: string;
      employerPostedAt: string | null;
    }
  >();

  if (otherJobIds.length > 0) {
    const otherRows = db
      .select({
        id: jobs.id,
        title: jobs.title,
        companyName: jobs.companyName,
        locationText: jobs.locationText,
        status: jobs.status,
        canonicalUrl: jobs.canonicalUrl,
        firstSeenAt: jobs.firstSeenAt,
        employerPostedAt: jobs.employerPostedAt,
      })
      .from(jobs)
      .where(inArray(jobs.id, otherJobIds))
      .all();
    for (const r of otherRows) {
      otherJobsMap.set(r.id, r);
    }
  }

  let dateConflict: DateConflictRecord | null = null;
  if (current.dateConflictJson) {
    try {
      dateConflict = JSON.parse(current.dateConflictJson) as DateConflictRecord;
    } catch {
      dateConflict = null;
    }
  }

  return {
    redirectedFromJobId,
    job: {
      ...current,
      freshnessLabel: computeFreshnessLabel(current.employerPostedAt),
      dateConflict,
    },
    company,
    jobSourceRecords: sourceRecordRows,
    requirements,
    compensationOverride,
    userJobState,
    userJobStates: allUserJobStates,
    application,
    applications: allApplications,
    latestMatch,
    duplicateCandidates: duplicateCandidateRows.map((cand) => {
      const otherJobId =
        cand.jobAId === canonicalJobId ? cand.jobBId : cand.jobAId;
      return {
        id: cand.id,
        jobAId: cand.jobAId,
        jobBId: cand.jobBId,
        matchMethod: cand.matchMethod,
        similarityScore: cand.similarityScore,
        state: cand.state,
        evidence: safeParseJson(cand.evidenceJson),
        otherJob: otherJobsMap.get(otherJobId) ?? null,
        createdAt: cand.createdAt,
      };
    }),
  };
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function resolveDefaultSearchProfileId(db: AppDatabase): string {
  const first = db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .orderBy(asc(searchProfiles.createdAt))
    .get();
  if (first) {
    return first.id;
  }
  throw new JobServiceError(
    "SEARCH_PROFILE_NOT_FOUND",
    404,
    "No search profile exists."
  );
}

/**
 * Sets or clears a user's discovery state (`saved`, `dismissed`, `hidden`, or `active`) for a job and search profile.
 */
export function setUserJobState(
  input: {
    jobId: string;
    searchProfileId?: string;
    state: UserJobStateInputValue;
    notes?: string | null;
  },
  db: AppDatabase = getDb()
) {
  const parsed = SetUserJobStateSchema.parse({
    searchProfileId: input.searchProfileId,
    state: input.state,
    notes: input.notes,
  });

  const { sqlite } = resolveDbAndSqlite(db);
  const canonicalJobId = resolveCanonicalJobIdSync(sqlite, input.jobId);
  if (!canonicalJobId) {
    throw new JobServiceError(
      "JOB_NOT_FOUND",
      404,
      `Job not found: ${input.jobId}`
    );
  }

  const profileId = parsed.searchProfileId
    ? (() => {
        const sp = db
          .select({ id: searchProfiles.id })
          .from(searchProfiles)
          .where(eq(searchProfiles.id, parsed.searchProfileId!))
          .get();
        if (!sp) {
          throw new JobServiceError(
            "SEARCH_PROFILE_NOT_FOUND",
            404,
            `Search profile not found: ${parsed.searchProfileId}`
          );
        }
        return sp.id;
      })()
    : resolveDefaultSearchProfileId(db);

  const nowIso = new Date().toISOString();

  if (parsed.state === "active") {
    db.delete(userJobStates)
      .where(
        and(
          eq(userJobStates.jobId, canonicalJobId),
          eq(userJobStates.searchProfileId, profileId)
        )
      )
      .run();

    return {
      jobId: canonicalJobId,
      searchProfileId: profileId,
      discoveryState: null,
      notes: null,
      updatedAt: nowIso,
    };
  }

  const existing = db
    .select()
    .from(userJobStates)
    .where(
      and(
        eq(userJobStates.jobId, canonicalJobId),
        eq(userJobStates.searchProfileId, profileId)
      )
    )
    .get();

  const nextNotes =
    parsed.notes !== undefined ? parsed.notes : existing?.notes ?? null;

  if (existing) {
    db.update(userJobStates)
      .set({
        discoveryState: parsed.state,
        notes: nextNotes,
        updatedAt: nowIso,
      })
      .where(eq(userJobStates.id, existing.id))
      .run();

    return {
      id: existing.id,
      jobId: canonicalJobId,
      searchProfileId: profileId,
      discoveryState: parsed.state,
      notes: nextNotes,
      updatedAt: nowIso,
    };
  }

  const newId = crypto.randomUUID();
  db.insert(userJobStates)
    .values({
      id: newId,
      jobId: canonicalJobId,
      searchProfileId: profileId,
      discoveryState: parsed.state,
      notes: nextNotes,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();

  return {
    id: newId,
    jobId: canonicalJobId,
    searchProfileId: profileId,
    discoveryState: parsed.state,
    notes: nextNotes,
    updatedAt: nowIso,
  };
}

/**
 * Lists duplicate candidate pairs for review (defaulting to `proposed` candidates).
 */
export function listDuplicateCandidates(
  db: AppDatabase = getDb(),
  options?: { state?: DuplicateState | "all"; limit?: number; offset?: number }
) {
  const stateFilter = options?.state ?? "proposed";
  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 100)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));

  const candidates =
    stateFilter === "all"
      ? db
          .select()
          .from(jobDuplicateCandidates)
          .orderBy(
            desc(jobDuplicateCandidates.similarityScore),
            desc(jobDuplicateCandidates.createdAt)
          )
          .limit(limit)
          .offset(offset)
          .all()
      : db
          .select()
          .from(jobDuplicateCandidates)
          .where(eq(jobDuplicateCandidates.state, stateFilter))
          .orderBy(
            desc(jobDuplicateCandidates.similarityScore),
            desc(jobDuplicateCandidates.createdAt)
          )
          .limit(limit)
          .offset(offset)
          .all();

  const jobIds = Array.from(
    new Set(candidates.flatMap((c) => [c.jobAId, c.jobBId]))
  );

  const jobMap = new Map<
    string,
    {
      id: string;
      title: string;
      companyName: string;
      locationText: string | null;
      workplaceType: WorkplaceType;
      status: JobStatus;
      canonicalUrl: string | null;
      applyUrl: string | null;
      employerPostedAt: string | null;
      firstSeenAt: string;
      mergedIntoJobId: string | null;
    }
  >();

  if (jobIds.length > 0) {
    const rows = db
      .select({
        id: jobs.id,
        title: jobs.title,
        companyName: jobs.companyName,
        locationText: jobs.locationText,
        workplaceType: jobs.workplaceType,
        status: jobs.status,
        canonicalUrl: jobs.canonicalUrl,
        applyUrl: jobs.applyUrl,
        employerPostedAt: jobs.employerPostedAt,
        firstSeenAt: jobs.firstSeenAt,
        mergedIntoJobId: jobs.mergedIntoJobId,
      })
      .from(jobs)
      .where(inArray(jobs.id, jobIds))
      .all();

    for (const r of rows) {
      jobMap.set(r.id, r);
    }
  }

  return candidates.map((c) => ({
    id: c.id,
    jobAId: c.jobAId,
    jobBId: c.jobBId,
    matchMethod: c.matchMethod,
    similarityScore: c.similarityScore,
    state: c.state,
    evidence: safeParseJson(c.evidenceJson),
    jobA: jobMap.get(c.jobAId) ?? null,
    jobB: jobMap.get(c.jobBId) ?? null,
    createdAt: c.createdAt,
    dismissedAt: c.dismissedAt,
    resolvedAt: c.resolvedAt,
  }));
}

/**
 * Transactionally merges a reviewed duplicate candidate pair per Section 7.8.
 * Re-parents source records, requirements, matches, and discovery states (saved > hidden > dismissed),
 * aborts with 409 Conflict if both jobs have applications for the same search profile,
 * sets `merged_into_job_id`, and removes the merged alias from `job_fts`.
 */
export function mergeDuplicateCandidate(
  candidateId: string,
  input: { keepJobId: string },
  db: AppDatabase = getDb(),
  sqliteArg?: SqliteDatabase
) {
  const parsedInput = MergeDuplicateSchema.parse(input);
  const { sqlite } = resolveDbAndSqlite(db, sqliteArg);
  const nowIso = new Date().toISOString();

  const tx = sqlite.transaction(() => {
    const candidate = sqlite
      .prepare(
        `SELECT id, job_a_id, job_b_id, match_method, evidence_json, similarity_score, state
         FROM job_duplicate_candidates
         WHERE id = ?`
      )
      .get(candidateId) as
      | {
          id: string;
          job_a_id: string;
          job_b_id: string;
          match_method: string;
          evidence_json: string;
          similarity_score: number;
          state: DuplicateState;
        }
      | undefined;

    if (!candidate) {
      throw new JobServiceError(
        "DUPLICATE_CANDIDATE_NOT_FOUND",
        404,
        `Duplicate candidate not found: ${candidateId}`
      );
    }

    if (candidate.state === "merged") {
      throw new JobServiceError(
        "DUPLICATE_ALREADY_MERGED",
        409,
        "Duplicate candidate has already been merged."
      );
    }

    const keepJobId = parsedInput.keepJobId;
    if (keepJobId !== candidate.job_a_id && keepJobId !== candidate.job_b_id) {
      throw new JobServiceError(
        "VALIDATION_ERROR",
        400,
        "keepJobId must be one of the two jobs in the duplicate candidate pair."
      );
    }

    const mergeFromJobId =
      keepJobId === candidate.job_a_id ? candidate.job_b_id : candidate.job_a_id;

    const keepJob = sqlite
      .prepare(`SELECT * FROM jobs WHERE id = ?`)
      .get(keepJobId) as Record<string, unknown> | undefined;
    const mergeFromJob = sqlite
      .prepare(`SELECT * FROM jobs WHERE id = ?`)
      .get(mergeFromJobId) as Record<string, unknown> | undefined;

    if (!keepJob || !mergeFromJob) {
      throw new JobServiceError(
        "JOB_NOT_FOUND",
        404,
        "One or both jobs in the duplicate pair no longer exist."
      );
    }

    if (keepJob.merged_into_job_id) {
      throw new JobServiceError(
        "JOB_ALREADY_MERGED",
        409,
        "The selected keepJobId is already merged into another job."
      );
    }
    if (mergeFromJob.merged_into_job_id) {
      throw new JobServiceError(
        "JOB_ALREADY_MERGED",
        409,
        "The source job in this pair is already merged into another job."
      );
    }

    // 1. Application conflict check per Section 7.8
    const keepApps = sqlite
      .prepare(`SELECT id, search_profile_id FROM applications WHERE job_id = ?`)
      .all(keepJobId) as Array<{ id: string; search_profile_id: string }>;
    const mergeFromApps = sqlite
      .prepare(`SELECT id, search_profile_id FROM applications WHERE job_id = ?`)
      .all(mergeFromJobId) as Array<{ id: string; search_profile_id: string }>;

    const keepProfiles = new Set(keepApps.map((a) => a.search_profile_id));
    const conflictingProfiles = mergeFromApps
      .filter((a) => keepProfiles.has(a.search_profile_id))
      .map((a) => a.search_profile_id);

    if (conflictingProfiles.length > 0) {
      throw new JobServiceError(
        "DUPLICATE_APPLICATION_CONFLICT",
        409,
        "Cannot merge jobs because both have applications for the same search profile. Resolve manually."
      );
    }

    // Re-parent non-conflicting applications & related documents
    sqlite
      .prepare(`UPDATE applications SET job_id = ?, updated_at = ? WHERE job_id = ?`)
      .run(keepJobId, nowIso, mergeFromJobId);
    sqlite
      .prepare(`UPDATE resume_drafts SET job_id = ?, updated_at = ? WHERE job_id = ?`)
      .run(keepJobId, nowIso, mergeFromJobId);
    sqlite
      .prepare(`UPDATE resume_versions SET job_id = ? WHERE job_id = ?`)
      .run(keepJobId, mergeFromJobId);
    sqlite
      .prepare(`UPDATE cover_letters SET job_id = ?, updated_at = ? WHERE job_id = ?`)
      .run(keepJobId, nowIso, mergeFromJobId);
    sqlite
      .prepare(`UPDATE application_answers SET job_id = ?, updated_at = ? WHERE job_id = ?`)
      .run(keepJobId, nowIso, mergeFromJobId);

    // 2. Re-parent job_source_records
    sqlite
      .prepare(
        `UPDATE job_source_records SET job_id = ?, updated_at = ? WHERE job_id = ?`
      )
      .run(keepJobId, nowIso, mergeFromJobId);

    // 3. Re-parent job_requirements (avoiding duplicate stable_signature entries)
    const keepSigs = new Set(
      (
        sqlite
          .prepare(`SELECT stable_signature FROM job_requirements WHERE job_id = ?`)
          .all(keepJobId) as Array<{ stable_signature: string }>
      ).map((r) => r.stable_signature)
    );
    const mergeFromReqs = sqlite
      .prepare(`SELECT id, stable_signature FROM job_requirements WHERE job_id = ?`)
      .all(mergeFromJobId) as Array<{ id: string; stable_signature: string }>;

    for (const reqRow of mergeFromReqs) {
      if (keepSigs.has(reqRow.stable_signature)) {
        sqlite.prepare(`DELETE FROM job_requirements WHERE id = ?`).run(reqRow.id);
      } else {
        sqlite
          .prepare(`UPDATE job_requirements SET job_id = ?, updated_at = ? WHERE id = ?`)
          .run(keepJobId, nowIso, reqRow.id);
        keepSigs.add(reqRow.stable_signature);
      }
    }

    // 4. Re-parent match_runs
    sqlite
      .prepare(`UPDATE match_runs SET job_id = ? WHERE job_id = ?`)
      .run(keepJobId, mergeFromJobId);

    // 5. Re-parent compensation override if keepJob has none
    const keepComp = sqlite
      .prepare(`SELECT id FROM job_compensation_overrides WHERE job_id = ?`)
      .get(keepJobId) as { id: string } | undefined;
    if (!keepComp) {
      sqlite
        .prepare(
          `UPDATE job_compensation_overrides SET job_id = ?, updated_at = ? WHERE job_id = ?`
        )
        .run(keepJobId, nowIso, mergeFromJobId);
    } else {
      sqlite
        .prepare(`DELETE FROM job_compensation_overrides WHERE job_id = ?`)
        .run(mergeFromJobId);
    }

    // 6. Merge user_job_states by precedence saved > hidden > dismissed and preserve both notes
    const mergeFromStates = sqlite
      .prepare(`SELECT * FROM user_job_states WHERE job_id = ?`)
      .all(mergeFromJobId) as Array<{
      id: string;
      search_profile_id: string;
      discovery_state: UserJobDiscoveryState;
      notes: string | null;
    }>;

    const mergedStateAudit: Array<{
      searchProfileId: string;
      keptState: UserJobDiscoveryState;
      mergedState: UserJobDiscoveryState;
      keepNotes: string | null;
      mergedNotes: string | null;
    }> = [];

    for (const srcState of mergeFromStates) {
      const targetState = sqlite
        .prepare(
          `SELECT id, discovery_state, notes FROM user_job_states WHERE job_id = ? AND search_profile_id = ?`
        )
        .get(keepJobId, srcState.search_profile_id) as
        | {
            id: string;
            discovery_state: UserJobDiscoveryState;
            notes: string | null;
          }
        | undefined;

      if (!targetState) {
        sqlite
          .prepare(`UPDATE user_job_states SET job_id = ?, updated_at = ? WHERE id = ?`)
          .run(keepJobId, nowIso, srcState.id);
      } else {
        const chosenState =
          DISCOVERY_PRECEDENCE[srcState.discovery_state] >
          DISCOVERY_PRECEDENCE[targetState.discovery_state]
            ? srcState.discovery_state
            : targetState.discovery_state;

        const combinedNotesParts = [targetState.notes, srcState.notes]
          .map((n) => (n ? n.trim() : ""))
          .filter(Boolean);
        const combinedNotes =
          combinedNotesParts.length > 0
            ? Array.from(new Set(combinedNotesParts)).join("\n\n")
            : null;

        sqlite
          .prepare(
            `UPDATE user_job_states SET discovery_state = ?, notes = ?, updated_at = ? WHERE id = ?`
          )
          .run(chosenState, combinedNotes, nowIso, targetState.id);
        sqlite.prepare(`DELETE FROM user_job_states WHERE id = ?`).run(srcState.id);

        mergedStateAudit.push({
          searchProfileId: srcState.search_profile_id,
          keptState: targetState.discovery_state,
          mergedState: srcState.discovery_state,
          keepNotes: targetState.notes,
          mergedNotes: srcState.notes,
        });
      }
    }

    // 7. Update canonical keepJob metadata (firstSeenAt, dates, status)
    const keepFirstSeen = String(keepJob.first_seen_at);
    const mergeFirstSeen = String(mergeFromJob.first_seen_at);
    const earliestFirstSeen =
      mergeFirstSeen < keepFirstSeen ? mergeFirstSeen : keepFirstSeen;

    const keepLastSeen = String(keepJob.last_seen_at);
    const mergeLastSeen = String(mergeFromJob.last_seen_at);
    const latestLastSeen =
      mergeLastSeen > keepLastSeen ? mergeLastSeen : keepLastSeen;

    const dateMerged = mergeDateConflict(
      (keepJob.employer_posted_at as string | null) ?? null,
      (keepJob.date_conflict_json as string | null) ?? null,
      (mergeFromJob.employer_posted_at as string | null) ?? null,
      null,
      (mergeFromJob.primary_source_id as string | null) ?? mergeFromJobId,
      String(mergeFromJob.company_name ?? "Merged source"),
      (keepJob.primary_source_id as string | null) ?? keepJobId
    );

    sqlite
      .prepare(
        `UPDATE jobs
         SET first_seen_at = ?,
             last_seen_at = ?,
             last_verified_at = ?,
             employer_posted_at = ?,
             date_conflict_json = ?,
             canonical_url = COALESCE(canonical_url, ?),
             apply_url = COALESCE(apply_url, ?),
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        earliestFirstSeen,
        latestLastSeen,
        latestLastSeen,
        dateMerged.employerPostedAt,
        dateMerged.dateConflictJson,
        (mergeFromJob.canonical_url as string | null) ?? null,
        (mergeFromJob.apply_url as string | null) ?? null,
        nowIso,
        keepJobId
      );

    recomputeCanonicalJobStatusSync(sqlite, keepJobId, nowIso);

    // 8. Soft-merge alias row and delete merged alias from job_fts AFTER the UPDATE
    // (because jobs_fts_au trigger fires on UPDATE and would re-insert into job_fts)
    sqlite
      .prepare(
        `UPDATE jobs SET merged_into_job_id = ?, merged_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(keepJobId, nowIso, nowIso, mergeFromJobId);

    deleteJobFromFts(sqlite, mergeFromJobId);

    // 9. Clean up / re-point any other duplicate candidates referencing mergeFromJobId
    const otherCandidates = sqlite
      .prepare(
        `SELECT id, job_a_id, job_b_id FROM job_duplicate_candidates
         WHERE id != ? AND (job_a_id = ? OR job_b_id = ?)`
      )
      .all(candidateId, mergeFromJobId, mergeFromJobId) as Array<{
      id: string;
      job_a_id: string;
      job_b_id: string;
    }>;

    for (const oc of otherCandidates) {
      const otherSide =
        oc.job_a_id === mergeFromJobId ? oc.job_b_id : oc.job_a_id;
      if (otherSide === keepJobId) {
        sqlite.prepare(`DELETE FROM job_duplicate_candidates WHERE id = ?`).run(oc.id);
        continue;
      }
      const [newA, newB] = orderedPair(keepJobId, otherSide);
      const conflict = sqlite
        .prepare(
          `SELECT id FROM job_duplicate_candidates WHERE job_a_id = ? AND job_b_id = ?`
        )
        .get(newA, newB) as { id: string } | undefined;
      if (conflict) {
        sqlite.prepare(`DELETE FROM job_duplicate_candidates WHERE id = ?`).run(oc.id);
      } else {
        sqlite
          .prepare(
            `UPDATE job_duplicate_candidates SET job_a_id = ?, job_b_id = ? WHERE id = ?`
          )
          .run(newA, newB, oc.id);
      }
    }

    // 10. Mark candidate merged with audit evidence
    const evidence = safeParseJson(candidate.evidence_json);
    const updatedEvidenceJson = JSON.stringify({
      ...evidence,
      mergeAudit: {
        keepJobId,
        mergedFromJobId: mergeFromJobId,
        mergedAt: nowIso,
        mergedUserJobStates: mergedStateAudit,
      },
    });

    sqlite
      .prepare(
        `UPDATE job_duplicate_candidates
         SET state = 'merged',
             evidence_json = ?,
             resolved_at = ?
         WHERE id = ?`
      )
      .run(updatedEvidenceJson, nowIso, candidateId);

    return {
      candidateId,
      keepJobId,
      mergedFromJobId: mergeFromJobId,
      resolvedAt: nowIso,
      state: "merged" as const,
    };
  });

  return tx.immediate();
}

/**
 * Dismisses a duplicate candidate pair and snapshots both jobs' current description hashes
 * so it will not be re-suggested unless content changes materially.
 */
export function dismissDuplicateCandidate(
  candidateId: string,
  db: AppDatabase = getDb()
) {
  const candidate = db
    .select()
    .from(jobDuplicateCandidates)
    .where(eq(jobDuplicateCandidates.id, candidateId))
    .get();

  if (!candidate) {
    throw new JobServiceError(
      "DUPLICATE_CANDIDATE_NOT_FOUND",
      404,
      `Duplicate candidate not found: ${candidateId}`
    );
  }

  if (candidate.state === "merged") {
    throw new JobServiceError(
      "DUPLICATE_ALREADY_MERGED",
      409,
      "Cannot dismiss a duplicate candidate that has already been merged."
    );
  }

  const jobA = db
    .select({ descriptionHash: jobs.descriptionHash })
    .from(jobs)
    .where(eq(jobs.id, candidate.jobAId))
    .get();
  const jobB = db
    .select({ descriptionHash: jobs.descriptionHash })
    .from(jobs)
    .where(eq(jobs.id, candidate.jobBId))
    .get();

  const nowIso = new Date().toISOString();

  db.update(jobDuplicateCandidates)
    .set({
      state: "dismissed",
      dismissedAt: nowIso,
      jobADescriptionHash: jobA?.descriptionHash ?? candidate.jobADescriptionHash,
      jobBDescriptionHash: jobB?.descriptionHash ?? candidate.jobBDescriptionHash,
    })
    .where(eq(jobDuplicateCandidates.id, candidateId))
    .run();

  return {
    id: candidateId,
    state: "dismissed" as const,
    dismissedAt: nowIso,
  };
}

export function sanitizeJobErrorMessage(message: string): string {
  return redactPaths(redactString(message)).slice(0, 500);
}

import { asc } from "drizzle-orm";
import {
  getDb,
  getSqlite,
  type AppDatabase,
  type SqliteDatabase,
} from "../db/client";
import type { ApplicationStatus } from "../db/schema/applications";
import {
  jobSources,
  type SalaryPeriod,
  type SourceHealthState,
  type SourceType,
  type UserJobDiscoveryState,
  type WorkplaceType,
} from "../db/schema/jobs";
import { redactPaths, redactString } from "../security/redaction";
import { computeFreshnessLabel, type JobFreshnessLabel } from "./jobs";
import {
  listSearchProfiles,
  type SearchProfileRecord,
} from "./search-profiles";
import { getSettings } from "./settings";

export class OverviewServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "OverviewServiceError";
    this.code = code;
    this.status = status;
  }
}

export interface OverviewRecommendationItem {
  jobId: string;
  title: string;
  companyId: string | null;
  companyName: string;
  locationText: string | null;
  countryCode: string | null;
  workplaceType: WorkplaceType;
  employmentType: string | null;
  seniorityLevel: string | null;
  source: {
    id: string;
    displayName: string;
    sourceType: SourceType;
  } | null;
  primarySourceName: string | null;
  postedDateStatus: "known" | "unknown";
  employerPostedAt: string | null;
  freshnessLabel: JobFreshnessLabel;
  firstSeenAt: string;
  documentedFitScore: number | null;
  documentedFitLabel: string;
  searchSkillAlignmentScore: number | null;
  priorityScore: number | null;
  priorityRank: number;
  orderingBasis: "priority" | "basic_relevance";
  rankingMode: "priority" | "basic_relevance";
  analysisStatus: "pending" | "deterministic" | "ai" | "failed";
  includedFactors: string[];
  weightsRenormalized: boolean;
  matchReason: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salarySourceType: "employer_disclosed" | "unknown";
  compensationOverride: {
    minAmount: number | null;
    maxAmount: number | null;
    currency: string | null;
    period: SalaryPeriod | null;
  } | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    period: SalaryPeriod | null;
    source: "employer_disclosed" | "user_supplied" | "unknown";
  };
  discoveryState: UserJobDiscoveryState | null;
  userState: UserJobDiscoveryState | null;
  applicationStatus: ApplicationStatus | null;
  canonicalUrl: string | null;
  applyUrl: string | null;
}

export interface OverviewNeedsAttention {
  totalCount: number;
  draftsAwaitingReviewCount: number;
  applicationsReadyCount: number;
  sourceFailuresCount: number;
  duplicateCandidatesCount: number;
  counts: {
    draftsAwaitingReview: number;
    applicationsReadyToSubmit: number;
    sourceFailures: number;
    pendingDuplicates: number;
  };
  draftsAwaitingReview: Array<{
    draftId: string;
    jobId: string;
    searchProfileId: string;
    jobTitle: string;
    companyName: string;
    searchProfileName: string;
    updatedAt: string;
  }>;
  applicationsReadyToSubmit: Array<{
    applicationId: string;
    jobId: string;
    searchProfileId: string;
    jobTitle: string;
    companyName: string;
    originalApplyUrl: string | null;
    updatedAt: string;
  }>;
  sourceFailures: Array<{
    sourceId: string;
    displayName: string;
    sourceType: SourceType;
    healthState: SourceHealthState;
    consecutiveFailures: number;
    lastErrorCode: string | null;
    lastErrorDetail: string | null;
    lastAttemptAt: string | null;
  }>;
}

export interface OverviewScanSummary {
  lastSuccessfulScanAt: string | null;
  nextScheduledScanAt: string | null;
  lastSuccessfulRun: {
    sourceId: string;
    sourceName: string;
    outcome: string;
    completedAt: string;
    fetchedCount: number;
    newCount: number;
    updatedCount: number;
  } | null;
  enabledSourcesCount: number;
  schedulableSourcesCount: number;
  failingSourcesCount: number;
  activeScanTaskCount: number;
}

export interface OverviewData {
  activeProfileId: string | null;
  activeProfileName: string | null;
  activeSearchProfile: {
    id: string;
    name: string;
    enabled: boolean;
  } | null;
  searchProfiles: Array<{
    id: string;
    name: string;
    enabled: boolean;
    isDefault: boolean;
  }>;
  recommendations: OverviewRecommendationItem[];
  orderingMode: "priority" | "basic_relevance";
  rankingMode: "priority" | "basic_relevance";
  orderingLabel: string;
  analysisNeeded: boolean;
  totalEligibleOpenJobs: number;
  totalEligible: number;
  unanalyzedCount: number;
  withheldPendingSkillFilterCount: number;
  actionAnalysisCap: number;
  hasProfileFacts: boolean;
  hasSearchProfiles: boolean;
  hasAnyJobs: boolean;
  needsAttention: OverviewNeedsAttention;
  scanSummary: OverviewScanSummary;
  scanStatus: {
    lastSuccessfulScanAt: string | null;
    nextScheduledScanAt: string | null;
    activeSourcesCount: number;
    failingSourcesCount: number;
  };
}

const MAX_OVERVIEW_RECOMMENDATIONS = 10;
const MAX_ATTENTION_ITEMS = 10;
const SCHEDULABLE_SOURCE_TYPES = new Set<SourceType>([
  "greenhouse",
  "lever",
  "ashby",
  "generic_career_page",
]);

interface OpenJobRow {
  id: string;
  company_id: string | null;
  company_name: string;
  primary_source_id: string | null;
  source_display_name: string | null;
  source_type: SourceType | null;
  title: string;
  description_text: string;
  location_text: string | null;
  country_code: string | null;
  workplace_type: WorkplaceType;
  employment_type: string | null;
  seniority_level: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;
  salary_source_type: "employer_disclosed" | "unknown" | null;
  override_min_amount: number | null;
  override_max_amount: number | null;
  override_currency: string | null;
  override_period: SalaryPeriod | null;
  employer_posted_at: string | null;
  first_seen_at: string;
  canonical_url: string | null;
  apply_url: string | null;
  analysis_status: "pending" | "deterministic" | "ai" | "failed";
  documented_fit_score: number | null;
  search_skill_alignment_score: number | null;
  priority_score: number | null;
  hard_filter_passed: number | null;
  hard_filter_status: "eligible" | "excluded" | "pending_analysis" | null;
  included_factors_json: string | null;
  discovery_state: UserJobDiscoveryState | null;
  application_status: ApplicationStatus | null;
}

function resolveDbPair(
  dbArg?: AppDatabase,
  sqliteArg?: SqliteDatabase
): { db: AppDatabase; sqlite: SqliteDatabase } {
  if (sqliteArg && dbArg) {
    return { db: dbArg, sqlite: sqliteArg };
  }
  if (dbArg && !sqliteArg) {
    const internal = (dbArg as unknown as { $client?: SqliteDatabase }).$client;
    if (internal) {
      return { db: dbArg, sqlite: internal };
    }
    return { db: dbArg, sqlite: getSqlite() };
  }
  return { db: getDb(), sqlite: sqliteArg ?? getSqlite() };
}

function normalizeToken(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textContainsTerm(haystackLower: string, term: string): boolean {
  const normalized = normalizeToken(term);
  if (!normalized) return false;
  if (/^[a-z0-9 ]+$/.test(normalized)) {
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(normalized)}(?:$|[^a-z0-9])`);
    return pattern.test(haystackLower);
  }
  return haystackLower.includes(normalized);
}

function computeTitleRelevance(
  title: string,
  profile: SearchProfileRecord | null
): number {
  if (!profile) return 0;
  const targets = [...profile.targetTitles, ...profile.titleAliases]
    .map(normalizeToken)
    .filter(Boolean);
  if (targets.length === 0) return 0;

  const jobTitle = normalizeToken(title);
  let best = 0;

  for (const target of targets) {
    if (jobTitle === target) {
      best = Math.max(best, 100);
    } else if (jobTitle.includes(target) || target.includes(jobTitle)) {
      best = Math.max(best, 75);
    } else {
      const targetWords = target.split(" ").filter((w) => w.length >= 2);
      if (targetWords.length > 0) {
        const matchedWords = targetWords.filter((w) => jobTitle.includes(w));
        if (matchedWords.length > 0) {
          best = Math.max(
            best,
            Math.round((matchedWords.length / targetWords.length) * 60)
          );
        }
      }
    }
  }
  return best;
}

function computeBasicSkillEvidenceScore(
  row: OpenJobRow,
  profile: SearchProfileRecord | null
): { score: number; matchedLabels: string[]; hardExcluded: boolean } {
  if (!profile || profile.skills.length === 0) {
    return { score: 0, matchedLabels: [], hardExcluded: false };
  }

  const haystack = `${row.title}\n${row.description_text}`.toLowerCase();
  let weightedTotal = 0;
  let weightedMatched = 0;
  const matchedLabels: string[] = [];

  for (const skill of profile.skills) {
    const terms = [skill.displayLabel, skill.normalizedSkillKey, ...skill.aliases]
      .map(normalizeToken)
      .filter(Boolean);
    const matched = terms.some((t) => textContainsTerm(haystack, t));

    if (skill.preference === "excluded") {
      if (matched && skill.filterMode === "hard") {
        return { score: 0, matchedLabels: [], hardExcluded: true };
      }
      continue;
    }

    const weight = skill.preference === "must_have" ? 2 : 1;
    weightedTotal += weight;
    if (matched) {
      weightedMatched += weight;
      matchedLabels.push(skill.displayLabel);
    }
  }

  const score =
    weightedTotal > 0 ? Math.round((100 * weightedMatched) / weightedTotal) : 0;
  return { score, matchedLabels, hardExcluded: false };
}

function parseIncludedFactors(raw: string | null): {
  factors: string[];
  weightsRenormalized: boolean;
  summaryText: string | null;
} {
  if (!raw) {
    return { factors: [], weightsRenormalized: false, summaryText: null };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const factors = parsed.filter((x): x is string => typeof x === "string");
      return { factors, weightsRenormalized: false, summaryText: null };
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      let factors: string[];
      if (Array.isArray(obj.included)) {
        factors = obj.included.filter((x): x is string => typeof x === "string");
      } else if (Array.isArray(obj.factors)) {
        factors = obj.factors
          .map((f) =>
            typeof f === "string"
              ? f
              : f && typeof f === "object" && typeof (f as { factor?: unknown }).factor === "string"
                ? (f as { factor: string }).factor
                : null
          )
          .filter((x): x is string => x !== null);
      } else if (
        obj.factors &&
        typeof obj.factors === "object" &&
        !Array.isArray(obj.factors)
      ) {
        const factorRecord = obj.factors as Record<string, unknown>;
        factors = Object.entries(factorRecord)
          .filter(([, val]) => {
            if (val && typeof val === "object") {
              return Boolean((val as { included?: unknown }).included);
            }
            return Boolean(val);
          })
          .map(([k]) => k);
      } else {
        factors = Object.keys(obj).filter(
          (k) =>
            k !== "renormalized" &&
            k !== "weightsRenormalized" &&
            k !== "hardFilter" &&
            k !== "summary" &&
            k !== "reason" &&
            obj[k] !== null &&
            obj[k] !== false
        );
      }
      const weightsRenormalized = Boolean(
        obj.renormalized ?? obj.weightsRenormalized ?? false
      );
      const summaryText =
        typeof obj.reason === "string"
          ? obj.reason
          : typeof obj.summary === "string"
            ? obj.summary
            : null;
      return { factors, weightsRenormalized, summaryText };
    }
  } catch {
    // Ignore malformed JSON
  }
  return { factors: [], weightsRenormalized: false, summaryText: null };
}

const FACTOR_DISPLAY_LABELS: Record<string, string> = {
  documentedFit: "documented fit",
  documented_fit: "documented fit",
  searchSkillAlignment: "skill alignment",
  search_skill_alignment: "skill alignment",
  freshness: "freshness",
  location: "location/work mode",
  locationWorkMode: "location/work mode",
  location_work_mode: "location/work mode",
  compensation: "compensation",
  company: "company/industry",
  companyIndustry: "company/industry",
  company_industry: "company/industry",
};

function formatFactorLabel(factor: string): string {
  return FACTOR_DISPLAY_LABELS[factor] ?? factor.replace(/_/g, " ");
}

function buildPriorityMatchReason(
  row: OpenJobRow,
  factors: string[],
  weightsRenormalized: boolean,
  summaryText: string | null
): string {
  if (summaryText) {
    return summaryText;
  }
  const parts: string[] = [];
  if (row.documented_fit_score !== null) {
    parts.push(`${Math.round(row.documented_fit_score)}% documented fit`);
  }
  if (row.search_skill_alignment_score !== null) {
    parts.push(`${Math.round(row.search_skill_alignment_score)}% skill alignment`);
  }
  if (factors.length > 0 && parts.length === 0) {
    parts.push(
      `Ranked on ${factors.slice(0, 3).map(formatFactorLabel).join(", ")}`
    );
  }
  if (parts.length === 0) {
    return "Matches active search profile criteria";
  }
  if (weightsRenormalized) {
    parts.push("weights renormalized");
  }
  return parts.join(" · ");
}

function buildBasicRelevanceReason(
  titleRelevance: number,
  matchedSkills: string[],
  searchSkillScore: number | null
): string {
  const parts: string[] = [];
  if (titleRelevance >= 75) {
    parts.push("Strong title match");
  } else if (titleRelevance > 0) {
    parts.push("Partial title match");
  }
  if (matchedSkills.length > 0) {
    parts.push(
      `Matches ${matchedSkills.slice(0, 3).join(", ")}${
        matchedSkills.length > 3 ? ` +${matchedSkills.length - 3}` : ""
      }`
    );
  } else if (searchSkillScore !== null && searchSkillScore > 0) {
    parts.push(`${Math.round(searchSkillScore)}% skill alignment`);
  }
  if (parts.length === 0) {
    return "Basic relevance (AI analysis unavailable/not run)";
  }
  return `${parts.join(" · ")} (basic relevance)`;
}

function formatDocumentedFitLabel(score: number | null): string {
  if (score === null) {
    return "Not analyzed";
  }
  if (score >= 80) return "Strong documented fit";
  if (score >= 60) return "Moderate documented fit";
  if (score >= 40) return "Partial documented fit";
  return "Low documented fit";
}

function buildSalaryDisplay(row: OpenJobRow): OverviewRecommendationItem["salary"] {
  if (
    row.override_min_amount !== null ||
    row.override_max_amount !== null
  ) {
    return {
      min: row.override_min_amount,
      max: row.override_max_amount,
      currency: row.override_currency,
      period: row.override_period,
      source: "user_supplied",
    };
  }
  if (
    row.salary_source_type === "employer_disclosed" &&
    (row.salary_min !== null || row.salary_max !== null)
  ) {
    return {
      min: row.salary_min,
      max: row.salary_max,
      currency: row.salary_currency,
      period: row.salary_period,
      source: "employer_disclosed",
    };
  }
  return {
    min: null,
    max: null,
    currency: null,
    period: null,
    source: "unknown",
  };
}

function computeNeedsAttention(sqlite: SqliteDatabase): OverviewNeedsAttention {
  const draftCountRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM resume_drafts rd
       JOIN jobs j ON j.id = rd.job_id
       WHERE rd.state = 'draft' AND j.merged_into_job_id IS NULL`
    )
    .get() as { cnt: number };

  const draftRows = sqlite
    .prepare(
      `SELECT
        rd.id AS draft_id,
        rd.job_id,
        rd.search_profile_id,
        j.title AS job_title,
        j.company_name,
        sp.name AS search_profile_name,
        rd.updated_at
       FROM resume_drafts rd
       JOIN jobs j ON j.id = rd.job_id
       JOIN search_profiles sp ON sp.id = rd.search_profile_id
       WHERE rd.state = 'draft' AND j.merged_into_job_id IS NULL
       ORDER BY rd.updated_at DESC
       LIMIT ?`
    )
    .all(MAX_ATTENTION_ITEMS) as Array<{
    draft_id: string;
    job_id: string;
    search_profile_id: string;
    job_title: string;
    company_name: string;
    search_profile_name: string;
    updated_at: string;
  }>;

  const readyAppCountRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.status = 'ready_to_apply' AND j.merged_into_job_id IS NULL`
    )
    .get() as { cnt: number };

  const readyAppRows = sqlite
    .prepare(
      `SELECT
        a.id AS application_id,
        a.job_id,
        a.search_profile_id,
        j.title AS job_title,
        j.company_name,
        COALESCE(a.original_apply_url, j.apply_url, j.canonical_url) AS original_apply_url,
        a.updated_at
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.status = 'ready_to_apply' AND j.merged_into_job_id IS NULL
       ORDER BY a.updated_at DESC
       LIMIT ?`
    )
    .all(MAX_ATTENTION_ITEMS) as Array<{
    application_id: string;
    job_id: string;
    search_profile_id: string;
    job_title: string;
    company_name: string;
    original_apply_url: string | null;
    updated_at: string;
  }>;

  const sourceRows = sqlite
    .prepare(
      `SELECT
        id,
        display_name,
        source_type,
        config_json,
        health_state,
        consecutive_failures,
        last_error_code,
        last_error_detail,
        last_attempt_at
       FROM job_sources
       WHERE enabled = 1
         AND (health_state IN ('failing', 'degraded') OR consecutive_failures > 0)
       ORDER BY consecutive_failures DESC, last_attempt_at DESC`
    )
    .all() as Array<{
    id: string;
    display_name: string;
    source_type: SourceType;
    config_json: string;
    health_state: SourceHealthState;
    consecutive_failures: number;
    last_error_code: string | null;
    last_error_detail: string | null;
    last_attempt_at: string | null;
  }>;

  const nonArchivedFailures = sourceRows.filter((row) => {
    try {
      const cfg = JSON.parse(row.config_json || "{}") as Record<string, unknown>;
      return cfg.archived !== true;
    } catch {
      return true;
    }
  });

  const duplicateCountRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM job_duplicate_candidates
       WHERE state = 'proposed'`
    )
    .get() as { cnt: number };

  const draftsCount = draftCountRow?.cnt ?? 0;
  const readyAppsCount = readyAppCountRow?.cnt ?? 0;
  const sourceFailuresCount = nonArchivedFailures.length;
  const duplicatesCount = duplicateCountRow?.cnt ?? 0;

  return {
    totalCount: draftsCount + readyAppsCount + sourceFailuresCount,
    draftsAwaitingReviewCount: draftsCount,
    applicationsReadyCount: readyAppsCount,
    sourceFailuresCount,
    duplicateCandidatesCount: duplicatesCount,
    counts: {
      draftsAwaitingReview: draftsCount,
      applicationsReadyToSubmit: readyAppsCount,
      sourceFailures: sourceFailuresCount,
      pendingDuplicates: duplicatesCount,
    },
    draftsAwaitingReview: draftRows.map((r) => ({
      draftId: r.draft_id,
      jobId: r.job_id,
      searchProfileId: r.search_profile_id,
      jobTitle: r.job_title,
      companyName: r.company_name,
      searchProfileName: r.search_profile_name,
      updatedAt: r.updated_at,
    })),
    applicationsReadyToSubmit: readyAppRows.map((r) => ({
      applicationId: r.application_id,
      jobId: r.job_id,
      searchProfileId: r.search_profile_id,
      jobTitle: r.job_title,
      companyName: r.company_name,
      originalApplyUrl: r.original_apply_url,
      updatedAt: r.updated_at,
    })),
    sourceFailures: nonArchivedFailures.slice(0, MAX_ATTENTION_ITEMS).map((r) => ({
      sourceId: r.id,
      displayName: r.display_name,
      sourceType: r.source_type,
      healthState: r.health_state,
      consecutiveFailures: r.consecutive_failures,
      lastErrorCode: r.last_error_code,
      lastErrorDetail: r.last_error_detail
        ? redactPaths(redactString(r.last_error_detail))
        : null,
      lastAttemptAt: r.last_attempt_at,
    })),
  };
}

function computeScanSummary(
  db: AppDatabase,
  sqlite: SqliteDatabase,
  now: Date
): OverviewScanSummary {
  const lastRunRow = sqlite
    .prepare(
      `SELECT
        sr.source_id,
        js.display_name AS source_name,
        sr.outcome,
        sr.completed_at,
        sr.fetched_count,
        sr.new_count,
        sr.updated_count
       FROM source_runs sr
       JOIN job_sources js ON js.id = sr.source_id
       WHERE sr.outcome IN ('succeeded', 'partial', 'skipped_not_modified')
         AND sr.completed_at IS NOT NULL
       ORDER BY sr.completed_at DESC
       LIMIT 1`
    )
    .get() as
    | {
        source_id: string;
        source_name: string;
        outcome: string;
        completed_at: string;
        fetched_count: number;
        new_count: number;
        updated_count: number;
      }
    | undefined;

  const allSources = db
    .select()
    .from(jobSources)
    .orderBy(asc(jobSources.createdAt))
    .all()
    .filter((s) => {
      try {
        const cfg = JSON.parse(s.configJson || "{}") as Record<string, unknown>;
        return cfg.archived !== true;
      } catch {
        return true;
      }
    });

  let lastSuccessFromSource: string | null = null;
  let enabledSourcesCount = 0;
  let schedulableSourcesCount = 0;
  let failingSourcesCount = 0;
  let earliestNextMs: number | null = null;
  const nowMs = now.getTime();

  for (const source of allSources) {
    if (
      source.lastSuccessAt &&
      (!lastSuccessFromSource || source.lastSuccessAt > lastSuccessFromSource)
    ) {
      lastSuccessFromSource = source.lastSuccessAt;
    }

    if (!source.enabled) continue;
    enabledSourcesCount++;

    if (
      source.healthState === "failing" ||
      source.healthState === "degraded"
    ) {
      failingSourcesCount++;
    }

    if (SCHEDULABLE_SOURCE_TYPES.has(source.sourceType)) {
      schedulableSourcesCount++;
      const intervalMs = Math.max(1, source.refreshIntervalMinutes) * 60_000;
      const lastAttemptMs = source.lastAttemptAt
        ? Date.parse(source.lastAttemptAt)
        : Number.NaN;
      const nextMs = Number.isFinite(lastAttemptMs)
        ? Math.max(nowMs, lastAttemptMs + intervalMs)
        : nowMs;

      if (earliestNextMs === null || nextMs < earliestNextMs) {
        earliestNextMs = nextMs;
      }
    }
  }

  const activeTaskRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM background_tasks
       WHERE task_type = 'source.fetch'
         AND status IN ('queued', 'running')`
    )
    .get() as { cnt: number };

  return {
    lastSuccessfulScanAt: lastRunRow?.completed_at ?? lastSuccessFromSource,
    nextScheduledScanAt:
      earliestNextMs !== null ? new Date(earliestNextMs).toISOString() : null,
    lastSuccessfulRun: lastRunRow
      ? {
          sourceId: lastRunRow.source_id,
          sourceName: lastRunRow.source_name,
          outcome: lastRunRow.outcome,
          completedAt: lastRunRow.completed_at,
          fetchedCount: lastRunRow.fetched_count,
          newCount: lastRunRow.new_count,
          updatedCount: lastRunRow.updated_count,
        }
      : null,
    enabledSourcesCount,
    schedulableSourcesCount,
    failingSourcesCount,
    activeScanTaskCount: activeTaskRow?.cnt ?? 0,
  };
}

/**
 * Aggregates the action-oriented Overview workspace data:
 * active search profile, up to 10 ranked open recommendations (with basic-relevance
 * fallback when unscored), needs-attention counts/items, and source scan summary.
 */
export function getOverviewData(options?: {
  searchProfileId?: string;
  db?: AppDatabase;
  sqlite?: SqliteDatabase;
  now?: Date;
}): OverviewData {
  const { db, sqlite } = resolveDbPair(options?.db, options?.sqlite);
  const now = options?.now ?? new Date();

  const profiles = listSearchProfiles(db);
  let activeProfile: SearchProfileRecord | null = null;

  if (options?.searchProfileId) {
    activeProfile =
      profiles.find((p) => p.id === options.searchProfileId) ?? null;
    if (!activeProfile) {
      throw new OverviewServiceError(
        "SEARCH_PROFILE_NOT_FOUND",
        404,
        `Search profile not found: ${options.searchProfileId}`
      );
    }
  } else {
    activeProfile = profiles.find((p) => p.enabled) ?? profiles[0] ?? null;
  }

  const openJobRows = activeProfile
    ? (sqlite
        .prepare(
          `SELECT
            j.id,
            j.company_id,
            j.company_name,
            j.primary_source_id,
            js.display_name AS source_display_name,
            js.source_type AS source_type,
            j.title,
            j.description_text,
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
            jco.min_amount AS override_min_amount,
            jco.max_amount AS override_max_amount,
            jco.currency AS override_currency,
            jco.period AS override_period,
            j.employer_posted_at,
            j.first_seen_at,
            j.canonical_url,
            j.apply_url,
            j.analysis_status,
            mr.documented_fit_score,
            mr.search_skill_alignment_score,
            mr.priority_score,
            mr.hard_filter_passed,
            mr.hard_filter_status,
            mr.included_factors_json,
            ujs.discovery_state,
            app.status AS application_status
           FROM jobs j
           LEFT JOIN job_sources js ON js.id = j.primary_source_id
           LEFT JOIN job_compensation_overrides jco ON jco.job_id = j.id
           LEFT JOIN match_runs mr ON mr.id = (
             SELECT mr2.id FROM match_runs mr2
             WHERE mr2.job_id = j.id AND mr2.search_profile_id = ?
             ORDER BY mr2.created_at DESC
             LIMIT 1
           )
           LEFT JOIN user_job_states ujs
             ON ujs.job_id = j.id AND ujs.search_profile_id = ?
           LEFT JOIN applications app
             ON app.job_id = j.id AND app.search_profile_id = ?
           WHERE j.status = 'open'
             AND j.merged_into_job_id IS NULL
             AND (ujs.discovery_state IS NULL OR ujs.discovery_state NOT IN ('dismissed', 'hidden'))
             AND (mr.hard_filter_status IS NULL OR mr.hard_filter_status = 'eligible')
             AND (mr.hard_filter_passed IS NULL OR mr.hard_filter_passed = 1)
           ORDER BY j.first_seen_at DESC`
        )
        .all(
          activeProfile.id,
          activeProfile.id,
          activeProfile.id
        ) as OpenJobRow[])
    : (sqlite
        .prepare(
          `SELECT
            j.id,
            j.company_id,
            j.company_name,
            j.primary_source_id,
            js.display_name AS source_display_name,
            js.source_type AS source_type,
            j.title,
            j.description_text,
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
            jco.min_amount AS override_min_amount,
            jco.max_amount AS override_max_amount,
            jco.currency AS override_currency,
            jco.period AS override_period,
            j.employer_posted_at,
            j.first_seen_at,
            j.canonical_url,
            j.apply_url,
            j.analysis_status,
            NULL AS documented_fit_score,
            NULL AS search_skill_alignment_score,
            NULL AS priority_score,
            NULL AS hard_filter_passed,
            NULL AS hard_filter_status,
            NULL AS included_factors_json,
            NULL AS discovery_state,
            NULL AS application_status
           FROM jobs j
           LEFT JOIN job_sources js ON js.id = j.primary_source_id
           LEFT JOIN job_compensation_overrides jco ON jco.job_id = j.id
           WHERE j.status = 'open'
             AND j.merged_into_job_id IS NULL
           ORDER BY COALESCE(j.employer_posted_at, j.first_seen_at) DESC, j.first_seen_at DESC`
        )
        .all() as OpenJobRow[]);

  interface CandidateEntry {
    row: OpenJobRow;
    titleRelevance: number;
    basicSkillScore: number;
    matchedSkills: string[];
    hasNumericPriority: boolean;
  }

  const eligibleCandidates: CandidateEntry[] = [];
  for (const row of openJobRows) {
    const titleRelevance = computeTitleRelevance(row.title, activeProfile);
    const skillInfo = computeBasicSkillEvidenceScore(row, activeProfile);
    if (row.priority_score === null && skillInfo.hardExcluded) {
      continue;
    }
    eligibleCandidates.push({
      row,
      titleRelevance,
      basicSkillScore:
        row.search_skill_alignment_score !== null
          ? row.search_skill_alignment_score
          : skillInfo.score,
      matchedSkills: skillInfo.matchedLabels,
      hasNumericPriority: row.priority_score !== null,
    });
  }

  const anyScored = eligibleCandidates.some((c) => c.hasNumericPriority);
  const orderingMode: "priority" | "basic_relevance" = anyScored
    ? "priority"
    : "basic_relevance";
  const orderingLabel = anyScored
    ? "Ranked by search profile priority"
    : activeProfile
      ? "Basic relevance (AI analysis unavailable/not run)"
      : "Basic relevance (no active search profile)";

  eligibleCandidates.sort((a, b) => {
    if (anyScored) {
      if (a.hasNumericPriority !== b.hasNumericPriority) {
        return a.hasNumericPriority ? -1 : 1;
      }
      if (a.hasNumericPriority && b.hasNumericPriority) {
        const diffPriority =
          (b.row.priority_score ?? 0) - (a.row.priority_score ?? 0);
        if (diffPriority !== 0) return diffPriority;

        const diffFit =
          (b.row.documented_fit_score ?? -1) -
          (a.row.documented_fit_score ?? -1);
        if (diffFit !== 0) return diffFit;
      }
    }

    // Basic relevance deterministic tie-breaker / fallback order:
    // 1. Title/alias relevance
    if (b.titleRelevance !== a.titleRelevance) {
      return b.titleRelevance - a.titleRelevance;
    }
    // 2. Assessed search-skill alignment / skill evidence
    if (b.basicSkillScore !== a.basicSkillScore) {
      return b.basicSkillScore - a.basicSkillScore;
    }
    // 3. First-seen recency
    if (b.row.first_seen_at !== a.row.first_seen_at) {
      return b.row.first_seen_at.localeCompare(a.row.first_seen_at);
    }
    return a.row.id.localeCompare(b.row.id);
  });

  const top10 = eligibleCandidates.slice(0, MAX_OVERVIEW_RECOMMENDATIONS);
  const recommendations: OverviewRecommendationItem[] = top10.map(
    (entry, idx) => {
      const { row } = entry;
      const factorMeta = parseIncludedFactors(row.included_factors_json);
      const isPriorityScored = entry.hasNumericPriority;
      const orderingBasis: "priority" | "basic_relevance" = isPriorityScored
        ? "priority"
        : "basic_relevance";

      const employerDisclosedSalary =
        row.salary_source_type === "employer_disclosed" &&
        (row.salary_min !== null || row.salary_max !== null);
      const hasOverride =
        row.override_min_amount !== null || row.override_max_amount !== null;

      return {
        jobId: row.id,
        title: row.title,
        companyId: row.company_id,
        companyName: row.company_name,
        locationText: row.location_text,
        countryCode: row.country_code,
        workplaceType: row.workplace_type,
        employmentType: row.employment_type,
        seniorityLevel: row.seniority_level,
        source:
          row.primary_source_id && row.source_display_name && row.source_type
            ? {
                id: row.primary_source_id,
                displayName: row.source_display_name,
                sourceType: row.source_type,
              }
            : null,
        primarySourceName: row.source_display_name ?? null,
        postedDateStatus: row.employer_posted_at ? "known" : "unknown",
        employerPostedAt: row.employer_posted_at,
        freshnessLabel: computeFreshnessLabel(row.employer_posted_at, now),
        firstSeenAt: row.first_seen_at,
        documentedFitScore: row.documented_fit_score,
        documentedFitLabel: formatDocumentedFitLabel(row.documented_fit_score),
        searchSkillAlignmentScore: row.search_skill_alignment_score,
        priorityScore: row.priority_score,
        priorityRank: idx + 1,
        orderingBasis,
        rankingMode: orderingBasis,
        analysisStatus: row.analysis_status,
        includedFactors: factorMeta.factors,
        weightsRenormalized: factorMeta.weightsRenormalized,
        matchReason: isPriorityScored
          ? buildPriorityMatchReason(
              row,
              factorMeta.factors,
              factorMeta.weightsRenormalized,
              factorMeta.summaryText
            )
          : buildBasicRelevanceReason(
              entry.titleRelevance,
              entry.matchedSkills,
              row.search_skill_alignment_score
            ),
        salaryMin: employerDisclosedSalary ? row.salary_min : null,
        salaryMax: employerDisclosedSalary ? row.salary_max : null,
        salaryCurrency: employerDisclosedSalary ? row.salary_currency : null,
        salaryPeriod: employerDisclosedSalary ? row.salary_period : null,
        salarySourceType: employerDisclosedSalary
          ? "employer_disclosed"
          : "unknown",
        compensationOverride: hasOverride
          ? {
              minAmount: row.override_min_amount,
              maxAmount: row.override_max_amount,
              currency: row.override_currency,
              period: row.override_period,
            }
          : null,
        salary: buildSalaryDisplay(row),
        discoveryState: row.discovery_state ?? null,
        userState: row.discovery_state ?? null,
        applicationStatus: row.application_status ?? null,
        canonicalUrl: row.canonical_url,
        applyUrl: row.apply_url,
      };
    }
  );

  const analysisNeeded =
    eligibleCandidates.length > 0 &&
    !eligibleCandidates.some((c) => c.row.documented_fit_score !== null);

  const withheldRow = activeProfile
    ? (sqlite
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM jobs j
           JOIN match_runs mr ON mr.id = (
             SELECT mr2.id FROM match_runs mr2
             WHERE mr2.job_id = j.id AND mr2.search_profile_id = ?
             ORDER BY mr2.created_at DESC
             LIMIT 1
           )
           WHERE j.status = 'open'
             AND j.merged_into_job_id IS NULL
             AND mr.hard_filter_status = 'pending_analysis'`
        )
        .get(activeProfile.id) as { cnt: number })
    : { cnt: 0 };

  const anyJobsRow = sqlite
    .prepare(`SELECT COUNT(*) AS cnt FROM jobs WHERE merged_into_job_id IS NULL`)
    .get() as { cnt: number };

  const profileFactCountRow = sqlite
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM experiences WHERE verification_status != 'rejected') +
        (SELECT COUNT(*) FROM projects WHERE verification_status != 'rejected') +
        (SELECT COUNT(*) FROM achievements WHERE verification_status != 'rejected') +
        (SELECT COUNT(*) FROM skills WHERE verification_status != 'rejected') +
        (SELECT COUNT(*) FROM education WHERE verification_status != 'rejected') +
        (SELECT COUNT(*) FROM certifications WHERE verification_status != 'rejected') +
        (SELECT COUNT(*) FROM languages WHERE verification_status != 'rejected') AS cnt`
    )
    .get() as { cnt: number };

  const settings = getSettings(db);
  const scanSummary = computeScanSummary(db, sqlite, now);

  return {
    activeProfileId: activeProfile?.id ?? null,
    activeProfileName: activeProfile?.name ?? null,
    activeSearchProfile: activeProfile
      ? {
          id: activeProfile.id,
          name: activeProfile.name,
          enabled: activeProfile.enabled,
        }
      : null,
    searchProfiles: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      enabled: p.enabled,
      isDefault: p.isDefault,
    })),
    recommendations,
    orderingMode,
    rankingMode: orderingMode,
    orderingLabel,
    analysisNeeded,
    totalEligibleOpenJobs: eligibleCandidates.length,
    totalEligible: eligibleCandidates.length,
    unanalyzedCount: eligibleCandidates.filter(
      (c) => c.row.analysis_status === "pending"
    ).length,
    withheldPendingSkillFilterCount: withheldRow?.cnt ?? 0,
    actionAnalysisCap: settings.ai.actionAnalysisCap,
    hasProfileFacts: (profileFactCountRow?.cnt ?? 0) > 0,
    hasSearchProfiles: profiles.length > 0,
    hasAnyJobs: (anyJobsRow?.cnt ?? 0) > 0,
    needsAttention: computeNeedsAttention(sqlite),
    scanSummary,
    scanStatus: {
      lastSuccessfulScanAt: scanSummary.lastSuccessfulScanAt,
      nextScheduledScanAt: scanSummary.nextScheduledScanAt,
      activeSourcesCount: scanSummary.enabledSourcesCount,
      failingSourcesCount: scanSummary.failingSourcesCount,
    },
  };
}

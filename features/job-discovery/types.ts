export type WorkplaceType = "remote" | "hybrid" | "onsite" | "unspecified";

export type JobStatus = "open" | "possibly_closed" | "closed" | "unknown";

export type SalaryPeriod = "hour" | "month" | "year" | "unknown";

export type SalaryProvenance =
  | "employer_disclosed"
  | "user_supplied"
  | "unknown";

export type UserJobDiscoveryState = "saved" | "dismissed" | "hidden";

export type JobUserStateFilter = "active" | "saved" | "dismissed" | "all";

export type JobSortOption =
  | "recommended"
  | "documented_fit"
  | "employer_posted_at"
  | "first_seen_at"
  | "company_title";

export type PostedDateFilter =
  | "any"
  | "24h"
  | "3d"
  | "7d"
  | "30d"
  | "known_only"
  | "unknown_only";

export type FreshnessLabel =
  | "Very recent"
  | "Recent"
  | "This week"
  | "Older"
  | "Date unknown";

export interface DateConflictEntry {
  sourceId: string | null;
  sourceName: string | null;
  postedAt: string;
  rawText: string | null;
}

export interface DateConflictInfo {
  summary: string | null;
  entries: DateConflictEntry[];
}

export interface CompensationOverrideItem {
  id: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
  provenance: string;
  note: string | null;
  updatedAt: string | null;
}

export interface JobSourceRecordItem {
  id: string;
  jobId: string;
  sourceId: string;
  sourceName: string | null;
  sourceType: string | null;
  externalId: string;
  sourceUrl: string | null;
  applyUrl: string | null;
  sourcePostedAtText: string | null;
  sourcePostedAt: string | null;
  sourceUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  missingRunCount: number;
  recordStatus: "open" | "possibly_closed" | "closed";
}

export type AnalysisStatus = "pending" | "deterministic" | "ai" | "failed";

export type HardFilterStatus = "eligible" | "excluded" | "pending_analysis";

export type RequirementCategory =
  | "skill"
  | "experience"
  | "education"
  | "responsibility"
  | "domain"
  | "other";

export type RequirementPriority =
  | "must_have"
  | "preferred"
  | "responsibility"
  | "unspecified";

export type MachineSupportState =
  | "supported"
  | "partially_supported"
  | "not_found_in_profile"
  | "ambiguous";

export type CandidateResponse =
  | "not_reviewed"
  | "candidate_confirms_has"
  | "candidate_confirms_does_not_have";

export interface MatchFactorEntry {
  key: string;
  label: string;
  score: number | null;
  configuredWeight: number | null;
  effectiveWeight: number | null;
  included: boolean;
  reason: string | null;
}

export interface MatchEvidenceItem {
  id: string;
  jobRequirementId: string;
  supportState: MachineSupportState;
  linkedFactType: string | null;
  linkedFactId: string | null;
  linkedFactLabel: string | null;
  evidenceLinkId: string | null;
  explanation: string | null;
}

export interface LatestMatchDetail {
  id: string;
  searchProfileId: string;
  documentedFitScore: number | null;
  searchSkillAlignmentScore: number | null;
  priorityScore: number | null;
  hardFilterPassed: boolean;
  hardFilterStatus: HardFilterStatus;
  renormalized: boolean;
  includedFactors: MatchFactorEntry[];
  omittedFactors: string[];
  weightVersion: string | null;
  calculationVersion: string | null;
  analysisVersion: string | null;
  createdAt: string | null;
  evidence: MatchEvidenceItem[];
}

export interface JobRequirementSummary {
  id: string;
  requirementKey: string | null;
  requirementText: string;
  normalizedSkill: string | null;
  category: RequirementCategory | string;
  priority: RequirementPriority;
  userPriorityOverride: RequirementPriority | null;
  effectivePriority: RequirementPriority;
  machineSupportState: MachineSupportState;
  candidateResponse: CandidateResponse;
  extractionConfidence: number | null;
  analysisSource: "deterministic" | "ai" | "manual";
  analysisVersion: string | null;
  overrideState: "active" | "orphaned";
  overrideUpdatedAt: string | null;
  evidence: MatchEvidenceItem[];
}

export interface JobListItem {
  id: string;
  companyId: string | null;
  companyName: string;
  primarySourceId: string | null;
  primarySourceName: string | null;
  primarySourceType: string | null;
  title: string;
  descriptionSnippet: string | null;
  locationText: string | null;
  countryCode: string | null;
  workplaceType: WorkplaceType;
  employmentType: string | null;
  seniorityLevel: string | null;
  seniorityMinYears: number | null;
  seniorityMaxYears: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salarySourceType: SalaryProvenance;
  compensationOverride: CompensationOverrideItem | null;
  employerPostedAt: string | null;
  dateConflict: DateConflictInfo | null;
  sourceUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastVerifiedAt: string;
  status: JobStatus;
  canonicalUrl: string | null;
  applyUrl: string | null;
  mergedIntoJobId: string | null;
  analysisStatus: AnalysisStatus;
  analysisVersion: string | null;
  analyzedAt: string | null;
  userState: UserJobDiscoveryState | null;
  userStateNotes: string | null;
  documentedFitScore: number | null;
  searchSkillAlignmentScore: number | null;
  priorityScore: number | null;
  hardFilterPassed: boolean;
  hardFilterStatus: HardFilterStatus;
  sourceCount: number;
  duplicateCandidateCount: number;
  hasDuplicateCandidates: boolean;
}

export interface JobDetailItem extends JobListItem {
  descriptionText: string;
  descriptionHtmlSanitized: string | null;
  sourceRecords: JobSourceRecordItem[];
  duplicateCandidates: DuplicateCandidateItem[];
  requirements: JobRequirementSummary[];
  latestMatch: LatestMatchDetail | null;
  applicationId: string | null;
}

export interface DuplicateJobSummary {
  id: string;
  title: string;
  companyName: string;
  locationText: string | null;
  workplaceType: WorkplaceType;
  employmentType: string | null;
  canonicalUrl: string | null;
  applyUrl: string | null;
  employerPostedAt: string | null;
  firstSeenAt: string;
  status: JobStatus;
  sourceNames: string[];
}

export interface DuplicateCandidateItem {
  id: string;
  jobAId: string;
  jobBId: string;
  matchMethod: string;
  evidence: Record<string, unknown>;
  similarityScore: number;
  state: "proposed" | "dismissed" | "merged";
  createdAt: string;
  dismissedAt: string | null;
  resolvedAt: string | null;
  jobA: DuplicateJobSummary | null;
  jobB: DuplicateJobSummary | null;
}

export interface SourceFilterOption {
  id: string;
  displayName: string;
  sourceType: string;
}

export interface JobsListResponse {
  items: JobListItem[];
  total: number;
  pendingDuplicateCount: number;
  sources: SourceFilterOption[];
}

export interface ListJobsParams {
  q?: string;
  state?: JobUserStateFilter;
  sourceId?: string;
  workplaceType?: WorkplaceType | "all";
  postedDate?: PostedDateFilter;
  sort?: JobSortOption;
  searchProfileId?: string | null;
  limit?: number;
  offset?: number;
}

export interface ImportJobInput {
  url?: string;
  descriptionText?: string;
  title?: string;
  companyName?: string;
  locationText?: string;
  workplaceType?: WorkplaceType;
  employmentType?: string;
}

export interface ImportJobResponse {
  job: JobDetailItem;
  duplicateCandidates: DuplicateCandidateItem[];
  created: boolean;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return null;
}

export function extractApiErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  const root = asRecord(payload);
  if (!root) return fallback;

  const nested = asRecord(root.error);
  if (nested) {
    const msg = pickString(nested, ["message", "detail"]);
    const code = pickString(nested, ["code"]);
    if (msg && code) return `${msg} (${code})`;
    if (msg) return msg;
  }

  return pickString(root, ["message", "error", "detail"]) ?? fallback;
}

function isWorkplaceType(val: string | null): val is WorkplaceType {
  return (
    val === "remote" ||
    val === "hybrid" ||
    val === "onsite" ||
    val === "unspecified"
  );
}

function isJobStatus(val: string | null): val is JobStatus {
  return (
    val === "open" ||
    val === "possibly_closed" ||
    val === "closed" ||
    val === "unknown"
  );
}

function isSalaryPeriod(val: string | null): val is SalaryPeriod {
  return val === "hour" || val === "month" || val === "year" || val === "unknown";
}

function isUserState(val: string | null): val is UserJobDiscoveryState {
  return val === "saved" || val === "dismissed" || val === "hidden";
}

function parseJsonField(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function normalizeDateConflict(raw: unknown): DateConflictInfo | null {
  if (!raw) return null;
  const parsed = parseJsonField(raw);
  if (!parsed) return null;

  if (typeof parsed === "string") {
    return parsed.trim() ? { summary: parsed.trim(), entries: [] } : null;
  }

  const entries: DateConflictEntry[] = [];
  let summary: string | null = null;

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const rec = asRecord(item);
      if (!rec) continue;
      const postedAt = pickString(rec, ["postedAt", "posted_at", "date", "value"]);
      if (!postedAt) continue;
      entries.push({
        sourceId: pickString(rec, ["sourceId", "source_id"]),
        sourceName: pickString(rec, ["sourceName", "source_name", "source"]),
        postedAt,
        rawText: pickString(rec, ["rawText", "raw_text", "text"]),
      });
    }
  } else {
    const rec = asRecord(parsed);
    if (rec) {
      if (rec.hasConflict === false) return null;
      summary = pickString(rec, ["summary", "message", "reason"]);
      const rawEntries = Array.isArray(rec.sources)
        ? rec.sources
        : Array.isArray(rec.values)
          ? rec.values
          : Array.isArray(rec.dates)
            ? rec.dates
            : [];
      for (const item of rawEntries) {
        if (typeof item === "string") {
          entries.push({
            sourceId: null,
            sourceName: null,
            postedAt: item,
            rawText: null,
          });
        } else {
          const entryRec = asRecord(item);
          if (!entryRec) continue;
          const postedAt = pickString(entryRec, [
            "postedAt",
            "posted_at",
            "date",
            "value",
          ]);
          if (!postedAt) continue;
          entries.push({
            sourceId: pickString(entryRec, ["sourceId", "source_id"]),
            sourceName: pickString(entryRec, [
              "sourceName",
              "source_name",
              "source",
            ]),
            postedAt,
            rawText: pickString(entryRec, [
              "rawText",
              "raw_text",
              "postedAtText",
              "text",
            ]),
          });
        }
      }
    }
  }

  if (!summary && entries.length === 0) return null;
  return { summary, entries };
}

export function normalizeCompensationOverride(
  raw: unknown
): CompensationOverrideItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const minAmount = pickNumber(rec, ["minAmount", "min_amount", "min"]);
  const maxAmount = pickNumber(rec, ["maxAmount", "max_amount", "max"]);
  const currency = pickString(rec, ["currency"]);
  const rawPeriod = pickString(rec, ["period"]);
  const note = pickString(rec, ["note"]);

  if (minAmount === null && maxAmount === null && !currency && !note) {
    return null;
  }

  return {
    id: pickString(rec, ["id"]),
    minAmount,
    maxAmount,
    currency,
    period: isSalaryPeriod(rawPeriod) ? rawPeriod : null,
    provenance: pickString(rec, ["provenance"]) ?? "user_supplied",
    note,
    updatedAt: pickString(rec, ["updatedAt", "updated_at"]),
  };
}

export function normalizeJobSourceRecord(raw: unknown): JobSourceRecordItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = pickString(rec, ["id"]);
  const jobId = pickString(rec, ["jobId", "job_id"]) ?? "";
  const sourceId = pickString(rec, ["sourceId", "source_id"]) ?? "";
  if (!id) return null;

  const rawStatus = pickString(rec, ["recordStatus", "record_status"]);
  const recordStatus: JobSourceRecordItem["recordStatus"] =
    rawStatus === "possibly_closed" || rawStatus === "closed"
      ? rawStatus
      : "open";

  return {
    id,
    jobId,
    sourceId,
    sourceName: pickString(rec, [
      "sourceName",
      "source_name",
      "sourceDisplayName",
      "displayName",
    ]),
    sourceType: pickString(rec, ["sourceType", "source_type"]),
    externalId: pickString(rec, ["externalId", "external_id"]) ?? id,
    sourceUrl: pickString(rec, ["sourceUrl", "source_url"]),
    applyUrl: pickString(rec, ["applyUrl", "apply_url"]),
    sourcePostedAtText: pickString(rec, [
      "sourcePostedAtText",
      "source_posted_at_text",
    ]),
    sourcePostedAt: pickString(rec, ["sourcePostedAt", "source_posted_at"]),
    sourceUpdatedAt: pickString(rec, ["sourceUpdatedAt", "source_updated_at"]),
    firstSeenAt: pickString(rec, ["firstSeenAt", "first_seen_at"]) ?? "",
    lastSeenAt: pickString(rec, ["lastSeenAt", "last_seen_at"]) ?? "",
    missingRunCount:
      pickNumber(rec, ["missingRunCount", "missing_run_count"]) ?? 0,
    recordStatus,
  };
}

function isAnalysisStatus(val: string | null): val is AnalysisStatus {
  return (
    val === "pending" ||
    val === "deterministic" ||
    val === "ai" ||
    val === "failed"
  );
}

function isHardFilterStatus(val: string | null): val is HardFilterStatus {
  return (
    val === "eligible" ||
    val === "excluded" ||
    val === "pending_analysis"
  );
}

function normalizeRequirementPriority(val: string | null): RequirementPriority {
  if (
    val === "must_have" ||
    val === "preferred" ||
    val === "responsibility" ||
    val === "unspecified"
  ) {
    return val;
  }
  return "unspecified";
}

function normalizeMachineSupportState(val: string | null): MachineSupportState {
  if (
    val === "supported" ||
    val === "partially_supported" ||
    val === "not_found_in_profile" ||
    val === "ambiguous"
  ) {
    return val;
  }
  return "not_found_in_profile";
}

function normalizeCandidateResponse(val: string | null): CandidateResponse {
  if (
    val === "not_reviewed" ||
    val === "candidate_confirms_has" ||
    val === "candidate_confirms_does_not_have"
  ) {
    return val;
  }
  return "not_reviewed";
}

function normalizeMatchEvidenceItem(raw: unknown): MatchEvidenceItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id =
    pickString(rec, ["id"]) ??
    `${pickString(rec, ["jobRequirementId", "job_requirement_id"]) ?? "ev"}-${pickString(rec, ["linkedFactId", "linked_fact_id"]) ?? "fact"}`;
  const jobRequirementId =
    pickString(rec, ["jobRequirementId", "job_requirement_id", "requirementId"]) ??
    "";
  return {
    id,
    jobRequirementId,
    supportState: normalizeMachineSupportState(
      pickString(rec, ["supportState", "support_state"])
    ),
    linkedFactType: pickString(rec, ["linkedFactType", "linked_fact_type"]),
    linkedFactId: pickString(rec, ["linkedFactId", "linked_fact_id"]),
    linkedFactLabel: pickString(rec, [
      "linkedFactLabel",
      "linked_fact_label",
      "factLabel",
      "label",
    ]),
    evidenceLinkId: pickString(rec, ["evidenceLinkId", "evidence_link_id"]),
    explanation: pickString(rec, ["explanation", "reason"]),
  };
}

const FACTOR_LABELS: Record<string, string> = {
  documentedFit: "Candidate documented fit",
  documented_fit: "Candidate documented fit",
  searchSkillAlignment: "Search-profile skill alignment",
  search_skill_alignment: "Search-profile skill alignment",
  freshness: "Freshness",
  location: "Location / work mode",
  locationWorkMode: "Location / work mode",
  locationWorkplace: "Location / work mode",
  location_workplace: "Location / work mode",
  compensation: "Compensation fit",
  company: "Company / industry preference",
  companyIndustry: "Company / industry preference",
  company_industry: "Company / industry preference",
};

function normalizeIncludedFactors(raw: unknown): {
  factors: MatchFactorEntry[];
  omitted: string[];
  renormalized: boolean;
} {
  const parsed = parseJsonField(raw);
  const factors: MatchFactorEntry[] = [];
  const omitted: string[] = [];
  let renormalized = false;

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const rec = asRecord(item);
      if (!rec) continue;
      const key = pickString(rec, ["key", "factor", "name"]) ?? "factor";
      const included =
        typeof rec.included === "boolean" ? rec.included : true;
      const label =
        pickString(rec, ["label"]) ?? FACTOR_LABELS[key] ?? key;
      if (!included) omitted.push(label);
      factors.push({
        key,
        label,
        score: pickNumber(rec, ["score"]),
        configuredWeight: pickNumber(rec, [
          "configuredWeight",
          "weightPercent",
          "weight",
        ]),
        effectiveWeight: pickNumber(rec, [
          "effectiveWeight",
          "renormalizedWeight",
          "effective_weight",
        ]),
        included,
        reason: pickString(rec, ["reason", "omitReason"]),
      });
    }
    renormalized = omitted.length > 0;
    return { factors, omitted, renormalized };
  }

  const rec = asRecord(parsed);
  if (!rec) return { factors, omitted, renormalized: false };

  if (typeof rec.renormalized === "boolean") {
    renormalized = rec.renormalized;
  }
  if (Array.isArray(rec.omittedFactors)) {
    for (const o of rec.omittedFactors) {
      if (typeof o === "string" && o.trim()) {
        omitted.push(FACTOR_LABELS[o] ?? o);
      }
    }
  }

  const rawList = Array.isArray(rec.factors) ? rec.factors : null;
  if (rawList) {
    const nested = normalizeIncludedFactors(rawList);
    return {
      factors: nested.factors,
      omitted: omitted.length > 0 ? omitted : nested.omitted,
      renormalized: renormalized || nested.renormalized,
    };
  }

  for (const [key, val] of Object.entries(rec)) {
    if (key === "renormalized" || key === "omittedFactors") continue;
    const fRec = asRecord(val);
    if (!fRec) continue;
    const included = typeof fRec.included === "boolean" ? fRec.included : true;
    const label = pickString(fRec, ["label"]) ?? FACTOR_LABELS[key] ?? key;
    if (!included && !omitted.includes(label)) omitted.push(label);
    factors.push({
      key,
      label,
      score: pickNumber(fRec, ["score"]),
      configuredWeight: pickNumber(fRec, [
        "configuredWeight",
        "weightPercent",
        "weight",
      ]),
      effectiveWeight: pickNumber(fRec, [
        "effectiveWeight",
        "renormalizedWeight",
      ]),
      included,
      reason: pickString(fRec, ["reason", "omitReason"]),
    });
  }

  return {
    factors,
    omitted,
    renormalized: renormalized || omitted.length > 0,
  };
}

export function normalizeLatestMatch(
  rawMatch: unknown,
  rawEvidence?: unknown
): LatestMatchDetail | null {
  const rec = asRecord(rawMatch);
  if (!rec) return null;
  const id = pickString(rec, ["id"]) ?? "latest-match";
  const searchProfileId =
    pickString(rec, ["searchProfileId", "search_profile_id"]) ?? "";

  const factorInfo = normalizeIncludedFactors(
    rec.includedFactors ?? rec.includedFactorsJson ?? rec.included_factors_json
  );
  const rawEvidenceList = Array.isArray(rawEvidence)
    ? rawEvidence
    : Array.isArray(rec.evidence)
      ? rec.evidence
      : [];
  const evidence = rawEvidenceList
    .map(normalizeMatchEvidenceItem)
    .filter((e): e is MatchEvidenceItem => e !== null);

  const rawHardStatus = pickString(rec, [
    "hardFilterStatus",
    "hard_filter_status",
  ]);
  const hardFilterPassed =
    typeof rec.hardFilterPassed === "boolean"
      ? rec.hardFilterPassed
      : rec.hard_filter_passed === 0
        ? false
        : true;

  return {
    id,
    searchProfileId,
    documentedFitScore: pickNumber(rec, [
      "documentedFitScore",
      "documented_fit_score",
    ]),
    searchSkillAlignmentScore: pickNumber(rec, [
      "searchSkillAlignmentScore",
      "search_skill_alignment_score",
    ]),
    priorityScore: pickNumber(rec, ["priorityScore", "priority_score"]),
    hardFilterPassed,
    hardFilterStatus: isHardFilterStatus(rawHardStatus)
      ? rawHardStatus
      : hardFilterPassed
        ? "eligible"
        : "excluded",
    renormalized:
      typeof rec.renormalized === "boolean"
        ? rec.renormalized
        : factorInfo.renormalized,
    includedFactors: factorInfo.factors,
    omittedFactors: factorInfo.omitted,
    weightVersion: pickString(rec, ["weightVersion", "weight_version"]),
    calculationVersion: pickString(rec, [
      "calculationVersion",
      "calculation_version",
    ]),
    analysisVersion: pickString(rec, ["analysisVersion", "analysis_version"]),
    createdAt: pickString(rec, ["createdAt", "created_at"]),
    evidence,
  };
}

export function normalizeJobListItem(raw: unknown): JobListItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const id = pickString(rec, ["id"]);
  if (!id) return null;

  const rawWorkplace = pickString(rec, ["workplaceType", "workplace_type"]);
  const rawStatus = pickString(rec, ["status"]);
  const rawPeriod = pickString(rec, ["salaryPeriod", "salary_period"]);
  const rawSalarySource = pickString(rec, [
    "salarySourceType",
    "salary_source_type",
  ]);
  const rawUserState = pickString(rec, [
    "userState",
    "user_state",
    "discoveryState",
    "discovery_state",
  ]);
  const rawAnalysisStatus = pickString(rec, [
    "analysisStatus",
    "analysis_status",
  ]);

  const compensationOverride = normalizeCompensationOverride(
    rec.compensationOverride ?? rec.compensation_override
  );

  const salaryMin = pickNumber(rec, ["salaryMin", "salary_min"]);
  const salaryMax = pickNumber(rec, ["salaryMax", "salary_max"]);
  let salarySourceType: SalaryProvenance = "unknown";
  if (rawSalarySource === "employer_disclosed") {
    salarySourceType = "employer_disclosed";
  } else if (rawSalarySource === "user_supplied") {
    salarySourceType = "user_supplied";
  } else if (salaryMin !== null || salaryMax !== null) {
    salarySourceType = "employer_disclosed";
  } else if (compensationOverride) {
    salarySourceType = "user_supplied";
  }

  const dupCount =
    pickNumber(rec, [
      "duplicateCandidateCount",
      "duplicate_candidate_count",
      "proposedDuplicatesCount",
    ]) ?? 0;

  const matchRec = asRecord(rec.match) ?? asRecord(rec.latestMatch);
  const rawHardStatus =
    pickString(rec, ["hardFilterStatus", "hard_filter_status"]) ??
    (matchRec
      ? pickString(matchRec, ["hardFilterStatus", "hard_filter_status"])
      : null);
  const hardFilterPassed =
    typeof rec.hardFilterPassed === "boolean"
      ? rec.hardFilterPassed
      : matchRec && typeof matchRec.hardFilterPassed === "boolean"
        ? matchRec.hardFilterPassed
        : matchRec && matchRec.hard_filter_passed === 0
          ? false
          : true;

  return {
    id,
    companyId: pickString(rec, ["companyId", "company_id"]),
    companyName:
      pickString(rec, ["companyName", "company_name"]) ?? "Unknown company",
    primarySourceId: pickString(rec, ["primarySourceId", "primary_source_id"]),
    primarySourceName: pickString(rec, [
      "primarySourceName",
      "primary_source_name",
      "sourceName",
    ]),
    primarySourceType: pickString(rec, [
      "primarySourceType",
      "primary_source_type",
      "sourceType",
    ]),
    title: pickString(rec, ["title"]) ?? "Untitled role",
    descriptionSnippet: pickString(rec, [
      "descriptionSnippet",
      "description_snippet",
      "snippet",
    ]),
    locationText: pickString(rec, ["locationText", "location_text", "location"]),
    countryCode: pickString(rec, ["countryCode", "country_code"]),
    workplaceType: isWorkplaceType(rawWorkplace) ? rawWorkplace : "unspecified",
    employmentType: pickString(rec, ["employmentType", "employment_type"]),
    seniorityLevel: pickString(rec, ["seniorityLevel", "seniority_level"]),
    seniorityMinYears: pickNumber(rec, [
      "seniorityMinYears",
      "seniority_min_years",
    ]),
    seniorityMaxYears: pickNumber(rec, [
      "seniorityMaxYears",
      "seniority_max_years",
    ]),
    salaryMin,
    salaryMax,
    salaryCurrency: pickString(rec, ["salaryCurrency", "salary_currency"]),
    salaryPeriod: isSalaryPeriod(rawPeriod) ? rawPeriod : null,
    salarySourceType,
    compensationOverride,
    employerPostedAt: pickString(rec, ["employerPostedAt", "employer_posted_at"]),
    dateConflict: normalizeDateConflict(
      rec.dateConflict ?? rec.dateConflictJson ?? rec.date_conflict_json
    ),
    sourceUpdatedAt: pickString(rec, ["sourceUpdatedAt", "source_updated_at"]),
    firstSeenAt: pickString(rec, ["firstSeenAt", "first_seen_at"]) ?? "",
    lastSeenAt: pickString(rec, ["lastSeenAt", "last_seen_at"]) ?? "",
    lastVerifiedAt: pickString(rec, ["lastVerifiedAt", "last_verified_at"]) ?? "",
    status: isJobStatus(rawStatus) ? rawStatus : "unknown",
    canonicalUrl: pickString(rec, ["canonicalUrl", "canonical_url"]),
    applyUrl: pickString(rec, ["applyUrl", "apply_url"]),
    mergedIntoJobId: pickString(rec, ["mergedIntoJobId", "merged_into_job_id"]),
    analysisStatus: isAnalysisStatus(rawAnalysisStatus)
      ? rawAnalysisStatus
      : "pending",
    analysisVersion: pickString(rec, ["analysisVersion", "analysis_version"]),
    analyzedAt: pickString(rec, ["analyzedAt", "analyzed_at"]),
    userState: isUserState(rawUserState) ? rawUserState : null,
    userStateNotes: pickString(rec, ["userStateNotes", "user_state_notes", "notes"]),
    documentedFitScore:
      pickNumber(rec, ["documentedFitScore", "documented_fit_score"]) ??
      (matchRec
        ? pickNumber(matchRec, ["documentedFitScore", "documented_fit_score"])
        : null),
    searchSkillAlignmentScore:
      pickNumber(rec, [
        "searchSkillAlignmentScore",
        "search_skill_alignment_score",
      ]) ??
      (matchRec
        ? pickNumber(matchRec, [
            "searchSkillAlignmentScore",
            "search_skill_alignment_score",
          ])
        : null),
    priorityScore:
      pickNumber(rec, ["priorityScore", "priority_score"]) ??
      (matchRec ? pickNumber(matchRec, ["priorityScore", "priority_score"]) : null),
    hardFilterPassed,
    hardFilterStatus: isHardFilterStatus(rawHardStatus)
      ? rawHardStatus
      : hardFilterPassed
        ? "eligible"
        : "excluded",
    sourceCount: pickNumber(rec, ["sourceCount", "source_count"]) ?? 1,
    duplicateCandidateCount: dupCount,
    hasDuplicateCandidates:
      Boolean(rec.hasDuplicateCandidates) || dupCount > 0,
  };
}

function normalizeDuplicateJobSummary(raw: unknown): DuplicateJobSummary | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = pickString(rec, ["id"]);
  if (!id) return null;
  const rawWorkplace = pickString(rec, ["workplaceType", "workplace_type"]);
  const rawStatus = pickString(rec, ["status"]);
  const sourceNames = Array.isArray(rec.sourceNames)
    ? rec.sourceNames.filter((s): s is string => typeof s === "string")
    : [];

  return {
    id,
    title: pickString(rec, ["title"]) ?? "Untitled role",
    companyName:
      pickString(rec, ["companyName", "company_name"]) ?? "Unknown company",
    locationText: pickString(rec, ["locationText", "location_text"]),
    workplaceType: isWorkplaceType(rawWorkplace) ? rawWorkplace : "unspecified",
    employmentType: pickString(rec, ["employmentType", "employment_type"]),
    canonicalUrl: pickString(rec, ["canonicalUrl", "canonical_url"]),
    applyUrl: pickString(rec, ["applyUrl", "apply_url"]),
    employerPostedAt: pickString(rec, ["employerPostedAt", "employer_posted_at"]),
    firstSeenAt: pickString(rec, ["firstSeenAt", "first_seen_at"]) ?? "",
    status: isJobStatus(rawStatus) ? rawStatus : "unknown",
    sourceNames,
  };
}

export function normalizeDuplicateCandidate(
  raw: unknown
): DuplicateCandidateItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = pickString(rec, ["id"]);
  const jobAId = pickString(rec, ["jobAId", "job_a_id"]);
  const jobBId = pickString(rec, ["jobBId", "job_b_id"]);
  if (!id || !jobAId || !jobBId) return null;

  const rawEvidence = parseJsonField(rec.evidence ?? rec.evidenceJson ?? rec.evidence_json);
  const evidence = asRecord(rawEvidence) ?? {};
  const rawState = pickString(rec, ["state"]);
  const state: DuplicateCandidateItem["state"] =
    rawState === "dismissed" || rawState === "merged" ? rawState : "proposed";

  return {
    id,
    jobAId,
    jobBId,
    matchMethod:
      pickString(rec, ["matchMethod", "match_method"]) ?? "similarity",
    evidence,
    similarityScore:
      pickNumber(rec, ["similarityScore", "similarity_score"]) ?? 0,
    state,
    createdAt: pickString(rec, ["createdAt", "created_at"]) ?? "",
    dismissedAt: pickString(rec, ["dismissedAt", "dismissed_at"]),
    resolvedAt: pickString(rec, ["resolvedAt", "resolved_at"]),
    jobA: normalizeDuplicateJobSummary(rec.jobA ?? rec.job_a),
    jobB: normalizeDuplicateJobSummary(rec.jobB ?? rec.job_b),
  };
}

export function normalizeJobDetailItem(raw: unknown): JobDetailItem | null {
  const root = asRecord(raw);
  if (!root) return null;

  const jobRec = asRecord(root.job) ?? root;
  const base = normalizeJobListItem(jobRec);
  if (!base) return null;

  const rootUserJobState = asRecord(root.userJobState);
  const rootUserStateVal = rootUserJobState
    ? pickString(rootUserJobState, ["discoveryState", "discovery_state"])
    : null;
  const resolvedUserState: UserJobDiscoveryState | null = isUserState(
    rootUserStateVal
  )
    ? rootUserStateVal
    : base.userState;

  const rootCompensationOverride = normalizeCompensationOverride(
    root.compensationOverride ?? root.compensation_override
  );
  const resolvedCompensationOverride =
    rootCompensationOverride ?? base.compensationOverride;

  const rootMatchRaw = root.latestMatch ?? root.match;
  const rootMatch = asRecord(rootMatchRaw);
  const latestMatch = normalizeLatestMatch(
    rootMatchRaw,
    root.matchEvidence ?? root.evidence ?? rootMatch?.evidence
  );

  const resolvedFitScore =
    base.documentedFitScore ??
    latestMatch?.documentedFitScore ??
    (rootMatch
      ? pickNumber(rootMatch, ["documentedFitScore", "documented_fit_score"])
      : null);
  const resolvedSkillAlignScore =
    base.searchSkillAlignmentScore ??
    latestMatch?.searchSkillAlignmentScore ??
    (rootMatch
      ? pickNumber(rootMatch, [
          "searchSkillAlignmentScore",
          "search_skill_alignment_score",
        ])
      : null);
  const resolvedPriorityScore =
    base.priorityScore ??
    latestMatch?.priorityScore ??
    (rootMatch ? pickNumber(rootMatch, ["priorityScore", "priority_score"]) : null);

  const rawSourceRecords = Array.isArray(root.jobSourceRecords)
    ? root.jobSourceRecords
    : Array.isArray(root.sourceRecords)
      ? root.sourceRecords
      : Array.isArray(jobRec.sourceRecords)
        ? jobRec.sourceRecords
        : Array.isArray(jobRec.source_records)
          ? jobRec.source_records
          : [];

  const sourceRecords = rawSourceRecords
    .map(normalizeJobSourceRecord)
    .filter((r): r is JobSourceRecordItem => r !== null);

  const rawDuplicates = Array.isArray(root.duplicateCandidates)
    ? root.duplicateCandidates
    : Array.isArray(jobRec.duplicateCandidates)
      ? jobRec.duplicateCandidates
      : [];

  const duplicateCandidates = rawDuplicates
    .map(normalizeDuplicateCandidate)
    .filter((d): d is DuplicateCandidateItem => d !== null);

  const evidenceByRequirementId = new Map<string, MatchEvidenceItem[]>();
  if (latestMatch) {
    for (const ev of latestMatch.evidence) {
      if (!ev.jobRequirementId) continue;
      const list = evidenceByRequirementId.get(ev.jobRequirementId) ?? [];
      list.push(ev);
      evidenceByRequirementId.set(ev.jobRequirementId, list);
    }
  }

  const rawReqs = Array.isArray(root.requirements)
    ? root.requirements
    : Array.isArray(jobRec.requirements)
      ? jobRec.requirements
      : [];
  const requirements: JobRequirementSummary[] = rawReqs
    .map((item) => {
      const r = asRecord(item);
      if (!r) return null;
      const reqId = pickString(r, ["id"]);
      const requirementText = pickString(r, [
        "requirementText",
        "requirement_text",
      ]);
      if (!reqId || !requirementText) return null;

      const extractedPriority = normalizeRequirementPriority(
        pickString(r, ["priority"])
      );
      const rawUserPriority = pickString(r, [
        "userPriorityOverride",
        "user_priority_override",
      ]);
      const userPriorityOverride = rawUserPriority
        ? normalizeRequirementPriority(rawUserPriority)
        : null;

      const nestedEvidence = Array.isArray(r.evidence)
        ? r.evidence
            .map(normalizeMatchEvidenceItem)
            .filter((e): e is MatchEvidenceItem => e !== null)
        : [];
      const matchedEvidence =
        nestedEvidence.length > 0
          ? nestedEvidence
          : evidenceByRequirementId.get(reqId) ?? [];

      const rawSource = pickString(r, ["analysisSource", "analysis_source"]);
      const analysisSource: JobRequirementSummary["analysisSource"] =
        rawSource === "ai" || rawSource === "manual"
          ? rawSource
          : "deterministic";
      const rawOverrideState = pickString(r, [
        "overrideState",
        "override_state",
      ]);

      return {
        id: reqId,
        requirementKey: pickString(r, ["requirementKey", "requirement_key"]),
        requirementText,
        normalizedSkill: pickString(r, [
          "normalizedSkill",
          "normalized_skill",
        ]),
        category: pickString(r, ["category"]) ?? "other",
        priority: extractedPriority,
        userPriorityOverride,
        effectivePriority: userPriorityOverride ?? extractedPriority,
        machineSupportState: normalizeMachineSupportState(
          pickString(r, ["machineSupportState", "machine_support_state"])
        ),
        candidateResponse: normalizeCandidateResponse(
          pickString(r, ["candidateResponse", "candidate_response"])
        ),
        extractionConfidence: pickNumber(r, [
          "extractionConfidence",
          "extraction_confidence",
        ]),
        analysisSource,
        analysisVersion: pickString(r, [
          "analysisVersion",
          "analysis_version",
        ]),
        overrideState:
          rawOverrideState === "orphaned" ? "orphaned" : "active",
        overrideUpdatedAt: pickString(r, [
          "overrideUpdatedAt",
          "override_updated_at",
        ]),
        evidence: matchedEvidence,
      };
    })
    .filter((r): r is JobRequirementSummary => r !== null);

  const rootApp = asRecord(root.application);

  return {
    ...base,
    userState: resolvedUserState,
    userStateNotes:
      (rootUserJobState
        ? pickString(rootUserJobState, ["notes"])
        : null) ?? base.userStateNotes,
    compensationOverride: resolvedCompensationOverride,
    salarySourceType:
      base.salaryMin !== null || base.salaryMax !== null
        ? base.salarySourceType
        : resolvedCompensationOverride
          ? "user_supplied"
          : base.salarySourceType,
    documentedFitScore: resolvedFitScore,
    searchSkillAlignmentScore: resolvedSkillAlignScore,
    priorityScore: resolvedPriorityScore,
    hardFilterPassed:
      latestMatch?.hardFilterPassed ?? base.hardFilterPassed,
    hardFilterStatus:
      latestMatch?.hardFilterStatus ?? base.hardFilterStatus,
    latestMatch,
    duplicateCandidateCount: Math.max(
      base.duplicateCandidateCount,
      duplicateCandidates.length
    ),
    hasDuplicateCandidates:
      base.hasDuplicateCandidates || duplicateCandidates.length > 0,
    descriptionText:
      pickString(jobRec, ["descriptionText", "description_text"]) ?? "",
    descriptionHtmlSanitized: pickString(jobRec, [
      "descriptionHtmlSanitized",
      "description_html_sanitized",
    ]),
    sourceRecords,
    duplicateCandidates,
    requirements,
    applicationId:
      pickString(jobRec, ["applicationId", "application_id"]) ??
      pickString(root, ["applicationId"]) ??
      (rootApp ? pickString(rootApp, ["id"]) : null),
  };
}

export function computeFreshness(employerPostedAt: string | null): {
  label: FreshnessLabel;
  tone: "accent" | "neutral" | "warning";
} {
  if (!employerPostedAt) {
    return { label: "Date unknown", tone: "neutral" };
  }
  const parsed = new Date(employerPostedAt);
  if (Number.isNaN(parsed.getTime())) {
    return { label: "Date unknown", tone: "neutral" };
  }
  const ageHours = (Date.now() - parsed.getTime()) / (1000 * 60 * 60);
  if (ageHours < 24) {
    return { label: "Very recent", tone: "accent" };
  }
  if (ageHours <= 72) {
    return { label: "Recent", tone: "accent" };
  }
  if (ageHours <= 24 * 7) {
    return { label: "This week", tone: "neutral" };
  }
  return { label: "Older", tone: "neutral" };
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatSalaryRange(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: SalaryPeriod | null
): string | null {
  if (min === null && max === null) return null;
  const curr = currency?.trim() || "";
  const formatNum = (n: number) => {
    try {
      if (curr && curr.length === 3) {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: curr.toUpperCase(),
          maximumFractionDigits: 0,
        }).format(n);
      }
    } catch {
      // Fallback to plain tabular formatting
    }
    return `${curr ? `${curr} ` : ""}${n.toLocaleString()}`;
  };

  let rangeText = "";
  if (min !== null && max !== null && min !== max) {
    rangeText = `${formatNum(min)} – ${formatNum(max)}`;
  } else {
    const single = min ?? max;
    rangeText = single !== null ? formatNum(single) : "";
  }

  if (!rangeText) return null;
  if (period && period !== "unknown") {
    return `${rangeText} / ${period}`;
  }
  return rangeText;
}

export function formatWorkplaceLabel(type: WorkplaceType): string {
  switch (type) {
    case "remote":
      return "Remote";
    case "hybrid":
      return "Hybrid";
    case "onsite":
      return "Onsite";
    case "unspecified":
      return "Workplace unspecified";
  }
}

export function isSafeExternalHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

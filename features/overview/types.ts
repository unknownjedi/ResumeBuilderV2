import {
  asRecord,
  formatSalaryRange,
  normalizeCompensationOverride,
  normalizeLatestMatch,
  type AnalysisStatus,
  type CompensationOverrideItem,
  type LatestMatchDetail,
  type SalaryPeriod,
  type SalaryProvenance,
  type UserJobDiscoveryState,
  type WorkplaceType,
} from "@/features/job-discovery/types";

export interface OverviewRequirementCounts {
  supported: number;
  partiallySupported: number;
  notFoundInProfile: number;
  ambiguous: number;
  total: number;
}

export interface OverviewRecommendationItem {
  jobId: string;
  title: string;
  companyName: string;
  locationText: string | null;
  workplaceType: WorkplaceType;
  employmentType: string | null;
  primarySourceName: string | null;
  applyUrl: string | null;
  canonicalUrl: string | null;
  employerPostedAt: string | null;
  firstSeenAt: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salarySourceType: SalaryProvenance;
  compensationOverride: CompensationOverrideItem | null;
  analysisStatus: AnalysisStatus;
  documentedFitScore: number | null;
  documentedFitLabel: string | null;
  searchSkillAlignmentScore: number | null;
  priorityScore: number | null;
  rankingMode: "priority" | "basic_relevance";
  matchReason: string | null;
  includedFactorNames: string[];
  weightsRenormalized: boolean;
  requirementCounts: OverviewRequirementCounts | null;
  latestMatch: LatestMatchDetail | null;
  userState: UserJobDiscoveryState | null;
}

export interface NeedsAttentionItem {
  id: string;
  kind:
    | "draft_review"
    | "ready_application"
    | "source_failure"
    | "duplicate_candidate"
    | "profile_review";
  title: string;
  detail: string;
  href: string;
  severity: "warning" | "danger" | "neutral";
  count?: number;
}

export interface OverviewScanStatus {
  lastSuccessfulScanAt: string | null;
  nextScheduledScanAt: string | null;
  activeSourcesCount: number;
  failingSourcesCount: number;
}

export interface OverviewPayload {
  activeProfileId: string | null;
  activeProfileName: string | null;
  rankingMode: "priority" | "basic_relevance";
  orderingLabel: string | null;
  totalEligible: number;
  unanalyzedCount: number;
  withheldPendingSkillFilterCount: number;
  actionAnalysisCap: number;
  recommendations: OverviewRecommendationItem[];
  needsAttention: NeedsAttentionItem[];
  scanStatus: OverviewScanStatus;
  hasProfileFacts: boolean;
  hasSearchProfiles: boolean;
  hasAnyJobs: boolean;
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

function normalizeWorkplaceType(val: string | null): WorkplaceType {
  if (val === "remote" || val === "hybrid" || val === "onsite") return val;
  return "unspecified";
}

function normalizeSalaryPeriod(val: string | null): SalaryPeriod | null {
  if (val === "hour" || val === "month" || val === "year" || val === "unknown") {
    return val;
  }
  return null;
}

function normalizeRequirementCounts(
  raw: unknown
): OverviewRequirementCounts | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const supported = pickNumber(rec, ["supported"]) ?? 0;
  const partiallySupported =
    pickNumber(rec, ["partiallySupported", "partially_supported", "partial"]) ??
    0;
  const notFoundInProfile =
    pickNumber(rec, [
      "notFoundInProfile",
      "not_found_in_profile",
      "notFound",
      "missing",
    ]) ?? 0;
  const ambiguous = pickNumber(rec, ["ambiguous"]) ?? 0;
  const total =
    pickNumber(rec, ["total"]) ??
    supported + partiallySupported + notFoundInProfile + ambiguous;
  if (total === 0) return null;
  return {
    supported,
    partiallySupported,
    notFoundInProfile,
    ambiguous,
    total,
  };
}

export function normalizeRecommendationItem(
  raw: unknown
): OverviewRecommendationItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const jobRec = asRecord(rec.job) ?? rec;
  const jobId =
    pickString(rec, ["jobId", "job_id"]) ?? pickString(jobRec, ["id"]);
  if (!jobId) return null;

  const matchRec = asRecord(rec.match) ?? asRecord(rec.latestMatch);
  const latestMatch = normalizeLatestMatch(matchRec ?? rec);
  const salaryRec = asRecord(rec.salary);
  const sourceRec = asRecord(rec.source);

  const salaryMin =
    (salaryRec ? pickNumber(salaryRec, ["min", "minAmount"]) : null) ??
    pickNumber(jobRec, ["salaryMin", "salary_min"]);
  const salaryMax =
    (salaryRec ? pickNumber(salaryRec, ["max", "maxAmount"]) : null) ??
    pickNumber(jobRec, ["salaryMax", "salary_max"]);
  const salaryCurrency =
    (salaryRec ? pickString(salaryRec, ["currency"]) : null) ??
    pickString(jobRec, ["salaryCurrency", "salary_currency"]);
  const salaryPeriod = normalizeSalaryPeriod(
    (salaryRec ? pickString(salaryRec, ["period"]) : null) ??
      pickString(jobRec, ["salaryPeriod", "salary_period"])
  );
  const rawSalarySource =
    (salaryRec ? pickString(salaryRec, ["source"]) : null) ??
    pickString(jobRec, ["salarySourceType", "salary_source_type"]);

  const compensationOverride = normalizeCompensationOverride(
    rec.compensationOverride ??
      jobRec.compensationOverride ??
      jobRec.compensation_override
  );

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

  const documentedFitScore =
    pickNumber(rec, ["documentedFitScore", "documented_fit_score"]) ??
    latestMatch?.documentedFitScore ??
    null;
  const searchSkillAlignmentScore =
    pickNumber(rec, [
      "searchSkillAlignmentScore",
      "search_skill_alignment_score",
    ]) ??
    latestMatch?.searchSkillAlignmentScore ??
    null;
  const priorityScore =
    pickNumber(rec, ["priorityScore", "priority_score"]) ??
    latestMatch?.priorityScore ??
    null;

  const rawMode = pickString(rec, [
    "orderingBasis",
    "ordering_basis",
    "rankingMode",
    "ranking_mode",
  ]);
  const rankingMode: "priority" | "basic_relevance" =
    rawMode === "basic_relevance" || priorityScore === null
      ? "basic_relevance"
      : "priority";

  const rawAnalysisStatus = pickString(jobRec, [
    "analysisStatus",
    "analysis_status",
  ]);
  const analysisStatus: AnalysisStatus =
    rawAnalysisStatus === "deterministic" ||
    rawAnalysisStatus === "ai" ||
    rawAnalysisStatus === "failed"
      ? rawAnalysisStatus
      : "pending";

  const rawUserState = pickString(rec, [
    "userState",
    "user_state",
    "discoveryState",
    "discovery_state",
  ]);
  const userState: UserJobDiscoveryState | null =
    rawUserState === "saved" ||
    rawUserState === "dismissed" ||
    rawUserState === "hidden"
      ? rawUserState
      : null;

  const includedFactorNames = Array.isArray(rec.includedFactors)
    ? rec.includedFactors.filter((f): f is string => typeof f === "string")
    : [];

  return {
    jobId,
    title: pickString(jobRec, ["title"]) ?? "Untitled role",
    companyName:
      pickString(jobRec, ["companyName", "company_name"]) ?? "Unknown company",
    locationText: pickString(jobRec, ["locationText", "location_text"]),
    workplaceType: normalizeWorkplaceType(
      pickString(jobRec, ["workplaceType", "workplace_type"])
    ),
    employmentType: pickString(jobRec, ["employmentType", "employment_type"]),
    primarySourceName:
      (sourceRec ? pickString(sourceRec, ["displayName", "name"]) : null) ??
      pickString(rec, [
        "primarySourceName",
        "sourceName",
        "primary_source_name",
      ]) ??
      pickString(jobRec, ["primarySourceName", "sourceName"]),
    applyUrl: pickString(jobRec, ["applyUrl", "apply_url"]),
    canonicalUrl: pickString(jobRec, ["canonicalUrl", "canonical_url"]),
    employerPostedAt: pickString(jobRec, [
      "employerPostedAt",
      "employer_posted_at",
    ]),
    firstSeenAt:
      pickString(jobRec, ["firstSeenAt", "first_seen_at"]) ?? "",
    salaryMin,
    salaryMax,
    salaryCurrency,
    salaryPeriod,
    salarySourceType,
    compensationOverride,
    analysisStatus,
    documentedFitScore,
    documentedFitLabel: pickString(rec, [
      "documentedFitLabel",
      "documented_fit_label",
    ]),
    searchSkillAlignmentScore,
    priorityScore,
    rankingMode,
    matchReason: pickString(rec, [
      "matchReason",
      "match_reason",
      "reason",
      "summary",
    ]),
    includedFactorNames,
    weightsRenormalized:
      Boolean(rec.weightsRenormalized) ||
      Boolean(latestMatch?.renormalized),
    requirementCounts: normalizeRequirementCounts(
      rec.requirementCounts ?? rec.requirement_counts ?? rec.evidenceCounts
    ),
    latestMatch,
    userState,
  };
}

export function getOverviewSalaryDisplay(
  item: OverviewRecommendationItem
): { text: string; provenanceLabel: string } | null {
  if (item.salarySourceType === "user_supplied") {
    const userSupplied = formatSalaryRange(
      item.compensationOverride?.minAmount ?? item.salaryMin,
      item.compensationOverride?.maxAmount ?? item.salaryMax,
      item.compensationOverride?.currency ?? item.salaryCurrency,
      item.compensationOverride?.period ?? item.salaryPeriod
    );
    if (userSupplied) {
      return { text: userSupplied, provenanceLabel: "User supplied" };
    }
  }

  const disclosed = formatSalaryRange(
    item.salaryMin,
    item.salaryMax,
    item.salaryCurrency,
    item.salaryPeriod
  );
  if (disclosed && item.salarySourceType === "employer_disclosed") {
    return { text: disclosed, provenanceLabel: "Employer disclosed" };
  }

  if (item.compensationOverride) {
    const userSupplied = formatSalaryRange(
      item.compensationOverride.minAmount,
      item.compensationOverride.maxAmount,
      item.compensationOverride.currency,
      item.compensationOverride.period
    );
    if (userSupplied) {
      return { text: userSupplied, provenanceLabel: "User supplied" };
    }
  }
  return null;
}

export function normalizeOverviewPayload(raw: unknown): OverviewPayload {
  const root = asRecord(raw) ?? {};
  const rawRecs = Array.isArray(root.recommendations)
    ? root.recommendations
    : Array.isArray(root.items)
      ? root.items
      : [];
  const recommendations = rawRecs
    .map(normalizeRecommendationItem)
    .filter((r): r is OverviewRecommendationItem => r !== null)
    .slice(0, 10);

  const needsAttention: NeedsAttentionItem[] = [];
  const rawAttention = root.needsAttention;
  if (Array.isArray(rawAttention)) {
    for (const item of rawAttention) {
      const r = asRecord(item);
      if (!r) continue;
      const title = pickString(r, ["title", "label"]);
      const href = pickString(r, ["href", "url"]) ?? "/discover";
      if (!title) continue;
      const sev = pickString(r, ["severity"]);
      const kindRaw = pickString(r, ["kind", "type"]);
      const kind: NeedsAttentionItem["kind"] =
        kindRaw === "draft_review" ||
        kindRaw === "ready_application" ||
        kindRaw === "source_failure" ||
        kindRaw === "duplicate_candidate" ||
        kindRaw === "profile_review"
          ? kindRaw
          : "draft_review";
      needsAttention.push({
        id: pickString(r, ["id"]) ?? `${kind}-${needsAttention.length}`,
        kind,
        title,
        detail: pickString(r, ["detail", "description"]) ?? "",
        href,
        severity:
          sev === "danger" || sev === "warning" ? sev : "neutral",
        count: pickNumber(r, ["count"]) ?? undefined,
      });
    }
  } else {
    const attRec = asRecord(rawAttention);
    if (attRec) {
      const countsRec = asRecord(attRec.counts);
      const draftsCount =
        (countsRec
          ? pickNumber(countsRec, ["draftsAwaitingReview"])
          : null) ??
        pickNumber(attRec, ["draftsAwaitingReviewCount", "draftsCount"]) ??
        (Array.isArray(attRec.draftsAwaitingReview)
          ? attRec.draftsAwaitingReview.length
          : 0);
      if (draftsCount > 0) {
        needsAttention.push({
          id: "drafts-review",
          kind: "draft_review",
          title: `${draftsCount} draft${draftsCount === 1 ? "" : "s"} awaiting review`,
          detail: "Verify edited claims before exporting.",
          href: "/resumes",
          severity: "warning",
          count: draftsCount,
        });
      }

      const readyCount =
        (countsRec
          ? pickNumber(countsRec, ["applicationsReadyToSubmit"])
          : null) ??
        pickNumber(attRec, ["applicationsReadyCount", "readyApplicationsCount"]) ??
        (Array.isArray(attRec.applicationsReadyToSubmit)
          ? attRec.applicationsReadyToSubmit.length
          : 0);
      if (readyCount > 0) {
        needsAttention.push({
          id: "ready-apps",
          kind: "ready_application",
          title: `${readyCount} application${readyCount === 1 ? "" : "s"} ready to submit`,
          detail: "Open employer links and confirm submitted materials.",
          href: "/applications",
          severity: "neutral",
          count: readyCount,
        });
      }

      const sourceFailures =
        (countsRec ? pickNumber(countsRec, ["sourceFailures"]) : null) ??
        pickNumber(attRec, ["sourceFailuresCount", "failingSourcesCount"]) ??
        (Array.isArray(attRec.sourceFailures)
          ? attRec.sourceFailures.length
          : 0);
      if (sourceFailures > 0) {
        needsAttention.push({
          id: "source-failures",
          kind: "source_failure",
          title: `${sourceFailures} source${sourceFailures === 1 ? "" : "s"} failing`,
          detail: "Check job source health and error details in Settings.",
          href: "/settings?tab=sources",
          severity: "danger",
          count: sourceFailures,
        });
      }

      const dupCount =
        (countsRec ? pickNumber(countsRec, ["pendingDuplicates"]) : null) ??
        pickNumber(attRec, ["duplicateCandidatesCount", "duplicatesCount"]) ??
        0;
      if (dupCount > 0) {
        needsAttention.push({
          id: "duplicate-candidates",
          kind: "duplicate_candidate",
          title: `${dupCount} duplicate candidate${dupCount === 1 ? "" : "s"} to review`,
          detail: "Merge or dismiss suggested duplicate job postings.",
          href: "/discover",
          severity: "warning",
          count: dupCount,
        });
      }

      const profileReviewCount =
        (countsRec
          ? pickNumber(countsRec, ["profileNeedsReviewCount"])
          : null) ??
        pickNumber(attRec, ["profileNeedsReviewCount"]) ??
        0;
      if (profileReviewCount > 0) {
        needsAttention.push({
          id: "profile-review",
          kind: "profile_review",
          title: `${profileReviewCount} career fact${profileReviewCount === 1 ? "" : "s"} need review`,
          detail: "Verify extracted facts so they count toward Documented Fit.",
          href: "/profile",
          severity: "neutral",
          count: profileReviewCount,
        });
      }
    }
  }

  const scanRec =
    asRecord(root.scanSummary) ?? asRecord(root.scanStatus) ?? root;
  const profileRec =
    asRecord(root.activeSearchProfile) ??
    asRecord(root.searchProfile) ??
    asRecord(root.activeProfile);
  const metaRec = asRecord(root.rankingMeta) ?? root;

  const rawRankingMode = pickString(metaRec, ["orderingMode", "rankingMode", "mode"]);
  const rankingMode: "priority" | "basic_relevance" =
    rawRankingMode === "basic_relevance" ||
    (recommendations.length > 0 &&
      recommendations.every((r) => r.rankingMode === "basic_relevance"))
      ? "basic_relevance"
      : "priority";

  const rawProfiles = Array.isArray(root.searchProfiles)
    ? root.searchProfiles
    : [];

  const totalEligible =
    pickNumber(metaRec, [
      "totalEligibleOpenJobs",
      "totalEligible",
      "total",
    ]) ?? recommendations.length;

  return {
    activeProfileId:
      pickString(root, ["activeProfileId", "searchProfileId"]) ??
      (profileRec ? pickString(profileRec, ["id"]) : null),
    activeProfileName:
      pickString(root, ["activeProfileName", "searchProfileName"]) ??
      (profileRec ? pickString(profileRec, ["name"]) : null),
    rankingMode,
    orderingLabel: pickString(root, ["orderingLabel"]),
    totalEligible,
    unanalyzedCount:
      pickNumber(metaRec, ["unanalyzedCount", "pendingAnalysisCount"]) ??
      recommendations.filter((r) => r.analysisStatus === "pending").length,
    withheldPendingSkillFilterCount:
      pickNumber(metaRec, [
        "withheldPendingSkillFilterCount",
        "pendingSkillFilterCount",
      ]) ?? 0,
    actionAnalysisCap:
      pickNumber(root, ["actionAnalysisCap", "maxJobsPerAnalysisAction"]) ?? 10,
    recommendations,
    needsAttention,
    scanStatus: {
      lastSuccessfulScanAt: pickString(scanRec, [
        "lastSuccessfulScanAt",
        "lastScanAt",
        "lastSuccessAt",
      ]),
      nextScheduledScanAt: pickString(scanRec, [
        "nextScheduledScanAt",
        "nextScanAt",
      ]),
      activeSourcesCount:
        pickNumber(scanRec, ["enabledSourcesCount", "activeSourcesCount"]) ?? 0,
      failingSourcesCount:
        pickNumber(scanRec, ["failingSourcesCount"]) ?? 0,
    },
    hasProfileFacts:
      typeof root.hasProfileFacts === "boolean" ? root.hasProfileFacts : true,
    hasSearchProfiles:
      typeof root.hasSearchProfiles === "boolean"
        ? root.hasSearchProfiles
        : rawProfiles.length > 0 || Boolean(profileRec || root.activeProfileId),
    hasAnyJobs:
      typeof root.hasAnyJobs === "boolean"
        ? root.hasAnyJobs
        : totalEligible > 0 || recommendations.length > 0,
  };
}

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { evidenceLinks } from "./career";

export const SKILL_PREFERENCES = ["must_have", "preferred", "excluded"] as const;
export type SkillPreference = (typeof SKILL_PREFERENCES)[number];

export const SKILL_FILTER_MODES = ["hard", "weighted"] as const;
export type SkillFilterMode = (typeof SKILL_FILTER_MODES)[number];

export const SOURCE_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "generic_career_page",
  "manual",
  "gmail",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_HEALTH_STATES = [
  "healthy",
  "degraded",
  "failing",
  "paused",
  "untested",
] as const;
export type SourceHealthState = (typeof SOURCE_HEALTH_STATES)[number];

export const SOURCE_RUN_OUTCOMES = [
  "running",
  "succeeded",
  "partial",
  "failed",
  "skipped_not_modified",
] as const;
export type SourceRunOutcome = (typeof SOURCE_RUN_OUTCOMES)[number];

export const WORKPLACE_TYPES = [
  "remote",
  "hybrid",
  "onsite",
  "unspecified",
] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const JOB_STATUSES = [
  "open",
  "possibly_closed",
  "closed",
  "unknown",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SALARY_PERIODS = ["hour", "month", "year", "unknown"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const REQUIREMENT_CATEGORIES = [
  "skill",
  "experience",
  "education",
  "responsibility",
  "domain",
  "other",
] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export const REQUIREMENT_PRIORITIES = [
  "must_have",
  "preferred",
  "responsibility",
  "unspecified",
] as const;
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];

export const MACHINE_SUPPORT_STATES = [
  "supported",
  "partially_supported",
  "not_found_in_profile",
  "ambiguous",
] as const;
export type MachineSupportState = (typeof MACHINE_SUPPORT_STATES)[number];

export const CANDIDATE_RESPONSES = [
  "not_reviewed",
  "candidate_confirms_has",
  "candidate_confirms_does_not_have",
] as const;
export type CandidateResponse = (typeof CANDIDATE_RESPONSES)[number];

export const DUPLICATE_STATES = ["proposed", "dismissed", "merged"] as const;
export type DuplicateState = (typeof DUPLICATE_STATES)[number];

export const USER_JOB_DISCOVERY_STATES = [
  "saved",
  "dismissed",
  "hidden",
] as const;
export type UserJobDiscoveryState = (typeof USER_JOB_DISCOVERY_STATES)[number];

export const searchProfiles = sqliteTable("search_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  targetTitlesJson: text("target_titles_json").notNull().default("[]"),
  targetSeniorityJson: text("target_seniority_json").notNull().default("[]"),
  minYearsExperience: integer("min_years_experience"),
  maxYearsExperience: integer("max_years_experience"),
  locationsJson: text("locations_json").notNull().default("[]"),
  remoteEligibleCountriesJson: text("remote_eligible_countries_json")
    .notNull()
    .default("[]"),
  workplaceTypesJson: text("workplace_types_json").notNull().default("[]"),
  employmentTypesJson: text("employment_types_json").notNull().default("[]"),
  relocationAllowed: integer("relocation_allowed", { mode: "boolean" }),
  maxJobAgeDays: integer("max_job_age_days"),
  hardFiltersJson: text("hard_filters_json").notNull().default("{}"),
  rankingWeightsJson: text("ranking_weights_json").notNull().default("{}"),
  resumePreferencesJson: text("resume_preferences_json").notNull().default("{}"),
  failClosedOnUnknown: integer("fail_closed_on_unknown", { mode: "boolean" })
    .notNull()
    .default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Intentionally has NO foreign key to candidate `skills.id`.
 */
export const searchProfileSkills = sqliteTable(
  "search_profile_skills",
  {
    id: text("id").primaryKey(),
    searchProfileId: text("search_profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "cascade" }),
    normalizedSkillKey: text("normalized_skill_key").notNull(),
    displayLabel: text("display_label").notNull(),
    aliasesJson: text("aliases_json").notNull().default("[]"),
    preference: text("preference", { enum: SKILL_PREFERENCES }).notNull(),
    filterMode: text("filter_mode", { enum: SKILL_FILTER_MODES }).notNull(),
    weight: real("weight"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("search_profile_skills_profile_key_uidx").on(
      t.searchProfileId,
      t.normalizedSkillKey
    ),
  ]
);

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    website: text("website"),
    aliasesJson: text("aliases_json").notNull().default("[]"),
    industryTagsJson: text("industry_tags_json").notNull().default("[]"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("companies_normalized_name_idx").on(t.normalizedName)]
);

export const jobSources = sqliteTable(
  "job_sources",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type", { enum: SOURCE_TYPES }).notNull(),
    displayName: text("display_name").notNull(),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    sourceIdentifier: text("source_identifier"),
    baseUrl: text("base_url"),
    configJson: text("config_json").notNull().default("{}"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    refreshIntervalMinutes: integer("refresh_interval_minutes")
      .notNull()
      .default(360),
    healthState: text("health_state", { enum: SOURCE_HEALTH_STATES })
      .notNull()
      .default("untested"),
    lastAttemptAt: text("last_attempt_at"),
    lastSuccessAt: text("last_success_at"),
    lastSuccessfulFullScanAt: text("last_successful_full_scan_at"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    lastErrorDetail: text("last_error_detail"),
    lastEtag: text("last_etag"),
    lastModified: text("last_modified"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("job_sources_type_identifier_uidx")
      .on(t.sourceType, t.sourceIdentifier)
      .where(sql`${t.sourceIdentifier} IS NOT NULL`),
    index("job_sources_enabled_idx").on(t.enabled),
  ]
);

export const sourceRuns = sqliteTable(
  "source_runs",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => jobSources.id, { onDelete: "cascade" }),
    taskId: text("task_id"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    fetchedCount: integer("fetched_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    closedCount: integer("closed_count").notNull().default(0),
    isCompleteSnapshot: integer("is_complete_snapshot", { mode: "boolean" })
      .notNull()
      .default(false),
    outcome: text("outcome", { enum: SOURCE_RUN_OUTCOMES })
      .notNull()
      .default("running"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("source_runs_source_started_idx").on(t.sourceId, t.startedAt)]
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    companyName: text("company_name").notNull(),
    primarySourceId: text("primary_source_id").references(() => jobSources.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    descriptionText: text("description_text").notNull(),
    descriptionHtmlSanitized: text("description_html_sanitized"),
    descriptionHash: text("description_hash").notNull(),
    locationText: text("location_text"),
    countryCode: text("country_code"),
    workplaceType: text("workplace_type", { enum: WORKPLACE_TYPES })
      .notNull()
      .default("unspecified"),
    employmentType: text("employment_type"),
    seniorityLevel: text("seniority_level"),
    seniorityMinYears: real("seniority_min_years"),
    seniorityMaxYears: real("seniority_max_years"),
    salaryMin: real("salary_min"),
    salaryMax: real("salary_max"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period", { enum: SALARY_PERIODS }),
    salarySourceType: text("salary_source_type", {
      enum: ["employer_disclosed", "unknown"],
    }),
    employerPostedAt: text("employer_posted_at"),
    dateConflictJson: text("date_conflict_json"),
    sourceUpdatedAt: text("source_updated_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    lastVerifiedAt: text("last_verified_at").notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("open"),
    canonicalUrl: text("canonical_url"),
    applyUrl: text("apply_url"),
    mergedIntoJobId: text("merged_into_job_id"),
    mergedAt: text("merged_at"),
    analysisStatus: text("analysis_status", {
      enum: ["pending", "deterministic", "ai", "failed"],
    })
      .notNull()
      .default("pending"),
    analysisVersion: text("analysis_version"),
    analyzedDescriptionHash: text("analyzed_description_hash"),
    analyzedAt: text("analyzed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("jobs_status_idx").on(t.status),
    index("jobs_employer_posted_at_idx").on(t.employerPostedAt),
    index("jobs_first_seen_at_idx").on(t.firstSeenAt),
    index("jobs_primary_source_id_idx").on(t.primarySourceId),
    index("jobs_company_id_idx").on(t.companyId),
    index("jobs_merged_into_idx").on(t.mergedIntoJobId),
  ]
);

export const jobSourceRecords = sqliteTable(
  "job_source_records",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => jobSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url"),
    applyUrl: text("apply_url"),
    rawJson: text("raw_json").notNull(),
    sourcePostedAtText: text("source_posted_at_text"),
    sourcePostedAt: text("source_posted_at"),
    sourceUpdatedAt: text("source_updated_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    missingRunCount: integer("missing_run_count").notNull().default(0),
    recordStatus: text("record_status", {
      enum: ["open", "possibly_closed", "closed"],
    })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("job_source_records_source_external_uidx").on(
      t.sourceId,
      t.externalId
    ),
    index("job_source_records_job_id_idx").on(t.jobId),
  ]
);

export const jobRequirements = sqliteTable(
  "job_requirements",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    requirementKey: text("requirement_key").notNull(),
    requirementText: text("requirement_text").notNull(),
    normalizedSkill: text("normalized_skill"),
    category: text("category", { enum: REQUIREMENT_CATEGORIES }).notNull(),
    priority: text("priority", { enum: REQUIREMENT_PRIORITIES })
      .notNull()
      .default("unspecified"),
    machineSupportState: text("machine_support_state", {
      enum: MACHINE_SUPPORT_STATES,
    })
      .notNull()
      .default("not_found_in_profile"),
    candidateResponse: text("candidate_response", {
      enum: CANDIDATE_RESPONSES,
    })
      .notNull()
      .default("not_reviewed"),
    extractionConfidence: real("extraction_confidence"),
    analysisSource: text("analysis_source", {
      enum: ["deterministic", "ai", "manual"],
    })
      .notNull()
      .default("deterministic"),
    analysisVersion: text("analysis_version").notNull(),
    stableSignature: text("stable_signature").notNull(),
    userPriorityOverride: text("user_priority_override", {
      enum: REQUIREMENT_PRIORITIES,
    }),
    overrideState: text("override_state", { enum: ["active", "orphaned"] })
      .notNull()
      .default("active"),
    overrideUpdatedAt: text("override_updated_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("job_requirements_job_id_idx").on(t.jobId),
    index("job_requirements_signature_idx").on(t.jobId, t.stableSignature),
  ]
);

export const jobCompensationOverrides = sqliteTable(
  "job_compensation_overrides",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    minAmount: real("min_amount"),
    maxAmount: real("max_amount"),
    currency: text("currency"),
    period: text("period", { enum: SALARY_PERIODS }),
    provenance: text("provenance").notNull().default("user_supplied"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("job_compensation_overrides_job_uidx").on(t.jobId)]
);

export const jobDuplicateCandidates = sqliteTable(
  "job_duplicate_candidates",
  {
    id: text("id").primaryKey(),
    jobAId: text("job_a_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    jobBId: text("job_b_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    matchMethod: text("match_method").notNull(),
    evidenceJson: text("evidence_json").notNull().default("{}"),
    similarityScore: real("similarity_score").notNull(),
    state: text("state", { enum: DUPLICATE_STATES })
      .notNull()
      .default("proposed"),
    jobADescriptionHash: text("job_a_description_hash"),
    jobBDescriptionHash: text("job_b_description_hash"),
    createdAt: text("created_at").notNull(),
    dismissedAt: text("dismissed_at"),
    resolvedAt: text("resolved_at"),
  },
  (t) => [
    uniqueIndex("job_duplicate_candidates_pair_uidx").on(t.jobAId, t.jobBId),
    index("job_duplicate_candidates_state_idx").on(t.state),
  ]
);

export const matchRuns = sqliteTable(
  "match_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    searchProfileId: text("search_profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "cascade" }),
    documentedFitScore: real("documented_fit_score"),
    searchSkillAlignmentScore: real("search_skill_alignment_score"),
    priorityScore: real("priority_score"),
    hardFilterPassed: integer("hard_filter_passed", { mode: "boolean" })
      .notNull()
      .default(true),
    hardFilterStatus: text("hard_filter_status", {
      enum: ["eligible", "excluded", "pending_analysis"],
    })
      .notNull()
      .default("eligible"),
    includedFactorsJson: text("included_factors_json").notNull().default("{}"),
    inputsSnapshotJson: text("inputs_snapshot_json").notNull().default("{}"),
    weightVersion: text("weight_version").notNull(),
    calculationVersion: text("calculation_version").notNull(),
    analysisVersion: text("analysis_version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("match_runs_job_profile_idx").on(t.jobId, t.searchProfileId),
    index("match_runs_profile_priority_idx").on(
      t.searchProfileId,
      t.priorityScore
    ),
  ]
);

export const matchEvidence = sqliteTable(
  "match_evidence",
  {
    id: text("id").primaryKey(),
    matchRunId: text("match_run_id")
      .notNull()
      .references(() => matchRuns.id, { onDelete: "cascade" }),
    jobRequirementId: text("job_requirement_id")
      .notNull()
      .references(() => jobRequirements.id, { onDelete: "cascade" }),
    supportState: text("support_state", {
      enum: MACHINE_SUPPORT_STATES,
    }).notNull(),
    linkedFactType: text("linked_fact_type"),
    linkedFactId: text("linked_fact_id"),
    evidenceLinkId: text("evidence_link_id").references(() => evidenceLinks.id, {
      onDelete: "set null",
    }),
    explanation: text("explanation"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("match_evidence_run_idx").on(t.matchRunId)]
);

export const userJobStates = sqliteTable(
  "user_job_states",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    searchProfileId: text("search_profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "cascade" }),
    discoveryState: text("discovery_state", {
      enum: USER_JOB_DISCOVERY_STATES,
    }).notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("user_job_states_job_profile_uidx").on(
      t.jobId,
      t.searchProfileId
    ),
    index("user_job_states_profile_state_idx").on(
      t.searchProfileId,
      t.discoveryState
    ),
  ]
);

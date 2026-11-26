export const SKILL_PREFERENCES = ["must_have", "preferred", "excluded"] as const;
export type SkillPreference = (typeof SKILL_PREFERENCES)[number];

export const SKILL_FILTER_MODES = ["hard", "weighted"] as const;
export type SkillFilterMode = (typeof SKILL_FILTER_MODES)[number];

export const PROFILE_WORKPLACE_TYPES = ["remote", "hybrid", "onsite"] as const;
export type ProfileWorkplaceType = (typeof PROFILE_WORKPLACE_TYPES)[number];

export const SALARY_PERIOD_OPTIONS = ["year", "month", "hour"] as const;
export type SalaryPeriodOption = (typeof SALARY_PERIOD_OPTIONS)[number];

export interface SearchProfileSkill {
  id: string;
  searchProfileId: string;
  normalizedSkillKey: string;
  displayLabel: string;
  aliases: string[];
  preference: SkillPreference;
  filterMode: SkillFilterMode;
  weight: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchProfileHardFilters {
  workplaceTypesHard: boolean;
  locationsHard: boolean;
  remoteCountriesHard: boolean;
  employmentTypesHard: boolean;
  seniorityHard: boolean;
  yearsExperienceHard: boolean;
  compensationHard: boolean;
  excludeMissingSalary: boolean;
  maxJobAgeHard: boolean;
  relocationHardNo: boolean;
  excludedCompaniesHard: boolean;
  excludedSourcesHard: boolean;
  includeUnknownPostedDate: boolean;
}

export interface SearchProfileRankingWeights {
  documentedFit: number;
  searchSkillAlignment: number;
  freshness: number;
  locationWorkMode: number;
  compensation: number;
  companyIndustry: number;
}

export interface SearchProfileResumePreferences {
  paperSize: "A4" | "Letter";
  pagePreference: "1_page" | "2_pages" | "auto";
  wordingStyle: "concise" | "descriptive";
  template: string | null;
  sectionOrder: string[];
  coverLetterTone: string | null;
  coverLetterLength: "short" | "medium" | "long";
  firstPerson: boolean;
  allowCompanyResearch: boolean;
}

export interface SearchProfileRecord {
  id: string;
  name: string;
  enabled: boolean;
  isDefault?: boolean;
  targetTitles: string[];
  titleAliases: string[];
  targetSeniority: string[];
  minYearsExperience: number | null;
  maxYearsExperience: number | null;
  locations: string[];
  excludedLocations: string[];
  remoteEligibleCountries: string[];
  workplaceTypes: ProfileWorkplaceType[];
  employmentTypes: string[];
  relocationAllowed: boolean | null;
  maxJobAgeDays: number | null;
  preferredRecencyDays: number | null;
  minCompensation: number | null;
  targetCompensation: number | null;
  compensationCurrency: string | null;
  compensationPeriod: SalaryPeriodOption | null;
  preferredCompanies: string[];
  excludedCompanies: string[];
  preferredIndustries: string[];
  excludedIndustries: string[];
  includedSources: string[];
  excludedSources: string[];
  failClosedOnUnknown: boolean;
  hardFilters: SearchProfileHardFilters;
  rankingWeights: SearchProfileRankingWeights;
  resumePreferences: SearchProfileResumePreferences;
  skills: SearchProfileSkill[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchProfileFormInput {
  name: string;
  enabled: boolean;
  targetTitles: string[];
  titleAliases: string[];
  targetSeniority: string[];
  minYearsExperience: number | null;
  maxYearsExperience: number | null;
  locations: string[];
  excludedLocations: string[];
  remoteEligibleCountries: string[];
  workplaceTypes: ProfileWorkplaceType[];
  employmentTypes: string[];
  relocationAllowed: boolean | null;
  maxJobAgeDays: number | null;
  preferredRecencyDays: number | null;
  minCompensation: number | null;
  targetCompensation: number | null;
  compensationCurrency: string | null;
  compensationPeriod: SalaryPeriodOption | null;
  preferredCompanies: string[];
  excludedCompanies: string[];
  preferredIndustries: string[];
  excludedIndustries: string[];
  includedSources: string[];
  excludedSources: string[];
  failClosedOnUnknown: boolean;
  hardFilters: SearchProfileHardFilters;
  rankingWeights: SearchProfileRankingWeights;
  resumePreferences: SearchProfileResumePreferences;
}

export interface SearchProfileSkillInput {
  displayLabel: string;
  aliases?: string[];
  preference: SkillPreference;
  filterMode: SkillFilterMode;
  weight?: number | null;
}

export const DEFAULT_RANKING_WEIGHTS: SearchProfileRankingWeights = {
  documentedFit: 45,
  searchSkillAlignment: 15,
  freshness: 15,
  locationWorkMode: 10,
  compensation: 10,
  companyIndustry: 5,
};

export const DEFAULT_SECTION_ORDER = [
  "summary",
  "experience",
  "projects",
  "skills",
  "achievements",
  "education",
  "certifications",
];

export const DEFAULT_HARD_FILTERS: SearchProfileHardFilters = {
  workplaceTypesHard: false,
  locationsHard: false,
  remoteCountriesHard: false,
  employmentTypesHard: false,
  seniorityHard: false,
  yearsExperienceHard: false,
  compensationHard: false,
  excludeMissingSalary: false,
  maxJobAgeHard: false,
  relocationHardNo: false,
  excludedCompaniesHard: true,
  excludedSourcesHard: true,
  includeUnknownPostedDate: true,
};

export const DEFAULT_RESUME_PREFERENCES: SearchProfileResumePreferences = {
  paperSize: "A4",
  pagePreference: "1_page",
  wordingStyle: "concise",
  template: null,
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  coverLetterTone: "direct",
  coverLetterLength: "medium",
  firstPerson: true,
  allowCompanyResearch: false,
};

export function createEmptyProfileFormInput(name = ""): SearchProfileFormInput {
  return {
    name,
    enabled: true,
    targetTitles: [],
    titleAliases: [],
    targetSeniority: [],
    minYearsExperience: null,
    maxYearsExperience: null,
    locations: [],
    excludedLocations: [],
    remoteEligibleCountries: [],
    workplaceTypes: [],
    employmentTypes: [],
    relocationAllowed: null,
    maxJobAgeDays: null,
    preferredRecencyDays: null,
    minCompensation: null,
    targetCompensation: null,
    compensationCurrency: "USD",
    compensationPeriod: "year",
    preferredCompanies: [],
    excludedCompanies: [],
    preferredIndustries: [],
    excludedIndustries: [],
    includedSources: [],
    excludedSources: [],
    failClosedOnUnknown: false,
    hardFilters: { ...DEFAULT_HARD_FILTERS },
    rankingWeights: { ...DEFAULT_RANKING_WEIGHTS },
    resumePreferences: {
      ...DEFAULT_RESUME_PREFERENCES,
      sectionOrder: [...DEFAULT_SECTION_ORDER],
    },
  };
}

export function sumRankingWeights(weights: SearchProfileRankingWeights): number {
  return (
    (Number.isFinite(weights.documentedFit) ? weights.documentedFit : 0) +
    (Number.isFinite(weights.searchSkillAlignment)
      ? weights.searchSkillAlignment
      : 0) +
    (Number.isFinite(weights.freshness) ? weights.freshness : 0) +
    (Number.isFinite(weights.locationWorkMode)
      ? weights.locationWorkMode
      : 0) +
    (Number.isFinite(weights.compensation) ? weights.compensation : 0) +
    (Number.isFinite(weights.companyIndustry) ? weights.companyIndustry : 0)
  );
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

function pickBoolean(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "boolean") return val;
    if (val === 1) return true;
    if (val === 0) return false;
  }
  return null;
}

function parseJsonIfString(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toStringArray(raw: unknown): string[] {
  const parsed = parseJsonIfString(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
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

export function normalizeSearchProfileSkill(raw: unknown): SearchProfileSkill | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = pickString(rec, ["id"]);
  const displayLabel = pickString(rec, ["displayLabel", "display_label", "label"]);
  if (!id || !displayLabel) return null;

  const prefRaw = pickString(rec, ["preference"]);
  const preference: SkillPreference =
    prefRaw === "must_have" || prefRaw === "preferred" || prefRaw === "excluded"
      ? prefRaw
      : "preferred";

  const modeRaw = pickString(rec, ["filterMode", "filter_mode"]);
  const filterMode: SkillFilterMode =
    modeRaw === "hard" || modeRaw === "weighted" ? modeRaw : "weighted";

  return {
    id,
    searchProfileId:
      pickString(rec, ["searchProfileId", "search_profile_id"]) ?? "",
    normalizedSkillKey:
      pickString(rec, ["normalizedSkillKey", "normalized_skill_key"]) ??
      displayLabel.toLowerCase(),
    displayLabel,
    aliases: toStringArray(rec.aliases ?? rec.aliasesJson ?? rec.aliases_json),
    preference,
    filterMode,
    weight: pickNumber(rec, ["weight"]),
    createdAt: pickString(rec, ["createdAt", "created_at"]) ?? "",
    updatedAt: pickString(rec, ["updatedAt", "updated_at"]) ?? "",
  };
}

export function normalizeHardFilters(raw: unknown): SearchProfileHardFilters {
  const rec = asRecord(parseJsonIfString(raw)) ?? {};
  return {
    workplaceTypesHard:
      pickBoolean(rec, ["workplaceTypesHard", "workplaceHard"]) ?? false,
    locationsHard:
      pickBoolean(rec, ["locationsHard", "locationHard"]) ?? false,
    remoteCountriesHard:
      pickBoolean(rec, ["remoteCountriesHard"]) ?? false,
    employmentTypesHard:
      pickBoolean(rec, ["employmentTypesHard", "employmentTypeHard"]) ?? false,
    seniorityHard: pickBoolean(rec, ["seniorityHard"]) ?? false,
    yearsExperienceHard:
      pickBoolean(rec, ["yearsExperienceHard"]) ?? false,
    compensationHard:
      pickBoolean(rec, ["compensationHard", "salaryHard"]) ?? false,
    excludeMissingSalary:
      pickBoolean(rec, ["excludeMissingSalary"]) ?? false,
    maxJobAgeHard: pickBoolean(rec, ["maxJobAgeHard"]) ?? false,
    relocationHardNo:
      pickBoolean(rec, ["relocationHardNo", "relocationHard"]) ?? false,
    excludedCompaniesHard:
      pickBoolean(rec, ["excludedCompaniesHard"]) ?? true,
    excludedSourcesHard:
      pickBoolean(rec, ["excludedSourcesHard"]) ?? true,
    includeUnknownPostedDate:
      pickBoolean(rec, [
        "includeUnknownPostedDate",
        "includeUnknownPostedDates",
      ]) ?? true,
  };
}

export function normalizeRankingWeights(raw: unknown): SearchProfileRankingWeights {
  const rec = asRecord(parseJsonIfString(raw));
  if (!rec) return { ...DEFAULT_RANKING_WEIGHTS };

  return {
    documentedFit:
      pickNumber(rec, ["documentedFit", "documented_fit"]) ??
      DEFAULT_RANKING_WEIGHTS.documentedFit,
    searchSkillAlignment:
      pickNumber(rec, ["searchSkillAlignment", "search_skill_alignment"]) ??
      DEFAULT_RANKING_WEIGHTS.searchSkillAlignment,
    freshness:
      pickNumber(rec, ["freshness"]) ?? DEFAULT_RANKING_WEIGHTS.freshness,
    locationWorkMode:
      pickNumber(rec, [
        "locationWorkMode",
        "locationWorkplace",
        "location_work_mode",
      ]) ?? DEFAULT_RANKING_WEIGHTS.locationWorkMode,
    compensation:
      pickNumber(rec, ["compensation", "compensationFit"]) ??
      DEFAULT_RANKING_WEIGHTS.compensation,
    companyIndustry:
      pickNumber(rec, ["companyIndustry", "company_industry"]) ??
      DEFAULT_RANKING_WEIGHTS.companyIndustry,
  };
}

export function normalizeResumePreferences(
  raw: unknown
): SearchProfileResumePreferences {
  const rec = asRecord(parseJsonIfString(raw)) ?? {};
  const paperSizeRaw = pickString(rec, ["paperSize", "paper_size"]);
  const pagePrefRaw = pickString(rec, ["pagePreference", "page_preference"]);
  const wordingRaw = pickString(rec, ["wordingStyle", "wording_style"]);
  const lengthRaw = pickString(rec, ["coverLetterLength", "cover_letter_length"]);
  const sectionOrder = toStringArray(rec.sectionOrder ?? rec.section_order);

  return {
    paperSize: paperSizeRaw === "Letter" ? "Letter" : "A4",
    pagePreference:
      pagePrefRaw === "1_page" || pagePrefRaw === "2_pages" || pagePrefRaw === "auto"
        ? pagePrefRaw
        : "auto",
    wordingStyle: wordingRaw === "descriptive" ? "descriptive" : "concise",
    template: pickString(rec, ["template"]),
    sectionOrder:
      sectionOrder.length > 0 ? sectionOrder : [...DEFAULT_SECTION_ORDER],
    coverLetterTone: pickString(rec, ["coverLetterTone", "cover_letter_tone"]),
    coverLetterLength:
      lengthRaw === "short" || lengthRaw === "long" ? lengthRaw : "medium",
    firstPerson: pickBoolean(rec, ["firstPerson", "first_person"]) ?? true,
    allowCompanyResearch:
      pickBoolean(rec, ["allowCompanyResearch", "allow_company_research"]) ??
      false,
  };
}

export function normalizeSearchProfile(raw: unknown): SearchProfileRecord | null {
  const root = asRecord(raw);
  if (!root) return null;
  const rec = asRecord(root.profile) ?? asRecord(root.searchProfile) ?? root;
  const id = pickString(rec, ["id"]);
  const name = pickString(rec, ["name"]);
  if (!id || !name) return null;

  const hardRaw = asRecord(
    parseJsonIfString(rec.hardFilters ?? rec.hardFiltersJson ?? rec.hard_filters_json)
  );

  const workplaceRaw = toStringArray(
    rec.workplaceTypes ?? rec.workplaceTypesJson ?? rec.workplace_types_json
  );
  const workplaceTypes = workplaceRaw.filter(
    (w): w is ProfileWorkplaceType =>
      w === "remote" || w === "hybrid" || w === "onsite"
  );

  const rawSkills = Array.isArray(root.skills)
    ? root.skills
    : Array.isArray(rec.skills)
      ? rec.skills
      : [];
  const skills = rawSkills
    .map(normalizeSearchProfileSkill)
    .filter((s): s is SearchProfileSkill => s !== null);

  const rawPeriod =
    pickString(rec, ["compensationPeriod"]) ??
    (hardRaw ? pickString(hardRaw, ["compensationPeriod", "salaryPeriod"]) : null);
  const compensationPeriod: SalaryPeriodOption | null =
    rawPeriod === "year" || rawPeriod === "month" || rawPeriod === "hour"
      ? rawPeriod
      : null;

  const rawCurrency =
    pickString(rec, ["compensationCurrency"]) ??
    (hardRaw ? pickString(hardRaw, ["compensationCurrency", "salaryCurrency"]) : null);

  return {
    id,
    name,
    enabled: pickBoolean(rec, ["enabled"]) ?? true,
    isDefault: pickBoolean(rec, ["isDefault", "is_default"]) ?? undefined,
    targetTitles: toStringArray(
      rec.targetTitles ?? rec.targetTitlesJson ?? rec.target_titles_json
    ),
    titleAliases: toStringArray(
      rec.titleAliases ?? hardRaw?.titleAliases
    ),
    targetSeniority: toStringArray(
      rec.targetSeniority ??
        rec.targetSeniorityJson ??
        rec.target_seniority_json
    ),
    minYearsExperience: pickNumber(rec, [
      "minYearsExperience",
      "min_years_experience",
    ]),
    maxYearsExperience: pickNumber(rec, [
      "maxYearsExperience",
      "max_years_experience",
    ]),
    locations: toStringArray(
      rec.locations ?? rec.locationsJson ?? rec.locations_json
    ),
    excludedLocations: toStringArray(
      rec.excludedLocations ?? hardRaw?.excludedLocations
    ),
    remoteEligibleCountries: toStringArray(
      rec.remoteEligibleCountries ??
        rec.remoteEligibleCountriesJson ??
        rec.remote_eligible_countries_json
    ),
    workplaceTypes,
    employmentTypes: toStringArray(
      rec.employmentTypes ??
        rec.employmentTypesJson ??
        rec.employment_types_json
    ),
    relocationAllowed: pickBoolean(rec, [
      "relocationAllowed",
      "relocation_allowed",
    ]),
    maxJobAgeDays: pickNumber(rec, ["maxJobAgeDays", "max_job_age_days"]),
    preferredRecencyDays:
      pickNumber(rec, ["preferredRecencyDays"]) ??
      (hardRaw ? pickNumber(hardRaw, ["preferredRecencyDays"]) : null),
    minCompensation:
      pickNumber(rec, ["minCompensation"]) ??
      (hardRaw ? pickNumber(hardRaw, ["minCompensation", "minSalary"]) : null),
    targetCompensation:
      pickNumber(rec, ["targetCompensation"]) ??
      (hardRaw ? pickNumber(hardRaw, ["targetCompensation", "targetSalary"]) : null),
    compensationCurrency: rawCurrency ? rawCurrency.toUpperCase() : null,
    compensationPeriod,
    preferredCompanies: toStringArray(
      rec.preferredCompanies ?? hardRaw?.preferredCompanies
    ),
    excludedCompanies: toStringArray(
      rec.excludedCompanies ?? hardRaw?.excludedCompanies
    ),
    preferredIndustries: toStringArray(
      rec.preferredIndustries ?? hardRaw?.preferredIndustries
    ),
    excludedIndustries: toStringArray(
      rec.excludedIndustries ?? hardRaw?.excludedIndustries ?? hardRaw?.dispreferredIndustries
    ),
    includedSources: toStringArray(
      rec.includedSources ?? hardRaw?.includedSources ?? hardRaw?.includedSourceIds
    ),
    excludedSources: toStringArray(
      rec.excludedSources ?? hardRaw?.excludedSources ?? hardRaw?.excludedSourceIds
    ),
    failClosedOnUnknown:
      pickBoolean(rec, ["failClosedOnUnknown", "fail_closed_on_unknown"]) ??
      false,
    hardFilters: normalizeHardFilters(
      rec.hardFilters ?? rec.hardFiltersJson ?? rec.hard_filters_json
    ),
    rankingWeights: normalizeRankingWeights(
      rec.rankingWeights ?? rec.rankingWeightsJson ?? rec.ranking_weights_json
    ),
    resumePreferences: normalizeResumePreferences(
      rec.resumePreferences ??
        rec.resumePreferencesJson ??
        rec.resume_preferences_json
    ),
    skills,
    createdAt: pickString(rec, ["createdAt", "created_at"]) ?? "",
    updatedAt: pickString(rec, ["updatedAt", "updated_at"]) ?? "",
  };
}

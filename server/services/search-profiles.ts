import crypto from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, type AppDatabase } from "../db/client";
import { applications, resumeVersions } from "../db/schema/applications";
import {
  SALARY_PERIODS,
  searchProfiles,
  searchProfileSkills,
  SKILL_FILTER_MODES,
  SKILL_PREFERENCES,
  WORKPLACE_TYPES,
  type SalaryPeriod,
  type SkillFilterMode,
  type SkillPreference,
  type WorkplaceType,
} from "../db/schema/jobs";
import { recomputeMatchesForSearchProfile } from "./matching";
import { normalizeSkillKey } from "./profile";

export class SearchProfileServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "SearchProfileServiceError";
    this.code = code;
    this.status = status;
  }
}

export interface RankingWeights {
  documentedFit: number;
  searchSkillAlignment: number;
  freshness: number;
  locationWorkMode: number;
  compensation: number;
  companyIndustry: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  documentedFit: 45,
  searchSkillAlignment: 15,
  freshness: 15,
  locationWorkMode: 10,
  compensation: 10,
  companyIndustry: 5,
};

export interface HardFiltersConfig {
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

export const DEFAULT_HARD_FILTERS: HardFiltersConfig = {
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

export interface ResumePreferences {
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

export const DEFAULT_RESUME_PREFERENCES: ResumePreferences = {
  paperSize: "A4",
  pagePreference: "auto",
  wordingStyle: "concise",
  template: null,
  sectionOrder: [],
  coverLetterTone: null,
  coverLetterLength: "medium",
  firstPerson: true,
  allowCompanyResearch: false,
};

interface StoredHardFiltersBlob extends HardFiltersConfig {
  // Aliases read by server/services/matching.ts
  locationHard?: boolean;
  workplaceHard?: boolean;
  employmentTypeHard?: boolean;
  relocationHard?: boolean;
  salaryHard?: boolean;
  minSalary?: number | null;
  targetSalary?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: SalaryPeriod | null;
  dispreferredIndustries?: string[];
  includedSourceIds?: string[];
  excludedSourceIds?: string[];
  // Canonical search-profile preference fields
  titleAliases?: string[];
  excludedLocations?: string[];
  preferredCompanies?: string[];
  excludedCompanies?: string[];
  preferredIndustries?: string[];
  excludedIndustries?: string[];
  includedSources?: string[];
  excludedSources?: string[];
  preferredRecencyDays?: number | null;
  minCompensation?: number | null;
  targetCompensation?: number | null;
  compensationCurrency?: string | null;
  compensationPeriod?: SalaryPeriod | null;
}

export interface SearchProfileSkillRecord {
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

export interface SearchProfileRecord {
  id: string;
  name: string;
  isDefault: boolean;
  targetTitles: string[];
  titleAliases: string[];
  targetSeniority: string[];
  minYearsExperience: number | null;
  maxYearsExperience: number | null;
  locations: string[];
  excludedLocations: string[];
  remoteEligibleCountries: string[];
  workplaceTypes: WorkplaceType[];
  employmentTypes: string[];
  relocationAllowed: boolean | null;
  maxJobAgeDays: number | null;
  preferredRecencyDays: number | null;
  minCompensation: number | null;
  targetCompensation: number | null;
  compensationCurrency: string | null;
  compensationPeriod: SalaryPeriod | null;
  preferredCompanies: string[];
  excludedCompanies: string[];
  preferredIndustries: string[];
  excludedIndustries: string[];
  includedSources: string[];
  excludedSources: string[];
  hardFilters: HardFiltersConfig;
  rankingWeights: RankingWeights;
  resumePreferences: ResumePreferences;
  failClosedOnUnknown: boolean;
  enabled: boolean;
  skills: SearchProfileSkillRecord[];
  createdAt: string;
  updatedAt: string;
}

const StringArraySchema = z
  .array(z.string().trim().min(1).max(200))
  .max(200)
  .transform((arr) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of arr) {
      const key = item.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  });

const CurrencyCodeSchema = z
  .union([z.string().trim().max(10), z.null()])
  .optional()
  .transform((val) => {
    if (val === undefined) return undefined;
    if (val === null || val === "") return null;
    return val.toUpperCase();
  })
  .refine(
    (val) => val === undefined || val === null || /^[A-Z]{3}$/.test(val),
    { message: "compensationCurrency must be a 3-letter ISO 4217 code." }
  );

export const RankingWeightsSchema = z
  .object({
    documentedFit: z.number().finite().min(0).max(100),
    searchSkillAlignment: z.number().finite().min(0).max(100),
    freshness: z.number().finite().min(0).max(100),
    locationWorkMode: z.number().finite().min(0).max(100),
    compensation: z.number().finite().min(0).max(100),
    companyIndustry: z.number().finite().min(0).max(100),
  })
  .strict();

export const RankingWeightsPatchSchema = RankingWeightsSchema.partial().strict();

export const HardFiltersSchema = z
  .object({
    workplaceTypesHard: z.boolean().optional(),
    locationsHard: z.boolean().optional(),
    remoteCountriesHard: z.boolean().optional(),
    employmentTypesHard: z.boolean().optional(),
    seniorityHard: z.boolean().optional(),
    yearsExperienceHard: z.boolean().optional(),
    compensationHard: z.boolean().optional(),
    excludeMissingSalary: z.boolean().optional(),
    maxJobAgeHard: z.boolean().optional(),
    relocationHardNo: z.boolean().optional(),
    excludedCompaniesHard: z.boolean().optional(),
    excludedSourcesHard: z.boolean().optional(),
    includeUnknownPostedDate: z.boolean().optional(),
  })
  .strict();

export const ResumePreferencesSchema = z
  .object({
    paperSize: z.enum(["A4", "Letter"]).optional(),
    pagePreference: z.enum(["1_page", "2_pages", "auto"]).optional(),
    wordingStyle: z.enum(["concise", "descriptive"]).optional(),
    template: z.union([z.string().trim().max(100), z.null()]).optional(),
    sectionOrder: StringArraySchema.optional(),
    coverLetterTone: z.union([z.string().trim().max(100), z.null()]).optional(),
    coverLetterLength: z.enum(["short", "medium", "long"]).optional(),
    firstPerson: z.boolean().optional(),
    allowCompanyResearch: z.boolean().optional(),
  })
  .strict();

export const CreateSearchProfileSkillSchema = z
  .object({
    displayLabel: z
      .string()
      .trim()
      .min(1, "Skill label is required.")
      .max(120),
    normalizedSkillKey: z.string().trim().min(1).max(120).optional(),
    aliases: StringArraySchema.optional().default([]),
    preference: z.enum(SKILL_PREFERENCES),
    // Per Spec Section 4.6: must_have is weighted by default until explicitly marked hard.
    filterMode: z.enum(SKILL_FILTER_MODES).optional().default("weighted"),
    weight: z.number().finite().min(0).max(100).nullable().optional(),
  })
  .strict();

export type CreateSearchProfileSkillInput = z.input<
  typeof CreateSearchProfileSkillSchema
>;

export const UpdateSearchProfileSkillSchema = z
  .object({
    displayLabel: z
      .string()
      .trim()
      .min(1, "Skill label cannot be empty.")
      .max(120)
      .optional(),
    normalizedSkillKey: z.string().trim().min(1).max(120).optional(),
    aliases: StringArraySchema.optional(),
    preference: z.enum(SKILL_PREFERENCES).optional(),
    filterMode: z.enum(SKILL_FILTER_MODES).optional(),
    weight: z.number().finite().min(0).max(100).nullable().optional(),
  })
  .strict();

export type UpdateSearchProfileSkillInput = z.input<
  typeof UpdateSearchProfileSkillSchema
>;

export const CreateSearchProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Profile name is required.").max(200),
    targetTitles: StringArraySchema.optional().default([]),
    titleAliases: StringArraySchema.optional().default([]),
    targetSeniority: StringArraySchema.optional().default([]),
    minYearsExperience: z.number().int().min(0).max(80).nullable().optional(),
    maxYearsExperience: z.number().int().min(0).max(80).nullable().optional(),
    locations: StringArraySchema.optional().default([]),
    excludedLocations: StringArraySchema.optional().default([]),
    remoteEligibleCountries: StringArraySchema.optional().default([]),
    workplaceTypes: z.array(z.enum(WORKPLACE_TYPES)).max(10).optional().default([]),
    employmentTypes: StringArraySchema.optional().default([]),
    relocationAllowed: z.boolean().nullable().optional(),
    maxJobAgeDays: z.number().int().min(1).max(3650).nullable().optional(),
    preferredRecencyDays: z.number().int().min(1).max(3650).nullable().optional(),
    minCompensation: z.number().finite().nonnegative().nullable().optional(),
    targetCompensation: z.number().finite().nonnegative().nullable().optional(),
    compensationCurrency: CurrencyCodeSchema,
    compensationPeriod: z.enum(SALARY_PERIODS).nullable().optional(),
    preferredCompanies: StringArraySchema.optional().default([]),
    excludedCompanies: StringArraySchema.optional().default([]),
    preferredIndustries: StringArraySchema.optional().default([]),
    excludedIndustries: StringArraySchema.optional().default([]),
    includedSources: StringArraySchema.optional().default([]),
    excludedSources: StringArraySchema.optional().default([]),
    hardFilters: HardFiltersSchema.optional(),
    rankingWeights: RankingWeightsSchema.optional(),
    resumePreferences: ResumePreferencesSchema.optional(),
    failClosedOnUnknown: z.boolean().optional().default(false),
    enabled: z.boolean().optional().default(true),
    skills: z.array(CreateSearchProfileSkillSchema).max(200).optional(),
  })
  .strict();

export type CreateSearchProfileInput = z.input<typeof CreateSearchProfileSchema>;

export const UpdateSearchProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Profile name cannot be empty.")
      .max(200)
      .optional(),
    targetTitles: StringArraySchema.optional(),
    titleAliases: StringArraySchema.optional(),
    targetSeniority: StringArraySchema.optional(),
    minYearsExperience: z.number().int().min(0).max(80).nullable().optional(),
    maxYearsExperience: z.number().int().min(0).max(80).nullable().optional(),
    locations: StringArraySchema.optional(),
    excludedLocations: StringArraySchema.optional(),
    remoteEligibleCountries: StringArraySchema.optional(),
    workplaceTypes: z.array(z.enum(WORKPLACE_TYPES)).max(10).optional(),
    employmentTypes: StringArraySchema.optional(),
    relocationAllowed: z.boolean().nullable().optional(),
    maxJobAgeDays: z.number().int().min(1).max(3650).nullable().optional(),
    preferredRecencyDays: z.number().int().min(1).max(3650).nullable().optional(),
    minCompensation: z.number().finite().nonnegative().nullable().optional(),
    targetCompensation: z.number().finite().nonnegative().nullable().optional(),
    compensationCurrency: CurrencyCodeSchema,
    compensationPeriod: z.enum(SALARY_PERIODS).nullable().optional(),
    preferredCompanies: StringArraySchema.optional(),
    excludedCompanies: StringArraySchema.optional(),
    preferredIndustries: StringArraySchema.optional(),
    excludedIndustries: StringArraySchema.optional(),
    includedSources: StringArraySchema.optional(),
    excludedSources: StringArraySchema.optional(),
    hardFilters: HardFiltersSchema.optional(),
    rankingWeights: RankingWeightsPatchSchema.optional(),
    resumePreferences: ResumePreferencesSchema.optional(),
    failClosedOnUnknown: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type UpdateSearchProfileInput = z.input<typeof UpdateSearchProfileSchema>;

/**
 * Validates that the enabled ranking weights sum to exactly 100%.
 */
export function validateRankingWeights(weights: RankingWeights): void {
  const values = [
    weights.documentedFit,
    weights.searchSkillAlignment,
    weights.freshness,
    weights.locationWorkMode,
    weights.compensation,
    weights.companyIndustry,
  ];
  for (const val of values) {
    if (!Number.isFinite(val) || val < 0 || val > 100) {
      throw new SearchProfileServiceError(
        "INVALID_RANKING_WEIGHTS",
        400,
        "Each ranking weight must be between 0 and 100."
      );
    }
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  if (Math.abs(sum - 100) > 0.001) {
    throw new SearchProfileServiceError(
      "INVALID_RANKING_WEIGHTS",
      400,
      `Enabled ranking weights must total 100% (got ${Math.round(sum * 100) / 100}%).`
    );
  }
}

/**
 * Validates that target compensation is not below minimum compensation when both are configured.
 */
export function validateCompensationRange(
  minCompensation: number | null,
  targetCompensation: number | null
): void {
  if (
    minCompensation !== null &&
    targetCompensation !== null &&
    targetCompensation < minCompensation
  ) {
    throw new SearchProfileServiceError(
      "INVALID_COMPENSATION_RANGE",
      400,
      "Target compensation must be greater than or equal to minimum compensation."
    );
  }
}

function validateExperienceRange(
  minYears: number | null,
  maxYears: number | null
): void {
  if (minYears !== null && maxYears !== null && maxYears < minYears) {
    throw new SearchProfileServiceError(
      "INVALID_EXPERIENCE_RANGE",
      400,
      "Maximum years of experience must be greater than or equal to minimum years of experience."
    );
  }
}

function safeParseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function safeParseJsonObject(
  raw: string | null | undefined
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseHardFiltersBlob(raw: string | null | undefined): StoredHardFiltersBlob {
  const obj = safeParseJsonObject(raw);
  const boolOrKeys = (keys: string[], fallback: boolean): boolean => {
    for (const k of keys) {
      if (typeof obj[k] === "boolean") return obj[k] as boolean;
    }
    return fallback;
  };
  const strArr = (key: string): string[] =>
    Array.isArray(obj[key])
      ? obj[key].filter((x): x is string => typeof x === "string")
      : [];
  const numOrNull = (keys: string[]): number | null => {
    for (const k of keys) {
      if (typeof obj[k] === "number" && Number.isFinite(obj[k])) {
        return obj[k] as number;
      }
    }
    return null;
  };
  const strOrNull = (keys: string[]): string | null => {
    for (const k of keys) {
      if (typeof obj[k] === "string" && (obj[k] as string).trim().length > 0) {
        return (obj[k] as string).trim();
      }
    }
    return null;
  };

  const rawPeriod = strOrNull(["compensationPeriod", "salaryPeriod"]);
  const compensationPeriod =
    rawPeriod !== null &&
    (SALARY_PERIODS as readonly string[]).includes(rawPeriod)
      ? (rawPeriod as SalaryPeriod)
      : null;

  return {
    workplaceTypesHard: boolOrKeys(
      ["workplaceTypesHard", "workplaceHard", "workplaceTypeHard"],
      DEFAULT_HARD_FILTERS.workplaceTypesHard
    ),
    locationsHard: boolOrKeys(
      ["locationsHard", "locationHard"],
      DEFAULT_HARD_FILTERS.locationsHard
    ),
    remoteCountriesHard: boolOrKeys(
      ["remoteCountriesHard", "remoteEligibleCountriesHard"],
      DEFAULT_HARD_FILTERS.remoteCountriesHard
    ),
    employmentTypesHard: boolOrKeys(
      ["employmentTypesHard", "employmentTypeHard"],
      DEFAULT_HARD_FILTERS.employmentTypesHard
    ),
    seniorityHard: boolOrKeys(
      ["seniorityHard"],
      DEFAULT_HARD_FILTERS.seniorityHard
    ),
    yearsExperienceHard: boolOrKeys(
      ["yearsExperienceHard", "experienceHard"],
      DEFAULT_HARD_FILTERS.yearsExperienceHard
    ),
    compensationHard: boolOrKeys(
      ["compensationHard", "salaryHard"],
      DEFAULT_HARD_FILTERS.compensationHard
    ),
    excludeMissingSalary: boolOrKeys(
      ["excludeMissingSalary", "missingSalaryHard", "requireSalary"],
      DEFAULT_HARD_FILTERS.excludeMissingSalary
    ),
    maxJobAgeHard: boolOrKeys(
      ["maxJobAgeHard"],
      DEFAULT_HARD_FILTERS.maxJobAgeHard
    ),
    relocationHardNo: boolOrKeys(
      ["relocationHardNo", "relocationHard"],
      DEFAULT_HARD_FILTERS.relocationHardNo
    ),
    excludedCompaniesHard: boolOrKeys(
      ["excludedCompaniesHard"],
      DEFAULT_HARD_FILTERS.excludedCompaniesHard
    ),
    excludedSourcesHard: boolOrKeys(
      ["excludedSourcesHard"],
      DEFAULT_HARD_FILTERS.excludedSourcesHard
    ),
    includeUnknownPostedDate: boolOrKeys(
      ["includeUnknownPostedDate"],
      DEFAULT_HARD_FILTERS.includeUnknownPostedDate
    ),
    titleAliases: strArr("titleAliases"),
    excludedLocations: strArr("excludedLocations"),
    preferredCompanies: strArr("preferredCompanies"),
    excludedCompanies: strArr("excludedCompanies"),
    preferredIndustries: strArr("preferredIndustries"),
    excludedIndustries:
      strArr("excludedIndustries").length > 0
        ? strArr("excludedIndustries")
        : strArr("dispreferredIndustries"),
    includedSources:
      strArr("includedSources").length > 0
        ? strArr("includedSources")
        : strArr("includedSourceIds"),
    excludedSources:
      strArr("excludedSources").length > 0
        ? strArr("excludedSources")
        : strArr("excludedSourceIds"),
    preferredRecencyDays: numOrNull(["preferredRecencyDays"]),
    minCompensation: numOrNull(["minCompensation", "minSalary", "compensationMin"]),
    targetCompensation: numOrNull([
      "targetCompensation",
      "targetSalary",
      "compensationTarget",
    ]),
    compensationCurrency: strOrNull(["compensationCurrency", "salaryCurrency"]),
    compensationPeriod,
  };
}

function parseRankingWeights(raw: string | null | undefined): RankingWeights {
  const obj = safeParseJsonObject(raw);
  const numOr = (key: keyof RankingWeights, fallback: number): number =>
    typeof obj[key] === "number" && Number.isFinite(obj[key])
      ? (obj[key] as number)
      : fallback;

  return {
    documentedFit: numOr("documentedFit", DEFAULT_RANKING_WEIGHTS.documentedFit),
    searchSkillAlignment: numOr(
      "searchSkillAlignment",
      DEFAULT_RANKING_WEIGHTS.searchSkillAlignment
    ),
    freshness: numOr("freshness", DEFAULT_RANKING_WEIGHTS.freshness),
    locationWorkMode: numOr(
      "locationWorkMode",
      DEFAULT_RANKING_WEIGHTS.locationWorkMode
    ),
    compensation: numOr("compensation", DEFAULT_RANKING_WEIGHTS.compensation),
    companyIndustry: numOr(
      "companyIndustry",
      DEFAULT_RANKING_WEIGHTS.companyIndustry
    ),
  };
}

function parseResumePreferences(
  raw: string | null | undefined
): ResumePreferences {
  const obj = safeParseJsonObject(raw);
  return {
    paperSize:
      obj.paperSize === "Letter" || obj.paperSize === "A4"
        ? obj.paperSize
        : DEFAULT_RESUME_PREFERENCES.paperSize,
    pagePreference:
      obj.pagePreference === "1_page" ||
      obj.pagePreference === "2_pages" ||
      obj.pagePreference === "auto"
        ? obj.pagePreference
        : DEFAULT_RESUME_PREFERENCES.pagePreference,
    wordingStyle:
      obj.wordingStyle === "concise" || obj.wordingStyle === "descriptive"
        ? obj.wordingStyle
        : DEFAULT_RESUME_PREFERENCES.wordingStyle,
    template: typeof obj.template === "string" ? obj.template : null,
    sectionOrder: Array.isArray(obj.sectionOrder)
      ? obj.sectionOrder.filter((x): x is string => typeof x === "string")
      : [],
    coverLetterTone:
      typeof obj.coverLetterTone === "string" ? obj.coverLetterTone : null,
    coverLetterLength:
      obj.coverLetterLength === "short" ||
      obj.coverLetterLength === "medium" ||
      obj.coverLetterLength === "long"
        ? obj.coverLetterLength
        : DEFAULT_RESUME_PREFERENCES.coverLetterLength,
    firstPerson:
      typeof obj.firstPerson === "boolean"
        ? obj.firstPerson
        : DEFAULT_RESUME_PREFERENCES.firstPerson,
    allowCompanyResearch:
      typeof obj.allowCompanyResearch === "boolean"
        ? obj.allowCompanyResearch
        : DEFAULT_RESUME_PREFERENCES.allowCompanyResearch,
  };
}

function serializeSkillRow(
  row: typeof searchProfileSkills.$inferSelect
): SearchProfileSkillRecord {
  return {
    id: row.id,
    searchProfileId: row.searchProfileId,
    normalizedSkillKey: row.normalizedSkillKey,
    displayLabel: row.displayLabel,
    aliases: safeParseJsonArray(row.aliasesJson),
    preference: row.preference,
    filterMode: row.filterMode,
    weight: row.weight ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeSearchProfileRow(
  row: typeof searchProfiles.$inferSelect,
  skills: SearchProfileSkillRecord[],
  isDefault: boolean
): SearchProfileRecord {
  const blob = parseHardFiltersBlob(row.hardFiltersJson);
  const {
    titleAliases = [],
    excludedLocations = [],
    preferredCompanies = [],
    excludedCompanies = [],
    preferredIndustries = [],
    excludedIndustries = [],
    includedSources = [],
    excludedSources = [],
    preferredRecencyDays = null,
    minCompensation = null,
    targetCompensation = null,
    compensationCurrency = null,
    compensationPeriod = null,
    ...hardFilters
  } = blob;

  const workplaceTypes = safeParseJsonArray(row.workplaceTypesJson).filter(
    (w): w is WorkplaceType => (WORKPLACE_TYPES as readonly string[]).includes(w)
  );

  return {
    id: row.id,
    name: row.name,
    isDefault,
    targetTitles: safeParseJsonArray(row.targetTitlesJson),
    titleAliases,
    targetSeniority: safeParseJsonArray(row.targetSeniorityJson),
    minYearsExperience: row.minYearsExperience ?? null,
    maxYearsExperience: row.maxYearsExperience ?? null,
    locations: safeParseJsonArray(row.locationsJson),
    excludedLocations,
    remoteEligibleCountries: safeParseJsonArray(row.remoteEligibleCountriesJson),
    workplaceTypes,
    employmentTypes: safeParseJsonArray(row.employmentTypesJson),
    relocationAllowed:
      row.relocationAllowed === null || row.relocationAllowed === undefined
        ? null
        : Boolean(row.relocationAllowed),
    maxJobAgeDays: row.maxJobAgeDays ?? null,
    preferredRecencyDays,
    minCompensation,
    targetCompensation,
    compensationCurrency,
    compensationPeriod,
    preferredCompanies,
    excludedCompanies,
    preferredIndustries,
    excludedIndustries,
    includedSources,
    excludedSources,
    hardFilters,
    rankingWeights: parseRankingWeights(row.rankingWeightsJson),
    resumePreferences: parseResumePreferences(row.resumePreferencesJson),
    failClosedOnUnknown: Boolean(row.failClosedOnUnknown),
    enabled: Boolean(row.enabled),
    skills,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildStoredHardFiltersBlob(params: {
  hardFilters: HardFiltersConfig;
  titleAliases: string[];
  excludedLocations: string[];
  preferredCompanies: string[];
  excludedCompanies: string[];
  preferredIndustries: string[];
  excludedIndustries: string[];
  includedSources: string[];
  excludedSources: string[];
  preferredRecencyDays: number | null;
  minCompensation: number | null;
  targetCompensation: number | null;
  compensationCurrency: string | null;
  compensationPeriod: SalaryPeriod | null;
}): StoredHardFiltersBlob {
  return {
    ...params.hardFilters,
    locationHard: params.hardFilters.locationsHard,
    workplaceHard: params.hardFilters.workplaceTypesHard,
    employmentTypeHard: params.hardFilters.employmentTypesHard,
    relocationHard: params.hardFilters.relocationHardNo,
    salaryHard: params.hardFilters.compensationHard,
    minSalary: params.minCompensation,
    targetSalary: params.targetCompensation,
    salaryCurrency: params.compensationCurrency,
    salaryPeriod: params.compensationPeriod,
    dispreferredIndustries: params.excludedIndustries,
    includedSourceIds: params.includedSources,
    excludedSourceIds: params.excludedSources,
    titleAliases: params.titleAliases,
    excludedLocations: params.excludedLocations,
    preferredCompanies: params.preferredCompanies,
    excludedCompanies: params.excludedCompanies,
    preferredIndustries: params.preferredIndustries,
    excludedIndustries: params.excludedIndustries,
    includedSources: params.includedSources,
    excludedSources: params.excludedSources,
    preferredRecencyDays: params.preferredRecencyDays,
    minCompensation: params.minCompensation,
    targetCompensation: params.targetCompensation,
    compensationCurrency: params.compensationCurrency,
    compensationPeriod: params.compensationPeriod,
  };
}

/**
 * Recomputes deterministic matches across all canonical jobs for a search profile.
 */
function triggerMatchRecomputeForProfile(
  db: AppDatabase,
  searchProfileId: string
): void {
  recomputeMatchesForSearchProfile(searchProfileId, db);
}

/**
 * Lists all search profiles ordered by creation time along with their skill preferences.
 */
export function listSearchProfiles(
  db: AppDatabase = getDb()
): SearchProfileRecord[] {
  const rows = db
    .select()
    .from(searchProfiles)
    .orderBy(asc(searchProfiles.createdAt))
    .all();

  const skillRows = db
    .select()
    .from(searchProfileSkills)
    .orderBy(asc(searchProfileSkills.createdAt))
    .all();

  const skillsByProfile = new Map<string, SearchProfileSkillRecord[]>();
  for (const s of skillRows) {
    const list = skillsByProfile.get(s.searchProfileId) ?? [];
    list.push(serializeSkillRow(s));
    skillsByProfile.set(s.searchProfileId, list);
  }

  return rows.map((row, idx) =>
    serializeSearchProfileRow(
      row,
      skillsByProfile.get(row.id) ?? [],
      idx === 0
    )
  );
}

/**
 * Loads a single search profile by ID with its configured skills.
 */
export function getSearchProfileById(
  id: string,
  db: AppDatabase = getDb()
): SearchProfileRecord | null {
  const row = db
    .select()
    .from(searchProfiles)
    .where(eq(searchProfiles.id, id))
    .get();
  if (!row) {
    return null;
  }

  const firstRow = db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .orderBy(asc(searchProfiles.createdAt))
    .get();

  const skillRows = db
    .select()
    .from(searchProfileSkills)
    .where(eq(searchProfileSkills.searchProfileId, id))
    .orderBy(asc(searchProfileSkills.createdAt))
    .all();

  return serializeSearchProfileRow(
    row,
    skillRows.map(serializeSkillRow),
    firstRow?.id === row.id
  );
}

/**
 * Creates a new search profile with validated weights (100% total) and compensation bounds.
 */
export function createSearchProfile(
  input: CreateSearchProfileInput,
  db: AppDatabase = getDb()
): SearchProfileRecord {
  const parsed = CreateSearchProfileSchema.parse(input);

  const weights: RankingWeights = parsed.rankingWeights
    ? { ...parsed.rankingWeights }
    : { ...DEFAULT_RANKING_WEIGHTS };
  validateRankingWeights(weights);

  const minCompensation = parsed.minCompensation ?? null;
  const targetCompensation = parsed.targetCompensation ?? null;
  validateCompensationRange(minCompensation, targetCompensation);

  const minYearsExperience = parsed.minYearsExperience ?? null;
  const maxYearsExperience = parsed.maxYearsExperience ?? null;
  validateExperienceRange(minYearsExperience, maxYearsExperience);

  const hardFiltersBlob = buildStoredHardFiltersBlob({
    hardFilters: {
      ...DEFAULT_HARD_FILTERS,
      ...(parsed.hardFilters ?? {}),
    },
    titleAliases: parsed.titleAliases,
    excludedLocations: parsed.excludedLocations,
    preferredCompanies: parsed.preferredCompanies,
    excludedCompanies: parsed.excludedCompanies,
    preferredIndustries: parsed.preferredIndustries,
    excludedIndustries: parsed.excludedIndustries,
    includedSources: parsed.includedSources,
    excludedSources: parsed.excludedSources,
    preferredRecencyDays: parsed.preferredRecencyDays ?? null,
    minCompensation,
    targetCompensation,
    compensationCurrency: parsed.compensationCurrency ?? null,
    compensationPeriod: parsed.compensationPeriod ?? null,
  });

  const resumePreferences: ResumePreferences = {
    ...DEFAULT_RESUME_PREFERENCES,
    ...(parsed.resumePreferences ?? {}),
    sectionOrder: parsed.resumePreferences?.sectionOrder ?? [],
  };

  const nowIso = new Date().toISOString();
  const profileId = crypto.randomUUID();

  // Deduplicate initial skills by normalizedSkillKey before opening transaction.
  const initialSkills = parsed.skills ?? [];
  const seenSkillKeys = new Set<string>();
  const normalizedSkillsToInsert = initialSkills.map((s) => {
    const key = normalizeSkillKey(s.normalizedSkillKey ?? s.displayLabel);
    if (!key) {
      throw new SearchProfileServiceError(
        "VALIDATION_ERROR",
        400,
        "Skill label must produce a non-empty normalized key."
      );
    }
    if (seenSkillKeys.has(key)) {
      throw new SearchProfileServiceError(
        "DUPLICATE_SEARCH_PROFILE_SKILL",
        409,
        `Duplicate skill key "${key}" in search profile.`
      );
    }
    seenSkillKeys.add(key);
    return {
      id: crypto.randomUUID(),
      searchProfileId: profileId,
      normalizedSkillKey: key,
      displayLabel: s.displayLabel,
      aliasesJson: JSON.stringify(s.aliases ?? []),
      preference: s.preference,
      filterMode: s.filterMode ?? "weighted",
      weight: s.weight ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  db.transaction((tx) => {
    tx.insert(searchProfiles)
      .values({
        id: profileId,
        name: parsed.name,
        targetTitlesJson: JSON.stringify(parsed.targetTitles),
        targetSeniorityJson: JSON.stringify(parsed.targetSeniority),
        minYearsExperience,
        maxYearsExperience,
        locationsJson: JSON.stringify(parsed.locations),
        remoteEligibleCountriesJson: JSON.stringify(
          parsed.remoteEligibleCountries
        ),
        workplaceTypesJson: JSON.stringify(parsed.workplaceTypes),
        employmentTypesJson: JSON.stringify(parsed.employmentTypes),
        relocationAllowed:
          parsed.relocationAllowed === undefined
            ? null
            : parsed.relocationAllowed,
        maxJobAgeDays: parsed.maxJobAgeDays ?? null,
        hardFiltersJson: JSON.stringify(hardFiltersBlob),
        rankingWeightsJson: JSON.stringify(weights),
        resumePreferencesJson: JSON.stringify(resumePreferences),
        failClosedOnUnknown: parsed.failClosedOnUnknown,
        enabled: parsed.enabled,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .run();

    for (const skillRow of normalizedSkillsToInsert) {
      tx.insert(searchProfileSkills).values(skillRow).run();
    }
  });

  triggerMatchRecomputeForProfile(db, profileId);

  const created = getSearchProfileById(profileId, db);
  if (!created) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_CREATE_FAILED",
      500,
      "Failed to load newly created search profile."
    );
  }
  return created;
}

/**
 * Updates a search profile, validates invariants, and recomputes matches for the profile.
 */
export function updateSearchProfile(
  id: string,
  input: UpdateSearchProfileInput,
  db: AppDatabase = getDb()
): SearchProfileRecord {
  const parsed = UpdateSearchProfileSchema.parse(input);

  const existing = getSearchProfileById(id, db);
  if (!existing) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_NOT_FOUND",
      404,
      `Search profile not found: ${id}`
    );
  }

  const nextWeights: RankingWeights = parsed.rankingWeights
    ? {
        ...existing.rankingWeights,
        ...parsed.rankingWeights,
      }
    : existing.rankingWeights;
  validateRankingWeights(nextWeights);

  const nextMinComp =
    parsed.minCompensation !== undefined
      ? parsed.minCompensation
      : existing.minCompensation;
  const nextTargetComp =
    parsed.targetCompensation !== undefined
      ? parsed.targetCompensation
      : existing.targetCompensation;
  validateCompensationRange(nextMinComp, nextTargetComp);

  const nextMinYears =
    parsed.minYearsExperience !== undefined
      ? parsed.minYearsExperience
      : existing.minYearsExperience;
  const nextMaxYears =
    parsed.maxYearsExperience !== undefined
      ? parsed.maxYearsExperience
      : existing.maxYearsExperience;
  validateExperienceRange(nextMinYears, nextMaxYears);

  const nextHardFiltersBlob = buildStoredHardFiltersBlob({
    hardFilters: {
      ...existing.hardFilters,
      ...(parsed.hardFilters ?? {}),
    },
    titleAliases: parsed.titleAliases ?? existing.titleAliases,
    excludedLocations: parsed.excludedLocations ?? existing.excludedLocations,
    preferredCompanies:
      parsed.preferredCompanies ?? existing.preferredCompanies,
    excludedCompanies: parsed.excludedCompanies ?? existing.excludedCompanies,
    preferredIndustries:
      parsed.preferredIndustries ?? existing.preferredIndustries,
    excludedIndustries:
      parsed.excludedIndustries ?? existing.excludedIndustries,
    includedSources: parsed.includedSources ?? existing.includedSources,
    excludedSources: parsed.excludedSources ?? existing.excludedSources,
    preferredRecencyDays:
      parsed.preferredRecencyDays !== undefined
        ? parsed.preferredRecencyDays
        : existing.preferredRecencyDays,
    minCompensation: nextMinComp,
    targetCompensation: nextTargetComp,
    compensationCurrency:
      parsed.compensationCurrency !== undefined
        ? parsed.compensationCurrency
        : existing.compensationCurrency,
    compensationPeriod:
      parsed.compensationPeriod !== undefined
        ? parsed.compensationPeriod
        : existing.compensationPeriod,
  });

  const nextResumePrefs: ResumePreferences = parsed.resumePreferences
    ? {
        ...existing.resumePreferences,
        ...parsed.resumePreferences,
        sectionOrder:
          parsed.resumePreferences.sectionOrder ??
          existing.resumePreferences.sectionOrder,
      }
    : existing.resumePreferences;

  const nowIso = new Date().toISOString();

  db.update(searchProfiles)
    .set({
      name: parsed.name ?? existing.name,
      targetTitlesJson: JSON.stringify(
        parsed.targetTitles ?? existing.targetTitles
      ),
      targetSeniorityJson: JSON.stringify(
        parsed.targetSeniority ?? existing.targetSeniority
      ),
      minYearsExperience: nextMinYears,
      maxYearsExperience: nextMaxYears,
      locationsJson: JSON.stringify(parsed.locations ?? existing.locations),
      remoteEligibleCountriesJson: JSON.stringify(
        parsed.remoteEligibleCountries ?? existing.remoteEligibleCountries
      ),
      workplaceTypesJson: JSON.stringify(
        parsed.workplaceTypes ?? existing.workplaceTypes
      ),
      employmentTypesJson: JSON.stringify(
        parsed.employmentTypes ?? existing.employmentTypes
      ),
      relocationAllowed:
        parsed.relocationAllowed !== undefined
          ? parsed.relocationAllowed
          : existing.relocationAllowed,
      maxJobAgeDays:
        parsed.maxJobAgeDays !== undefined
          ? parsed.maxJobAgeDays
          : existing.maxJobAgeDays,
      hardFiltersJson: JSON.stringify(nextHardFiltersBlob),
      rankingWeightsJson: JSON.stringify(nextWeights),
      resumePreferencesJson: JSON.stringify(nextResumePrefs),
      failClosedOnUnknown:
        parsed.failClosedOnUnknown !== undefined
          ? parsed.failClosedOnUnknown
          : existing.failClosedOnUnknown,
      enabled:
        parsed.enabled !== undefined ? parsed.enabled : existing.enabled,
      updatedAt: nowIso,
    })
    .where(eq(searchProfiles.id, id))
    .run();

  triggerMatchRecomputeForProfile(db, id);

  const updated = getSearchProfileById(id, db);
  if (!updated) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_NOT_FOUND",
      404,
      `Search profile not found: ${id}`
    );
  }
  return updated;
}

/**
 * Deletes a search profile unless protected by immutable applications or resume versions.
 */
export function deleteSearchProfile(
  id: string,
  db: AppDatabase = getDb()
): { deleted: boolean; id: string } | null {
  const existing = db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .where(eq(searchProfiles.id, id))
    .get();
  if (!existing) {
    return null;
  }

  const linkedApp = db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.searchProfileId, id))
    .get();
  if (linkedApp) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_IN_USE",
      409,
      "Cannot delete a search profile that has existing applications."
    );
  }

  const linkedVersion = db
    .select({ id: resumeVersions.id })
    .from(resumeVersions)
    .where(eq(resumeVersions.searchProfileId, id))
    .get();
  if (linkedVersion) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_IN_USE",
      409,
      "Cannot delete a search profile that has exported resume versions."
    );
  }

  db.delete(searchProfiles).where(eq(searchProfiles.id, id)).run();
  return { deleted: true, id };
}

/**
 * Lists skills configured on a search profile.
 */
export function listSearchProfileSkills(
  searchProfileId: string,
  db: AppDatabase = getDb()
): SearchProfileSkillRecord[] {
  const profile = db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .where(eq(searchProfiles.id, searchProfileId))
    .get();
  if (!profile) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_NOT_FOUND",
      404,
      `Search profile not found: ${searchProfileId}`
    );
  }

  const rows = db
    .select()
    .from(searchProfileSkills)
    .where(eq(searchProfileSkills.searchProfileId, searchProfileId))
    .orderBy(asc(searchProfileSkills.createdAt))
    .all();

  return rows.map(serializeSkillRow);
}

/**
 * Adds a normalized job-skill preference to a search profile and recomputes matches.
 */
export function addSearchProfileSkill(
  searchProfileId: string,
  input: CreateSearchProfileSkillInput,
  db: AppDatabase = getDb()
): SearchProfileSkillRecord {
  const parsed = CreateSearchProfileSkillSchema.parse(input);

  const profile = db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .where(eq(searchProfiles.id, searchProfileId))
    .get();
  if (!profile) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_NOT_FOUND",
      404,
      `Search profile not found: ${searchProfileId}`
    );
  }

  const normalizedKey = normalizeSkillKey(
    parsed.normalizedSkillKey ?? parsed.displayLabel
  );
  if (!normalizedKey) {
    throw new SearchProfileServiceError(
      "VALIDATION_ERROR",
      400,
      "Skill label must produce a non-empty normalized key."
    );
  }

  const duplicate = db
    .select({ id: searchProfileSkills.id })
    .from(searchProfileSkills)
    .where(
      and(
        eq(searchProfileSkills.searchProfileId, searchProfileId),
        eq(searchProfileSkills.normalizedSkillKey, normalizedKey)
      )
    )
    .get();
  if (duplicate) {
    throw new SearchProfileServiceError(
      "DUPLICATE_SEARCH_PROFILE_SKILL",
      409,
      `Skill "${normalizedKey}" already exists on this search profile.`
    );
  }

  const nowIso = new Date().toISOString();
  const skillId = crypto.randomUUID();

  db.insert(searchProfileSkills)
    .values({
      id: skillId,
      searchProfileId,
      normalizedSkillKey: normalizedKey,
      displayLabel: parsed.displayLabel,
      aliasesJson: JSON.stringify(parsed.aliases ?? []),
      preference: parsed.preference,
      filterMode: parsed.filterMode ?? "weighted",
      weight: parsed.weight ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();

  triggerMatchRecomputeForProfile(db, searchProfileId);

  const created = db
    .select()
    .from(searchProfileSkills)
    .where(eq(searchProfileSkills.id, skillId))
    .get();
  if (!created) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_SKILL_CREATE_FAILED",
      500,
      "Failed to load newly created search profile skill."
    );
  }
  return serializeSkillRow(created);
}

/**
 * Updates a search-profile skill preference and recomputes matches.
 */
export function updateSearchProfileSkill(
  searchProfileId: string,
  skillId: string,
  input: UpdateSearchProfileSkillInput,
  db: AppDatabase = getDb()
): SearchProfileSkillRecord {
  const parsed = UpdateSearchProfileSkillSchema.parse(input);

  const existing = db
    .select()
    .from(searchProfileSkills)
    .where(
      and(
        eq(searchProfileSkills.id, skillId),
        eq(searchProfileSkills.searchProfileId, searchProfileId)
      )
    )
    .get();
  if (!existing) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_SKILL_NOT_FOUND",
      404,
      `Search profile skill not found: ${skillId}`
    );
  }

  const nextLabel = parsed.displayLabel ?? existing.displayLabel;
  const nextNormalizedKey =
    parsed.normalizedSkillKey !== undefined
      ? normalizeSkillKey(parsed.normalizedSkillKey)
      : parsed.displayLabel !== undefined
        ? normalizeSkillKey(parsed.displayLabel)
        : existing.normalizedSkillKey;

  if (!nextNormalizedKey) {
    throw new SearchProfileServiceError(
      "VALIDATION_ERROR",
      400,
      "Skill label must produce a non-empty normalized key."
    );
  }

  if (nextNormalizedKey !== existing.normalizedSkillKey) {
    const duplicate = db
      .select({ id: searchProfileSkills.id })
      .from(searchProfileSkills)
      .where(
        and(
          eq(searchProfileSkills.searchProfileId, searchProfileId),
          eq(searchProfileSkills.normalizedSkillKey, nextNormalizedKey),
          ne(searchProfileSkills.id, skillId)
        )
      )
      .get();
    if (duplicate) {
      throw new SearchProfileServiceError(
        "DUPLICATE_SEARCH_PROFILE_SKILL",
        409,
        `Skill "${nextNormalizedKey}" already exists on this search profile.`
      );
    }
  }

  const nowIso = new Date().toISOString();

  db.update(searchProfileSkills)
    .set({
      normalizedSkillKey: nextNormalizedKey,
      displayLabel: nextLabel,
      aliasesJson:
        parsed.aliases !== undefined
          ? JSON.stringify(parsed.aliases)
          : existing.aliasesJson,
      preference: parsed.preference ?? existing.preference,
      filterMode: parsed.filterMode ?? existing.filterMode,
      weight: parsed.weight !== undefined ? parsed.weight : existing.weight,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(searchProfileSkills.id, skillId),
        eq(searchProfileSkills.searchProfileId, searchProfileId)
      )
    )
    .run();

  triggerMatchRecomputeForProfile(db, searchProfileId);

  const updated = db
    .select()
    .from(searchProfileSkills)
    .where(eq(searchProfileSkills.id, skillId))
    .get();
  if (!updated) {
    throw new SearchProfileServiceError(
      "SEARCH_PROFILE_SKILL_NOT_FOUND",
      404,
      `Search profile skill not found: ${skillId}`
    );
  }
  return serializeSkillRow(updated);
}

/**
 * Deletes a search-profile skill preference and recomputes matches.
 */
export function deleteSearchProfileSkill(
  searchProfileId: string,
  skillId: string,
  db: AppDatabase = getDb()
): { deleted: boolean; id: string } | null {
  const existing = db
    .select({ id: searchProfileSkills.id })
    .from(searchProfileSkills)
    .where(
      and(
        eq(searchProfileSkills.id, skillId),
        eq(searchProfileSkills.searchProfileId, searchProfileId)
      )
    )
    .get();
  if (!existing) {
    return null;
  }

  db.delete(searchProfileSkills)
    .where(
      and(
        eq(searchProfileSkills.id, skillId),
        eq(searchProfileSkills.searchProfileId, searchProfileId)
      )
    )
    .run();

  triggerMatchRecomputeForProfile(db, searchProfileId);

  return { deleted: true, id: skillId };
}

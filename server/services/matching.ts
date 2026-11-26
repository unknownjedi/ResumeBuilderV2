import crypto from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import {
  detectSkillsInText,
  expandSkillAliases,
  normalizeSkillTerm,
  textContainsSkillAlias,
} from "../ai/workflows/analyze-job";
import {
  getDb,
  getSqlite,
  type AppDatabase,
  type SqliteDatabase,
} from "../db/client";
import {
  achievements,
  achievementSkills,
  certifications,
  education,
  evidenceLinks,
  experiences,
  experienceSkills,
  languages,
  profile,
  projects,
  projectSkills,
  skills,
} from "../db/schema/career";
import * as schema from "../db/schema/index";
import {
  CANDIDATE_RESPONSES,
  companies,
  jobCompensationOverrides,
  jobRequirements,
  jobs,
  jobSourceRecords,
  matchEvidence,
  matchRuns,
  REQUIREMENT_PRIORITIES,
  SALARY_PERIODS,
  searchProfiles,
  searchProfileSkills,
  WORKPLACE_TYPES,
  type CandidateResponse,
  type MachineSupportState,
  type RequirementPriority,
  type SalaryPeriod,
  type WorkplaceType,
} from "../db/schema/jobs";

export const MATCHING_CALCULATION_VERSION = "1.0.0";
export const MATCHING_WEIGHT_VERSION = "1.0.0";

export class MatchingServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "MatchingServiceError";
    this.code = code;
    this.status = status;
  }
}

export type HardFilterStatus = "eligible" | "excluded" | "pending_analysis";

export type RankingFactorKey =
  | "documentedFit"
  | "searchSkillAlignment"
  | "freshness"
  | "location"
  | "compensation"
  | "company";

export interface RankingFactorBreakdown {
  score: number | null;
  weight: number;
  effectiveWeight: number;
  included: boolean;
  reason: string;
}

export interface HardFilterEvaluation {
  passed: boolean;
  status: HardFilterStatus;
  reasons: string[];
  pendingReasons: string[];
}

export interface EvaluatedRequirementEvidence {
  jobRequirementId: string;
  supportState: MachineSupportState;
  linkedFactType: string | null;
  linkedFactId: string | null;
  evidenceLinkId: string | null;
  explanation: string;
}

export interface ComputeJobMatchInput {
  jobId: string;
  searchProfileId: string;
  db?: AppDatabase;
  sqlite?: SqliteDatabase;
  now?: () => Date;
}

export interface ComputeJobMatchResult {
  matchRunId: string;
  jobId: string;
  searchProfileId: string;
  documentedFitScore: number | null;
  searchSkillAlignmentScore: number | null;
  priorityScore: number | null;
  hardFilterPassed: boolean;
  hardFilterStatus: HardFilterStatus;
  hardFilterReasons: string[];
  renormalized: boolean;
  factors: Record<RankingFactorKey, RankingFactorBreakdown>;
  evidence: EvaluatedRequirementEvidence[];
  weightVersion: string;
  calculationVersion: string;
  analysisVersion: string;
  createdAt: string;
}

export const UpdateRequirementOverrideSchema = z
  .object({
    jobId: z.string().trim().min(1).max(128),
    requirementId: z.string().trim().min(1).max(128),
    candidateResponse: z.enum(CANDIDATE_RESPONSES).optional(),
    userPriorityOverride: z.enum(REQUIREMENT_PRIORITIES).nullable().optional(),
    overrideState: z.enum(["active", "orphaned"]).optional(),
    recomputeMatches: z.boolean().optional().default(true),
  })
  .strict();

export type UpdateRequirementOverrideInput = z.input<
  typeof UpdateRequirementOverrideSchema
>;

export const UpsertCompensationOverrideSchema = z
  .object({
    jobId: z.string().trim().min(1).max(128),
    minAmount: z.number().finite().nonnegative().nullable().optional(),
    maxAmount: z.number().finite().nonnegative().nullable().optional(),
    currency: z
      .union([z.string().trim().min(1).max(10), z.null()])
      .optional()
      .transform((v) => (typeof v === "string" ? v.toUpperCase() : v ?? null)),
    period: z.enum(SALARY_PERIODS).nullable().optional(),
    note: z
      .union([z.string().trim().max(1000), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v ?? null)),
    recomputeMatches: z.boolean().optional().default(true),
  })
  .strict()
  .refine(
    (data) =>
      data.minAmount == null ||
      data.maxAmount == null ||
      data.minAmount <= data.maxAmount,
    { message: "minAmount cannot exceed maxAmount." }
  );

export type UpsertCompensationOverrideInput = z.input<
  typeof UpsertCompensationOverrideSchema
>;

const DEFAULT_WEIGHTS: Record<RankingFactorKey, number> = {
  documentedFit: 45,
  searchSkillAlignment: 15,
  freshness: 15,
  location: 10,
  compensation: 10,
  company: 5,
};

const REQUIREMENT_PRIORITY_WEIGHTS: Record<RequirementPriority, number> = {
  must_have: 3,
  responsibility: 2,
  preferred: 1,
  unspecified: 1,
};

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "into", "is", "it", "its", "of", "on", "or", "our", "such", "that",
  "the", "their", "them", "this", "to", "using", "we", "will", "with", "you",
  "your", "experience", "strong", "ability", "knowledge", "understanding",
  "proficiency", "working", "skills", "skill", "work", "team", "years", "year",
  "plus", "preferred", "required", "must", "including", "related", "field",
]);

const COUNTRY_ALIASES: Record<string, string> = {
  us: "US",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  "united states": "US",
  "united states of america": "US",
  uk: "GB",
  gb: "GB",
  "u.k.": "GB",
  "united kingdom": "GB",
  britain: "GB",
  "great britain": "GB",
  england: "GB",
  ca: "CA",
  can: "CA",
  canada: "CA",
  de: "DE",
  deu: "DE",
  germany: "DE",
  fr: "FR",
  fra: "FR",
  france: "FR",
  in: "IN",
  ind: "IN",
  india: "IN",
  au: "AU",
  aus: "AU",
  australia: "AU",
  nl: "NL",
  nld: "NL",
  netherlands: "NL",
  sg: "SG",
  sgp: "SG",
  singapore: "SG",
  ie: "IE",
  irl: "IE",
  ireland: "IE",
  es: "ES",
  esp: "ES",
  spain: "ES",
  jp: "JP",
  jpn: "JP",
  japan: "JP",
  ch: "CH",
  che: "CH",
  switzerland: "CH",
  se: "SE",
  swe: "SE",
  sweden: "SE",
  pl: "PL",
  pol: "PL",
  poland: "PL",
  br: "BR",
  bra: "BR",
  brazil: "BR",
  mx: "MX",
  mex: "MX",
  mexico: "MX",
};

const US_STATE_ABBR_TO_NAME: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california",
  co: "colorado", ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia",
  hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland",
  ma: "massachusetts", mi: "michigan", mn: "minnesota", ms: "mississippi",
  mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "newhampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee",
  tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};

const US_STATE_NAME_TO_ABBR = new Map<string, string>(
  Object.entries(US_STATE_ABBR_TO_NAME).map(([abbr, full]) => [full, abbr])
);

const SENIORITY_ALIASES: Record<string, string> = {
  intern: "intern",
  internship: "intern",
  "entry": "entry",
  "entry-level": "entry",
  "entry level": "entry",
  junior: "entry",
  jr: "entry",
  associate: "entry",
  mid: "mid",
  "mid-level": "mid",
  "mid level": "mid",
  intermediate: "mid",
  senior: "senior",
  sr: "senior",
  staff: "staff",
  principal: "principal",
  lead: "lead",
  "tech lead": "lead",
  manager: "manager",
  director: "director",
  vp: "vp",
  executive: "executive",
};

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

function resolveCanonicalJobRow(
  db: AppDatabase,
  jobId: string
): typeof jobs.$inferSelect | null {
  let current = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!current) return null;

  const visited = new Set<string>([current.id]);
  let hops = 0;
  while (current.mergedIntoJobId && hops < 10) {
    if (visited.has(current.mergedIntoJobId)) break;
    visited.add(current.mergedIntoJobId);
    const parent = db
      .select()
      .from(jobs)
      .where(eq(jobs.id, current.mergedIntoJobId))
      .get();
    if (!parent) break;
    current = parent;
    hops++;
  }
  return current;
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseStringArrayJson(raw: string | null | undefined): string[] {
  const parsed = safeParseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeCountryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!cleaned) return null;
  if (COUNTRY_ALIASES[cleaned]) return COUNTRY_ALIASES[cleaned];
  if (/^[a-z]{2}$/i.test(cleaned)) return cleaned.toUpperCase();
  return null;
}

function normalizeRegionToken(raw: string): string {
  const lower = raw.trim().toLowerCase().replace(/\./g, "");
  return US_STATE_NAME_TO_ABBR.get(lower) ?? lower;
}

interface ParsedLocation {
  city: string | null;
  region: string | null;
  countryCode: string | null;
  isUnrestrictedRemote: boolean;
}

function parseLocationParts(
  rawLocation: string | null | undefined,
  fallbackCountryCode?: string | null
): ParsedLocation {
  const explicitCountry = normalizeCountryCode(fallbackCountryCode);
  if (!rawLocation || !rawLocation.trim()) {
    return {
      city: null,
      region: null,
      countryCode: explicitCountry,
      isUnrestrictedRemote: false,
    };
  }

  let cleaned = rawLocation.trim();
  const lowerFull = cleaned.toLowerCase();
  const mentionsRemote = /\bremote\b/i.test(lowerFull);
  const mentionsWorldwide =
    /\b(worldwide|global|anywhere|international|any location)\b/i.test(
      lowerFull
    );

  // Strip wrapper annotations like "(Remote)", "Remote - ", "Hybrid in "
  cleaned = cleaned
    .replace(/\b(fully\s+remote|remote|hybrid|on[- ]?site|in[- ]?office)\b/gi, " ")
    .replace(/[()[\]]/g, " ")
    .replace(/\s*[-–|]+\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  const segments = cleaned
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(worldwide|global|anywhere)$/i.test(s));

  if (segments.length === 0) {
    return {
      city: null,
      region: null,
      countryCode: mentionsWorldwide ? null : explicitCountry,
      isUnrestrictedRemote: mentionsRemote && !explicitCountry,
    };
  }

  let countryCode = explicitCountry;
  const remaining = [...segments];

  // Check last segment as country
  const lastCountry = normalizeCountryCode(remaining[remaining.length - 1]);
  if (lastCountry) {
    countryCode = lastCountry;
    remaining.pop();
  }

  let region: string | null = null;
  let city: string | null = null;

  if (remaining.length >= 2) {
    region = normalizeRegionToken(remaining[remaining.length - 1]);
    city = remaining[0].toLowerCase();
  } else if (remaining.length === 1) {
    const token = remaining[0].toLowerCase();
    const cleanToken = token.replace(/\./g, "");
    if (
      US_STATE_ABBR_TO_NAME[cleanToken] ||
      US_STATE_NAME_TO_ABBR.has(cleanToken)
    ) {
      region = normalizeRegionToken(cleanToken);
      if (!countryCode) countryCode = "US";
    } else {
      city = token;
    }
  }

  if (region && !countryCode && US_STATE_ABBR_TO_NAME[region]) {
    countryCode = "US";
  }

  return {
    city,
    region,
    countryCode,
    isUnrestrictedRemote:
      mentionsRemote && !city && !region && !countryCode,
  };
}

type LocationMatchLevel = "exact" | "alternative" | "mismatch" | "unknown";

function evaluateLocationAgainstPreferences(
  jobLoc: ParsedLocation,
  prefs: ParsedLocation[]
): LocationMatchLevel {
  if (prefs.length === 0) return "unknown";
  if (!jobLoc.city && !jobLoc.region && !jobLoc.countryCode) {
    return "unknown";
  }

  let best: LocationMatchLevel = "mismatch";

  for (const pref of prefs) {
    // City-level preference (most specific)
    if (pref.city) {
      if (jobLoc.city && jobLoc.city === pref.city) {
        if (
          (!pref.region || !jobLoc.region || jobLoc.region === pref.region) &&
          (!pref.countryCode ||
            !jobLoc.countryCode ||
            jobLoc.countryCode === pref.countryCode)
        ) {
          return "exact";
        }
      }
      if (pref.region && jobLoc.region && jobLoc.region === pref.region) {
        best = "alternative";
        continue;
      }
      if (
        pref.countryCode &&
        jobLoc.countryCode &&
        jobLoc.countryCode === pref.countryCode
      ) {
        best = "alternative";
      }
      continue;
    }

    // Region-level preference
    if (pref.region) {
      if (jobLoc.region && jobLoc.region === pref.region) {
        if (
          !pref.countryCode ||
          !jobLoc.countryCode ||
          jobLoc.countryCode === pref.countryCode
        ) {
          return "exact";
        }
      }
      if (
        pref.countryCode &&
        jobLoc.countryCode &&
        jobLoc.countryCode === pref.countryCode
      ) {
        best = "alternative";
      }
      continue;
    }

    // Country-level preference
    if (pref.countryCode) {
      if (jobLoc.countryCode && jobLoc.countryCode === pref.countryCode) {
        return "exact";
      }
    }
  }

  return best;
}

function parseConfiguredLocations(rawJson: string | null | undefined): ParsedLocation[] {
  const parsed = safeParseJson<unknown>(rawJson, []);
  if (!Array.isArray(parsed)) return [];
  const results: ParsedLocation[] = [];

  for (const item of parsed) {
    if (typeof item === "string") {
      if (!item.trim()) continue;
      results.push(parseLocationParts(item));
    } else if (typeof item === "object" && item !== null) {
      const rec = item as Record<string, unknown>;
      const city = typeof rec.city === "string" ? rec.city.trim().toLowerCase() : null;
      const rawRegion =
        typeof rec.region === "string"
          ? rec.region
          : typeof rec.state === "string"
            ? rec.state
            : null;
      const region = rawRegion ? normalizeRegionToken(rawRegion) : null;
      const rawCountry =
        typeof rec.countryCode === "string"
          ? rec.countryCode
          : typeof rec.country === "string"
            ? rec.country
            : null;
      const countryCode = normalizeCountryCode(rawCountry);
      if (city || region || countryCode) {
        results.push({
          city: city || null,
          region: region || null,
          countryCode,
          isUnrestrictedRemote: false,
        });
      } else if (typeof rec.label === "string" && rec.label.trim()) {
        results.push(parseLocationParts(rec.label));
      }
    }
  }

  return results;
}

function normalizeCompanyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[.,/\\|()]+/g, " ")
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|gmbh|plc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmploymentType(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeSeniority(raw: string): string {
  const lower = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return SENIORITY_ALIASES[lower] ?? lower;
}

interface ParsedHardFilters {
  locationHard: boolean;
  workplaceHard: boolean;
  remoteCountriesHard: boolean;
  relocationHard: boolean;
  seniorityHard: boolean;
  yearsExperienceHard: boolean;
  employmentTypeHard: boolean;
  excludeMissingSalary: boolean;
  salaryHard: boolean;
  maxJobAgeHard: boolean;
  includeUnknownPostedDate: boolean;
  excludedCompaniesHard: boolean;
  excludedSourcesHard: boolean;
  minSalary: number | null;
  targetSalary: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  maxJobAgeDays: number | null;
  excludedLocations: string[];
  includedCompanyIds: string[];
  includedCompanies: string[];
  excludedCompanyIds: string[];
  excludedCompanies: string[];
  preferredCompanyIds: string[];
  preferredCompanies: string[];
  preferredIndustries: string[];
  dispreferredCompanyIds: string[];
  dispreferredCompanies: string[];
  dispreferredIndustries: string[];
  includedSourceIds: string[];
  excludedSourceIds: string[];
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseHardFiltersConfig(
  searchProfileRow: typeof searchProfiles.$inferSelect
): ParsedHardFilters {
  const raw = safeParseJson<Record<string, unknown>>(
    searchProfileRow.hardFiltersJson,
    {}
  );
  const compObj =
    typeof raw.compensation === "object" && raw.compensation !== null
      ? (raw.compensation as Record<string, unknown>)
      : {};
  const companyObj =
    typeof raw.company === "object" && raw.company !== null
      ? (raw.company as Record<string, unknown>)
      : {};

  const minSalary =
    toFiniteNumber(raw.minSalary) ??
    toFiniteNumber(raw.minCompensation) ??
    toFiniteNumber(raw.compensationMin) ??
    toFiniteNumber(compObj.min) ??
    toFiniteNumber(compObj.minAmount);
  const rawTargetSalary =
    toFiniteNumber(raw.targetSalary) ??
    toFiniteNumber(raw.targetCompensation) ??
    toFiniteNumber(raw.compensationTarget) ??
    toFiniteNumber(compObj.target) ??
    toFiniteNumber(compObj.targetAmount);
  const targetSalary =
    minSalary !== null
      ? Math.max(minSalary, rawTargetSalary ?? minSalary)
      : null;

  const rawCurrency =
    (typeof raw.salaryCurrency === "string" ? raw.salaryCurrency : null) ??
    (typeof raw.compensationCurrency === "string"
      ? raw.compensationCurrency
      : null) ??
    (typeof compObj.currency === "string" ? compObj.currency : null);

  const rawPeriod =
    (typeof raw.salaryPeriod === "string" ? raw.salaryPeriod : null) ??
    (typeof raw.compensationPeriod === "string"
      ? raw.compensationPeriod
      : null) ??
    (typeof compObj.period === "string" ? compObj.period : null);

  const parsedPeriod = SALARY_PERIODS.includes(rawPeriod as SalaryPeriod)
    ? (rawPeriod as SalaryPeriod)
    : null;

  const maxJobAgeDays =
    searchProfileRow.maxJobAgeDays ?? toFiniteNumber(raw.maxJobAgeDays);
  const maxJobAgeHard =
    typeof raw.maxJobAgeHard === "boolean"
      ? raw.maxJobAgeHard
      : maxJobAgeDays !== null;

  return {
    locationHard: Boolean(raw.locationHard ?? raw.locationsHard ?? raw.location),
    workplaceHard: Boolean(
      raw.workplaceHard ?? raw.workplaceTypeHard ?? raw.workplaceTypesHard
    ),
    remoteCountriesHard: Boolean(
      raw.remoteCountriesHard ?? raw.remoteEligibleCountriesHard
    ),
    relocationHard:
      Boolean(raw.relocationHardNo ?? raw.relocationHard) ||
      raw.relocation === "hard_no",
    seniorityHard: Boolean(raw.seniorityHard),
    yearsExperienceHard: Boolean(
      raw.yearsExperienceHard ?? raw.experienceHard ?? raw.seniorityHard
    ),
    employmentTypeHard: Boolean(
      raw.employmentTypeHard ?? raw.employmentTypesHard
    ),
    excludeMissingSalary: Boolean(
      raw.excludeMissingSalary ??
        raw.missingSalaryHard ??
        raw.requireSalary ??
        compObj.excludeMissing
    ),
    salaryHard: Boolean(raw.salaryHard ?? raw.compensationHard ?? compObj.hard),
    maxJobAgeHard,
    includeUnknownPostedDate:
      typeof raw.includeUnknownPostedDate === "boolean"
        ? raw.includeUnknownPostedDate
        : true,
    excludedCompaniesHard:
      typeof raw.excludedCompaniesHard === "boolean"
        ? raw.excludedCompaniesHard
        : true,
    excludedSourcesHard:
      typeof raw.excludedSourcesHard === "boolean"
        ? raw.excludedSourcesHard
        : true,
    minSalary,
    targetSalary,
    salaryCurrency: rawCurrency ? rawCurrency.trim().toUpperCase() : null,
    salaryPeriod: parsedPeriod,
    maxJobAgeDays,
    excludedLocations: toStringList(raw.excludedLocations),
    includedCompanyIds: toStringList(
      raw.includedCompanyIds ?? companyObj.includedIds
    ),
    includedCompanies: toStringList(
      raw.includedCompanies ?? companyObj.includedNames
    ),
    excludedCompanyIds: toStringList(
      raw.excludedCompanyIds ?? companyObj.excludedIds
    ),
    excludedCompanies: toStringList(
      raw.excludedCompanies ?? companyObj.excludedNames
    ),
    preferredCompanyIds: toStringList(
      raw.preferredCompanyIds ?? companyObj.preferredIds
    ),
    preferredCompanies: toStringList(
      raw.preferredCompanies ?? companyObj.preferredNames
    ),
    preferredIndustries: toStringList(
      raw.preferredIndustries ?? companyObj.preferredIndustries
    ),
    dispreferredCompanyIds: toStringList(
      raw.dispreferredCompanyIds ?? companyObj.dispreferredIds
    ),
    dispreferredCompanies: toStringList(
      raw.dispreferredCompanies ?? companyObj.dispreferredNames
    ),
    dispreferredIndustries: toStringList(
      raw.dispreferredIndustries ??
        raw.excludedIndustries ??
        companyObj.dispreferredIndustries
    ),
    includedSourceIds: toStringList(
      raw.includedSourceIds ?? raw.includedSources
    ),
    excludedSourceIds: toStringList(
      raw.excludedSourceIds ?? raw.excludedSources
    ),
  };
}

function parseRankingWeights(rawJson: string | null | undefined): Record<RankingFactorKey, number> {
  const raw = safeParseJson<Record<string, unknown>>(rawJson, {});
  const entries: Array<[RankingFactorKey, unknown]> = [
    [
      "documentedFit",
      raw.documentedFit ?? raw.documented_fit ?? raw.fit,
    ],
    [
      "searchSkillAlignment",
      raw.searchSkillAlignment ??
        raw.search_skill_alignment ??
        raw.skillAlignment ??
        raw.skills,
    ],
    ["freshness", raw.freshness],
    ["location", raw.location ?? raw.locationWorkMode],
    ["compensation", raw.compensation ?? raw.salary],
    ["company", raw.company ?? raw.companyIndustry],
  ];

  const hasAny = entries.some(([, v]) => typeof v === "number" && Number.isFinite(v));
  if (!hasAny) {
    return { ...DEFAULT_WEIGHTS };
  }

  const out: Record<RankingFactorKey, number> = {
    documentedFit: 0,
    searchSkillAlignment: 0,
    freshness: 0,
    location: 0,
    compensation: 0,
    company: 0,
  };

  for (const [key, val] of entries) {
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
      out[key] = val;
    }
  }

  return out;
}

interface VerifiedCareerFacts {
  profile: typeof profile.$inferSelect | null;
  experiences: Array<typeof experiences.$inferSelect>;
  projects: Array<typeof projects.$inferSelect>;
  achievements: Array<typeof achievements.$inferSelect>;
  skills: Array<typeof skills.$inferSelect>;
  education: Array<typeof education.$inferSelect>;
  certifications: Array<typeof certifications.$inferSelect>;
  languages: Array<typeof languages.$inferSelect>;
  linkedSkillIdsByFact: Map<string, Set<string>>;
  skillLinkedToWork: Set<string>;
  evidenceLinkByTarget: Map<string, string>;
  totalExperienceYears: number;
  hasDatedExperience: boolean;
}

function parseDateToMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}$/.test(trimmed)) {
    return Date.UTC(Number(trimmed), 0, 1);
  }
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [y, m] = trimmed.split("-").map(Number);
    return Date.UTC(y, m - 1, 1);
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

function computeMergedExperienceYears(
  exps: Array<{ startDate: string | null; endDate: string | null; isCurrent: boolean }>,
  nowMs: number
): { years: number; hasDated: boolean } {
  const intervals: Array<[number, number]> = [];

  for (const exp of exps) {
    const startMs = parseDateToMs(exp.startDate);
    if (startMs === null) continue;
    let endMs = parseDateToMs(exp.endDate);
    if (endMs === null && exp.isCurrent) {
      endMs = nowMs;
    }
    if (endMs === null || endMs < startMs) continue;
    intervals.push([startMs, endMs]);
  }

  if (intervals.length === 0) {
    return { years: 0, hasDated: false };
  }

  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [intervals[0]];

  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    const last = merged[merged.length - 1];
    if (s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const totalMs = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
  return {
    years: totalMs / (365.25 * 24 * 60 * 60 * 1000),
    hasDated: true,
  };
}

function loadVerifiedCareerFacts(
  db: AppDatabase,
  nowMs: number
): VerifiedCareerFacts {
  const verifiedProfile =
    db
      .select()
      .from(profile)
      .where(
        and(eq(profile.id, 1), eq(profile.verificationStatus, "verified"))
      )
      .get() ?? null;

  const verifiedExps = db
    .select()
    .from(experiences)
    .where(eq(experiences.verificationStatus, "verified"))
    .all();

  const verifiedProjects = db
    .select()
    .from(projects)
    .where(eq(projects.verificationStatus, "verified"))
    .all();

  const verifiedAchievements = db
    .select()
    .from(achievements)
    .where(eq(achievements.verificationStatus, "verified"))
    .all();

  const verifiedSkills = db
    .select()
    .from(skills)
    .where(eq(skills.verificationStatus, "verified"))
    .all();

  const verifiedEducation = db
    .select()
    .from(education)
    .where(eq(education.verificationStatus, "verified"))
    .all();

  const verifiedCertifications = db
    .select()
    .from(certifications)
    .where(eq(certifications.verificationStatus, "verified"))
    .all();

  const verifiedLanguages = db
    .select()
    .from(languages)
    .where(eq(languages.verificationStatus, "verified"))
    .all();

  const verifiedEvidence = db
    .select()
    .from(evidenceLinks)
    .where(eq(evidenceLinks.verificationStatus, "verified"))
    .all();

  const verifiedSkillIdSet = new Set(verifiedSkills.map((s) => s.id));
  const verifiedExpIdSet = new Set(verifiedExps.map((e) => e.id));
  const verifiedProjIdSet = new Set(verifiedProjects.map((p) => p.id));
  const verifiedAchIdSet = new Set(verifiedAchievements.map((a) => a.id));

  const linkedSkillIdsByFact = new Map<string, Set<string>>();
  const skillLinkedToWork = new Set<string>();

  const addLink = (factKey: string, skillId: string) => {
    const set = linkedSkillIdsByFact.get(factKey) ?? new Set<string>();
    set.add(skillId);
    linkedSkillIdsByFact.set(factKey, set);
    skillLinkedToWork.add(skillId);
  };

  for (const row of db.select().from(experienceSkills).all()) {
    if (verifiedExpIdSet.has(row.experienceId) && verifiedSkillIdSet.has(row.skillId)) {
      addLink(`experience:${row.experienceId}`, row.skillId);
    }
  }
  for (const row of db.select().from(projectSkills).all()) {
    if (verifiedProjIdSet.has(row.projectId) && verifiedSkillIdSet.has(row.skillId)) {
      addLink(`project:${row.projectId}`, row.skillId);
    }
  }
  for (const row of db.select().from(achievementSkills).all()) {
    if (verifiedAchIdSet.has(row.achievementId) && verifiedSkillIdSet.has(row.skillId)) {
      addLink(`achievement:${row.achievementId}`, row.skillId);
    }
  }

  const evidenceLinkByTarget = new Map<string, string>();
  for (const ev of verifiedEvidence) {
    const key = `${ev.targetType}:${ev.targetId}`;
    if (!evidenceLinkByTarget.has(key)) {
      evidenceLinkByTarget.set(key, ev.id);
    }
  }

  const expDuration = computeMergedExperienceYears(verifiedExps, nowMs);

  return {
    profile: verifiedProfile,
    experiences: verifiedExps,
    projects: verifiedProjects,
    achievements: verifiedAchievements,
    skills: verifiedSkills,
    education: verifiedEducation,
    certifications: verifiedCertifications,
    languages: verifiedLanguages,
    linkedSkillIdsByFact,
    skillLinkedToWork,
    evidenceLinkByTarget,
    totalExperienceYears: expDuration.years,
    hasDatedExperience: expDuration.hasDated,
  };
}

function tokenizeKeywords(text: string): string[] {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s/-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-./]+|[-./]+$/g, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return Array.from(new Set(words));
}

function extractRequiredYears(text: string): number | null {
  const m = /\b(\d{1,2})\s*\+?\s*(?:-\s*\d+\s*)?years?\b/i.exec(text);
  if (!m) return null;
  const val = Number(m[1]);
  return Number.isFinite(val) ? val : null;
}

function parseDegreeRank(text: string): number {
  const lower = text.toLowerCase();
  if (/\b(ph\.?d|doctorate|doctoral)\b/.test(lower)) return 4;
  if (/\b(master|m\.s\.|ms|m\.sc|mba|m\.tech|m\.eng)\b/.test(lower)) return 3;
  if (/\b(bachelor|b\.s\.|bs|b\.a\.|ba|b\.sc|b\.tech|b\.e\.|undergraduate)\b/.test(lower)) {
    return 2;
  }
  if (/\b(associate|diploma)\b/.test(lower)) return 1;
  return 0;
}

function findVerifiedSkillMatch(
  aliases: string[],
  facts: VerifiedCareerFacts
): typeof skills.$inferSelect | null {
  const aliasSet = new Set(aliases.map((a) => normalizeSkillTerm(a)));
  const rawSet = new Set(aliases.map((a) => a.toLowerCase().trim()));

  for (const skill of facts.skills) {
    const keyNorm = normalizeSkillTerm(skill.normalizedKey);
    const nameNorm = normalizeSkillTerm(skill.canonicalName);
    if (
      aliasSet.has(keyNorm) ||
      aliasSet.has(nameNorm) ||
      rawSet.has(skill.normalizedKey.toLowerCase()) ||
      rawSet.has(skill.canonicalName.toLowerCase())
    ) {
      return skill;
    }

    const skillAliases = parseStringArrayJson(skill.aliasesJson);
    for (const sa of skillAliases) {
      if (aliasSet.has(normalizeSkillTerm(sa)) || rawSet.has(sa.toLowerCase())) {
        return skill;
      }
    }
  }
  return null;
}

function findFactMentioningSkill(
  aliases: string[],
  facts: VerifiedCareerFacts
): {
  factType: string;
  factId: string;
  label: string;
  matchingExpIds: string[];
} | null {
  const matchingExpIds: string[] = [];
  let firstMatch: { factType: string; factId: string; label: string } | null = null;

  for (const exp of facts.experiences) {
    const text = `${exp.title} ${exp.description ?? ""}`;
    if (textContainsSkillAlias(text, aliases)) {
      matchingExpIds.push(exp.id);
      if (!firstMatch) {
        firstMatch = {
          factType: "experience",
          factId: exp.id,
          label: `${exp.title} at ${exp.employer}`,
        };
      }
    }
  }

  if (firstMatch) {
    return { ...firstMatch, matchingExpIds };
  }

  for (const proj of facts.projects) {
    const text = [
      proj.name,
      proj.problem,
      proj.description,
      proj.roleContribution,
      proj.architecture,
      proj.outcomes,
    ]
      .filter(Boolean)
      .join(" ");
    if (textContainsSkillAlias(text, aliases)) {
      return {
        factType: "project",
        factId: proj.id,
        label: proj.name,
        matchingExpIds: [],
      };
    }
  }

  for (const ach of facts.achievements) {
    if (textContainsSkillAlias(ach.text, aliases)) {
      return {
        factType: "achievement",
        factId: ach.id,
        label: ach.text.slice(0, 80),
        matchingExpIds: [],
      };
    }
  }

  for (const cert of facts.certifications) {
    if (textContainsSkillAlias(`${cert.name} ${cert.issuer ?? ""}`, aliases)) {
      return {
        factType: "certification",
        factId: cert.id,
        label: cert.name,
        matchingExpIds: [],
      };
    }
  }

  return null;
}

function matchRequirementAgainstProfile(
  req: typeof jobRequirements.$inferSelect,
  facts: VerifiedCareerFacts,
  nowMs: number
): EvaluatedRequirementEvidence {
  if (
    req.extractionConfidence !== null &&
    req.extractionConfidence < 0.35
  ) {
    return {
      jobRequirementId: req.id,
      supportState: "ambiguous",
      linkedFactType: null,
      linkedFactId: null,
      evidenceLinkId: null,
      explanation: "Low extraction confidence; marked ambiguous for review.",
    };
  }

  const detectedInReq = detectSkillsInText(req.requirementText);
  const candidateSkillTerms = req.normalizedSkill
    ? [req.normalizedSkill, ...detectedInReq]
    : detectedInReq;

  const uniqueAliases = Array.from(
    new Set(candidateSkillTerms.flatMap((t) => expandSkillAliases(t)))
  );

  // 1. Experience requirement with explicit years
  const requiredYears = extractRequiredYears(req.requirementText);
  if (req.category === "experience" && requiredYears !== null) {
    const matchedSkill =
      uniqueAliases.length > 0 ? findVerifiedSkillMatch(uniqueAliases, facts) : null;
    const factWithSkill =
      uniqueAliases.length > 0 ? findFactMentioningSkill(uniqueAliases, facts) : null;

    if (uniqueAliases.length > 0) {
      if (!matchedSkill && !factWithSkill) {
        return {
          jobRequirementId: req.id,
          supportState: "not_found_in_profile",
          linkedFactType: null,
          linkedFactId: null,
          evidenceLinkId: null,
          explanation: "No verified skill or experience found matching requirement.",
        };
      }

      const relevantExps = factWithSkill?.matchingExpIds.length
        ? facts.experiences.filter((e) => factWithSkill.matchingExpIds.includes(e.id))
        : facts.experiences;
      const relevantDur = computeMergedExperienceYears(relevantExps, nowMs);

      const linkedType = matchedSkill ? "skill" : factWithSkill!.factType;
      const linkedId = matchedSkill ? matchedSkill.id : factWithSkill!.factId;
      const evId = facts.evidenceLinkByTarget.get(`${linkedType}:${linkedId}`) ?? null;

      if (relevantDur.hasDated && relevantDur.years >= requiredYears) {
        return {
          jobRequirementId: req.id,
          supportState: "supported",
          linkedFactType: linkedType,
          linkedFactId: linkedId,
          evidenceLinkId: evId,
          explanation: `Verified experience (~${relevantDur.years.toFixed(1)} yrs) and skill evidence meet ${requiredYears}+ yrs requirement.`,
        };
      }
      if (
        (relevantDur.hasDated && relevantDur.years >= requiredYears * 0.5) ||
        (!relevantDur.hasDated && (matchedSkill || factWithSkill))
      ) {
        return {
          jobRequirementId: req.id,
          supportState: "partially_supported",
          linkedFactType: linkedType,
          linkedFactId: linkedId,
          evidenceLinkId: evId,
          explanation: `Verified evidence found for skill, though documented duration does not fully confirm ${requiredYears}+ yrs.`,
        };
      }
      return {
        jobRequirementId: req.id,
        supportState: "partially_supported",
        linkedFactType: linkedType,
        linkedFactId: linkedId,
        evidenceLinkId: evId,
        explanation: `Verified skill found, with ${relevantDur.years.toFixed(1)} documented yrs vs ${requiredYears}+ yrs requested.`,
      };
    }

    // Generic years-of-experience requirement
    if (facts.hasDatedExperience && facts.experiences.length > 0) {
      const topExp = facts.experiences[0];
      const evId =
        facts.evidenceLinkByTarget.get(`experience:${topExp.id}`) ?? null;
      if (facts.totalExperienceYears >= requiredYears) {
        return {
          jobRequirementId: req.id,
          supportState: "supported",
          linkedFactType: "experience",
          linkedFactId: topExp.id,
          evidenceLinkId: evId,
          explanation: `Verified experience spans ~${facts.totalExperienceYears.toFixed(1)} yrs (meets ${requiredYears}+ yrs).`,
        };
      }
      if (facts.totalExperienceYears >= requiredYears * 0.5) {
        return {
          jobRequirementId: req.id,
          supportState: "partially_supported",
          linkedFactType: "experience",
          linkedFactId: topExp.id,
          evidenceLinkId: evId,
          explanation: `Verified experience spans ~${facts.totalExperienceYears.toFixed(1)} yrs (partial toward ${requiredYears}+ yrs).`,
        };
      }
    }

    return {
      jobRequirementId: req.id,
      supportState: "not_found_in_profile",
      linkedFactType: null,
      linkedFactId: null,
      evidenceLinkId: null,
      explanation: "Insufficient verified experience duration found in profile.",
    };
  }

  // 2. Skill-based matching (for skill category or any requirement with detected skill)
  if (uniqueAliases.length > 0) {
    const matchedSkill = findVerifiedSkillMatch(uniqueAliases, facts);
    if (matchedSkill) {
      const evId =
        facts.evidenceLinkByTarget.get(`skill:${matchedSkill.id}`) ?? null;
      return {
        jobRequirementId: req.id,
        supportState: "supported",
        linkedFactType: "skill",
        linkedFactId: matchedSkill.id,
        evidenceLinkId: evId,
        explanation: `Supported by verified skill "${matchedSkill.canonicalName}".`,
      };
    }

    const mention = findFactMentioningSkill(uniqueAliases, facts);
    if (mention) {
      const evId =
        facts.evidenceLinkByTarget.get(
          `${mention.factType}:${mention.factId}`
        ) ?? null;
      return {
        jobRequirementId: req.id,
        supportState: req.category === "skill" ? "supported" : "partially_supported",
        linkedFactType: mention.factType,
        linkedFactId: mention.factId,
        evidenceLinkId: evId,
        explanation: `Supported by verified ${mention.factType} "${mention.label}".`,
      };
    }

    if (req.category === "skill") {
      return {
        jobRequirementId: req.id,
        supportState: "not_found_in_profile",
        linkedFactType: null,
        linkedFactId: null,
        evidenceLinkId: null,
        explanation: "Skill not found among verified career profile facts.",
      };
    }
  }

  // 3. Education matching
  if (req.category === "education") {
    const requiredRank = parseDegreeRank(req.requirementText);
    const reqTokens = tokenizeKeywords(req.requirementText).filter(
      (t) => !["bachelor", "master", "degree", "phd", "doctorate", "equivalent"].includes(t)
    );

    let bestEdu: {
      edu: typeof education.$inferSelect;
      state: MachineSupportState;
      reason: string;
    } | null = null;

    for (const edu of facts.education) {
      const eduText = `${edu.qualification} ${edu.fieldOfStudy ?? ""} ${edu.details ?? ""}`;
      const eduRank = parseDegreeRank(eduText);
      const eduTokens = new Set(tokenizeKeywords(eduText));
      const fieldOverlap = reqTokens.filter((t) => eduTokens.has(t)).length;

      const rankOk = requiredRank === 0 || eduRank >= requiredRank;
      const fieldOk = reqTokens.length === 0 || fieldOverlap > 0;

      if (rankOk && fieldOk) {
        bestEdu = {
          edu,
          state: "supported",
          reason: `Verified education "${edu.qualification}" at ${edu.institution} matches.`,
        };
        break;
      }
      if (rankOk || fieldOk) {
        bestEdu = {
          edu,
          state: "partially_supported",
          reason: `Verified education "${edu.qualification}" partially matches requirement.`,
        };
      }
    }

    if (bestEdu) {
      return {
        jobRequirementId: req.id,
        supportState: bestEdu.state,
        linkedFactType: "education",
        linkedFactId: bestEdu.edu.id,
        evidenceLinkId:
          facts.evidenceLinkByTarget.get(`education:${bestEdu.edu.id}`) ?? null,
        explanation: bestEdu.reason,
      };
    }

    return {
      jobRequirementId: req.id,
      supportState: "not_found_in_profile",
      linkedFactType: null,
      linkedFactId: null,
      evidenceLinkId: null,
      explanation: "No matching verified education record found.",
    };
  }

  // 4. General semantic/keyword overlap across verified facts
  const reqKeywords = tokenizeKeywords(req.requirementText);
  if (reqKeywords.length === 0) {
    return {
      jobRequirementId: req.id,
      supportState: "ambiguous",
      linkedFactType: null,
      linkedFactId: null,
      evidenceLinkId: null,
      explanation: "Requirement text has insufficient specific terms to evaluate.",
    };
  }

  const candidateFacts: Array<{
    factType: string;
    factId: string;
    label: string;
    tokens: Set<string>;
  }> = [];

  for (const exp of facts.experiences) {
    candidateFacts.push({
      factType: "experience",
      factId: exp.id,
      label: `${exp.title} at ${exp.employer}`,
      tokens: new Set(tokenizeKeywords(`${exp.title} ${exp.description ?? ""}`)),
    });
  }
  for (const proj of facts.projects) {
    candidateFacts.push({
      factType: "project",
      factId: proj.id,
      label: proj.name,
      tokens: new Set(
        tokenizeKeywords(
          [
            proj.name,
            proj.problem,
            proj.description,
            proj.roleContribution,
            proj.architecture,
            proj.outcomes,
          ]
            .filter(Boolean)
            .join(" ")
        )
      ),
    });
  }
  for (const ach of facts.achievements) {
    candidateFacts.push({
      factType: "achievement",
      factId: ach.id,
      label: ach.text.slice(0, 80),
      tokens: new Set(tokenizeKeywords(ach.text)),
    });
  }
  for (const cert of facts.certifications) {
    candidateFacts.push({
      factType: "certification",
      factId: cert.id,
      label: cert.name,
      tokens: new Set(tokenizeKeywords(`${cert.name} ${cert.issuer ?? ""}`)),
    });
  }
  for (const lang of facts.languages) {
    candidateFacts.push({
      factType: "language",
      factId: lang.id,
      label: lang.language,
      tokens: new Set(tokenizeKeywords(`${lang.language} ${lang.proficiency ?? ""}`)),
    });
  }
  if (facts.profile) {
    candidateFacts.push({
      factType: "profile",
      factId: "1",
      label: facts.profile.headline ?? "Profile summary",
      tokens: new Set(
        tokenizeKeywords(
          `${facts.profile.headline ?? ""} ${facts.profile.summary ?? ""}`
        )
      ),
    });
  }

  let bestOverlap = 0;
  let bestMatchedCount = 0;
  let bestFact: (typeof candidateFacts)[number] | null = null;

  for (const fact of candidateFacts) {
    let matchedCount = 0;
    for (const kw of reqKeywords) {
      if (fact.tokens.has(kw)) matchedCount++;
    }
    const ratio = matchedCount / reqKeywords.length;
    if (
      matchedCount > bestMatchedCount ||
      (matchedCount === bestMatchedCount && ratio > bestOverlap)
    ) {
      bestMatchedCount = matchedCount;
      bestOverlap = ratio;
      bestFact = fact;
    }
  }

  if (bestFact && (bestOverlap >= 0.5 || bestMatchedCount >= 3)) {
    return {
      jobRequirementId: req.id,
      supportState: "supported",
      linkedFactType: bestFact.factType,
      linkedFactId: bestFact.factId,
      evidenceLinkId:
        facts.evidenceLinkByTarget.get(
          `${bestFact.factType}:${bestFact.factId}`
        ) ?? null,
      explanation: `Supported by verified ${bestFact.factType} "${bestFact.label}".`,
    };
  }

  if (bestFact && (bestOverlap >= 0.25 || bestMatchedCount >= 2)) {
    return {
      jobRequirementId: req.id,
      supportState: "partially_supported",
      linkedFactType: bestFact.factType,
      linkedFactId: bestFact.factId,
      evidenceLinkId:
        facts.evidenceLinkByTarget.get(
          `${bestFact.factType}:${bestFact.factId}`
        ) ?? null,
      explanation: `Partially supported by verified ${bestFact.factType} "${bestFact.label}".`,
    };
  }

  return {
    jobRequirementId: req.id,
    supportState: "not_found_in_profile",
    linkedFactType: null,
    linkedFactId: null,
    evidenceLinkId: null,
    explanation: "No supporting verified career profile fact found.",
  };
}

function doesJobMatchSearchSkill(
  skillEntry: typeof searchProfileSkills.$inferSelect,
  job: typeof jobs.$inferSelect,
  activeRequirements: Array<typeof jobRequirements.$inferSelect>
): boolean {
  const customAliases = parseStringArrayJson(skillEntry.aliasesJson);
  const aliases = expandSkillAliases(skillEntry.normalizedSkillKey, [
    skillEntry.displayLabel,
    ...customAliases,
  ]);
  const normalizedAliasSet = new Set(aliases.map((a) => normalizeSkillTerm(a)));

  if (textContainsSkillAlias(job.title, aliases)) {
    return true;
  }

  for (const req of activeRequirements) {
    if (
      req.normalizedSkill &&
      normalizedAliasSet.has(normalizeSkillTerm(req.normalizedSkill))
    ) {
      return true;
    }
    if (textContainsSkillAlias(req.requirementText, aliases)) {
      return true;
    }
  }

  if (textContainsSkillAlias(job.descriptionText, aliases)) {
    return true;
  }

  return false;
}

function detectRelocationRequired(
  job: typeof jobs.$inferSelect,
  activeRequirements: Array<typeof jobRequirements.$inferSelect>
): boolean {
  const combined = [
    job.descriptionText,
    ...activeRequirements.map((r) => r.requirementText),
  ].join("\n");
  if (
    /\b(no relocation|relocation not required|without relocation)\b/i.test(
      combined
    )
  ) {
    return false;
  }
  return /\b(relocation required|must relocate|requires relocation|willing to relocate|relocate to)\b/i.test(
    combined
  );
}

/**
 * Computes documented fit, search-profile skill alignment, hard-filter eligibility,
 * factor-by-factor breakdown, and renormalized priority score for `(jobId, searchProfileId)`,
 * persisting `match_runs` and `match_evidence` in a short synchronous transaction.
 */
export function computeJobMatch(
  input: ComputeJobMatchInput
): ComputeJobMatchResult {
  const { db, sqlite } = resolveDbAndSqlite(input.db, input.sqlite);
  const nowFn = input.now ?? (() => new Date());
  const nowDate = nowFn();
  const nowMs = nowDate.getTime();

  const job = resolveCanonicalJobRow(db, input.jobId);
  if (!job) {
    throw new MatchingServiceError(
      "JOB_NOT_FOUND",
      404,
      `Job '${input.jobId}' not found.`
    );
  }

  const searchProfileRow = db
    .select()
    .from(searchProfiles)
    .where(eq(searchProfiles.id, input.searchProfileId))
    .get();
  if (!searchProfileRow) {
    throw new MatchingServiceError(
      "SEARCH_PROFILE_NOT_FOUND",
      404,
      `Search profile '${input.searchProfileId}' not found.`
    );
  }

  const allReqs = db
    .select()
    .from(jobRequirements)
    .where(eq(jobRequirements.jobId, job.id))
    .orderBy(asc(jobRequirements.sortOrder), asc(jobRequirements.createdAt))
    .all();
  const activeRequirements = allReqs.filter(
    (r) => r.overrideState !== "orphaned"
  );

  const profileSkills = db
    .select()
    .from(searchProfileSkills)
    .where(eq(searchProfileSkills.searchProfileId, searchProfileRow.id))
    .all();

  const companyRow = job.companyId
    ? db
        .select()
        .from(companies)
        .where(eq(companies.id, job.companyId))
        .get() ?? null
    : null;

  const sourceRecordRows = db
    .select({ sourceId: jobSourceRecords.sourceId })
    .from(jobSourceRecords)
    .where(eq(jobSourceRecords.jobId, job.id))
    .all();

  const compensationOverride =
    db
      .select()
      .from(jobCompensationOverrides)
      .where(eq(jobCompensationOverrides.jobId, job.id))
      .get() ?? null;

  const verifiedFacts = loadVerifiedCareerFacts(db, nowMs);

  // 1. Evaluate documented fit (Section 8.2)
  const evidence = activeRequirements.map((req) =>
    matchRequirementAgainstProfile(req, verifiedFacts, nowMs)
  );
  const evidenceByReqId = new Map(
    evidence.map((ev) => [ev.jobRequirementId, ev])
  );

  let docFitNumerator = 0;
  let docFitDenominator = 0;

  for (const req of activeRequirements) {
    const ev = evidenceByReqId.get(req.id)!;
    const effectivePriority = req.userPriorityOverride ?? req.priority;
    const weight = REQUIREMENT_PRIORITY_WEIGHTS[effectivePriority];

    if (req.candidateResponse === "candidate_confirms_does_not_have") {
      docFitDenominator += weight;
      continue;
    }

    if (ev.supportState === "ambiguous") {
      continue;
    }

    docFitDenominator += weight;
    if (ev.supportState === "supported") {
      docFitNumerator += weight * 1.0;
    } else if (ev.supportState === "partially_supported") {
      docFitNumerator += weight * 0.5;
    }
  }

  const documentedFitScore =
    docFitDenominator > 0
      ? Math.round((100 * docFitNumerator) / docFitDenominator)
      : null;

  // 2. Evaluate search-profile skills (Section 5.2 & 5.3)
  const isAnalysisPending = job.analysisStatus === "pending";
  const hardFilterReasons: string[] = [];
  const pendingReasons: string[] = [];

  let positiveWeightedMatched = 0;
  let positiveWeightedAssessable = 0;
  let weightedExcludedMatches = 0;

  for (const entry of profileSkills) {
    const matched = doesJobMatchSearchSkill(entry, job, activeRequirements);

    if (entry.preference === "excluded") {
      if (entry.filterMode === "hard") {
        if (matched) {
          hardFilterReasons.push(`excluded_skill:${entry.normalizedSkillKey}`);
        } else if (isAnalysisPending) {
          pendingReasons.push(`pending_excluded_skill:${entry.normalizedSkillKey}`);
        }
      } else if (matched) {
        weightedExcludedMatches++;
      }
      continue;
    }

    // must_have or preferred
    if (entry.filterMode === "hard") {
      if (!matched) {
        if (isAnalysisPending) {
          pendingReasons.push(`pending_hard_skill:${entry.normalizedSkillKey}`);
        } else {
          hardFilterReasons.push(
            entry.preference === "must_have"
              ? `missing_must_have_skill:${entry.normalizedSkillKey}`
              : `missing_preferred_hard_skill:${entry.normalizedSkillKey}`
          );
        }
      }
    }

    const skillWeight =
      entry.weight !== null && entry.weight > 0
        ? entry.weight
        : entry.preference === "must_have"
          ? 2
          : 1;

    if (matched) {
      positiveWeightedAssessable += skillWeight;
      positiveWeightedMatched += skillWeight;
    } else if (!isAnalysisPending) {
      positiveWeightedAssessable += skillWeight;
    }
  }

  let searchSkillAlignmentScore: number | null = null;
  if (positiveWeightedAssessable > 0) {
    const baseAlignment = Math.round(
      (100 * positiveWeightedMatched) / positiveWeightedAssessable
    );
    const penalty = Math.min(100, weightedExcludedMatches * 25);
    searchSkillAlignmentScore = Math.max(0, Math.min(100, baseAlignment - penalty));
  }

  // 3. Evaluate remaining hard filters (Section 5.2 & 8.3)
  const hardFilters = parseHardFiltersConfig(searchProfileRow);
  const failClosed = searchProfileRow.failClosedOnUnknown;

  // 3a. Included / excluded companies
  const companyNorm = normalizeCompanyKey(
    companyRow?.canonicalName ?? job.companyName
  );
  const companyAliases = companyRow
    ? parseStringArrayJson(companyRow.aliasesJson).map(normalizeCompanyKey)
    : [];
  const companyKeys = new Set([companyNorm, ...companyAliases].filter(Boolean));

  const matchesCompanyList = (ids: string[], names: string[]): boolean => {
    if (job.companyId && ids.includes(job.companyId)) return true;
    for (const n of names) {
      if (companyKeys.has(normalizeCompanyKey(n))) return true;
    }
    return false;
  };

  if (
    hardFilters.excludedCompaniesHard &&
    (hardFilters.excludedCompanyIds.length > 0 ||
      hardFilters.excludedCompanies.length > 0) &&
    matchesCompanyList(
      hardFilters.excludedCompanyIds,
      hardFilters.excludedCompanies
    )
  ) {
    hardFilterReasons.push("excluded_company");
  }

  if (
    (hardFilters.includedCompanyIds.length > 0 ||
      hardFilters.includedCompanies.length > 0) &&
    !matchesCompanyList(
      hardFilters.includedCompanyIds,
      hardFilters.includedCompanies
    )
  ) {
    hardFilterReasons.push("company_not_included");
  }

  // 3b. Included / excluded sources
  const jobSourceIds = new Set<string>();
  if (job.primarySourceId) jobSourceIds.add(job.primarySourceId);
  for (const sr of sourceRecordRows) jobSourceIds.add(sr.sourceId);

  if (hardFilters.excludedSourcesHard && hardFilters.excludedSourceIds.length > 0) {
    if (
      job.primarySourceId &&
      hardFilters.excludedSourceIds.includes(job.primarySourceId) &&
      Array.from(jobSourceIds).every((sid) =>
        hardFilters.excludedSourceIds.includes(sid)
      )
    ) {
      hardFilterReasons.push("excluded_source");
    }
  }

  if (hardFilters.includedSourceIds.length > 0) {
    const hasIncluded = Array.from(jobSourceIds).some((sid) =>
      hardFilters.includedSourceIds.includes(sid)
    );
    if (!hasIncluded) {
      hardFilterReasons.push("source_not_included");
    }
  }

  // 3c. Max job age (uses employerPostedAt or firstSeenAt when unknown)
  if (
    hardFilters.maxJobAgeHard &&
    hardFilters.maxJobAgeDays !== null &&
    hardFilters.maxJobAgeDays >= 0
  ) {
    if (!job.employerPostedAt && !hardFilters.includeUnknownPostedDate) {
      hardFilterReasons.push("posted_date_unknown");
    } else {
      const refDateStr = job.employerPostedAt ?? job.firstSeenAt;
      const refMs = Date.parse(refDateStr);
      if (Number.isFinite(refMs)) {
        const ageDays = (nowMs - refMs) / (1000 * 60 * 60 * 24);
        if (ageDays > hardFilters.maxJobAgeDays) {
          hardFilterReasons.push("max_job_age_exceeded");
        }
      }
    }
  }

  // 3d. Compensation hard filters (missing salary & salary below minimum)
  const effectiveSalary = (() => {
    if (
      compensationOverride &&
      (compensationOverride.minAmount !== null ||
        compensationOverride.maxAmount !== null)
    ) {
      return {
        min: compensationOverride.minAmount,
        max: compensationOverride.maxAmount,
        currency: compensationOverride.currency?.toUpperCase() ?? null,
        period: compensationOverride.period ?? null,
        source: "user_supplied" as const,
      };
    }
    if (
      (job.salaryMin !== null || job.salaryMax !== null) &&
      job.salarySourceType !== "unknown"
    ) {
      return {
        min: job.salaryMin,
        max: job.salaryMax,
        currency: job.salaryCurrency?.toUpperCase() ?? null,
        period: job.salaryPeriod ?? null,
        source: "employer_disclosed" as const,
      };
    }
    return null;
  })();

  if (hardFilters.excludeMissingSalary && effectiveSalary === null) {
    hardFilterReasons.push("missing_salary");
  }

  if (
    hardFilters.salaryHard &&
    hardFilters.minSalary !== null &&
    hardFilters.salaryCurrency !== null
  ) {
    const expectedPeriod = hardFilters.salaryPeriod ?? "year";
    if (
      effectiveSalary &&
      effectiveSalary.max !== null &&
      effectiveSalary.currency === hardFilters.salaryCurrency &&
      effectiveSalary.period === expectedPeriod
    ) {
      if (effectiveSalary.max < hardFilters.minSalary) {
        hardFilterReasons.push("salary_below_minimum");
      }
    } else if (failClosed && effectiveSalary === null) {
      hardFilterReasons.push("salary_unknown");
    }
  }

  // 3e. Workplace type + remote countries + location hierarchy
  const configuredWorkplaces = parseStringArrayJson(
    searchProfileRow.workplaceTypesJson
  ).filter((w): w is WorkplaceType =>
    (WORKPLACE_TYPES as readonly string[]).includes(w)
  );
  const configuredRemoteCountries = parseStringArrayJson(
    searchProfileRow.remoteEligibleCountriesJson
  )
    .map((c) => normalizeCountryCode(c))
    .filter((c): c is string => Boolean(c));
  const configuredLocations = parseConfiguredLocations(
    searchProfileRow.locationsJson
  );

  if (hardFilters.workplaceHard && configuredWorkplaces.length > 0) {
    if (job.workplaceType === "unspecified") {
      if (failClosed) hardFilterReasons.push("workplace_unknown");
    } else if (!configuredWorkplaces.includes(job.workplaceType)) {
      hardFilterReasons.push("workplace_mismatch");
    }
  }

  const jobLoc = parseLocationParts(job.locationText, job.countryCode);

  if (
    job.workplaceType === "remote" &&
    configuredRemoteCountries.length > 0
  ) {
    const remoteHard =
      hardFilters.remoteCountriesHard ||
      hardFilters.locationHard ||
      hardFilters.workplaceHard;
    if (remoteHard) {
      if (jobLoc.countryCode) {
        if (!configuredRemoteCountries.includes(jobLoc.countryCode)) {
          hardFilterReasons.push("remote_country_mismatch");
        }
      } else if (failClosed && !jobLoc.isUnrestrictedRemote) {
        hardFilterReasons.push("remote_country_unknown");
      }
    }
  }

  const excludedLocPrefs = hardFilters.excludedLocations.map((loc) =>
    parseLocationParts(loc)
  );
  if (hardFilters.locationHard && excludedLocPrefs.length > 0) {
    const exclEval = evaluateLocationAgainstPreferences(jobLoc, excludedLocPrefs);
    if (exclEval === "exact") {
      hardFilterReasons.push("excluded_location");
    }
  }

  if (hardFilters.locationHard && configuredLocations.length > 0) {
    const isRemoteWithoutLocationRestriction =
      job.workplaceType === "remote" &&
      (configuredRemoteCountries.length > 0 || jobLoc.isUnrestrictedRemote);

    if (!isRemoteWithoutLocationRestriction) {
      const locEval = evaluateLocationAgainstPreferences(
        jobLoc,
        configuredLocations
      );
      if (locEval === "unknown") {
        if (failClosed) hardFilterReasons.push("location_unknown");
      } else if (locEval === "mismatch") {
        hardFilterReasons.push("location_mismatch");
      }
    }
  }

  // 3f. Relocation
  const requiresRelocation = detectRelocationRequired(job, activeRequirements);
  if (
    requiresRelocation &&
    searchProfileRow.relocationAllowed === false &&
    hardFilters.relocationHard
  ) {
    hardFilterReasons.push("relocation_required");
  }

  // 3g. Seniority / Years of experience
  const targetSeniority = parseStringArrayJson(
    searchProfileRow.targetSeniorityJson
  ).map(normalizeSeniority);

  if (hardFilters.seniorityHard && targetSeniority.length > 0) {
    if (!job.seniorityLevel) {
      if (failClosed) hardFilterReasons.push("seniority_unknown");
    } else if (!targetSeniority.includes(normalizeSeniority(job.seniorityLevel))) {
      hardFilterReasons.push("seniority_mismatch");
    }
  }

  if (
    hardFilters.yearsExperienceHard &&
    (searchProfileRow.minYearsExperience !== null ||
      searchProfileRow.maxYearsExperience !== null)
  ) {
    if (job.seniorityMinYears === null && job.seniorityMaxYears === null) {
      if (failClosed) hardFilterReasons.push("years_experience_unknown");
    } else {
      if (
        searchProfileRow.maxYearsExperience !== null &&
        job.seniorityMinYears !== null &&
        job.seniorityMinYears > searchProfileRow.maxYearsExperience
      ) {
        hardFilterReasons.push("years_experience_mismatch");
      }
      if (
        searchProfileRow.minYearsExperience !== null &&
        job.seniorityMaxYears !== null &&
        job.seniorityMaxYears < searchProfileRow.minYearsExperience
      ) {
        hardFilterReasons.push("years_experience_mismatch");
      }
    }
  }

  // 3h. Employment type
  const configuredEmploymentTypes = parseStringArrayJson(
    searchProfileRow.employmentTypesJson
  ).map(normalizeEmploymentType);

  if (hardFilters.employmentTypeHard && configuredEmploymentTypes.length > 0) {
    if (!job.employmentType) {
      if (failClosed) hardFilterReasons.push("employment_type_unknown");
    } else if (
      !configuredEmploymentTypes.includes(
        normalizeEmploymentType(job.employmentType)
      )
    ) {
      hardFilterReasons.push("employment_type_mismatch");
    }
  }

  const hardFilterStatus: HardFilterStatus =
    hardFilterReasons.length > 0
      ? "excluded"
      : pendingReasons.length > 0
        ? "pending_analysis"
        : "eligible";
  const hardFilterPassed = hardFilterStatus === "eligible";

  // 4. Evaluate remaining ranking factors (Section 5.3)
  // 4a. Freshness
  let freshnessScore: number | null = null;
  let freshnessReason = "employer_posted_at_unknown";
  if (job.employerPostedAt) {
    const postedMs = Date.parse(job.employerPostedAt);
    if (Number.isFinite(postedMs)) {
      const ageHours = Math.max(0, (nowMs - postedMs) / (1000 * 60 * 60));
      if (ageHours < 24) freshnessScore = 100;
      else if (ageHours <= 72) freshnessScore = 80;
      else if (ageHours <= 168) freshnessScore = 60;
      else if (ageHours <= 336) freshnessScore = 30;
      else freshnessScore = 0;
      freshnessReason = "employer_posted_at_scored";
    }
  }

  // 4b. Location / work mode
  let locationScore: number | null = null;
  let locationReason = "no_location_preference_or_unknown";
  const hasLocOrWorkPref =
    configuredWorkplaces.length > 0 ||
    configuredLocations.length > 0 ||
    configuredRemoteCountries.length > 0;

  if (hasLocOrWorkPref) {
    let wpScore: number | null = null;
    if (configuredWorkplaces.length > 0 && job.workplaceType !== "unspecified") {
      if (configuredWorkplaces.includes(job.workplaceType)) {
        wpScore = 100;
      } else if (
        (configuredWorkplaces.includes("remote") &&
          job.workplaceType === "hybrid") ||
        (configuredWorkplaces.includes("hybrid") &&
          job.workplaceType === "remote")
      ) {
        wpScore = 75;
      } else {
        wpScore = 0;
      }
    }

    let geoScore: number | null = null;
    if (
      job.workplaceType === "remote" &&
      configuredRemoteCountries.length > 0
    ) {
      if (jobLoc.countryCode) {
        geoScore = configuredRemoteCountries.includes(jobLoc.countryCode)
          ? 100
          : 0;
      }
    } else if (configuredLocations.length > 0) {
      const locMatch = evaluateLocationAgainstPreferences(
        jobLoc,
        configuredLocations
      );
      if (locMatch === "exact") geoScore = 100;
      else if (locMatch === "alternative") geoScore = 75;
      else if (locMatch === "mismatch") geoScore = 0;
    }

    if (wpScore !== null && geoScore !== null) {
      locationScore = Math.min(wpScore, geoScore);
      locationReason = "workplace_and_location_scored";
    } else if (wpScore !== null) {
      locationScore = wpScore;
      locationReason = "workplace_scored";
    } else if (geoScore !== null) {
      locationScore = geoScore;
      locationReason = "location_scored";
    }
  }

  // 4c. Compensation
  let compensationScore: number | null = null;
  let compensationReason = "no_threshold_or_incomplete_compensation";
  if (
    hardFilters.minSalary !== null &&
    hardFilters.salaryCurrency !== null &&
    effectiveSalary !== null &&
    effectiveSalary.min !== null &&
    effectiveSalary.max !== null &&
    effectiveSalary.currency === hardFilters.salaryCurrency &&
    effectiveSalary.period !== null &&
    effectiveSalary.period !== "unknown"
  ) {
    const expectedPeriod = hardFilters.salaryPeriod ?? "year";
    if (effectiveSalary.period === expectedPeriod) {
      const minThreshold = hardFilters.minSalary;
      const targetThreshold = Math.max(
        minThreshold,
        hardFilters.targetSalary ?? minThreshold
      );
      if (effectiveSalary.min >= targetThreshold) {
        compensationScore = 100;
      } else if (
        effectiveSalary.min <= targetThreshold &&
        effectiveSalary.max >= targetThreshold
      ) {
        compensationScore = 75;
      } else if (effectiveSalary.max >= minThreshold) {
        compensationScore = 50;
      } else {
        compensationScore = 0;
      }
      compensationReason = `scored_from_${effectiveSalary.source}`;
    } else {
      compensationReason = "period_mismatch_omitted";
    }
  }

  // 4d. Company / industry preference
  let companyScore: number | null = null;
  let companyReason = "no_company_preference";
  const hasCompanyPrefs =
    hardFilters.preferredCompanyIds.length > 0 ||
    hardFilters.preferredCompanies.length > 0 ||
    hardFilters.preferredIndustries.length > 0 ||
    hardFilters.dispreferredCompanyIds.length > 0 ||
    hardFilters.dispreferredCompanies.length > 0 ||
    hardFilters.dispreferredIndustries.length > 0;

  if (hasCompanyPrefs) {
    const companyIndustries = companyRow
      ? parseStringArrayJson(companyRow.industryTagsJson).map((t) =>
          t.toLowerCase()
        )
      : [];
    const prefIndustries = new Set(
      hardFilters.preferredIndustries.map((t) => t.toLowerCase())
    );
    const disprefIndustries = new Set(
      hardFilters.dispreferredIndustries.map((t) => t.toLowerCase())
    );

    const isPreferred =
      matchesCompanyList(
        hardFilters.preferredCompanyIds,
        hardFilters.preferredCompanies
      ) || companyIndustries.some((t) => prefIndustries.has(t));

    const isDispreferred =
      matchesCompanyList(
        hardFilters.dispreferredCompanyIds,
        hardFilters.dispreferredCompanies
      ) || companyIndustries.some((t) => disprefIndustries.has(t));

    if (isPreferred) {
      companyScore = 100;
      companyReason = "preferred_company_or_industry";
    } else if (isDispreferred) {
      companyScore = 0;
      companyReason = "soft_dispreferred_company_or_industry";
    } else {
      companyScore = 50;
      companyReason = "neutral_company_or_industry";
    }
  }

  // 5. Renormalized Priority Score (Section 5.3)
  const configuredWeights = parseRankingWeights(
    searchProfileRow.rankingWeightsJson
  );

  const rawScores: Record<RankingFactorKey, { score: number | null; reason: string }> = {
    documentedFit: {
      score: documentedFitScore,
      reason:
        documentedFitScore !== null
          ? "assessed_requirements"
          : "no_assessable_requirements",
    },
    searchSkillAlignment: {
      score: searchSkillAlignmentScore,
      reason:
        searchSkillAlignmentScore !== null
          ? "assessed_search_skills"
          : "no_assessable_search_skills",
    },
    freshness: {
      score: freshnessScore,
      reason: freshnessReason,
    },
    location: {
      score: locationScore,
      reason: locationReason,
    },
    compensation: {
      score: compensationScore,
      reason: compensationReason,
    },
    company: {
      score: companyScore,
      reason: companyReason,
    },
  };

  let activeWeightSum = 0;
  let totalConfiguredWeightSum = 0;

  for (const key of Object.keys(configuredWeights) as RankingFactorKey[]) {
    const w = configuredWeights[key];
    totalConfiguredWeightSum += w;
    if (rawScores[key].score !== null && w > 0) {
      activeWeightSum += w;
    }
  }

  const renormalized =
    activeWeightSum > 0 && activeWeightSum < totalConfiguredWeightSum;

  const factors = {} as Record<RankingFactorKey, RankingFactorBreakdown>;
  let weightedScoreSum = 0;

  for (const key of Object.keys(configuredWeights) as RankingFactorKey[]) {
    const w = configuredWeights[key];
    const { score, reason } = rawScores[key];
    const included = score !== null && w > 0;
    const effectiveWeight =
      included && activeWeightSum > 0
        ? Math.round((w / activeWeightSum) * 10000) / 100
        : 0;

    if (included && score !== null) {
      weightedScoreSum += w * score;
    }

    factors[key] = {
      score,
      weight: w,
      effectiveWeight,
      included,
      reason,
    };
  }

  const priorityScore =
    hardFilterPassed && activeWeightSum > 0
      ? Math.round(weightedScoreSum / activeWeightSum)
      : null;

  const analysisVersion = job.analysisVersion ?? "unassigned";
  const matchRunId = crypto.randomUUID();

  // Persist inside a short synchronous SQLite transaction.
  const persistedCreatedAt = sqlite
    .transaction(() => {
      const latestExisting = db
        .select({ createdAt: matchRuns.createdAt })
        .from(matchRuns)
        .where(
          and(
            eq(matchRuns.jobId, job.id),
            eq(matchRuns.searchProfileId, searchProfileRow.id)
          )
        )
        .orderBy(desc(matchRuns.createdAt))
        .get();

      let createdAtIso = nowDate.toISOString();
      if (latestExisting && createdAtIso <= latestExisting.createdAt) {
        const nextMs = Date.parse(latestExisting.createdAt) + 1;
        createdAtIso = new Date(
          Number.isFinite(nextMs) ? nextMs : nowMs + 1
        ).toISOString();
      }

      for (const ev of evidence) {
        db.update(jobRequirements)
          .set({
            machineSupportState: ev.supportState,
            updatedAt: createdAtIso,
          })
          .where(eq(jobRequirements.id, ev.jobRequirementId))
          .run();
      }

      const includedKeys = (
        Object.keys(factors) as RankingFactorKey[]
      ).filter((k) => factors[k].included);

      const includedFactorsPayload = {
        included: includedKeys,
        renormalized,
        weightsRenormalized: renormalized,
        hardFilter: {
          passed: hardFilterPassed,
          status: hardFilterStatus,
          reasons: hardFilterReasons,
          pendingReasons,
        },
        factors,
      };

      const inputsSnapshotPayload = {
        jobId: job.id,
        analyzedDescriptionHash: job.analyzedDescriptionHash,
        analysisStatus: job.analysisStatus,
        employerPostedAt: job.employerPostedAt,
        firstSeenAt: job.firstSeenAt,
        workplaceType: job.workplaceType,
        locationText: job.locationText,
        countryCode: job.countryCode,
        employmentType: job.employmentType,
        seniorityLevel: job.seniorityLevel,
        seniorityMinYears: job.seniorityMinYears,
        seniorityMaxYears: job.seniorityMaxYears,
        effectiveSalary,
        verifiedFactCounts: {
          experiences: verifiedFacts.experiences.length,
          projects: verifiedFacts.projects.length,
          achievements: verifiedFacts.achievements.length,
          skills: verifiedFacts.skills.length,
          education: verifiedFacts.education.length,
          certifications: verifiedFacts.certifications.length,
          languages: verifiedFacts.languages.length,
        },
        searchProfileUpdatedAt: searchProfileRow.updatedAt,
      };

      db.insert(matchRuns)
        .values({
          id: matchRunId,
          jobId: job.id,
          searchProfileId: searchProfileRow.id,
          documentedFitScore,
          searchSkillAlignmentScore,
          priorityScore,
          hardFilterPassed,
          hardFilterStatus,
          includedFactorsJson: JSON.stringify(includedFactorsPayload),
          inputsSnapshotJson: JSON.stringify(inputsSnapshotPayload),
          weightVersion: MATCHING_WEIGHT_VERSION,
          calculationVersion: MATCHING_CALCULATION_VERSION,
          analysisVersion,
          createdAt: createdAtIso,
        })
        .run();

      for (const ev of evidence) {
        db.insert(matchEvidence)
          .values({
            id: crypto.randomUUID(),
            matchRunId,
            jobRequirementId: ev.jobRequirementId,
            supportState: ev.supportState,
            linkedFactType: ev.linkedFactType,
            linkedFactId: ev.linkedFactId,
            evidenceLinkId: ev.evidenceLinkId,
            explanation: ev.explanation,
            createdAt: createdAtIso,
          })
          .run();
      }

      return createdAtIso;
    })
    .immediate();

  return {
    matchRunId,
    jobId: job.id,
    searchProfileId: searchProfileRow.id,
    documentedFitScore,
    searchSkillAlignmentScore,
    priorityScore,
    hardFilterPassed,
    hardFilterStatus,
    hardFilterReasons,
    renormalized,
    factors,
    evidence,
    weightVersion: MATCHING_WEIGHT_VERSION,
    calculationVersion: MATCHING_CALCULATION_VERSION,
    analysisVersion,
    createdAt: persistedCreatedAt,
  };
}

/**
 * Recomputes matches across all canonical (non-merged) jobs for a search profile.
 */
export function recomputeMatchesForSearchProfile(
  searchProfileId: string,
  dbArg?: AppDatabase,
  sqliteArg?: SqliteDatabase,
  now: () => Date = () => new Date()
): {
  searchProfileId: string;
  recomputedCount: number;
  results: ComputeJobMatchResult[];
} {
  const { db, sqlite } = resolveDbAndSqlite(dbArg, sqliteArg);
  const profileRow = db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .where(eq(searchProfiles.id, searchProfileId))
    .get();
  if (!profileRow) {
    throw new MatchingServiceError(
      "SEARCH_PROFILE_NOT_FOUND",
      404,
      `Search profile '${searchProfileId}' not found.`
    );
  }

  const canonicalJobRows = sqlite
    .prepare(`SELECT id FROM jobs WHERE merged_into_job_id IS NULL`)
    .all() as Array<{ id: string }>;

  const results: ComputeJobMatchResult[] = [];
  for (const row of canonicalJobRows) {
    results.push(
      computeJobMatch({
        jobId: row.id,
        searchProfileId,
        db,
        sqlite,
        now,
      })
    );
  }

  return {
    searchProfileId,
    recomputedCount: results.length,
    results,
  };
}

/**
 * Recomputes matches across all enabled search profiles for a canonical job.
 */
export function recomputeMatchesForJob(
  jobId: string,
  dbArg?: AppDatabase,
  sqliteArg?: SqliteDatabase,
  now: () => Date = () => new Date()
): {
  jobId: string;
  recomputedCount: number;
  results: ComputeJobMatchResult[];
} {
  const { db, sqlite } = resolveDbAndSqlite(dbArg, sqliteArg);
  const job = resolveCanonicalJobRow(db, jobId);
  if (!job) {
    throw new MatchingServiceError(
      "JOB_NOT_FOUND",
      404,
      `Job '${jobId}' not found.`
    );
  }

  const enabledProfiles = db
    .select({ id: searchProfiles.id })
    .from(searchProfiles)
    .where(eq(searchProfiles.enabled, true))
    .all();

  const results: ComputeJobMatchResult[] = [];
  for (const sp of enabledProfiles) {
    results.push(
      computeJobMatch({
        jobId: job.id,
        searchProfileId: sp.id,
        db,
        sqlite,
        now,
      })
    );
  }

  return {
    jobId: job.id,
    recomputedCount: results.length,
    results,
  };
}

/**
 * Updates candidate response and/or priority override on a job requirement,
 * keeping machine assessment and user override strictly separate, and recomputes matches.
 */
export function updateJobRequirementOverride(
  input: UpdateRequirementOverrideInput,
  dbArg?: AppDatabase,
  sqliteArg?: SqliteDatabase,
  now: () => Date = () => new Date()
) {
  const parsed = UpdateRequirementOverrideSchema.parse(input);
  const { db, sqlite } = resolveDbAndSqlite(dbArg, sqliteArg);
  const job = resolveCanonicalJobRow(db, parsed.jobId);
  if (!job) {
    throw new MatchingServiceError(
      "JOB_NOT_FOUND",
      404,
      `Job '${parsed.jobId}' not found.`
    );
  }

  const existing = db
    .select()
    .from(jobRequirements)
    .where(
      and(
        eq(jobRequirements.id, parsed.requirementId),
        eq(jobRequirements.jobId, job.id)
      )
    )
    .get();

  if (!existing) {
    throw new MatchingServiceError(
      "REQUIREMENT_NOT_FOUND",
      404,
      `Requirement '${parsed.requirementId}' not found for job '${job.id}'.`
    );
  }

  const nowIso = now().toISOString();
  const nextCandidateResponse: CandidateResponse =
    parsed.candidateResponse ?? existing.candidateResponse;
  const nextPriorityOverride: RequirementPriority | null =
    parsed.userPriorityOverride !== undefined
      ? parsed.userPriorityOverride
      : existing.userPriorityOverride;
  const nextOverrideState = parsed.overrideState ?? existing.overrideState;

  sqlite
    .transaction(() => {
      db.update(jobRequirements)
        .set({
          candidateResponse: nextCandidateResponse,
          userPriorityOverride: nextPriorityOverride,
          overrideState: nextOverrideState,
          overrideUpdatedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(jobRequirements.id, existing.id))
        .run();
    })
    .immediate();

  const updated = db
    .select()
    .from(jobRequirements)
    .where(eq(jobRequirements.id, existing.id))
    .get()!;

  const recomputed = parsed.recomputeMatches
    ? recomputeMatchesForJob(job.id, db, sqlite, now)
    : null;

  return {
    requirement: updated,
    recomputedCount: recomputed?.recomputedCount ?? 0,
  };
}

/**
 * Upserts a user-supplied compensation override in `job_compensation_overrides`
 * without mutating source-disclosed compensation columns on `jobs`.
 */
export function upsertCompensationOverride(
  input: UpsertCompensationOverrideInput,
  dbArg?: AppDatabase,
  sqliteArg?: SqliteDatabase,
  now: () => Date = () => new Date()
) {
  const parsed = UpsertCompensationOverrideSchema.parse(input);
  const { db, sqlite } = resolveDbAndSqlite(dbArg, sqliteArg);
  const job = resolveCanonicalJobRow(db, parsed.jobId);
  if (!job) {
    throw new MatchingServiceError(
      "JOB_NOT_FOUND",
      404,
      `Job '${parsed.jobId}' not found.`
    );
  }

  const nowIso = now().toISOString();

  sqlite
    .transaction(() => {
      db.insert(jobCompensationOverrides)
        .values({
          id: crypto.randomUUID(),
          jobId: job.id,
          minAmount: parsed.minAmount ?? null,
          maxAmount: parsed.maxAmount ?? null,
          currency: parsed.currency ?? null,
          period: parsed.period ?? null,
          provenance: "user_supplied",
          note: parsed.note ?? null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: jobCompensationOverrides.jobId,
          set: {
            minAmount: parsed.minAmount ?? null,
            maxAmount: parsed.maxAmount ?? null,
            currency: parsed.currency ?? null,
            period: parsed.period ?? null,
            provenance: "user_supplied",
            note: parsed.note ?? null,
            updatedAt: nowIso,
          },
        })
        .run();
    })
    .immediate();

  const override = db
    .select()
    .from(jobCompensationOverrides)
    .where(eq(jobCompensationOverrides.jobId, job.id))
    .get()!;

  const recomputed = parsed.recomputeMatches
    ? recomputeMatchesForJob(job.id, db, sqlite, now)
    : null;

  return {
    override,
    recomputedCount: recomputed?.recomputedCount ?? 0,
  };
}

/**
 * Deletes any user-supplied compensation override for a job without altering
 * source-disclosed compensation on `jobs`, and recomputes matches.
 */
export function deleteCompensationOverride(
  jobId: string,
  dbArg?: AppDatabase,
  sqliteArg?: SqliteDatabase,
  now: () => Date = () => new Date()
): { jobId: string; deleted: boolean; recomputedCount: number } {
  const { db, sqlite } = resolveDbAndSqlite(dbArg, sqliteArg);
  const job = resolveCanonicalJobRow(db, jobId);
  if (!job) {
    throw new MatchingServiceError(
      "JOB_NOT_FOUND",
      404,
      `Job '${jobId}' not found.`
    );
  }

  const res = sqlite
    .transaction(() =>
      db
        .delete(jobCompensationOverrides)
        .where(eq(jobCompensationOverrides.jobId, job.id))
        .run()
    )
    .immediate();

  const deleted = res.changes > 0;
  const recomputed = deleted
    ? recomputeMatchesForJob(job.id, db, sqlite, now)
    : null;

  return {
    jobId: job.id,
    deleted,
    recomputedCount: recomputed?.recomputedCount ?? 0,
  };
}

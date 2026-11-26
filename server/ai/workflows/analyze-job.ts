import crypto from "node:crypto";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  getDb,
  getSqlite,
  type AppDatabase,
  type SqliteDatabase,
} from "../../db/client";
import * as schema from "../../db/schema/index";
import {
  jobRequirements,
  jobs,
  type RequirementCategory,
  type RequirementPriority,
  type WorkplaceType,
} from "../../db/schema/jobs";
import { aiRuns } from "../../db/schema/system";
import { logger } from "../../logging/logger";
import { getSettings } from "../../services/settings";
import { generateStructuredWithTracking } from "../providers/index";
import {
  JOB_ANALYSIS_PROMPT_VERSION,
  JOB_ANALYSIS_SYSTEM_PROMPT,
  JOB_ANALYSIS_VERSION,
  JobAnalysisSchema,
  type JobAnalysis,
} from "../schemas/job-analysis";
import { AiProviderError } from "../types";

export type AnalyzeJobMode = "auto_or_ai" | "ai_required" | "deterministic";

export interface NormalizedRequirementInput {
  requirementKey: string;
  text: string;
  normalizedSkill: string | null;
  category: RequirementCategory;
  priority: RequirementPriority;
  extractionConfidence: number;
  stableSignature: string;
  sortOrder: number;
}

export interface DeterministicJobAnalysisResult {
  jobId: string;
  analysisStatus: "deterministic";
  analysisVersion: string;
  analyzedDescriptionHash: string;
  requirementCount: number;
  preservedOverrides: number;
  orphanedOverrides: number;
  analysis: JobAnalysis;
}

export interface AnalyzeJobWithBudgetInput {
  jobIds: string[];
  mode?: AnalyzeJobMode;
  taskId?: string;
  db?: AppDatabase;
  sqlite?: SqliteDatabase;
  generateStructured?: typeof generateStructuredWithTracking;
  now?: () => Date;
}

export interface AnalyzeJobItemResult {
  jobId: string;
  status:
    | "ai"
    | "deterministic"
    | "deduplicated"
    | "skipped_budget"
    | "failed"
    | "not_found";
  reason?: string;
  requirementCount?: number;
  preservedOverrides?: number;
  orphanedOverrides?: number;
}

export interface AnalyzeJobBudgetResult {
  mode: AnalyzeJobMode;
  aiEligible: boolean;
  aiUnavailableReason: string | null;
  aiCallsAttempted: number;
  aiCallsSucceeded: number;
  dailyCap: number;
  dailyUsedBefore: number;
  dailyUsedAfter: number;
  actionCap: number;
  analyzedJobIds: string[];
  aiAnalyzedJobIds: string[];
  deterministicJobIds: string[];
  deduplicatedJobIds: string[];
  skippedBudgetJobIds: string[];
  failedJobIds: string[];
  missingJobIds: string[];
  results: AnalyzeJobItemResult[];
}

export class JobAnalysisError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "JobAnalysisError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Curated canonical skill groups. Each group maps canonical normalized key -> list of aliases.
 * Note: short ambiguous single-word terms ("go", "c", "r") are handled with case-sensitive
 * boundary checks when scanning prose so normal English words do not false-positive.
 */
const SKILL_ALIAS_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["typescript", ["typescript", "ts"]],
  ["javascript", ["javascript", "js", "ecmascript", "es6"]],
  ["python", ["python", "py", "python3"]],
  ["java", ["java", "jdk", "jvm"]],
  ["go", ["go", "golang"]],
  ["rust", ["rust", "rustlang"]],
  ["c++", ["c++", "cpp"]],
  ["c#", ["c#", "csharp", "c-sharp"]],
  ["c", ["c"]],
  [".net", [".net", "dotnet", "asp.net", "aspnet"]],
  ["ruby", ["ruby"]],
  ["ruby on rails", ["ruby on rails", "rails", "ror"]],
  ["php", ["php"]],
  ["swift", ["swift"]],
  ["kotlin", ["kotlin"]],
  ["scala", ["scala"]],
  ["r", ["r", "r-lang"]],
  ["sql", ["sql", "tsql", "t-sql", "pl/sql", "plsql"]],
  ["postgresql", ["postgresql", "postgres", "psql", "pg"]],
  ["mysql", ["mysql"]],
  ["sqlite", ["sqlite", "sqlite3", "better-sqlite3"]],
  ["mongodb", ["mongodb", "mongo"]],
  ["redis", ["redis"]],
  ["elasticsearch", ["elasticsearch", "elastic search", "opensearch"]],
  ["dynamodb", ["dynamodb"]],
  ["cassandra", ["cassandra"]],
  ["react", ["react", "reactjs", "react.js"]],
  ["next.js", ["next.js", "nextjs"]],
  ["vue.js", ["vue.js", "vuejs", "vue"]],
  ["angular", ["angular", "angularjs"]],
  ["svelte", ["svelte", "sveltekit"]],
  ["html", ["html", "html5"]],
  ["css", ["css", "css3"]],
  ["tailwind css", ["tailwind css", "tailwindcss", "tailwind"]],
  ["node.js", ["node.js", "nodejs"]],
  ["express", ["express", "expressjs", "express.js"]],
  ["nestjs", ["nestjs", "nest.js"]],
  ["django", ["django"]],
  ["fastapi", ["fastapi"]],
  ["flask", ["flask"]],
  ["spring boot", ["spring boot", "spring", "spring framework"]],
  ["graphql", ["graphql", "gql"]],
  ["rest", ["rest", "restful", "rest api", "restful api", "restful apis"]],
  ["grpc", ["grpc"]],
  ["docker", ["docker", "containers", "containerization"]],
  ["kubernetes", ["kubernetes", "k8s"]],
  ["terraform", ["terraform", "tf"]],
  ["ansible", ["ansible"]],
  ["aws", ["aws", "amazon web services"]],
  ["gcp", ["gcp", "google cloud", "google cloud platform"]],
  ["azure", ["azure", "microsoft azure"]],
  ["linux", ["linux", "unix"]],
  ["git", ["git", "github", "gitlab"]],
  ["ci/cd", ["ci/cd", "cicd", "github actions", "jenkins", "circleci"]],
  ["kafka", ["kafka", "apache kafka"]],
  ["rabbitmq", ["rabbitmq"]],
  ["spark", ["spark", "apache spark", "pyspark"]],
  ["airflow", ["airflow", "apache airflow"]],
  ["dbt", ["dbt"]],
  ["snowflake", ["snowflake"]],
  ["pytorch", ["pytorch", "torch"]],
  ["tensorflow", ["tensorflow"]],
  ["scikit-learn", ["scikit-learn", "sklearn"]],
  ["llm", ["llm", "llms", "large language model", "large language models"]],
  ["playwright", ["playwright"]],
  ["vitest", ["vitest"]],
  ["jest", ["jest"]],
  ["cypress", ["cypress"]],
  ["drizzle orm", ["drizzle", "drizzle orm"]],
  ["prisma", ["prisma"]],
  ["microservices", ["microservices", "microservice architecture"]],
  ["distributed systems", ["distributed systems"]],
  ["machine learning", ["machine learning", "ml"]],
];

const CASE_SENSITIVE_PROSE_ALIASES = new Set(["c", "r", "go"]);
const SHORT_AMBIGUOUS_ALIASES = new Set(["tf", "ml", "ts", "js", "py", "pg", "ror", "gql"]);

const ALIAS_TO_CANONICAL = new Map<string, string>();
const CANONICAL_TO_ALIASES = new Map<string, string[]>();

for (const [canonical, aliases] of SKILL_ALIAS_GROUPS) {
  const normalizedGroup: string[] = [];
  for (const alias of aliases) {
    const key = cleanBaseSkillText(alias);
    if (!key) continue;
    if (!ALIAS_TO_CANONICAL.has(key)) {
      ALIAS_TO_CANONICAL.set(key, canonical);
    }
    if (!normalizedGroup.includes(key)) {
      normalizedGroup.push(key);
    }
  }
  CANONICAL_TO_ALIASES.set(canonical, normalizedGroup);
}

function cleanBaseSkillText(raw: string): string {
  return raw
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,;:()[\]]+|[,;:()[\]]+$/g, "")
    .trim();
}

/**
 * Normalizes a skill term into a canonical lookup key while preserving
 * technical symbols such as `+`, `#`, `.`, `/`, and `-`.
 */
export function normalizeSkillTerm(raw: string): string {
  const cleaned = cleanBaseSkillText(raw);
  if (!cleaned) return "";
  return ALIAS_TO_CANONICAL.get(cleaned) ?? cleaned;
}

/**
 * Expands a skill term into its deduplicated set of normalized aliases
 * (including any caller-supplied custom aliases).
 */
export function expandSkillAliases(
  term: string,
  extraAliases: readonly string[] = []
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const pushTerm = (value: string) => {
    const base = cleanBaseSkillText(value);
    if (!base) return;
    if (!seen.has(base)) {
      seen.add(base);
      result.push(base);
    }
    const canonical = ALIAS_TO_CANONICAL.get(base);
    if (canonical) {
      if (!seen.has(canonical)) {
        seen.add(canonical);
        result.push(canonical);
      }
      const group = CANONICAL_TO_ALIASES.get(canonical) ?? [];
      for (const item of group) {
        if (!seen.has(item)) {
          seen.add(item);
          result.push(item);
        }
      }
    }
  };

  pushTerm(term);
  for (const extra of extraAliases) {
    pushTerm(extra);
  }

  return result;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildProseRegex(alias: string, caseSensitive: boolean): RegExp {
  const escaped = escapeRegex(alias);
  const startsWithDot = alias.startsWith(".");
  const prefix = startsWithDot ? "(?<![a-zA-Z0-9_])" : "(?<![a-zA-Z0-9_+#])";
  const suffix = "(?![a-zA-Z0-9_+#])";
  return new RegExp(`${prefix}${escaped}${suffix}`, caseSensitive ? "" : "i");
}

/**
 * Boundary-safe check whether arbitrary text mentions any of the supplied skill aliases.
 */
export function textContainsSkillAlias(
  text: string,
  aliases: readonly string[]
): boolean {
  if (!text || aliases.length === 0) return false;
  const normalizedInput = text.normalize("NFKC");

  for (const rawAlias of aliases) {
    const alias = cleanBaseSkillText(rawAlias);
    if (!alias) continue;

    if (CASE_SENSITIVE_PROSE_ALIASES.has(alias)) {
      const upperAlias = alias.toUpperCase();
      const capitalizedAlias = alias[0].toUpperCase() + alias.slice(1);
      if (alias === "go") {
        // Match "Go" (capitalized) or "GO", avoiding lowercase English verb "go".
        const re = buildProseRegex(capitalizedAlias, true);
        const reUpper = buildProseRegex(upperAlias, true);
        if (re.test(normalizedInput) || reUpper.test(normalizedInput)) {
          return true;
        }
      } else {
        const re = buildProseRegex(upperAlias, true);
        if (re.test(normalizedInput)) {
          return true;
        }
      }
      continue;
    }

    const re = buildProseRegex(alias, false);
    if (re.test(normalizedInput)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects canonical skills explicitly mentioned in text via dictionary + boundary-safe matching.
 */
export function detectSkillsInText(
  text: string,
  options?: { includeShortAliases?: boolean }
): string[] {
  if (!text.trim()) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const includeShort = options?.includeShortAliases ?? false;

  for (const [canonical, aliases] of SKILL_ALIAS_GROUPS) {
    const candidateAliases = includeShort
      ? aliases
      : aliases.filter((a) => !SHORT_AMBIGUOUS_ALIASES.has(a));
    if (candidateAliases.length === 0) continue;
    if (textContainsSkillAlias(text, candidateAliases)) {
      if (!seen.has(canonical)) {
        seen.add(canonical);
        found.push(canonical);
      }
    }
  }

  return found;
}

/**
 * Computes a stable signature for a job requirement so user overrides and
 * candidate responses survive re-analysis across runs.
 */
export function computeRequirementSignature(
  input:
    | string
    | {
        text: string;
        category?: RequirementCategory | string;
        normalizedSkill?: string | null;
      }
): string {
  const rawText = typeof input === "string" ? input : input.text;
  const rawCategory = typeof input === "string" ? "" : (input.category ?? "");
  const rawSkill =
    typeof input === "string" ? "" : (input.normalizedSkill ?? "");

  const normalizedCore = rawText
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^[-*•▪◦·—–\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?;:]+$/g, "")
    .trim();

  const normCat = rawCategory.trim().toLowerCase();
  const normSkill = rawSkill ? normalizeSkillTerm(rawSkill) : "";

  const payload = `${normCat}|${normSkill}|${normalizedCore}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

export function normalizeDescriptionForHash(descriptionText: string): string {
  return descriptionText.replace(/\s+/g, " ").trim();
}

export function computeNormalizedDescriptionHash(descriptionText: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizeDescriptionForHash(descriptionText), "utf8")
    .digest("hex");
}

function buildRequirementKey(
  category: RequirementCategory,
  normalizedSkill: string | null,
  signature: string
): string {
  const base = normalizedSkill
    ? `${category}:${normalizedSkill}`
    : `${category}:${signature.slice(0, 12)}`;
  return base.slice(0, 120);
}

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

function classifyHeadingContext(line: string): {
  priority?: RequirementPriority;
  category?: RequirementCategory;
} | null {
  const cleaned = line
    .trim()
    .toLowerCase()
    .replace(/^#+\s*/, "")
    .replace(/[:\s]+$/, "");
  if (!cleaned || cleaned.length > 80) return null;

  if (
    /\b(preferred|nice to have|bonus|plus|desired|optional)\b/.test(cleaned)
  ) {
    return { priority: "preferred", category: "skill" };
  }
  if (
    /\b(responsibilit|what you'?ll do|what you will do|your role|in this role|day[- ]to[- ]day|duties)\b/.test(
      cleaned
    )
  ) {
    return { priority: "responsibility", category: "responsibility" };
  }
  if (
    /\b(requirements?|qualifications?|what you bring|must[- ]have|you have|skills?|who you are|minimum|basic qualifications)\b/.test(
      cleaned
    )
  ) {
    return { priority: "must_have" };
  }
  if (/\b(about us|benefits|perks|compensation|equal opportunity|eeo)\b/.test(cleaned)) {
    return { priority: "unspecified", category: "other" };
  }
  return null;
}

function isBulletLine(line: string): boolean {
  return /^\s*(?:[-*•▪◦·—–]|\d+[.)])\s+\S/.test(line);
}

function stripBulletPrefix(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*•▪◦·—–]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferLinePriority(
  text: string,
  sectionPriority: RequirementPriority
): RequirementPriority {
  const lower = text.toLowerCase();
  if (/\b(preferred|nice to have|bonus|a plus|ideally|desired)\b/.test(lower)) {
    return "preferred";
  }
  if (/\b(required|must have|must be|minimum of|at least)\b/.test(lower)) {
    return "must_have";
  }
  return sectionPriority;
}

function inferLineCategory(
  text: string,
  normalizedSkill: string | null,
  sectionCategory?: RequirementCategory
): RequirementCategory {
  const lower = text.toLowerCase();
  if (
    /\b(bachelor|master|phd|doctorate|degree|b\.s\.|m\.s\.|b\.a\.|computer science or equivalent)\b/.test(
      lower
    )
  ) {
    return "education";
  }
  if (/\b\d+\s*\+?\s*(?:-\s*\d+\s*)?years?\b/.test(lower)) {
    return "experience";
  }
  if (
    sectionCategory === "responsibility" ||
    /^(design|build|lead|develop|architect|own|implement|maintain|collaborate|mentor|drive|manage|deliver|scale|partner|define)\b/i.test(
      text
    )
  ) {
    return "responsibility";
  }
  if (normalizedSkill) {
    return "skill";
  }
  if (
    /\b(fintech|healthcare|payments|saas|e-?commerce|security|distributed systems|cloud|analytics|infrastructure|compliance)\b/.test(
      lower
    )
  ) {
    return "domain";
  }
  return "other";
}

function extractExplicitYearsFromText(text: string): {
  minYears?: number;
  maxYears?: number;
} {
  const rangeMatch = /\b(\d{1,2})\s*[-–to]+\s*(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?experience\b/i.exec(
    text
  );
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      return { minYears: min, maxYears: max };
    }
  }
  const minMatch = /\b(\d{1,2})\s*\+?\s*years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+|software\s+)?experience\b/i.exec(
    text
  );
  if (minMatch) {
    const min = Number(minMatch[1]);
    if (Number.isFinite(min)) {
      return { minYears: min };
    }
  }
  return {};
}

function extractExplicitWorkplaceFromText(text: string): WorkplaceType {
  const lower = text.toLowerCase();
  if (/\bfully remote\b|\b100%\s*remote\b|\bremote[- ]first\b|\bwork from home\b/.test(lower)) {
    return "remote";
  }
  if (/\bhybrid\b/.test(lower)) {
    return "hybrid";
  }
  if (/\bon[- ]?site\b|\bin[- ]?office\b/.test(lower)) {
    return "onsite";
  }
  return "unspecified";
}

function extractExplicitConstraintsFromText(text: string): string[] {
  const constraints: string[] = [];
  const lower = text.toLowerCase();
  if (/\b(relocation required|must relocate|willing to relocate|requires relocation)\b/.test(lower)) {
    constraints.push("Relocation required");
  }
  if (/\b(us citizen|u\.s\. citizen|citizenship required|security clearance)\b/.test(lower)) {
    constraints.push("Work authorization / clearance constraint stated");
  }
  if (/\b(no visa sponsorship|unable to sponsor|cannot sponsor|without sponsorship)\b/.test(lower)) {
    constraints.push("No visa sponsorship");
  }
  return constraints;
}

function buildDeterministicAnalysis(
  job: typeof jobs.$inferSelect
): {
  analysis: JobAnalysis;
  requirements: NormalizedRequirementInput[];
} {
  const lines = job.descriptionText.split(/\r?\n/);
  let currentSectionPriority: RequirementPriority = "unspecified";
  let currentSectionCategory: RequirementCategory | undefined;
  let inBenefitsSection = false;

  const extracted: NormalizedRequirementInput[] = [];
  const seenSignatures = new Set<string>();
  const coveredSkills = new Set<string>();
  let reqIndex = 1;

  const pushRequirement = (item: {
    text: string;
    normalizedSkill: string | null;
    category: RequirementCategory;
    priority: RequirementPriority;
    extractionConfidence: number;
  }) => {
    if (extracted.length >= 60) return;
    const signature = computeRequirementSignature({
      text: item.text,
      category: item.category,
      normalizedSkill: item.normalizedSkill,
    });
    if (seenSignatures.has(signature)) return;
    seenSignatures.add(signature);

    if (item.normalizedSkill) {
      coveredSkills.add(item.normalizedSkill);
    }

    extracted.push({
      requirementKey: buildRequirementKey(
        item.category,
        item.normalizedSkill,
        signature
      ),
      text: item.text.slice(0, 2000),
      normalizedSkill: item.normalizedSkill,
      category: item.category,
      priority: item.priority,
      extractionConfidence: item.extractionConfidence,
      stableSignature: signature,
      sortOrder: extracted.length,
    });
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (!isBulletLine(rawLine)) {
      const heading = classifyHeadingContext(trimmed);
      if (heading) {
        if (heading.category === "other" && heading.priority === "unspecified") {
          inBenefitsSection = true;
          currentSectionPriority = "unspecified";
          currentSectionCategory = undefined;
        } else {
          inBenefitsSection = false;
          currentSectionPriority = heading.priority ?? "unspecified";
          currentSectionCategory = heading.category;
        }
        continue;
      }
    }

    if (inBenefitsSection) continue;

    if (isBulletLine(rawLine)) {
      const text = stripBulletPrefix(rawLine);
      if (text.length < 3) continue;

      const skillsInLine = detectSkillsInText(text);
      const primarySkill = skillsInLine[0] ?? null;
      const priority = inferLinePriority(text, currentSectionPriority);
      const category = inferLineCategory(
        text,
        primarySkill,
        currentSectionCategory
      );
      const confidence =
        currentSectionPriority !== "unspecified" || primarySkill !== null
          ? 0.78
          : 0.65;

      pushRequirement({
        text,
        normalizedSkill: primarySkill,
        category,
        priority,
        extractionConfidence: confidence,
      });

      // Emit explicit skill dictionary matches for additional skills in multi-skill bullets
      for (let i = 1; i < skillsInLine.length; i++) {
        const extraSkill = skillsInLine[i];
        if (coveredSkills.has(extraSkill)) continue;
        pushRequirement({
          text: extraSkill,
          normalizedSkill: extraSkill,
          category: "skill",
          priority: priority === "responsibility" ? "must_have" : priority,
          extractionConfidence: 0.75,
        });
      }
    }
  }

  // Also scan full descriptionText for explicit skill dictionary matches not yet covered
  const allDescriptionSkills = detectSkillsInText(job.descriptionText);
  for (const skill of allDescriptionSkills) {
    if (coveredSkills.has(skill)) continue;
    pushRequirement({
      text: skill,
      normalizedSkill: skill,
      category: "skill",
      priority: "unspecified",
      extractionConfidence: 0.72,
    });
  }

  const years = extractExplicitYearsFromText(job.descriptionText);
  const workplaceType =
    job.workplaceType !== "unspecified"
      ? job.workplaceType
      : extractExplicitWorkplaceFromText(job.descriptionText);
  const explicitConstraints = extractExplicitConstraintsFromText(
    job.descriptionText
  );

  const analysis: JobAnalysis = {
    roleTitle: job.title,
    seniority:
      years.minYears !== undefined ||
      years.maxYears !== undefined ||
      job.seniorityLevel
        ? {
            minYears: years.minYears ?? job.seniorityMinYears ?? undefined,
            maxYears: years.maxYears ?? job.seniorityMaxYears ?? undefined,
            level: job.seniorityLevel ?? undefined,
          }
        : undefined,
    locations: job.locationText ? [job.locationText] : [],
    workplaceType,
    employmentType: job.employmentType ? [job.employmentType] : undefined,
    requirements: extracted.map((r) => ({
      id: `req-${reqIndex++}`,
      text: r.text,
      normalizedSkill: r.normalizedSkill ?? undefined,
      category: r.category,
      priority: r.priority,
      extractionConfidence: r.extractionConfidence,
    })),
    compensation: undefined,
    explicitConstraints,
    analysisVersion: JOB_ANALYSIS_VERSION,
  };

  return { analysis, requirements: extracted };
}

function hasUserOverrideOrResponse(row: typeof jobRequirements.$inferSelect): boolean {
  return (
    row.candidateResponse !== "not_reviewed" ||
    row.userPriorityOverride !== null
  );
}

function persistJobAnalysis(params: {
  sqlite: SqliteDatabase;
  db: AppDatabase;
  job: typeof jobs.$inferSelect;
  analysisSource: "deterministic" | "ai";
  normalizedDescriptionHash: string;
  requirements: NormalizedRequirementInput[];
  analysis: JobAnalysis;
  nowIso: string;
}): {
  requirementCount: number;
  preservedOverrides: number;
  orphanedOverrides: number;
} {
  const {
    sqlite,
    db,
    job,
    analysisSource,
    normalizedDescriptionHash,
    requirements,
    analysis,
    nowIso,
  } = params;

  const tx = sqlite.transaction(() => {
    const existingRows = db
      .select()
      .from(jobRequirements)
      .where(eq(jobRequirements.jobId, job.id))
      .orderBy(asc(jobRequirements.sortOrder), asc(jobRequirements.createdAt))
      .all();

    // Index existing rows by stableSignature, prioritizing rows with overrides.
    const existingBySignature = new Map<
      string,
      Array<typeof jobRequirements.$inferSelect>
    >();
    for (const row of existingRows) {
      const bucket = existingBySignature.get(row.stableSignature) ?? [];
      bucket.push(row);
      existingBySignature.set(row.stableSignature, bucket);
    }

    const consumedIds = new Set<string>();
    const dedupedIncoming: NormalizedRequirementInput[] = [];
    const seenIncomingSigs = new Set<string>();

    for (const req of requirements) {
      if (seenIncomingSigs.has(req.stableSignature)) continue;
      seenIncomingSigs.add(req.stableSignature);
      dedupedIncoming.push(req);
    }

    let preservedOverrides = 0;
    let orphanedOverrides = 0;

    for (let idx = 0; idx < dedupedIncoming.length; idx++) {
      const req = dedupedIncoming[idx];
      const candidates = existingBySignature.get(req.stableSignature) ?? [];
      const available = candidates.filter((c) => !consumedIds.has(c.id));

      // Prefer a candidate that has a user override/response, then active rows.
      available.sort((a, b) => {
        const aHas = hasUserOverrideOrResponse(a) ? 1 : 0;
        const bHas = hasUserOverrideOrResponse(b) ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        const aActive = a.overrideState === "active" ? 1 : 0;
        const bActive = b.overrideState === "active" ? 1 : 0;
        return bActive - aActive;
      });

      const match = available[0];
      if (match) {
        consumedIds.add(match.id);
        if (hasUserOverrideOrResponse(match)) {
          preservedOverrides++;
        }

        db.update(jobRequirements)
          .set({
            requirementKey: req.requirementKey,
            requirementText: req.text,
            normalizedSkill: req.normalizedSkill,
            category: req.category,
            priority: req.priority,
            extractionConfidence: req.extractionConfidence,
            analysisSource,
            analysisVersion: JOB_ANALYSIS_VERSION,
            overrideState: "active",
            sortOrder: idx,
            updatedAt: nowIso,
          })
          .where(eq(jobRequirements.id, match.id))
          .run();
      } else {
        db.insert(jobRequirements)
          .values({
            id: crypto.randomUUID(),
            jobId: job.id,
            requirementKey: req.requirementKey,
            requirementText: req.text,
            normalizedSkill: req.normalizedSkill,
            category: req.category,
            priority: req.priority,
            machineSupportState: "not_found_in_profile",
            candidateResponse: "not_reviewed",
            extractionConfidence: req.extractionConfidence,
            analysisSource,
            analysisVersion: JOB_ANALYSIS_VERSION,
            stableSignature: req.stableSignature,
            userPriorityOverride: null,
            overrideState: "active",
            overrideUpdatedAt: null,
            sortOrder: idx,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .run();
      }
    }

    // Handle unmatched existing rows: preserve/orphan overrides, keep manual rows, delete stale machine rows.
    for (const row of existingRows) {
      if (consumedIds.has(row.id)) continue;

      if (hasUserOverrideOrResponse(row)) {
        orphanedOverrides++;
        db.update(jobRequirements)
          .set({
            overrideState: "orphaned",
            updatedAt: nowIso,
          })
          .where(eq(jobRequirements.id, row.id))
          .run();
      } else if (row.analysisSource === "manual") {
        // Manual requirements without priority/response overrides remain active.
        continue;
      } else {
        db.delete(jobRequirements).where(eq(jobRequirements.id, row.id)).run();
      }
    }

    // Safely enrich missing job metadata without ever overwriting source-disclosed fields or compensation.
    const nextWorkplaceType =
      job.workplaceType === "unspecified" &&
      analysis.workplaceType !== "unspecified"
        ? analysis.workplaceType
        : job.workplaceType;
    const nextSeniorityLevel =
      !job.seniorityLevel && analysis.seniority?.level
        ? analysis.seniority.level
        : job.seniorityLevel;
    const nextSeniorityMinYears =
      job.seniorityMinYears === null &&
      typeof analysis.seniority?.minYears === "number"
        ? analysis.seniority.minYears
        : job.seniorityMinYears;
    const nextSeniorityMaxYears =
      job.seniorityMaxYears === null &&
      typeof analysis.seniority?.maxYears === "number"
        ? analysis.seniority.maxYears
        : job.seniorityMaxYears;
    const nextEmploymentType =
      !job.employmentType &&
      Array.isArray(analysis.employmentType) &&
      analysis.employmentType.length > 0
        ? analysis.employmentType[0]
        : job.employmentType;

    db.update(jobs)
      .set({
        workplaceType: nextWorkplaceType,
        seniorityLevel: nextSeniorityLevel,
        seniorityMinYears: nextSeniorityMinYears,
        seniorityMaxYears: nextSeniorityMaxYears,
        employmentType: nextEmploymentType,
        analysisStatus: analysisSource,
        analysisVersion: JOB_ANALYSIS_VERSION,
        analyzedDescriptionHash: normalizedDescriptionHash,
        analyzedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(eq(jobs.id, job.id))
      .run();

    return {
      requirementCount: dedupedIncoming.length,
      preservedOverrides,
      orphanedOverrides,
    };
  });

  return tx.immediate();
}

/**
 * Deterministically extracts structured requirements from `job.descriptionText`
 * (bullet lines + explicit skill dictionary matches), preserves matching overrides
 * by `stableSignature`, and marks unmatched old overrides `orphaned`.
 */
export function runDeterministicJobAnalysis(
  jobId: string,
  dbArg?: AppDatabase,
  sqliteArg?: SqliteDatabase,
  now: () => Date = () => new Date()
): DeterministicJobAnalysisResult {
  const { db, sqlite } = resolveDbAndSqlite(dbArg, sqliteArg);
  const job = resolveCanonicalJobRow(db, jobId);
  if (!job) {
    throw new JobAnalysisError("JOB_NOT_FOUND", 404, `Job '${jobId}' not found.`);
  }

  const nowIso = now().toISOString();
  const normalizedDescriptionHash = computeNormalizedDescriptionHash(
    job.descriptionText
  );
  const { analysis, requirements } = buildDeterministicAnalysis(job);

  const persisted = persistJobAnalysis({
    sqlite,
    db,
    job,
    analysisSource: "deterministic",
    normalizedDescriptionHash,
    requirements,
    analysis,
    nowIso,
  });

  return {
    jobId: job.id,
    analysisStatus: "deterministic",
    analysisVersion: JOB_ANALYSIS_VERSION,
    analyzedDescriptionHash: normalizedDescriptionHash,
    requirementCount: persisted.requirementCount,
    preservedOverrides: persisted.preservedOverrides,
    orphanedOverrides: persisted.orphanedOverrides,
    analysis,
  };
}

function getLocalDayBoundsIso(nowDate: Date): {
  startIso: string;
  endIso: string;
} {
  const start = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    0,
    0,
    0,
    0
  );
  const end = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function countTodayJobAnalysisAiRuns(
  db: AppDatabase,
  nowDate: Date
): number {
  const { startIso, endIso } = getLocalDayBoundsIso(nowDate);
  const row = db
    .select({
      count: sql<number>`COUNT(*)`,
    })
    .from(aiRuns)
    .where(
      and(
        eq(aiRuns.taskType, "job.analyze"),
        gte(aiRuns.createdAt, startIso),
        lt(aiRuns.createdAt, endIso),
        inArray(aiRuns.status, ["succeeded", "failed", "rejected_validation"])
      )
    )
    .get();
  return Number(row?.count ?? 0);
}

function normalizeAiRequirements(analysis: JobAnalysis): NormalizedRequirementInput[] {
  const result: NormalizedRequirementInput[] = [];
  const seen = new Set<string>();

  for (const req of analysis.requirements) {
    const text = req.text.trim();
    if (!text) continue;

    let normalizedSkill = req.normalizedSkill
      ? normalizeSkillTerm(req.normalizedSkill)
      : null;
    if (!normalizedSkill && req.category === "skill") {
      const detected = detectSkillsInText(text);
      normalizedSkill = detected[0] ?? normalizeSkillTerm(text);
    }

    const stableSignature = computeRequirementSignature({
      text,
      category: req.category,
      normalizedSkill,
    });
    if (seen.has(stableSignature)) continue;
    seen.add(stableSignature);

    result.push({
      requirementKey: buildRequirementKey(
        req.category,
        normalizedSkill,
        stableSignature
      ),
      text: text.slice(0, 2000),
      normalizedSkill,
      category: req.category,
      priority: req.priority,
      extractionConfidence: Math.max(0, Math.min(1, req.extractionConfidence)),
      stableSignature,
      sortOrder: result.length,
    });
  }

  return result;
}

function recordFallbackAiRunIfMissing(params: {
  db: AppDatabase;
  beforeCount: number;
  nowDate: Date;
  taskId?: string;
  provider: string;
  model: string;
  inputHash: string;
  status: "succeeded" | "failed" | "rejected_validation";
  latencyMs: number;
  errorCode?: string;
}): void {
  const afterCount = countTodayJobAnalysisAiRuns(params.db, params.nowDate);
  if (afterCount > params.beforeCount) {
    return;
  }

  try {
    params.db
      .insert(aiRuns)
      .values({
        id: crypto.randomUUID(),
        taskId: params.taskId ?? null,
        taskType: "job.analyze",
        provider: params.provider,
        model: params.model,
        promptVersion: JOB_ANALYSIS_PROMPT_VERSION,
        schemaVersion: JOB_ANALYSIS_VERSION,
        inputHash: params.inputHash,
        status: params.status,
        latencyMs: params.latencyMs,
        validationOutcome: params.status === "succeeded" ? "valid" : "error",
        errorCode: params.errorCode ?? null,
        createdAt: params.nowDate.toISOString(),
      })
      .run();
  } catch (err) {
    logger.warn("job.analyze.ai_run_record_failed", "Failed to record ai_runs telemetry.", {
      taskId: params.taskId,
      meta: { reason: err instanceof Error ? err.message : "unknown" },
    });
  }
}

/**
 * Analyzes one or more jobs using deterministic fallback or capped AI extraction.
 * - Deduplicates by (canonical jobId, normalized descriptionHash, analysisVersion).
 * - Enforces `actionAnalysisCap` (default 10 unique description hashes per action)
 *   and `dailyAnalysisCap` (default 25 per local calendar day counted from `ai_runs`).
 * - Verifies `provider !== "none"` and `dataSharingAccepted === true` before any AI call.
 * - Keeps all SQLite transactions short and synchronous; never holds a transaction across LLM calls.
 */
export async function analyzeJobWithBudget(
  input: AnalyzeJobWithBudgetInput
): Promise<AnalyzeJobBudgetResult> {
  const { db, sqlite } = resolveDbAndSqlite(input.db, input.sqlite);
  const mode: AnalyzeJobMode = input.mode ?? "auto_or_ai";
  const nowFn = input.now ?? (() => new Date());
  const generateFn = input.generateStructured ?? generateStructuredWithTracking;

  const settings = getSettings(db);
  const aiConfig = settings.ai;
  const actionCap = aiConfig.actionAnalysisCap;
  const dailyCap = aiConfig.dailyAnalysisCap;

  if (mode === "ai_required") {
    if (aiConfig.provider === "none") {
      throw new AiProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "No AI provider is configured. Select a local AI CLI or endpoint in Settings."
      );
    }
    if (!aiConfig.dataSharingAccepted) {
      throw new AiProviderError(
        "DATA_SHARING_NOT_ACCEPTED",
        "Accept the AI data-sharing disclosure in Settings before running AI job analysis."
      );
    }
  }

  let aiUnavailableReason: string | null = null;
  if (mode !== "deterministic") {
    if (aiConfig.provider === "none") {
      aiUnavailableReason = "PROVIDER_NOT_CONFIGURED";
    } else if (!aiConfig.dataSharingAccepted) {
      aiUnavailableReason = "DATA_SHARING_NOT_ACCEPTED";
    }
  }
  const aiEligible = mode !== "deterministic" && aiUnavailableReason === null;

  const dailyUsedBefore = countTodayJobAnalysisAiRuns(db, nowFn());
  let dailyUsed = dailyUsedBefore;

  // Resolve and deduplicate canonical job IDs in input order.
  const canonicalJobs: Array<{ requestedId: string; job: typeof jobs.$inferSelect | null }> = [];
  const seenCanonicalIds = new Set<string>();

  for (const requestedId of input.jobIds) {
    const resolved = resolveCanonicalJobRow(db, requestedId);
    if (!resolved) {
      canonicalJobs.push({ requestedId, job: null });
      continue;
    }
    if (seenCanonicalIds.has(resolved.id)) {
      continue;
    }
    seenCanonicalIds.add(resolved.id);
    canonicalJobs.push({ requestedId, job: resolved });
  }

  const analyzedJobIds: string[] = [];
  const aiAnalyzedJobIds: string[] = [];
  const deterministicJobIds: string[] = [];
  const deduplicatedJobIds: string[] = [];
  const skippedBudgetJobIds: string[] = [];
  const failedJobIds: string[] = [];
  const missingJobIds: string[] = [];
  const results: AnalyzeJobItemResult[] = [];

  const uniqueHashesInAction = new Set<string>();
  const cachedAiByHash = new Map<
    string,
    { analysis: JobAnalysis; requirements: NormalizedRequirementInput[] }
  >();

  let aiCallsAttempted = 0;
  let aiCallsSucceeded = 0;

  for (const entry of canonicalJobs) {
    if (!entry.job) {
      missingJobIds.push(entry.requestedId);
      results.push({
        jobId: entry.requestedId,
        status: "not_found",
        reason: "job_not_found",
      });
      continue;
    }

    const job = entry.job;
    const currentHash = computeNormalizedDescriptionHash(job.descriptionText);

    // Deduplicate by (canonical jobId, normalized descriptionHash, analysisVersion).
    if (mode === "deterministic") {
      if (
        (job.analysisStatus === "deterministic" || job.analysisStatus === "ai") &&
        job.analyzedDescriptionHash === currentHash &&
        job.analysisVersion === JOB_ANALYSIS_VERSION
      ) {
        deduplicatedJobIds.push(job.id);
        results.push({
          jobId: job.id,
          status: "deduplicated",
          reason: "already_analyzed_for_hash_and_version",
        });
        continue;
      }
    } else {
      if (
        job.analysisStatus === "ai" &&
        job.analyzedDescriptionHash === currentHash &&
        job.analysisVersion === JOB_ANALYSIS_VERSION
      ) {
        deduplicatedJobIds.push(job.id);
        results.push({
          jobId: job.id,
          status: "deduplicated",
          reason: "already_ai_analyzed_for_hash_and_version",
        });
        continue;
      }

      if (
        mode === "auto_or_ai" &&
        job.analysisStatus === "failed" &&
        job.analyzedDescriptionHash === currentHash &&
        job.analysisVersion === JOB_ANALYSIS_VERSION
      ) {
        deduplicatedJobIds.push(job.id);
        results.push({
          jobId: job.id,
          status: "deduplicated",
          reason: "unchanged_failed_job_skipped",
        });
        continue;
      }
    }

    // Deterministic mode or AI unavailable in auto_or_ai -> run deterministic analysis.
    if (mode === "deterministic" || !aiEligible) {
      const det = runDeterministicJobAnalysis(job.id, db, sqlite, nowFn);
      analyzedJobIds.push(job.id);
      deterministicJobIds.push(job.id);
      results.push({
        jobId: job.id,
        status: "deterministic",
        reason: aiUnavailableReason ?? "deterministic_mode",
        requirementCount: det.requirementCount,
        preservedOverrides: det.preservedOverrides,
        orphanedOverrides: det.orphanedOverrides,
      });
      continue;
    }

    // Reuse an AI analysis already obtained in this action for an identical descriptionHash.
    const cached = cachedAiByHash.get(currentHash);
    if (cached) {
      const persisted = persistJobAnalysis({
        sqlite,
        db,
        job,
        analysisSource: "ai",
        normalizedDescriptionHash: currentHash,
        requirements: cached.requirements,
        analysis: cached.analysis,
        nowIso: nowFn().toISOString(),
      });
      analyzedJobIds.push(job.id);
      aiAnalyzedJobIds.push(job.id);
      results.push({
        jobId: job.id,
        status: "ai",
        reason: "reused_batch_hash_analysis",
        requirementCount: persisted.requirementCount,
        preservedOverrides: persisted.preservedOverrides,
        orphanedOverrides: persisted.orphanedOverrides,
      });
      continue;
    }

    // Enforce action cap (unique description hashes per action) & daily cap.
    if (uniqueHashesInAction.size >= actionCap) {
      skippedBudgetJobIds.push(job.id);
      results.push({
        jobId: job.id,
        status: "skipped_budget",
        reason: "action_cap_reached",
      });
      continue;
    }

    if (dailyUsed >= dailyCap) {
      skippedBudgetJobIds.push(job.id);
      results.push({
        jobId: job.id,
        status: "skipped_budget",
        reason: "daily_cap_reached",
      });
      continue;
    }

    uniqueHashesInAction.add(currentHash);
    aiCallsAttempted++;

    const callNow = nowFn();
    const beforeCount = countTodayJobAnalysisAiRuns(db, callNow);
    const startedMs = Date.now();

    try {
      const llmResult = await generateFn({
        task: "job.analyze",
        taskId: input.taskId,
        promptVersion: JOB_ANALYSIS_PROMPT_VERSION,
        schemaVersion: JOB_ANALYSIS_VERSION,
        systemPrompt: JOB_ANALYSIS_SYSTEM_PROMPT,
        userPayload: {
          jobId: job.id,
          roleTitle: job.title,
          companyName: job.companyName,
          locationText: job.locationText,
          workplaceType: job.workplaceType,
          employmentType: job.employmentType,
          descriptionText: job.descriptionText,
        },
        schema: JobAnalysisSchema,
        model: aiConfig.model || aiConfig.provider,
        temperature: aiConfig.temperature,
        timeoutMs: aiConfig.timeoutMs,
        db,
      });

      const parsedAnalysis = JobAnalysisSchema.parse(llmResult.data);
      const latencyMs =
        typeof llmResult.latencyMs === "number"
          ? llmResult.latencyMs
          : Date.now() - startedMs;

      recordFallbackAiRunIfMissing({
        db,
        beforeCount,
        nowDate: callNow,
        taskId: input.taskId,
        provider: llmResult.provider ?? aiConfig.provider,
        model: llmResult.model ?? (aiConfig.model || aiConfig.provider),
        inputHash: currentHash,
        status: "succeeded",
        latencyMs,
      });

      dailyUsed = countTodayJobAnalysisAiRuns(db, nowFn());
      aiCallsSucceeded++;

      const normalizedRequirements = normalizeAiRequirements(parsedAnalysis);
      cachedAiByHash.set(currentHash, {
        analysis: parsedAnalysis,
        requirements: normalizedRequirements,
      });

      const persisted = persistJobAnalysis({
        sqlite,
        db,
        job,
        analysisSource: "ai",
        normalizedDescriptionHash: currentHash,
        requirements: normalizedRequirements,
        analysis: parsedAnalysis,
        nowIso: nowFn().toISOString(),
      });

      analyzedJobIds.push(job.id);
      aiAnalyzedJobIds.push(job.id);
      results.push({
        jobId: job.id,
        status: "ai",
        requirementCount: persisted.requirementCount,
        preservedOverrides: persisted.preservedOverrides,
        orphanedOverrides: persisted.orphanedOverrides,
      });
    } catch (err) {
      const aiErr =
        err instanceof AiProviderError
          ? err
          : new AiProviderError("PROVIDER_UNAVAILABLE", "AI job analysis failed.", {
              cause: err,
            });
      const runStatus =
        aiErr.code === "INVALID_OUTPUT" || aiErr.code === "FACTUALITY_FAILED"
          ? "rejected_validation"
          : "failed";

      recordFallbackAiRunIfMissing({
        db,
        beforeCount,
        nowDate: callNow,
        taskId: input.taskId,
        provider: aiConfig.provider,
        model: aiConfig.model || aiConfig.provider,
        inputHash: currentHash,
        status: runStatus,
        latencyMs: Date.now() - startedMs,
        errorCode: aiErr.code,
      });

      dailyUsed = countTodayJobAnalysisAiRuns(db, nowFn());

      if (mode === "auto_or_ai") {
        const det = runDeterministicJobAnalysis(job.id, db, sqlite, nowFn);
        analyzedJobIds.push(job.id);
        deterministicJobIds.push(job.id);
        results.push({
          jobId: job.id,
          status: "deterministic",
          reason: `ai_fallback:${aiErr.code}`,
          requirementCount: det.requirementCount,
          preservedOverrides: det.preservedOverrides,
          orphanedOverrides: det.orphanedOverrides,
        });
      } else {
        const failNowIso = nowFn().toISOString();
        sqlite
          .transaction(() => {
            db.update(jobs)
              .set({
                analysisStatus: "failed",
                analysisVersion: JOB_ANALYSIS_VERSION,
                analyzedDescriptionHash: currentHash,
                analyzedAt: failNowIso,
                updatedAt: failNowIso,
              })
              .where(eq(jobs.id, job.id))
              .run();
          })
          .immediate();

        failedJobIds.push(job.id);
        results.push({
          jobId: job.id,
          status: "failed",
          reason: aiErr.code,
        });
      }
    }
  }

  return {
    mode,
    aiEligible,
    aiUnavailableReason,
    aiCallsAttempted,
    aiCallsSucceeded,
    dailyCap,
    dailyUsedBefore,
    dailyUsedAfter: dailyUsed,
    actionCap,
    analyzedJobIds,
    aiAnalyzedJobIds,
    deterministicJobIds,
    deduplicatedJobIds,
    skippedBudgetJobIds,
    failedJobIds,
    missingJobIds,
    results,
  };
}

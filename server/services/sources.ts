import crypto from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import { getConnectorForSourceType } from "../connectors/index";
import type { SourceConfig, ValidationResult } from "../connectors/types";
import {
  getDb,
  type AppDatabase,
  type SqliteDatabase,
} from "../db/client";
import * as schema from "../db/schema/index";
import {
  companies,
  jobSourceRecords,
  jobSources,
  jobs,
  SOURCE_TYPES,
  sourceRuns,
  type SourceHealthState,
  type SourceType,
} from "../db/schema/jobs";
import { enqueueTask, type BackgroundTask } from "../queue/task-queue";
import { redactPaths, redactString } from "../security/redaction";
import type { DnsLookupFn } from "../security/ssrf";

export class SourceServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    message: string,
    meta?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SourceServiceError";
    this.code = code;
    this.status = status;
    this.meta = meta;
  }
}

export const DEFAULT_MIN_COOLDOWN_SECONDS = 60;

export const SOURCE_REFRESH_RULES: Record<
  SourceType,
  { minMinutes: number; defaultMinutes: number }
> = {
  greenhouse: { minMinutes: 60, defaultMinutes: 360 },
  lever: { minMinutes: 60, defaultMinutes: 360 },
  ashby: { minMinutes: 60, defaultMinutes: 360 },
  generic_career_page: { minMinutes: 180, defaultMinutes: 720 },
  gmail: { minMinutes: 60, defaultMinutes: 360 },
  manual: { minMinutes: 60, defaultMinutes: 360 },
};

const FETCHABLE_SOURCE_TYPES = new Set<SourceType>([
  "greenhouse",
  "lever",
  "ashby",
  "generic_career_page",
]);

function nullableTrimmedString(maxLength: number) {
  return z
    .union([z.string().trim().max(maxLength), z.null()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      return v;
    });
}

export const CreateSourceSchema = z
  .object({
    sourceType: z.enum(SOURCE_TYPES),
    displayName: z
      .string()
      .trim()
      .min(1, "Display name is required.")
      .max(200),
    companyId: nullableTrimmedString(128),
    sourceIdentifier: nullableTrimmedString(256),
    baseUrl: nullableTrimmedString(2048),
    config: z.record(z.string(), z.unknown()).optional(),
    minCooldownSeconds: z.number().int().min(1).max(86_400).optional(),
    enabled: z.boolean().optional(),
    refreshIntervalMinutes: z.number().int().min(1).max(43_200).optional(),
  })
  .strict();

export type CreateSourceInput = z.input<typeof CreateSourceSchema>;

export const UpdateSourceSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "Display name cannot be empty.")
      .max(200)
      .optional(),
    companyId: nullableTrimmedString(128),
    sourceIdentifier: nullableTrimmedString(256),
    baseUrl: nullableTrimmedString(2048),
    config: z.record(z.string(), z.unknown()).optional(),
    minCooldownSeconds: z.number().int().min(1).max(86_400).optional(),
    enabled: z.boolean().optional(),
    refreshIntervalMinutes: z.number().int().min(1).max(43_200).optional(),
  })
  .strict();

export type UpdateSourceInput = z.input<typeof UpdateSourceSchema>;

export const EnqueueSourceRunSchema = z
  .object({
    trigger: z.enum(["manual", "scheduled", "startup_catchup"]).optional(),
  })
  .strict();

export interface SerializedSource {
  id: string;
  sourceType: SourceType;
  displayName: string;
  companyId: string | null;
  sourceIdentifier: string | null;
  baseUrl: string | null;
  config: Record<string, unknown>;
  minCooldownSeconds: number;
  archived: boolean;
  enabled: boolean;
  refreshIntervalMinutes: number;
  minRefreshIntervalMinutes: number;
  healthState: SourceHealthState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessfulFullScanAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  lastErrorMessage: string | null;
  lastEtag: string | null;
  lastModified: string | null;
  createdAt: string;
  updatedAt: string;
}

export function sanitizeSourceErrorText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = redactPaths(redactString(value)).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length <= 500 ? cleaned : `${cleaned.slice(0, 497)}...`;
}

function parseConfigJson(raw: string | null | undefined): Record<string, unknown> {
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

export function getMinCooldownSeconds(config: Record<string, unknown>): number {
  const raw = config.minCooldownSeconds;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_MIN_COOLDOWN_SECONDS;
}

function isArchivedConfig(config: Record<string, unknown>): boolean {
  return config.archived === true;
}

function validateSafeUrlSyntax(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SourceServiceError(
      "VALIDATION_ERROR",
      400,
      "baseUrl must be a valid HTTP or HTTPS URL."
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SourceServiceError(
      "VALIDATION_ERROR",
      400,
      "baseUrl must use http or https protocol."
    );
  }
  if (parsed.username || parsed.password) {
    throw new SourceServiceError(
      "VALIDATION_ERROR",
      400,
      "baseUrl must not include embedded credentials."
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "::1"
  ) {
    throw new SourceServiceError(
      "BLOCKED_HOST",
      400,
      "Localhost or loopback baseUrl values are not permitted."
    );
  }
  return parsed.toString();
}

function validateRefreshInterval(
  sourceType: SourceType,
  requestedMinutes?: number
): number {
  const rule = SOURCE_REFRESH_RULES[sourceType];
  if (requestedMinutes === undefined) {
    return rule.defaultMinutes;
  }
  if (requestedMinutes < rule.minMinutes) {
    throw new SourceServiceError(
      "REFRESH_INTERVAL_TOO_LOW",
      400,
      `Minimum refresh interval for ${sourceType} sources is ${rule.minMinutes} minutes.`
    );
  }
  return requestedMinutes;
}

function serializeSourceRow(
  row: typeof jobSources.$inferSelect
): SerializedSource {
  const config = parseConfigJson(row.configJson);
  const minCooldownSeconds = getMinCooldownSeconds(config);
  const archived = isArchivedConfig(config);
  const rule = SOURCE_REFRESH_RULES[row.sourceType];

  return {
    id: row.id,
    sourceType: row.sourceType,
    displayName: row.displayName,
    companyId: row.companyId,
    sourceIdentifier: row.sourceIdentifier,
    baseUrl: row.baseUrl,
    config,
    minCooldownSeconds,
    archived,
    enabled: Boolean(row.enabled),
    refreshIntervalMinutes: row.refreshIntervalMinutes,
    minRefreshIntervalMinutes: rule.minMinutes,
    healthState: row.healthState,
    lastAttemptAt: row.lastAttemptAt,
    lastSuccessAt: row.lastSuccessAt,
    lastSuccessfulFullScanAt: row.lastSuccessfulFullScanAt,
    consecutiveFailures: row.consecutiveFailures,
    lastErrorCode: row.lastErrorCode,
    lastErrorDetail: sanitizeSourceErrorText(row.lastErrorDetail),
    lastErrorMessage: sanitizeSourceErrorText(row.lastErrorDetail),
    lastEtag: row.lastEtag,
    lastModified: row.lastModified,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function buildSourceConfigFromRow(
  row: typeof jobSources.$inferSelect,
  db: AppDatabase,
  options?: { fetchImpl?: typeof fetch; lookup?: DnsLookupFn; timeoutMs?: number }
): SourceConfig {
  const config = parseConfigJson(row.configJson);
  let companyName: string | undefined;
  if (row.companyId) {
    const comp = db
      .select({ canonicalName: companies.canonicalName })
      .from(companies)
      .where(eq(companies.id, row.companyId))
      .get();
    if (comp) {
      companyName = comp.canonicalName;
    }
  }

  return {
    id: row.id,
    sourceType: row.sourceType,
    displayName: row.displayName,
    companyName: companyName ?? row.displayName,
    sourceIdentifier: row.sourceIdentifier,
    baseUrl: row.baseUrl,
    lastEtag: row.lastEtag,
    lastModified: row.lastModified,
    config,
    fetchImpl: options?.fetchImpl,
    lookup: options?.lookup,
    timeoutMs: options?.timeoutMs,
  };
}

/**
 * Lists configured job sources. Soft-archived sources are excluded by default.
 */
export function listSources(
  db: AppDatabase = getDb(),
  options?: { includeArchived?: boolean }
): SerializedSource[] {
  const rows = db
    .select()
    .from(jobSources)
    .orderBy(desc(jobSources.createdAt))
    .all();

  const serialized = rows.map(serializeSourceRow);
  if (options?.includeArchived) {
    return serialized;
  }
  return serialized.filter((s) => !s.archived);
}

/**
 * Gets a single job source by ID.
 */
export function getSourceById(
  id: string,
  db: AppDatabase = getDb()
): SerializedSource | null {
  const row = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, id))
    .get();
  return row ? serializeSourceRow(row) : null;
}

/**
 * Creates a new job source with refresh-interval minimum validation and uniqueness checks.
 */
export function createSource(
  rawInput: CreateSourceInput,
  db: AppDatabase = getDb()
): SerializedSource {
  const input = CreateSourceSchema.parse(rawInput);
  const refreshIntervalMinutes = validateRefreshInterval(
    input.sourceType,
    input.refreshIntervalMinutes
  );
  const baseUrl = validateSafeUrlSyntax(input.baseUrl);
  const sourceIdentifier = input.sourceIdentifier ?? null;

  if (input.companyId) {
    const comp = db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .get();
    if (!comp) {
      throw new SourceServiceError(
        "COMPANY_NOT_FOUND",
        404,
        `Company not found: ${input.companyId}`
      );
    }
  }

  if (input.sourceType === "generic_career_page" && !baseUrl) {
    throw new SourceServiceError(
      "VALIDATION_ERROR",
      400,
      "baseUrl is required for generic_career_page sources."
    );
  }

  if (
    (input.sourceType === "greenhouse" ||
      input.sourceType === "lever" ||
      input.sourceType === "ashby") &&
    !sourceIdentifier &&
    !baseUrl
  ) {
    throw new SourceServiceError(
      "VALIDATION_ERROR",
      400,
      `sourceIdentifier or baseUrl is required for ${input.sourceType} sources.`
    );
  }

  const nowIso = new Date().toISOString();
  const nextConfig: Record<string, unknown> = {
    ...(input.config ?? {}),
    archived: false,
  };
  delete nextConfig.archivedAt;
  if (input.minCooldownSeconds !== undefined) {
    nextConfig.minCooldownSeconds = input.minCooldownSeconds;
  }

  if (sourceIdentifier !== null) {
    const existing = db
      .select()
      .from(jobSources)
      .where(
        and(
          eq(jobSources.sourceType, input.sourceType),
          eq(jobSources.sourceIdentifier, sourceIdentifier)
        )
      )
      .get();

    if (existing) {
      const existingConfig = parseConfigJson(existing.configJson);
      if (!isArchivedConfig(existingConfig)) {
        throw new SourceServiceError(
          "SOURCE_ALREADY_EXISTS",
          409,
          `A ${input.sourceType} source with identifier "${sourceIdentifier}" already exists.`
        );
      }

      // Reactivate previously archived source while preserving lineage
      const enabled = input.enabled ?? true;
      db.update(jobSources)
        .set({
          displayName: input.displayName,
          companyId: input.companyId ?? null,
          baseUrl,
          configJson: JSON.stringify(nextConfig),
          enabled,
          refreshIntervalMinutes,
          healthState: enabled ? "untested" : "paused",
          updatedAt: nowIso,
        })
        .where(eq(jobSources.id, existing.id))
        .run();

      const updated = db
        .select()
        .from(jobSources)
        .where(eq(jobSources.id, existing.id))
        .get()!;
      return serializeSourceRow(updated);
    }
  }

  const id = crypto.randomUUID();
  const enabled = input.enabled ?? (input.sourceType !== "manual");

  db.insert(jobSources)
    .values({
      id,
      sourceType: input.sourceType,
      displayName: input.displayName,
      companyId: input.companyId ?? null,
      sourceIdentifier,
      baseUrl,
      configJson: JSON.stringify(nextConfig),
      enabled,
      refreshIntervalMinutes,
      healthState: enabled ? "untested" : "paused",
      consecutiveFailures: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();

  const created = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, id))
    .get()!;
  return serializeSourceRow(created);
}

/**
 * Updates a job source, enforcing source-type refresh interval minimums and identifier uniqueness.
 */
export function updateSource(
  id: string,
  rawInput: UpdateSourceInput,
  db: AppDatabase = getDb()
): SerializedSource {
  const existing = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, id))
    .get();

  if (!existing) {
    throw new SourceServiceError(
      "SOURCE_NOT_FOUND",
      404,
      `Source not found: ${id}`
    );
  }

  const existingConfig = parseConfigJson(existing.configJson);
  if (isArchivedConfig(existingConfig)) {
    throw new SourceServiceError(
      "SOURCE_ARCHIVED",
      409,
      "Archived sources cannot be modified."
    );
  }

  const input = UpdateSourceSchema.parse(rawInput);

  const nextRefreshInterval =
    input.refreshIntervalMinutes !== undefined
      ? validateRefreshInterval(existing.sourceType, input.refreshIntervalMinutes)
      : existing.refreshIntervalMinutes;

  const nextBaseUrl =
    input.baseUrl !== undefined
      ? validateSafeUrlSyntax(input.baseUrl)
      : existing.baseUrl;

  if (input.companyId) {
    const comp = db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .get();
    if (!comp) {
      throw new SourceServiceError(
        "COMPANY_NOT_FOUND",
        404,
        `Company not found: ${input.companyId}`
      );
    }
  }

  const nextIdentifier =
    input.sourceIdentifier !== undefined
      ? input.sourceIdentifier
      : existing.sourceIdentifier;

  if (nextIdentifier !== null && nextIdentifier !== existing.sourceIdentifier) {
    const dup = db
      .select({ id: jobSources.id })
      .from(jobSources)
      .where(
        and(
          eq(jobSources.sourceType, existing.sourceType),
          eq(jobSources.sourceIdentifier, nextIdentifier),
          ne(jobSources.id, id)
        )
      )
      .get();
    if (dup) {
      throw new SourceServiceError(
        "SOURCE_ALREADY_EXISTS",
        409,
        `Another ${existing.sourceType} source already uses identifier "${nextIdentifier}".`
      );
    }
  }

  const mergedConfig: Record<string, unknown> = {
    ...existingConfig,
    ...(input.config ?? {}),
  };
  if (input.minCooldownSeconds !== undefined) {
    mergedConfig.minCooldownSeconds = input.minCooldownSeconds;
  }

  const nextEnabled =
    input.enabled !== undefined ? input.enabled : Boolean(existing.enabled);

  let nextHealthState: SourceHealthState = existing.healthState;
  if (!nextEnabled) {
    nextHealthState = "paused";
  } else if (existing.healthState === "paused") {
    nextHealthState = existing.lastSuccessAt ? "healthy" : "untested";
  }

  const nowIso = new Date().toISOString();

  db.update(jobSources)
    .set({
      displayName: input.displayName ?? existing.displayName,
      companyId:
        input.companyId !== undefined ? input.companyId : existing.companyId,
      sourceIdentifier: nextIdentifier,
      baseUrl: nextBaseUrl,
      configJson: JSON.stringify(mergedConfig),
      enabled: nextEnabled,
      refreshIntervalMinutes: nextRefreshInterval,
      healthState: nextHealthState,
      updatedAt: nowIso,
    })
    .where(eq(jobSources.id, id))
    .run();

  const updated = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, id))
    .get()!;
  return serializeSourceRow(updated);
}

/**
 * Deletes a source ONLY if it has zero historical records (`job_source_records`, `source_runs`, `jobs`).
 * If historical lineage exists, soft-archives and disables the source without cascade-deleting
 * jobs, job_source_records, source_runs, applications, or resume_versions.
 */
export function deleteSource(
  id: string,
  db: AppDatabase = getDb()
): {
  action: "deleted" | "archived";
  deleted: boolean;
  archived: boolean;
  id: string;
  source?: SerializedSource;
} | null {
  const existing = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, id))
    .get();

  if (!existing) {
    return null;
  }

  const hasSourceRecords = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(jobSourceRecords)
    .where(eq(jobSourceRecords.sourceId, id))
    .get();
  const hasSourceRuns = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(sourceRuns)
    .where(eq(sourceRuns.sourceId, id))
    .get();
  const hasPrimaryJobs = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(jobs)
    .where(eq(jobs.primarySourceId, id))
    .get();

  const hasHistory =
    (hasSourceRecords?.count ?? 0) > 0 ||
    (hasSourceRuns?.count ?? 0) > 0 ||
    (hasPrimaryJobs?.count ?? 0) > 0;

  if (hasHistory) {
    const nowIso = new Date().toISOString();
    const existingConfig = parseConfigJson(existing.configJson);
    const archivedConfig: Record<string, unknown> = {
      ...existingConfig,
      archived: true,
      archivedAt: nowIso,
    };

    db.update(jobSources)
      .set({
        enabled: false,
        healthState: "paused",
        configJson: JSON.stringify(archivedConfig),
        updatedAt: nowIso,
      })
      .where(eq(jobSources.id, id))
      .run();

    const updated = db
      .select()
      .from(jobSources)
      .where(eq(jobSources.id, id))
      .get()!;

    return {
      action: "archived",
      deleted: false,
      archived: true,
      id,
      source: serializeSourceRow(updated),
    };
  }

  db.delete(jobSources).where(eq(jobSources.id, id)).run();

  return {
    action: "deleted",
    deleted: true,
    archived: false,
    id,
  };
}

/**
 * Validates a configured source via its connector without holding any SQLite transaction open
 * across network calls, then persists updated health state.
 */
export async function testSource(
  sourceId: string,
  db: AppDatabase = getDb(),
  options?: {
    fetchImpl?: typeof fetch;
    lookup?: DnsLookupFn;
    timeoutMs?: number;
  }
): Promise<{
  valid: boolean;
  validation: ValidationResult;
  source: SerializedSource;
}> {
  const row = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, sourceId))
    .get();

  if (!row) {
    throw new SourceServiceError(
      "SOURCE_NOT_FOUND",
      404,
      `Source not found: ${sourceId}`
    );
  }

  const config = parseConfigJson(row.configJson);
  if (isArchivedConfig(config)) {
    throw new SourceServiceError(
      "SOURCE_ARCHIVED",
      409,
      "Archived sources cannot be tested."
    );
  }

  let connector;
  try {
    connector = getConnectorForSourceType(row.sourceType);
  } catch (err) {
    throw new SourceServiceError(
      "UNSUPPORTED_SOURCE_TYPE",
      400,
      err instanceof Error
        ? err.message
        : `No connector is registered for source type: ${row.sourceType}`
    );
  }

  const sourceConfig = buildSourceConfigFromRow(row, db, options);

  let validation: ValidationResult;
  try {
    validation = await connector.validate(sourceConfig);
  } catch (err) {
    validation = {
      valid: false,
      errorCode: "MALFORMED_RESPONSE",
      errorMessage:
        err instanceof Error ? err.message : "Source validation threw an error.",
    };
  }

  const nowIso = new Date().toISOString();
  const safeErrorDetail = sanitizeSourceErrorText(validation.errorMessage);

  const nextHealth: SourceHealthState = validation.valid
    ? row.enabled
      ? "healthy"
      : "paused"
    : "failing";

  db.update(jobSources)
    .set({
      lastAttemptAt: nowIso,
      lastSuccessAt: validation.valid ? nowIso : row.lastSuccessAt,
      consecutiveFailures: validation.valid ? 0 : row.consecutiveFailures + 1,
      healthState: nextHealth,
      lastErrorCode: validation.valid
        ? null
        : validation.errorCode ?? "VALIDATION_FAILED",
      lastErrorDetail: validation.valid ? null : safeErrorDetail,
      updatedAt: nowIso,
    })
    .where(eq(jobSources.id, sourceId))
    .run();

  const updated = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, sourceId))
    .get()!;

  return {
    valid: validation.valid,
    validation: {
      ...validation,
      errorMessage: safeErrorDetail ?? undefined,
    },
    source: serializeSourceRow(updated),
  };
}

/**
 * Enqueues a `source.fetch` background task with idempotency key `source.fetch:<sourceId>`
 * and enforces the per-source minimum cooldown (`minCooldownSeconds`, default 60s).
 */
export function enqueueSourceRun(
  sqlite: SqliteDatabase,
  sourceId: string,
  options?: {
    trigger?: "manual" | "scheduled" | "startup_catchup";
    now?: Date;
    bypassCooldown?: boolean;
  }
): {
  task: BackgroundTask;
  taskId: string;
  deduplicated: boolean;
} {
  const now = options?.now ?? new Date();
  const nowMs = now.getTime();
  const db = drizzle(sqlite, { schema });

  const row = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, sourceId))
    .get();

  if (!row) {
    throw new SourceServiceError(
      "SOURCE_NOT_FOUND",
      404,
      `Source not found: ${sourceId}`
    );
  }

  const config = parseConfigJson(row.configJson);
  if (isArchivedConfig(config)) {
    throw new SourceServiceError(
      "SOURCE_ARCHIVED",
      409,
      "Archived sources cannot be scanned."
    );
  }

  if (!FETCHABLE_SOURCE_TYPES.has(row.sourceType)) {
    throw new SourceServiceError(
      "SOURCE_NOT_FETCHABLE",
      400,
      `Source type "${row.sourceType}" does not support remote fetching.`
    );
  }

  const idempotencyKey = `source.fetch:${sourceId}`;

  // If a task is already queued/running for this source, deduplicate cleanly without cooldown error.
  const activeTask = sqlite
    .prepare(
      `SELECT id FROM background_tasks
       WHERE task_type = 'source.fetch'
         AND idempotency_key = ?
         AND status IN ('queued', 'running')
       LIMIT 1`
    )
    .get(idempotencyKey) as { id: string } | undefined;

  if (!activeTask && !options?.bypassCooldown) {
    const minCooldownSeconds = getMinCooldownSeconds(config);
    const minCooldownMs = minCooldownSeconds * 1000;

    const latestRun = sqlite
      .prepare(
        `SELECT started_at FROM source_runs
         WHERE source_id = ?
         ORDER BY started_at DESC
         LIMIT 1`
      )
      .get(sourceId) as { started_at: string } | undefined;

    const candidateTimestamps = [row.lastAttemptAt, latestRun?.started_at]
      .filter((t): t is string => Boolean(t))
      .map((t) => Date.parse(t))
      .filter((ms) => !Number.isNaN(ms));

    if (candidateTimestamps.length > 0) {
      const latestAttemptMs = Math.max(...candidateTimestamps);
      const elapsedMs = nowMs - latestAttemptMs;
      if (elapsedMs >= 0 && elapsedMs < minCooldownMs) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((minCooldownMs - elapsedMs) / 1000)
        );
        throw new SourceServiceError(
          "SOURCE_COOLDOWN_ACTIVE",
          429,
          `Source cooldown is active. Please wait ${retryAfterSeconds} second(s) before running again.`,
          { retryAfterSeconds, minCooldownSeconds }
        );
      }
    }
  }

  const result = enqueueTask(sqlite, {
    taskType: "source.fetch",
    payload: {
      sourceId,
      trigger: options?.trigger ?? "manual",
    },
    idempotencyKey,
    resourceType: "source",
    resourceId: sourceId,
    now,
  });

  return {
    task: result.task,
    taskId: result.task.id,
    deduplicated: result.deduplicated,
  };
}

/**
 * Lists run history for a source ordered most-recent first.
 */
export function listSourceRuns(
  sourceId: string,
  options?: { limit?: number; offset?: number },
  db: AppDatabase = getDb()
) {
  const sourceExists = db
    .select({ id: jobSources.id })
    .from(jobSources)
    .where(eq(jobSources.id, sourceId))
    .get();

  if (!sourceExists) {
    throw new SourceServiceError(
      "SOURCE_NOT_FOUND",
      404,
      `Source not found: ${sourceId}`
    );
  }

  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));

  const runs = db
    .select()
    .from(sourceRuns)
    .where(eq(sourceRuns.sourceId, sourceId))
    .orderBy(desc(sourceRuns.startedAt), desc(sourceRuns.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return runs.map((run) => ({
    ...run,
    isCompleteSnapshot: Boolean(run.isCompleteSnapshot),
    errorDetail: sanitizeSourceErrorText(run.errorDetail),
  }));
}

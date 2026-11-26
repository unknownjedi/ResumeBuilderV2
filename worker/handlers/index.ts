import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  ConnectorError,
  getConnectorForSourceType,
  type NormalizedJob,
} from "../../server/connectors/index";
import type { SqliteDatabase } from "../../server/db/client";
import * as schema from "../../server/db/schema/index";
import {
  jobSources,
  sourceRuns,
  type SourceHealthState,
} from "../../server/db/schema/jobs";
import type { TaskResourceType } from "../../server/db/schema/system";
import { emitTaskEvent } from "../../server/events/task-events";
import { logger } from "../../server/logging/logger";
import type { BackgroundTask } from "../../server/queue/task-queue";
import { SsrfError } from "../../server/security/ssrf";
import {
  ingestSourceBatch,
  runJobDeduplicationPass,
  type NormalizedJobInput,
} from "../../server/services/jobs";
import {
  buildSourceConfigFromRow,
  sanitizeSourceErrorText,
  testSource,
} from "../../server/services/sources";

export interface TaskHandlerContext {
  sqlite: SqliteDatabase;
  workerId: string;
  task: BackgroundTask;
  isCancelled: () => boolean;
  reportProgress: (progress: {
    stage?: string | null;
    percent?: number | null;
    resourceType?: TaskResourceType | null;
    resourceId?: string | null;
  }) => void;
}

export interface TaskHandlerResult {
  resultSummary?: unknown;
  resourceType?: TaskResourceType | null;
  resourceId?: string | null;
}

export type TaskHandler = (
  ctx: TaskHandlerContext
) => Promise<TaskHandlerResult | void>;

export type TaskHandlerRegistry = Map<string, TaskHandler>;

/**
 * Error indicating a permanent failure that should not be retried with backoff.
 */
export class NonRetryableTaskError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NonRetryableTaskError";
    this.code = code;
  }
}

/**
 * Sentinel error thrown by handlers when cancellation is observed at a safe checkpoint.
 */
export class TaskCancelledError extends Error {
  constructor(message = "Task cancelled at checkpoint.") {
    super(message);
    this.name = "TaskCancelledError";
  }
}

interface PingPayload {
  stages?: string[];
  delayMs?: number;
  shouldFail?: boolean;
  retryable?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface SourceTaskPayload {
  sourceId?: string;
  trigger?: string;
}

interface JobNormalizePayload {
  sourceId?: string;
  jobs?: unknown[];
  isCompleteSnapshot?: boolean;
  fetchedAt?: string;
}

interface JobDeduplicatePayload {
  jobId?: string;
}

const MAX_FETCH_PAGES = 50;
const MAX_PER_JOB_SSE_EVENTS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseJsonPayload<T>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function emitResourceUpdatedSync(
  sqlite: SqliteDatabase,
  task: BackgroundTask,
  resourceType: TaskResourceType,
  resourceId: string | null,
  occurredAt: string
): void {
  emitTaskEvent(sqlite, {
    taskId: task.id,
    taskType: task.taskType,
    eventType: "resource.updated",
    status: "running",
    resourceType,
    resourceId,
    occurredAt,
  });
}

/**
 * Slice 1 built-in health/noop ping task handler.
 */
export async function handleSystemPing(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  const payload = parseJsonPayload<PingPayload>(ctx.task.payloadJson) ?? {};
  const stages = Array.isArray(payload.stages)
    ? payload.stages.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
  const stepDelayMs =
    typeof payload.delayMs === "number" && payload.delayMs > 0
      ? Math.min(payload.delayMs, 30_000)
      : 0;

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  if (stages.length > 0) {
    for (let i = 0; i < stages.length; i++) {
      if (ctx.isCancelled()) {
        throw new TaskCancelledError();
      }
      const percent = Math.round(((i + 1) / stages.length) * 100);
      ctx.reportProgress({ stage: stages[i], percent });
      if (stepDelayMs > 0) {
        await sleep(stepDelayMs);
      }
    }
  } else {
    ctx.reportProgress({ stage: "ping", percent: null });
    if (stepDelayMs > 0) {
      await sleep(stepDelayMs);
    }
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  if (payload.shouldFail) {
    const code = payload.errorCode || "PING_FAILED";
    const message = payload.errorMessage || "Ping task configured to fail.";
    if (payload.retryable === false) {
      throw new NonRetryableTaskError(code, message);
    }
    throw new Error(message);
  }

  return {
    resultSummary: {
      ok: true,
      workerId: ctx.workerId,
      taskId: ctx.task.id,
      completedAt: new Date().toISOString(),
    },
  };
}

/**
 * Validates a configured job source via its connector and updates source health metadata.
 */
export async function handleSourceValidate(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  const payload = parseJsonPayload<SourceTaskPayload>(ctx.task.payloadJson);
  const sourceId =
    typeof payload?.sourceId === "string" ? payload.sourceId.trim() : "";

  if (!sourceId) {
    throw new NonRetryableTaskError(
      "INVALID_PAYLOAD",
      "source.validate requires a non-empty sourceId."
    );
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const db = drizzle(ctx.sqlite, { schema });
  const sourceRow = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, sourceId))
    .get();

  if (!sourceRow) {
    throw new NonRetryableTaskError(
      "SOURCE_NOT_FOUND",
      `Source not found: ${sourceId}`
    );
  }

  ctx.reportProgress({
    stage: "validating",
    percent: 25,
    resourceType: "source",
    resourceId: sourceId,
  });

  const result = await testSource(sourceId, db);

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const nowIso = new Date().toISOString();
  const tx = ctx.sqlite.transaction(() => {
    emitResourceUpdatedSync(ctx.sqlite, ctx.task, "source", sourceId, nowIso);
  });
  tx.immediate();

  ctx.reportProgress({
    stage: "validated",
    percent: 100,
    resourceType: "source",
    resourceId: sourceId,
  });

  return {
    resourceType: "source",
    resourceId: sourceId,
    resultSummary: {
      sourceId,
      valid: result.valid,
      errorCode: result.validation.errorCode ?? null,
    },
  };
}

function classifySourceFetchError(err: unknown): {
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
} {
  if (err instanceof NonRetryableTaskError) {
    return {
      errorCode: err.code,
      errorMessage: sanitizeSourceErrorText(err.message) ?? "Source fetch failed.",
      retryable: false,
    };
  }
  if (err instanceof ConnectorError) {
    return {
      errorCode: err.code,
      errorMessage: sanitizeSourceErrorText(err.message) ?? "Connector error.",
      retryable: err.retryable,
    };
  }
  if (err instanceof SsrfError) {
    const retryable =
      err.code === "REQUEST_TIMEOUT" ||
      err.code === "FETCH_FAILED" ||
      err.code === "DNS_RESOLUTION_FAILED";
    return {
      errorCode: err.code,
      errorMessage: sanitizeSourceErrorText(err.message) ?? "Network validation error.",
      retryable,
    };
  }
  if (err instanceof Error) {
    return {
      errorCode: "SOURCE_FETCH_ERROR",
      errorMessage: sanitizeSourceErrorText(err.message) ?? "Source fetch failed.",
      retryable: true,
    };
  }
  return {
    errorCode: "SOURCE_FETCH_ERROR",
    errorMessage: "Source fetch failed with an unknown error.",
    retryable: true,
  };
}

/**
 * Fetches, normalizes, deduplicates, and ingests jobs for a configured source.
 * Never holds a SQLite transaction open across network requests, and never closes jobs
 * on failed or partial scans.
 */
export async function handleSourceFetch(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  const payload = parseJsonPayload<SourceTaskPayload>(ctx.task.payloadJson);
  const sourceId =
    typeof payload?.sourceId === "string" ? payload.sourceId.trim() : "";

  if (!sourceId) {
    throw new NonRetryableTaskError(
      "INVALID_PAYLOAD",
      "source.fetch requires a non-empty sourceId."
    );
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const db = drizzle(ctx.sqlite, { schema });
  const sourceRow = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, sourceId))
    .get();

  if (!sourceRow) {
    throw new NonRetryableTaskError(
      "SOURCE_NOT_FOUND",
      `Source not found: ${sourceId}`
    );
  }

  let parsedConfig: Record<string, unknown> = {};
  try {
    parsedConfig = JSON.parse(sourceRow.configJson || "{}") as Record<string, unknown>;
  } catch {
    parsedConfig = {};
  }
  if (parsedConfig.archived === true) {
    throw new NonRetryableTaskError(
      "SOURCE_ARCHIVED",
      "Archived sources cannot be fetched."
    );
  }

  if (sourceRow.sourceType === "manual") {
    throw new NonRetryableTaskError(
      "SOURCE_NOT_FETCHABLE",
      "Manual sources do not support scheduled remote fetching."
    );
  }

  let connector;
  try {
    connector = getConnectorForSourceType(sourceRow.sourceType);
  } catch (err) {
    if (err instanceof ConnectorError) {
      throw new NonRetryableTaskError(err.code, err.message);
    }
    throw err;
  }

  const sourceConfig = buildSourceConfigFromRow(sourceRow, db);
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();

  // Record running source_run and lastAttemptAt in a short synchronous transaction.
  ctx.sqlite
    .transaction(() => {
      db.insert(sourceRuns)
        .values({
          id: runId,
          sourceId,
          taskId: ctx.task.id,
          startedAt,
          outcome: "running",
          createdAt: startedAt,
        })
        .run();

      db.update(jobSources)
        .set({
          lastAttemptAt: startedAt,
          updatedAt: startedAt,
        })
        .where(eq(jobSources.id, sourceId))
        .run();
    })
    .immediate();

  ctx.reportProgress({
    stage: "fetching",
    percent: 10,
    resourceType: "source",
    resourceId: sourceId,
  });

  const normalizedJobs: NormalizedJob[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  let isNotModified = false;
  let allPagesCompleteSnapshot = true;
  let latestEtag: string | null = sourceRow.lastEtag;
  let latestLastModified: string | null = sourceRow.lastModified;
  let latestFetchedAt = startedAt;

  try {
    do {
      if (ctx.isCancelled()) {
        throw new TaskCancelledError();
      }

      const batch = await connector.fetch(sourceConfig, cursor);
      pageCount++;
      latestFetchedAt = batch.fetchedAt || new Date().toISOString();
      if (batch.sourceEtag) {
        latestEtag = batch.sourceEtag;
      }
      if (batch.sourceLastModified) {
        latestLastModified = batch.sourceLastModified;
      }

      if (ctx.isCancelled()) {
        throw new TaskCancelledError();
      }

      if (batch.notModified) {
        isNotModified = true;
        allPagesCompleteSnapshot = false;
        break;
      }

      if (!batch.isCompleteSnapshot) {
        allPagesCompleteSnapshot = false;
      }

      const normalizedPage = connector.normalize(batch.jobs, sourceConfig);
      normalizedJobs.push(...normalizedPage);

      cursor = batch.nextCursor;
      if (cursor && pageCount >= MAX_FETCH_PAGES) {
        allPagesCompleteSnapshot = false;
        break;
      }

      ctx.reportProgress({
        stage: "fetching",
        percent: cursor ? Math.min(60, 10 + pageCount * 10) : 65,
        resourceType: "source",
        resourceId: sourceId,
      });
    } while (cursor);

    if (ctx.isCancelled()) {
      throw new TaskCancelledError();
    }

    const completedAt = new Date().toISOString();

    if (isNotModified) {
      ctx.sqlite
        .transaction(() => {
          db.update(sourceRuns)
            .set({
              completedAt,
              fetchedCount: 0,
              newCount: 0,
              updatedCount: 0,
              closedCount: 0,
              isCompleteSnapshot: false,
              outcome: "skipped_not_modified",
            })
            .where(eq(sourceRuns.id, runId))
            .run();

          db.update(jobSources)
            .set({
              lastSuccessAt: completedAt,
              consecutiveFailures: 0,
              healthState: sourceRow.enabled ? "healthy" : "paused",
              lastErrorCode: null,
              lastErrorDetail: null,
              lastEtag: latestEtag,
              lastModified: latestLastModified,
              updatedAt: completedAt,
            })
            .where(eq(jobSources.id, sourceId))
            .run();

          emitResourceUpdatedSync(
            ctx.sqlite,
            ctx.task,
            "source",
            sourceId,
            completedAt
          );
        })
        .immediate();

      ctx.reportProgress({
        stage: "completed",
        percent: 100,
        resourceType: "source",
        resourceId: sourceId,
      });

      return {
        resourceType: "source",
        resourceId: sourceId,
        resultSummary: {
          sourceId,
          runId,
          outcome: "skipped_not_modified",
          fetchedCount: 0,
          newCount: 0,
          updatedCount: 0,
          closedCount: 0,
        },
      };
    }

    ctx.reportProgress({
      stage: "ingesting",
      percent: 75,
      resourceType: "source",
      resourceId: sourceId,
    });

    const ingestResult = ingestSourceBatch({
      db,
      sqlite: ctx.sqlite,
      source: {
        id: sourceRow.id,
        sourceType: sourceRow.sourceType,
        displayName: sourceRow.displayName,
        companyId: sourceRow.companyId,
        refreshIntervalMinutes: sourceRow.refreshIntervalMinutes,
        lastSuccessfulFullScanAt: sourceRow.lastSuccessfulFullScanAt,
      },
      batch: {
        jobs: normalizedJobs as unknown as NormalizedJobInput[],
        isCompleteSnapshot: allPagesCompleteSnapshot,
        fetchedAt: latestFetchedAt,
        sourceEtag: latestEtag,
        sourceLastModified: latestLastModified,
      },
      now: new Date(completedAt),
    });

    const runOutcome = allPagesCompleteSnapshot ? "succeeded" : "partial";
    const nextHealthState: SourceHealthState = !sourceRow.enabled
      ? "paused"
      : allPagesCompleteSnapshot
        ? "healthy"
        : "degraded";

    ctx.sqlite
      .transaction(() => {
        db.update(sourceRuns)
          .set({
            completedAt,
            fetchedCount: ingestResult.fetchedCount,
            newCount: ingestResult.newCount,
            updatedCount: ingestResult.updatedCount,
            closedCount: ingestResult.closedCount,
            isCompleteSnapshot: allPagesCompleteSnapshot,
            outcome: runOutcome,
          })
          .where(eq(sourceRuns.id, runId))
          .run();

        db.update(jobSources)
          .set({
            lastSuccessAt: completedAt,
            lastSuccessfulFullScanAt: allPagesCompleteSnapshot
              ? completedAt
              : sourceRow.lastSuccessfulFullScanAt,
            consecutiveFailures: 0,
            healthState: nextHealthState,
            lastErrorCode: null,
            lastErrorDetail: null,
            lastEtag: latestEtag,
            lastModified: latestLastModified,
            updatedAt: completedAt,
          })
          .where(eq(jobSources.id, sourceId))
          .run();

        emitResourceUpdatedSync(
          ctx.sqlite,
          ctx.task,
          "source",
          sourceId,
          completedAt
        );

        if (ingestResult.touchedJobIds.length > 0) {
          if (ingestResult.touchedJobIds.length <= MAX_PER_JOB_SSE_EVENTS) {
            for (const jobId of ingestResult.touchedJobIds) {
              emitResourceUpdatedSync(
                ctx.sqlite,
                ctx.task,
                "job",
                jobId,
                completedAt
              );
            }
          } else {
            emitResourceUpdatedSync(
              ctx.sqlite,
              ctx.task,
              "job",
              null,
              completedAt
            );
          }
        }
      })
      .immediate();

    ctx.reportProgress({
      stage: "completed",
      percent: 100,
      resourceType: "source",
      resourceId: sourceId,
    });

    logger.info("source.fetch.completed", "Completed source fetch run.", {
      taskId: ctx.task.id,
      sourceId,
      meta: {
        runId,
        outcome: runOutcome,
        fetchedCount: ingestResult.fetchedCount,
        newCount: ingestResult.newCount,
        updatedCount: ingestResult.updatedCount,
        closedCount: ingestResult.closedCount,
      },
    });

    return {
      resourceType: "source",
      resourceId: sourceId,
      resultSummary: {
        sourceId,
        runId,
        outcome: runOutcome,
        ...ingestResult,
      },
    };
  } catch (err) {
    const failedAt = new Date().toISOString();

    if (err instanceof TaskCancelledError) {
      ctx.sqlite
        .transaction(() => {
          db.update(sourceRuns)
            .set({
              completedAt: failedAt,
              fetchedCount: normalizedJobs.length,
              isCompleteSnapshot: false,
              outcome: normalizedJobs.length > 0 ? "partial" : "failed",
              errorCode: "TASK_CANCELLED",
              errorDetail: "Source fetch cancelled at checkpoint.",
            })
            .where(eq(sourceRuns.id, runId))
            .run();

          emitResourceUpdatedSync(
            ctx.sqlite,
            ctx.task,
            "source",
            sourceId,
            failedAt
          );
        })
        .immediate();

      throw err;
    }

    const classified = classifySourceFetchError(err);
    const nextFailures = sourceRow.consecutiveFailures + 1;
    const nextHealth: SourceHealthState = !sourceRow.enabled
      ? "paused"
      : !classified.retryable || nextFailures >= 3
        ? "failing"
        : "degraded";

    ctx.sqlite
      .transaction(() => {
        db.update(sourceRuns)
          .set({
            completedAt: failedAt,
            fetchedCount: normalizedJobs.length,
            isCompleteSnapshot: false,
            outcome: normalizedJobs.length > 0 ? "partial" : "failed",
            errorCode: classified.errorCode,
            errorDetail: classified.errorMessage,
          })
          .where(eq(sourceRuns.id, runId))
          .run();

        db.update(jobSources)
          .set({
            consecutiveFailures: nextFailures,
            healthState: nextHealth,
            lastErrorCode: classified.errorCode,
            lastErrorDetail: classified.errorMessage,
            updatedAt: failedAt,
          })
          .where(eq(jobSources.id, sourceId))
          .run();

        emitResourceUpdatedSync(
          ctx.sqlite,
          ctx.task,
          "source",
          sourceId,
          failedAt
        );
      })
      .immediate();

    logger.warn("source.fetch.failed", "Source fetch failed.", {
      taskId: ctx.task.id,
      sourceId,
      errorCode: classified.errorCode,
      meta: {
        runId,
        retryable: classified.retryable,
        consecutiveFailures: nextFailures,
      },
    });

    if (!classified.retryable) {
      throw new NonRetryableTaskError(
        classified.errorCode,
        classified.errorMessage
      );
    }

    throw new Error(classified.errorMessage);
  }
}

/**
 * Normalizes and ingests a queued raw job payload for an existing source.
 */
export async function handleJobNormalize(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  const payload = parseJsonPayload<JobNormalizePayload>(ctx.task.payloadJson);
  const sourceId =
    typeof payload?.sourceId === "string" ? payload.sourceId.trim() : "";

  if (!sourceId || !Array.isArray(payload?.jobs)) {
    throw new NonRetryableTaskError(
      "INVALID_PAYLOAD",
      "job.normalize requires sourceId and a jobs array."
    );
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const db = drizzle(ctx.sqlite, { schema });
  const sourceRow = db
    .select()
    .from(jobSources)
    .where(eq(jobSources.id, sourceId))
    .get();

  if (!sourceRow) {
    throw new NonRetryableTaskError(
      "SOURCE_NOT_FOUND",
      `Source not found: ${sourceId}`
    );
  }

  const connector = getConnectorForSourceType(sourceRow.sourceType);
  const sourceConfig = buildSourceConfigFromRow(sourceRow, db);
  const normalized = connector.normalize(payload.jobs, sourceConfig);

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const nowIso = new Date().toISOString();
  const result = ingestSourceBatch({
    db,
    sqlite: ctx.sqlite,
    source: {
      id: sourceRow.id,
      sourceType: sourceRow.sourceType,
      displayName: sourceRow.displayName,
      companyId: sourceRow.companyId,
      refreshIntervalMinutes: sourceRow.refreshIntervalMinutes,
      lastSuccessfulFullScanAt: sourceRow.lastSuccessfulFullScanAt,
    },
    batch: {
      jobs: normalized as unknown as NormalizedJobInput[],
      isCompleteSnapshot: Boolean(payload.isCompleteSnapshot),
      fetchedAt: payload.fetchedAt || nowIso,
    },
  });

  if (result.touchedJobIds.length > 0) {
    ctx.sqlite
      .transaction(() => {
        emitResourceUpdatedSync(
          ctx.sqlite,
          ctx.task,
          "job",
          result.touchedJobIds.length === 1 ? result.touchedJobIds[0] : null,
          nowIso
        );
      })
      .immediate();
  }

  return {
    resourceType: "job",
    resourceId: result.touchedJobIds[0] ?? null,
    resultSummary: result,
  };
}

/**
 * Runs a deduplication scan across active canonical jobs to propose candidate pairs.
 */
export async function handleJobDeduplicate(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const payload = parseJsonPayload<JobDeduplicatePayload>(ctx.task.payloadJson);
  const jobId =
    typeof payload?.jobId === "string" && payload.jobId.trim().length > 0
      ? payload.jobId.trim()
      : undefined;

  const result = runJobDeduplicationPass(ctx.sqlite, { jobId });

  if (result.duplicateCandidatesCreated > 0) {
    const nowIso = new Date().toISOString();
    ctx.sqlite
      .transaction(() => {
        emitResourceUpdatedSync(
          ctx.sqlite,
          ctx.task,
          "job",
          jobId ?? null,
          nowIso
        );
      })
      .immediate();
  }

  return {
    resourceType: "job",
    resourceId: jobId ?? null,
    resultSummary: result,
  };
}

/**
 * Builds the task handler registry for Slice 1–3 and future custom handlers.
 */
export function createTaskHandlerRegistry(
  customHandlers?: Record<string, TaskHandler>
): TaskHandlerRegistry {
  const registry: TaskHandlerRegistry = new Map<string, TaskHandler>();
  registry.set("system.ping", handleSystemPing);
  registry.set("source.validate", handleSourceValidate);
  registry.set("source.fetch", handleSourceFetch);
  registry.set("job.normalize", handleJobNormalize);
  registry.set("job.deduplicate", handleJobDeduplicate);

  if (customHandlers) {
    for (const [taskType, handler] of Object.entries(customHandlers)) {
      registry.set(taskType, handler);
    }
  }

  return registry;
}

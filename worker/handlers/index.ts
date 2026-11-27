import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { AiProviderError } from "../../server/ai/types";
import {
  analyzeJobWithBudget,
  JobAnalysisError,
  type AnalyzeJobMode,
} from "../../server/ai/workflows/analyze-job";
import {
  MaterialsGenerationError,
  type MaterialGenerationMode,
} from "../../server/ai/workflows/generate-materials";
import {
  ConnectorError,
  getConnectorForSourceType,
  type NormalizedJob,
} from "../../server/connectors/index";
import type { SqliteDatabase } from "../../server/db/client";
import { EXPORT_FORMATS, type ExportFormat } from "../../server/db/schema/applications";
import * as schema from "../../server/db/schema/index";
import {
  jobSources,
  sourceRuns,
  type SourceHealthState,
} from "../../server/db/schema/jobs";
import type { TaskResourceType } from "../../server/db/schema/system";
import { PdfBrowserMissingError } from "../../server/documents/resume-renderer";
import { emitTaskEvent } from "../../server/events/task-events";
import { logger } from "../../server/logging/logger";
import type { BackgroundTask } from "../../server/queue/task-queue";
import { SsrfError } from "../../server/security/ssrf";
import {
  ApplicationServiceError,
  exportCoverLetter,
  generateAndSaveApplicationAnswers,
  generateAndSaveCoverLetter,
} from "../../server/services/applications";
import {
  ingestSourceBatch,
  runJobDeduplicationPass,
  type NormalizedJobInput,
} from "../../server/services/jobs";
import {
  computeJobMatch,
  MatchingServiceError,
  recomputeMatchesForJob,
  recomputeMatchesForSearchProfile,
} from "../../server/services/matching";
import {
  createOrTailorResumeDraft,
  exportResumeDocument,
  ResumeServiceError,
} from "../../server/services/resumes";
import {
  BackupServiceError,
  createBackupArchive,
  type BackupTrigger,
} from "../../server/services/backup";
import {
  getSettings,
} from "../../server/services/settings";
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

interface JobAnalyzePayload {
  jobId?: string;
  jobIds?: unknown[];
  mode?: string;
  searchProfileId?: string;
  recomputeMatches?: boolean;
}

interface JobMatchPayload {
  jobId?: string;
  searchProfileId?: string;
}

interface ResumeGeneratePayload {
  jobId?: string;
  searchProfileId?: string;
  applicationId?: string;
  mode?: string;
  regenerate?: boolean;
  materialType?: "resume" | "cover_letter" | "application_answers";
  tone?: string;
  length?: "short" | "medium" | "long" | "detailed";
  prompts?: Array<{ promptKey: string; promptText: string }>;
  promptKeys?: string[];
  customPrompt?: string;
}

interface DocumentExportPayload {
  documentType?: "resume" | "cover_letter";
  resumeDraftId?: string;
  versionId?: string;
  coverLetterId?: string;
  format?: string;
  paperSize?: "A4" | "Letter";
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

    // Run deterministic baseline matching for touched jobs before emitting job SSE updates
    // so UI refetches observe populated match_runs immediately.
    let baselineMatchedJobs = 0;
    if (ingestResult.touchedJobIds.length > 0) {
      ctx.reportProgress({
        stage: "matching",
        percent: 90,
        resourceType: "source",
        resourceId: sourceId,
      });

      for (const touchedJobId of ingestResult.touchedJobIds) {
        if (ctx.isCancelled()) {
          break;
        }
        try {
          recomputeMatchesForJob(touchedJobId, db, ctx.sqlite);
          baselineMatchedJobs++;
        } catch (matchErr) {
          logger.warn(
            "source.fetch.baseline_match_failed",
            "Deterministic baseline matching failed for ingested job.",
            {
              taskId: ctx.task.id,
              sourceId,
              meta: {
                jobId: touchedJobId,
                error:
                  matchErr instanceof Error ? matchErr.message : "unknown_error",
              },
            }
          );
        }
      }
    }

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
        baselineMatchedJobs,
      },
    });

    return {
      resourceType: "source",
      resourceId: sourceId,
      resultSummary: {
        sourceId,
        runId,
        outcome: runOutcome,
        baselineMatchedJobs,
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
 * Analyzes one or more jobs (capped AI extraction or deterministic fallback)
 * and recomputes deterministic matches for analyzed jobs.
 */
export async function handleJobAnalyze(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  const payload = parseJsonPayload<JobAnalyzePayload>(ctx.task.payloadJson);
  const jobIdsSet = new Set<string>();

  if (typeof payload?.jobId === "string" && payload.jobId.trim().length > 0) {
    jobIdsSet.add(payload.jobId.trim());
  }
  if (Array.isArray(payload?.jobIds)) {
    for (const id of payload.jobIds) {
      if (typeof id === "string" && id.trim().length > 0) {
        jobIdsSet.add(id.trim());
      }
    }
  }

  const jobIds = Array.from(jobIdsSet);
  if (jobIds.length === 0) {
    throw new NonRetryableTaskError(
      "INVALID_PAYLOAD",
      "job.analyze requires a non-empty jobId or jobIds array."
    );
  }

  const rawMode = payload?.mode;
  const mode: AnalyzeJobMode =
    rawMode === "ai_required" ||
    rawMode === "deterministic" ||
    rawMode === "auto_or_ai"
      ? rawMode
      : "auto_or_ai";

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const singleJobId = jobIds.length === 1 ? jobIds[0] : null;
  ctx.reportProgress({
    stage: "analyzing",
    percent: 20,
    resourceType: "job",
    resourceId: singleJobId,
  });

  const db = drizzle(ctx.sqlite, { schema });
  let analysisResult;
  try {
    analysisResult = await analyzeJobWithBudget({
      jobIds,
      mode,
      taskId: ctx.task.id,
      db,
      sqlite: ctx.sqlite,
    });
  } catch (err) {
    if (err instanceof AiProviderError) {
      if (!err.retryable) {
        throw new NonRetryableTaskError(err.code, err.message);
      }
      throw new Error(err.message);
    }
    if (err instanceof JobAnalysisError) {
      throw new NonRetryableTaskError(err.code, err.message);
    }
    throw err;
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const shouldRecomputeMatches = payload?.recomputeMatches !== false;
  const searchProfileId =
    typeof payload?.searchProfileId === "string" &&
    payload.searchProfileId.trim().length > 0
      ? payload.searchProfileId.trim()
      : undefined;

  let matchesRecomputed = 0;
  if (shouldRecomputeMatches && analysisResult.analyzedJobIds.length > 0) {
    ctx.reportProgress({
      stage: "matching",
      percent: 80,
      resourceType: "job",
      resourceId: singleJobId,
    });

    for (const analyzedJobId of analysisResult.analyzedJobIds) {
      if (ctx.isCancelled()) {
        throw new TaskCancelledError();
      }
      if (searchProfileId) {
        computeJobMatch({
          jobId: analyzedJobId,
          searchProfileId,
          db,
          sqlite: ctx.sqlite,
        });
        matchesRecomputed++;
      } else {
        const res = recomputeMatchesForJob(analyzedJobId, db, ctx.sqlite);
        matchesRecomputed += res.recomputedCount;
      }
    }
  }

  const nowIso = new Date().toISOString();
  const updatedIds = analysisResult.analyzedJobIds;
  if (updatedIds.length > 0) {
    ctx.sqlite
      .transaction(() => {
        if (updatedIds.length <= MAX_PER_JOB_SSE_EVENTS) {
          for (const id of updatedIds) {
            emitResourceUpdatedSync(ctx.sqlite, ctx.task, "job", id, nowIso);
          }
        } else {
          emitResourceUpdatedSync(ctx.sqlite, ctx.task, "job", null, nowIso);
        }
      })
      .immediate();
  }

  ctx.reportProgress({
    stage: "completed",
    percent: 100,
    resourceType: "job",
    resourceId: singleJobId,
  });

  return {
    resourceType: "job",
    resourceId: singleJobId,
    resultSummary: {
      ...analysisResult,
      matchesRecomputed,
    },
  };
}

/**
 * Recomputes deterministic documented-fit and priority scores for a job and/or search profile.
 */
export async function handleJobMatch(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  const payload = parseJsonPayload<JobMatchPayload>(ctx.task.payloadJson);
  const jobId =
    typeof payload?.jobId === "string" && payload.jobId.trim().length > 0
      ? payload.jobId.trim()
      : undefined;
  const searchProfileId =
    typeof payload?.searchProfileId === "string" &&
    payload.searchProfileId.trim().length > 0
      ? payload.searchProfileId.trim()
      : undefined;

  if (!jobId && !searchProfileId) {
    throw new NonRetryableTaskError(
      "INVALID_PAYLOAD",
      "job.match requires jobId and/or searchProfileId."
    );
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  ctx.reportProgress({
    stage: "matching",
    percent: 25,
    resourceType: "job",
    resourceId: jobId ?? null,
  });

  const db = drizzle(ctx.sqlite, { schema });
  let resultSummary: unknown;

  try {
    if (jobId && searchProfileId) {
      resultSummary = computeJobMatch({
        jobId,
        searchProfileId,
        db,
        sqlite: ctx.sqlite,
      });
    } else if (jobId) {
      resultSummary = recomputeMatchesForJob(jobId, db, ctx.sqlite);
    } else {
      resultSummary = recomputeMatchesForSearchProfile(
        searchProfileId!,
        db,
        ctx.sqlite
      );
    }
  } catch (err) {
    if (err instanceof MatchingServiceError) {
      throw new NonRetryableTaskError(err.code, err.message);
    }
    throw err;
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

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

  ctx.reportProgress({
    stage: "completed",
    percent: 100,
    resourceType: "job",
    resourceId: jobId ?? null,
  });

  return {
    resourceType: "job",
    resourceId: jobId ?? null,
    resultSummary,
  };
}

/**
 * Generates job-specific resume drafts, cover letters, or application answer drafts.
 */
export async function handleResumeGenerate(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  const payload = parseJsonPayload<ResumeGeneratePayload>(ctx.task.payloadJson);
  const jobId =
    typeof payload?.jobId === "string" && payload.jobId.trim().length > 0
      ? payload.jobId.trim()
      : undefined;

  if (!jobId) {
    throw new NonRetryableTaskError(
      "INVALID_PAYLOAD",
      "resume.generate requires jobId."
    );
  }

  const searchProfileId =
    typeof payload?.searchProfileId === "string" &&
    payload.searchProfileId.trim().length > 0
      ? payload.searchProfileId.trim()
      : undefined;

  const mode: MaterialGenerationMode =
    payload?.mode === "ai_required" ||
    payload?.mode === "deterministic" ||
    payload?.mode === "auto_or_ai"
      ? payload.mode
      : "auto_or_ai";

  const materialType = payload?.materialType ?? "resume";

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  ctx.reportProgress({
    stage: "generating",
    percent: 25,
    resourceType: materialType === "resume" ? "resume" : "application",
    resourceId: null,
  });

  const db = drizzle(ctx.sqlite, { schema });
  let resourceType: TaskResourceType = "resume";
  let resourceId: string | null = null;
  let resultSummary: Record<string, unknown> = {};

  try {
    if (materialType === "cover_letter") {
      const detail = await generateAndSaveCoverLetter({
        jobId,
        searchProfileId,
        applicationId: payload?.applicationId,
        mode,
        tone: payload?.tone,
        length: payload?.length,
        regenerate: Boolean(payload?.regenerate),
        taskId: ctx.task.id,
        db,
      });
      resourceType = "application";
      resourceId = detail.applicationId ?? detail.id;
      resultSummary = {
        materialType: "cover_letter",
        coverLetterId: detail.id,
        jobId: detail.jobId,
        searchProfileId: detail.searchProfileId,
      };
    } else if (materialType === "application_answers") {
      const res = await generateAndSaveApplicationAnswers({
        jobId,
        searchProfileId,
        applicationId: payload?.applicationId,
        prompts: payload?.prompts,
        promptKeys: payload?.promptKeys,
        customPrompt: payload?.customPrompt,
        mode,
        regenerate: Boolean(payload?.regenerate),
        taskId: ctx.task.id,
        db,
      });
      resourceType = "application";
      resourceId = res.items[0]?.applicationId ?? null;
      resultSummary = {
        materialType: "application_answers",
        count: res.items.length,
        answerIds: res.items.map((a) => a.id),
      };
    } else {
      const detail = await createOrTailorResumeDraft({
        jobId,
        searchProfileId,
        mode,
        regenerate: Boolean(payload?.regenerate),
        taskId: ctx.task.id,
        db,
      });
      resourceType = "resume";
      resourceId = detail.id;
      resultSummary = {
        materialType: "resume",
        resumeDraftId: detail.id,
        jobId: detail.jobId,
        searchProfileId: detail.searchProfileId,
        claimsCount: detail.claimsCount,
      };
    }
  } catch (err) {
    if (
      err instanceof ResumeServiceError ||
      err instanceof ApplicationServiceError ||
      err instanceof MaterialsGenerationError
    ) {
      if (err.status >= 400 && err.status < 500) {
        throw new NonRetryableTaskError(err.code, err.message);
      }
    }
    if (err instanceof AiProviderError && !err.retryable) {
      throw new NonRetryableTaskError(err.code, err.message);
    }
    throw err;
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const nowIso = new Date().toISOString();
  ctx.sqlite
    .transaction(() => {
      emitResourceUpdatedSync(
        ctx.sqlite,
        ctx.task,
        resourceType,
        resourceId,
        nowIso
      );
    })
    .immediate();

  ctx.reportProgress({
    stage: "completed",
    percent: 100,
    resourceType,
    resourceId,
  });

  return {
    resourceType,
    resourceId,
    resultSummary,
  };
}

/**
 * Exports a resume version or cover letter to DOCX, PDF, TXT, or Markdown.
 */
export async function handleDocumentExport(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  const payload = parseJsonPayload<DocumentExportPayload>(ctx.task.payloadJson);
  const documentType =
    payload?.documentType === "cover_letter" ? "cover_letter" : "resume";
  const format = payload?.format;

  if (!format || !EXPORT_FORMATS.includes(format as ExportFormat)) {
    throw new NonRetryableTaskError(
      "INVALID_PAYLOAD",
      "document.export requires format to be one of docx, pdf, txt, or md."
    );
  }

  const typedFormat = format as ExportFormat;
  const resumeDraftId =
    typeof payload?.resumeDraftId === "string" &&
    payload.resumeDraftId.trim().length > 0
      ? payload.resumeDraftId.trim()
      : undefined;
  const coverLetterId =
    typeof payload?.coverLetterId === "string" &&
    payload.coverLetterId.trim().length > 0
      ? payload.coverLetterId.trim()
      : undefined;

  if (documentType === "resume" && !resumeDraftId) {
    throw new NonRetryableTaskError(
      "INVALID_PAYLOAD",
      "document.export requires resumeDraftId for resume exports."
    );
  }
  if (documentType === "cover_letter" && !coverLetterId) {
    throw new NonRetryableTaskError(
      "INVALID_PAYLOAD",
      "document.export requires coverLetterId for cover letter exports."
    );
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const targetResourceType: TaskResourceType =
    documentType === "cover_letter" ? "application" : "resume";
  const targetResourceId =
    documentType === "cover_letter" ? coverLetterId ?? null : resumeDraftId ?? null;

  ctx.reportProgress({
    stage: "exporting",
    percent: 30,
    resourceType: targetResourceType,
    resourceId: targetResourceId,
  });

  const db = drizzle(ctx.sqlite, { schema });
  let resultSummary: Record<string, unknown>;

  try {
    if (documentType === "cover_letter") {
      const exported = await exportCoverLetter({
        coverLetterId: coverLetterId!,
        format: typedFormat,
        paperSize: payload?.paperSize,
        db,
      });
      resultSummary = {
        documentType: "cover_letter",
        exportId: exported.exportRecord.id,
        coverLetterId: exported.coverLetter.id,
        format: exported.exportRecord.format,
        fileHash: exported.exportRecord.fileHash,
        fileSizeBytes: exported.exportRecord.fileSizeBytes,
        downloadUrl: exported.downloadUrl,
      };
    } else {
      const exported = await exportResumeDocument({
        resumeDraftId: resumeDraftId!,
        format: typedFormat,
        versionId: payload?.versionId,
        paperSize: payload?.paperSize,
        db,
      });
      resultSummary = {
        documentType: "resume",
        exportId: exported.exportRecord.id,
        resumeDraftId: resumeDraftId!,
        versionId: exported.version.id,
        versionNumber: exported.version.versionNumber,
        format: exported.exportRecord.format,
        fileHash: exported.exportRecord.fileHash,
        fileSizeBytes: exported.exportRecord.fileSizeBytes,
        downloadUrl: exported.downloadUrl,
      };
    }
  } catch (err) {
    if (err instanceof PdfBrowserMissingError) {
      throw new NonRetryableTaskError(err.code, err.message);
    }
    if (
      err instanceof ResumeServiceError ||
      err instanceof ApplicationServiceError
    ) {
      if (err.status >= 400 && err.status < 500) {
        throw new NonRetryableTaskError(err.code, err.message);
      }
    }
    throw err;
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const nowIso = new Date().toISOString();
  ctx.sqlite
    .transaction(() => {
      emitResourceUpdatedSync(
        ctx.sqlite,
        ctx.task,
        targetResourceType,
        targetResourceId,
        nowIso
      );
    })
    .immediate();

  ctx.reportProgress({
    stage: "completed",
    percent: 100,
    resourceType: targetResourceType,
    resourceId: targetResourceId,
  });

  return {
    resourceType: targetResourceType,
    resourceId: targetResourceId,
    resultSummary,
  };
}

/**
 * Worker handler for `backup.create` (`manual` or `scheduled` archive creation).
 */
export async function handleBackupCreate(
  ctx: TaskHandlerContext
): Promise<TaskHandlerResult> {
  const payload =
    parseJsonPayload<{ trigger?: BackupTrigger }>(ctx.task.payloadJson) ?? {};
  const trigger: BackupTrigger = payload.trigger ?? "manual";

  ctx.reportProgress({
    stage: "creating_backup_archive",
    percent: 25,
    resourceType: null,
    resourceId: null,
  });

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  const db = drizzle(ctx.sqlite, { schema });
  const settings = getSettings(db);

  let backup;
  try {
    backup = await createBackupArchive({
      sqlite: ctx.sqlite,
      trigger,
      retentionCount: settings.backupRetentionCount,
    });
  } catch (err) {
    if (err instanceof BackupServiceError) {
      throw new NonRetryableTaskError(err.code, err.message);
    }
    throw err;
  }

  if (ctx.isCancelled()) {
    throw new TaskCancelledError();
  }

  ctx.reportProgress({
    stage: "completed",
    percent: 100,
    resourceType: null,
    resourceId: null,
  });

  return {
    resourceType: null,
    resourceId: null,
    resultSummary: {
      filename: backup.filename,
      sizeBytes: backup.sizeBytes,
      fileCount: backup.fileCount,
      trigger: backup.trigger,
      createdAt: backup.createdAt,
    },
  };
}

/**
 * Builds the task handler registry for Slice 1–6 and future custom handlers.
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
  registry.set("job.analyze", handleJobAnalyze);
  registry.set("job.match", handleJobMatch);
  registry.set("resume.generate", handleResumeGenerate);
  registry.set("document.export", handleDocumentExport);
  registry.set("backup.create", handleBackupCreate);

  if (customHandlers) {
    for (const [taskType, handler] of Object.entries(customHandlers)) {
      registry.set(taskType, handler);
    }
  }

  return registry;
}

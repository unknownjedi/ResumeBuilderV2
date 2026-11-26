import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/client";
import type { TaskResourceType, TaskStatus } from "../db/schema/system";
import { emitTaskEvent } from "../events/task-events";

export const TASK_TYPES = [
  "system.ping",
  "source.validate",
  "source.fetch",
  "job.normalize",
  "job.deduplicate",
  "job.analyze",
  "job.match",
  "resume.generate",
  "document.export",
  "backup.create",
  "gmail.sync",
] as const;
export type KnownTaskType = (typeof TASK_TYPES)[number];

export const DEFAULT_LEASE_DURATION_MS = 60_000;
export const LEASE_RENEWAL_INTERVAL_MS = 20_000;
export const DEFAULT_MAX_ATTEMPTS = 4;
export const RETRY_BACKOFF_DELAYS_MS = [
  5_000,
  30_000,
  120_000,
  600_000,
] as const;

export interface BackgroundTask {
  id: string;
  taskType: string;
  payloadJson: string;
  idempotencyKey: string | null;
  status: TaskStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  cancelRequestedAt: string | null;
  progressStage: string | null;
  progressPercent: number | null;
  resourceType: TaskResourceType | null;
  resourceId: string | null;
  resultSummaryJson: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface EnqueueTaskInput {
  id?: string;
  taskType: string;
  payload?: unknown;
  idempotencyKey?: string | null;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date | string;
  resourceType?: TaskResourceType | null;
  resourceId?: string | null;
  now?: Date;
}

export interface EnqueueTaskResult {
  task: BackgroundTask;
  deduplicated: boolean;
}

export interface ClaimTaskOptions {
  leaseDurationMs?: number;
  now?: Date;
  allowedTaskTypes?: string[];
}

export interface TaskProgressUpdate {
  stage?: string | null;
  percent?: number | null;
  resourceType?: TaskResourceType | null;
  resourceId?: string | null;
  now?: Date;
}

export interface CompleteTaskSuccessOptions {
  resultSummary?: unknown;
  resourceType?: TaskResourceType | null;
  resourceId?: string | null;
  now?: Date;
}

export interface CompleteTaskFailureInput {
  errorCode: string;
  errorMessage: string;
  retryable?: boolean;
  now?: Date;
  random?: () => number;
}

export interface ListTasksFilter {
  status?: TaskStatus | TaskStatus[];
  taskType?: string;
  limit?: number;
  offset?: number;
}

interface BackgroundTaskRow {
  id: string;
  task_type: string;
  payload_json: string;
  idempotency_key: string | null;
  status: TaskStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  cancel_requested_at: string | null;
  progress_stage: string | null;
  progress_percent: number | null;
  resource_type: TaskResourceType | null;
  resource_id: string | null;
  result_summary_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
}

const SELECT_TASK_COLUMNS = `
  id,
  task_type,
  payload_json,
  idempotency_key,
  status,
  priority,
  attempts,
  max_attempts,
  run_after,
  lease_owner,
  lease_expires_at,
  cancel_requested_at,
  progress_stage,
  progress_percent,
  resource_type,
  resource_id,
  result_summary_json,
  error_code,
  error_message,
  created_at,
  started_at,
  updated_at,
  completed_at
`;

function mapRowToTask(row: BackgroundTaskRow): BackgroundTask {
  return {
    id: row.id,
    taskType: row.task_type,
    payloadJson: row.payload_json,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    cancelRequestedAt: row.cancel_requested_at,
    progressStage: row.progress_stage,
    progressPercent: row.progress_percent,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resultSummaryJson: row.result_summary_json,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function sanitizeErrorText(value: string, maxLength = 500): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

/**
 * Computes exponential retry backoff (5s, 30s, 120s, 600s) with ±20% jitter.
 */
export function computeRetryDelayMs(
  attemptNumber: number,
  random: () => number = Math.random
): number {
  const idx = Math.max(
    0,
    Math.min(attemptNumber - 1, RETRY_BACKOFF_DELAYS_MS.length - 1)
  );
  const baseDelay = RETRY_BACKOFF_DELAYS_MS[idx];
  const jitterMultiplier = 0.8 + random() * 0.4;
  return Math.round(baseDelay * jitterMultiplier);
}

/**
 * Enqueues a task and emits its task.queued event in one atomic SQLite transaction.
 * Deduplicates active (queued/running) tasks sharing (taskType, idempotencyKey).
 */
export function enqueueTask(
  sqlite: SqliteDatabase,
  input: EnqueueTaskInput
): EnqueueTaskResult {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const runAfterIso =
    input.runAfter instanceof Date
      ? input.runAfter.toISOString()
      : input.runAfter ?? nowIso;
  const payloadJson =
    input.payload === undefined ? "{}" : JSON.stringify(input.payload);
  const priority = input.priority ?? 0;
  const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const resourceType = input.resourceType ?? null;
  const resourceId = input.resourceId ?? null;
  const taskId = input.id ?? crypto.randomUUID();

  const tx = sqlite.transaction((): EnqueueTaskResult => {
    if (idempotencyKey !== null) {
      const existing = sqlite
        .prepare(
          `SELECT ${SELECT_TASK_COLUMNS}
           FROM background_tasks
           WHERE task_type = ?
             AND idempotency_key = ?
             AND status IN ('queued', 'running')
           LIMIT 1`
        )
        .get(input.taskType, idempotencyKey) as BackgroundTaskRow | undefined;

      if (existing) {
        return { task: mapRowToTask(existing), deduplicated: true };
      }
    }

    sqlite
      .prepare(
        `INSERT INTO background_tasks (
          id,
          task_type,
          payload_json,
          idempotency_key,
          status,
          priority,
          attempts,
          max_attempts,
          run_after,
          resource_type,
          resource_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        taskId,
        input.taskType,
        payloadJson,
        idempotencyKey,
        priority,
        maxAttempts,
        runAfterIso,
        resourceType,
        resourceId,
        nowIso,
        nowIso
      );

    emitTaskEvent(sqlite, {
      taskId,
      taskType: input.taskType,
      eventType: "task.queued",
      status: "queued",
      resourceType,
      resourceId,
      occurredAt: nowIso,
    });

    const created = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS} FROM background_tasks WHERE id = ?`
      )
      .get(taskId) as BackgroundTaskRow;

    return { task: mapRowToTask(created), deduplicated: false };
  });

  return tx.immediate();
}

/**
 * Claims the highest-priority ready task or reclaims an expired lease atomically.
 */
export function claimNextTask(
  sqlite: SqliteDatabase,
  workerId: string,
  options?: ClaimTaskOptions
): BackgroundTask | null {
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();
  const leaseDurationMs = options?.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const leaseExpiresIso = new Date(
    now.getTime() + leaseDurationMs
  ).toISOString();
  const allowedTaskTypes = options?.allowedTaskTypes;

  const tx = sqlite.transaction((): BackgroundTask | null => {
    // 1. Finalize expired running tasks that were already marked for cancellation.
    const expiredCancelled = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS}
         FROM background_tasks
         WHERE status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= ?
           AND cancel_requested_at IS NOT NULL`
      )
      .all(nowIso) as BackgroundTaskRow[];

    for (const row of expiredCancelled) {
      sqlite
        .prepare(
          `UPDATE background_tasks
           SET status = 'cancelled',
               lease_owner = NULL,
               lease_expires_at = NULL,
               completed_at = ?,
               updated_at = ?
           WHERE id = ? AND status = 'running'`
        )
        .run(nowIso, nowIso, row.id);

      emitTaskEvent(sqlite, {
        taskId: row.id,
        taskType: row.task_type,
        eventType: "task.cancelled",
        status: "cancelled",
        progressStage: row.progress_stage,
        progressPercent: row.progress_percent,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        occurredAt: nowIso,
      });
    }

    // 2. Finalize expired running tasks that have exhausted max_attempts.
    const expiredExhausted = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS}
         FROM background_tasks
         WHERE status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= ?
           AND attempts >= max_attempts`
      )
      .all(nowIso) as BackgroundTaskRow[];

    for (const row of expiredExhausted) {
      sqlite
        .prepare(
          `UPDATE background_tasks
           SET status = 'failed',
               lease_owner = NULL,
               lease_expires_at = NULL,
               error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
               error_message = 'Task lease expired after reaching maximum attempts.',
               completed_at = ?,
               updated_at = ?
           WHERE id = ? AND status = 'running'`
        )
        .run(nowIso, nowIso, row.id);

      emitTaskEvent(sqlite, {
        taskId: row.id,
        taskType: row.task_type,
        eventType: "task.failed",
        status: "failed",
        progressStage: row.progress_stage,
        progressPercent: row.progress_percent,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        occurredAt: nowIso,
      });
    }

    // 3. Select next eligible queued task or reclaimable expired lease.
    const typeFilter =
      allowedTaskTypes && allowedTaskTypes.length > 0
        ? `AND task_type IN (${allowedTaskTypes.map(() => "?").join(", ")})`
        : "";
    const params: unknown[] = [nowIso, nowIso];
    if (allowedTaskTypes && allowedTaskTypes.length > 0) {
      params.push(...allowedTaskTypes);
    }

    const candidate = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS}
         FROM background_tasks
         WHERE (
           (status = 'queued' AND run_after <= ?)
           OR (
             status = 'running'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?
             AND attempts < max_attempts
             AND cancel_requested_at IS NULL
           )
         )
         ${typeFilter}
         ORDER BY priority DESC, run_after ASC, created_at ASC
         LIMIT 1`
      )
      .get(...params) as BackgroundTaskRow | undefined;

    if (!candidate) {
      return null;
    }

    sqlite
      .prepare(
        `UPDATE background_tasks
         SET status = 'running',
             attempts = attempts + 1,
             lease_owner = ?,
             lease_expires_at = ?,
             started_at = COALESCE(started_at, ?),
             updated_at = ?
         WHERE id = ?`
      )
      .run(workerId, leaseExpiresIso, nowIso, nowIso, candidate.id);

    emitTaskEvent(sqlite, {
      taskId: candidate.id,
      taskType: candidate.task_type,
      eventType: "task.started",
      status: "running",
      progressStage: candidate.progress_stage,
      progressPercent: candidate.progress_percent,
      resourceType: candidate.resource_type,
      resourceId: candidate.resource_id,
      occurredAt: nowIso,
    });

    const claimed = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS} FROM background_tasks WHERE id = ?`
      )
      .get(candidate.id) as BackgroundTaskRow;

    return mapRowToTask(claimed);
  });

  return tx.immediate();
}

/**
 * Renews the active lease for a running task owned by workerId.
 * Returns false if the lease was already lost or task is no longer running.
 */
export function renewLease(
  sqlite: SqliteDatabase,
  taskId: string,
  workerId: string,
  leaseDurationMs: number = DEFAULT_LEASE_DURATION_MS,
  now: Date = new Date()
): boolean {
  const nowIso = now.toISOString();
  const leaseExpiresIso = new Date(
    now.getTime() + leaseDurationMs
  ).toISOString();

  const tx = sqlite.transaction(() => {
    const result = sqlite
      .prepare(
        `UPDATE background_tasks
         SET lease_expires_at = ?,
             updated_at = ?
         WHERE id = ?
           AND status = 'running'
           AND lease_owner = ?`
      )
      .run(leaseExpiresIso, nowIso, taskId, workerId);
    return result.changes === 1;
  });

  return tx.immediate();
}

/**
 * Updates progress metadata on a running task and emits task.progress in one transaction.
 */
export function updateTaskProgress(
  sqlite: SqliteDatabase,
  taskId: string,
  workerId: string,
  progress: TaskProgressUpdate
): BackgroundTask | null {
  const nowIso = (progress.now ?? new Date()).toISOString();
  const progressStage = progress.stage ?? null;
  const progressPercent =
    typeof progress.percent === "number"
      ? Math.max(0, Math.min(100, Math.round(progress.percent)))
      : null;

  const tx = sqlite.transaction((): BackgroundTask | null => {
    const existing = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS}
         FROM background_tasks
         WHERE id = ? AND status = 'running' AND lease_owner = ?`
      )
      .get(taskId, workerId) as BackgroundTaskRow | undefined;

    if (!existing) {
      return null;
    }

    const nextResourceType =
      progress.resourceType !== undefined
        ? progress.resourceType
        : existing.resource_type;
    const nextResourceId =
      progress.resourceId !== undefined
        ? progress.resourceId
        : existing.resource_id;

    sqlite
      .prepare(
        `UPDATE background_tasks
         SET progress_stage = ?,
             progress_percent = ?,
             resource_type = ?,
             resource_id = ?,
             updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ?`
      )
      .run(
        progressStage,
        progressPercent,
        nextResourceType,
        nextResourceId,
        nowIso,
        taskId,
        workerId
      );

    emitTaskEvent(sqlite, {
      taskId: existing.id,
      taskType: existing.task_type,
      eventType: "task.progress",
      status: "running",
      progressStage,
      progressPercent,
      resourceType: nextResourceType,
      resourceId: nextResourceId,
      occurredAt: nowIso,
    });

    const updated = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS} FROM background_tasks WHERE id = ?`
      )
      .get(taskId) as BackgroundTaskRow;

    return mapRowToTask(updated);
  });

  return tx.immediate();
}

/**
 * Marks a running task as succeeded and emits task.succeeded in one transaction.
 */
export function completeTaskSuccess(
  sqlite: SqliteDatabase,
  taskId: string,
  workerId: string,
  options?: CompleteTaskSuccessOptions
): BackgroundTask | null {
  const nowIso = (options?.now ?? new Date()).toISOString();
  const resultSummaryJson =
    options?.resultSummary === undefined
      ? null
      : JSON.stringify(options.resultSummary);

  const tx = sqlite.transaction((): BackgroundTask | null => {
    const existing = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS}
         FROM background_tasks
         WHERE id = ? AND status = 'running' AND lease_owner = ?`
      )
      .get(taskId, workerId) as BackgroundTaskRow | undefined;

    if (!existing) {
      return null;
    }

    const nextResourceType =
      options?.resourceType !== undefined
        ? options.resourceType
        : existing.resource_type;
    const nextResourceId =
      options?.resourceId !== undefined
        ? options.resourceId
        : existing.resource_id;
    const nextPercent =
      existing.progress_percent !== null ? 100 : null;

    sqlite
      .prepare(
        `UPDATE background_tasks
         SET status = 'succeeded',
             lease_owner = NULL,
             lease_expires_at = NULL,
             progress_percent = ?,
             resource_type = ?,
             resource_id = ?,
             result_summary_json = ?,
             error_code = NULL,
             error_message = NULL,
             completed_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ?`
      )
      .run(
        nextPercent,
        nextResourceType,
        nextResourceId,
        resultSummaryJson,
        nowIso,
        nowIso,
        taskId,
        workerId
      );

    emitTaskEvent(sqlite, {
      taskId: existing.id,
      taskType: existing.task_type,
      eventType: "task.succeeded",
      status: "succeeded",
      progressStage: existing.progress_stage,
      progressPercent: nextPercent,
      resourceType: nextResourceType,
      resourceId: nextResourceId,
      occurredAt: nowIso,
    });

    const updated = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS} FROM background_tasks WHERE id = ?`
      )
      .get(taskId) as BackgroundTaskRow;

    return mapRowToTask(updated);
  });

  return tx.immediate();
}

/**
 * Handles task failure: schedules exponential backoff retry if retryable and attempts < maxAttempts,
 * otherwise transitions to failed permanently. Emits task.queued or task.failed in the same transaction.
 */
export function completeTaskFailure(
  sqlite: SqliteDatabase,
  taskId: string,
  workerId: string,
  failure: CompleteTaskFailureInput
): BackgroundTask | null {
  const now = failure.now ?? new Date();
  const nowIso = now.toISOString();
  const errorCode = sanitizeErrorText(failure.errorCode || "TASK_FAILED", 100);
  const errorMessage = sanitizeErrorText(
    failure.errorMessage || "Task failed.",
    500
  );
  const retryable = failure.retryable ?? true;

  const tx = sqlite.transaction((): BackgroundTask | null => {
    const existing = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS}
         FROM background_tasks
         WHERE id = ? AND status = 'running' AND lease_owner = ?`
      )
      .get(taskId, workerId) as BackgroundTaskRow | undefined;

    if (!existing) {
      return null;
    }

    const shouldRetry = retryable && existing.attempts < existing.max_attempts;

    if (shouldRetry) {
      const delayMs = computeRetryDelayMs(existing.attempts, failure.random);
      const runAfterIso = new Date(now.getTime() + delayMs).toISOString();

      sqlite
        .prepare(
          `UPDATE background_tasks
           SET status = 'queued',
               run_after = ?,
               lease_owner = NULL,
               lease_expires_at = NULL,
               error_code = ?,
               error_message = ?,
               updated_at = ?
           WHERE id = ? AND status = 'running' AND lease_owner = ?`
        )
        .run(runAfterIso, errorCode, errorMessage, nowIso, taskId, workerId);

      emitTaskEvent(sqlite, {
        taskId: existing.id,
        taskType: existing.task_type,
        eventType: "task.queued",
        status: "queued",
        progressStage: existing.progress_stage,
        progressPercent: existing.progress_percent,
        resourceType: existing.resource_type,
        resourceId: existing.resource_id,
        occurredAt: nowIso,
      });
    } else {
      sqlite
        .prepare(
          `UPDATE background_tasks
           SET status = 'failed',
               lease_owner = NULL,
               lease_expires_at = NULL,
               error_code = ?,
               error_message = ?,
               completed_at = ?,
               updated_at = ?
           WHERE id = ? AND status = 'running' AND lease_owner = ?`
        )
        .run(errorCode, errorMessage, nowIso, nowIso, taskId, workerId);

      emitTaskEvent(sqlite, {
        taskId: existing.id,
        taskType: existing.task_type,
        eventType: "task.failed",
        status: "failed",
        progressStage: existing.progress_stage,
        progressPercent: existing.progress_percent,
        resourceType: existing.resource_type,
        resourceId: existing.resource_id,
        occurredAt: nowIso,
      });
    }

    const updated = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS} FROM background_tasks WHERE id = ?`
      )
      .get(taskId) as BackgroundTaskRow;

    return mapRowToTask(updated);
  });

  return tx.immediate();
}

/**
 * Requests task cancellation. Queued tasks cancel immediately; running tasks record cancel_requested_at
 * for the worker to finish at a safe checkpoint; completed tasks are left unchanged.
 */
export function requestCancellation(
  sqlite: SqliteDatabase,
  taskId: string,
  now: Date = new Date()
): BackgroundTask | null {
  const nowIso = now.toISOString();

  const tx = sqlite.transaction((): BackgroundTask | null => {
    const existing = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS} FROM background_tasks WHERE id = ?`
      )
      .get(taskId) as BackgroundTaskRow | undefined;

    if (!existing) {
      return null;
    }

    if (
      existing.status === "succeeded" ||
      existing.status === "failed" ||
      existing.status === "cancelled"
    ) {
      return mapRowToTask(existing);
    }

    if (existing.status === "queued") {
      sqlite
        .prepare(
          `UPDATE background_tasks
           SET status = 'cancelled',
               cancel_requested_at = COALESCE(cancel_requested_at, ?),
               completed_at = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(nowIso, nowIso, nowIso, taskId);

      emitTaskEvent(sqlite, {
        taskId: existing.id,
        taskType: existing.task_type,
        eventType: "task.cancelled",
        status: "cancelled",
        progressStage: existing.progress_stage,
        progressPercent: existing.progress_percent,
        resourceType: existing.resource_type,
        resourceId: existing.resource_id,
        occurredAt: nowIso,
      });
    } else if (existing.status === "running") {
      sqlite
        .prepare(
          `UPDATE background_tasks
           SET cancel_requested_at = COALESCE(cancel_requested_at, ?),
               updated_at = ?
           WHERE id = ?`
        )
        .run(nowIso, nowIso, taskId);
    }

    const updated = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS} FROM background_tasks WHERE id = ?`
      )
      .get(taskId) as BackgroundTaskRow;

    return mapRowToTask(updated);
  });

  return tx.immediate();
}

/**
 * Checks whether cancellation has been requested for the given task.
 */
export function isCancellationRequested(
  sqlite: SqliteDatabase,
  taskId: string
): boolean {
  const row = sqlite
    .prepare(
      `SELECT status, cancel_requested_at FROM background_tasks WHERE id = ?`
    )
    .get(taskId) as
    | { status: TaskStatus; cancel_requested_at: string | null }
    | undefined;

  if (!row) {
    return false;
  }
  return row.cancel_requested_at !== null || row.status === "cancelled";
}

/**
 * Finalizes a running task as cancelled at a worker checkpoint and emits task.cancelled.
 */
export function markTaskCancelled(
  sqlite: SqliteDatabase,
  taskId: string,
  workerId: string,
  now: Date = new Date()
): BackgroundTask | null {
  const nowIso = now.toISOString();

  const tx = sqlite.transaction((): BackgroundTask | null => {
    const existing = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS}
         FROM background_tasks
         WHERE id = ? AND status = 'running' AND lease_owner = ?`
      )
      .get(taskId, workerId) as BackgroundTaskRow | undefined;

    if (!existing) {
      return null;
    }

    sqlite
      .prepare(
        `UPDATE background_tasks
         SET status = 'cancelled',
             cancel_requested_at = COALESCE(cancel_requested_at, ?),
             lease_owner = NULL,
             lease_expires_at = NULL,
             completed_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ?`
      )
      .run(nowIso, nowIso, nowIso, taskId, workerId);

    emitTaskEvent(sqlite, {
      taskId: existing.id,
      taskType: existing.task_type,
      eventType: "task.cancelled",
      status: "cancelled",
      progressStage: existing.progress_stage,
      progressPercent: existing.progress_percent,
      resourceType: existing.resource_type,
      resourceId: existing.resource_id,
      occurredAt: nowIso,
    });

    const updated = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS} FROM background_tasks WHERE id = ?`
      )
      .get(taskId) as BackgroundTaskRow;

    return mapRowToTask(updated);
  });

  return tx.immediate();
}

/**
 * Releases all unfinished task leases held by workerId during graceful shutdown.
 */
export function releaseWorkerLeases(
  sqlite: SqliteDatabase,
  workerId: string,
  now: Date = new Date()
): number {
  const nowIso = now.toISOString();

  const tx = sqlite.transaction((): number => {
    const held = sqlite
      .prepare(
        `SELECT ${SELECT_TASK_COLUMNS}
         FROM background_tasks
         WHERE status = 'running' AND lease_owner = ?`
      )
      .all(workerId) as BackgroundTaskRow[];

    for (const row of held) {
      if (row.cancel_requested_at !== null) {
        sqlite
          .prepare(
            `UPDATE background_tasks
             SET status = 'cancelled',
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 completed_at = ?,
                 updated_at = ?
             WHERE id = ? AND status = 'running' AND lease_owner = ?`
          )
          .run(nowIso, nowIso, row.id, workerId);

        emitTaskEvent(sqlite, {
          taskId: row.id,
          taskType: row.task_type,
          eventType: "task.cancelled",
          status: "cancelled",
          progressStage: row.progress_stage,
          progressPercent: row.progress_percent,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          occurredAt: nowIso,
        });
      } else {
        sqlite
          .prepare(
            `UPDATE background_tasks
             SET status = 'queued',
                 attempts = MAX(attempts - 1, 0),
                 run_after = ?,
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 updated_at = ?
             WHERE id = ? AND status = 'running' AND lease_owner = ?`
          )
          .run(nowIso, nowIso, row.id, workerId);

        emitTaskEvent(sqlite, {
          taskId: row.id,
          taskType: row.task_type,
          eventType: "task.queued",
          status: "queued",
          progressStage: row.progress_stage,
          progressPercent: row.progress_percent,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          occurredAt: nowIso,
        });
      }
    }

    return held.length;
  });

  return tx.immediate();
}

/**
 * Fetches a single task by ID, or null if not found.
 */
export function getTaskById(
  sqlite: SqliteDatabase,
  taskId: string
): BackgroundTask | null {
  const row = sqlite
    .prepare(`SELECT ${SELECT_TASK_COLUMNS} FROM background_tasks WHERE id = ?`)
    .get(taskId) as BackgroundTaskRow | undefined;

  return row ? mapRowToTask(row) : null;
}

/**
 * Lists background tasks ordered by newest created_at first.
 */
export function listTasks(
  sqlite: SqliteDatabase,
  filters?: ListTasksFilter
): BackgroundTask[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.status !== undefined) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    if (statuses.length > 0) {
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
  }

  if (filters?.taskType) {
    clauses.push(`task_type = ?`);
    params.push(filters.taskType);
  }

  const whereClause =
    clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(200, Math.floor(filters?.limit ?? 50)));
  const offset = Math.max(0, Math.floor(filters?.offset ?? 0));

  const rows = sqlite
    .prepare(
      `SELECT ${SELECT_TASK_COLUMNS}
       FROM background_tasks
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as BackgroundTaskRow[];

  return rows.map(mapRowToTask);
}

import type { SqliteDatabase } from "../db/client";
import type {
  TaskEventType,
  TaskResourceType,
  TaskStatus,
} from "../db/schema/system";

export type { TaskEventType, TaskResourceType, TaskStatus };

export interface TaskEvent {
  id: number;
  taskId: string;
  taskType: string;
  eventType: TaskEventType;
  status: TaskStatus;
  progressStage?: string;
  progressPercent?: number;
  resourceType?: TaskResourceType;
  resourceId?: string;
  occurredAt: string;
}

export interface EmitTaskEventInput {
  taskId: string;
  taskType: string;
  eventType: TaskEventType;
  status: TaskStatus;
  progressStage?: string | null;
  progressPercent?: number | null;
  resourceType?: TaskResourceType | null;
  resourceId?: string | null;
  occurredAt?: string;
}

export const MAX_RETAINED_EVENT_AGE_DAYS = 7;
export const MAX_RETAINED_EVENT_COUNT = 10_000;

interface TaskEventRow {
  id: number;
  task_id: string;
  task_type: string;
  event_type: TaskEventType;
  status: TaskStatus;
  progress_stage: string | null;
  progress_percent: number | null;
  resource_type: TaskResourceType | null;
  resource_id: string | null;
  occurred_at: string;
}

function mapRowToTaskEvent(row: TaskEventRow): TaskEvent {
  const event: TaskEvent = {
    id: row.id,
    taskId: row.task_id,
    taskType: row.task_type,
    eventType: row.event_type,
    status: row.status,
    occurredAt: row.occurred_at,
  };
  if (row.progress_stage !== null) {
    event.progressStage = row.progress_stage;
  }
  if (row.progress_percent !== null) {
    event.progressPercent = row.progress_percent;
  }
  if (row.resource_type !== null) {
    event.resourceType = row.resource_type;
  }
  if (row.resource_id !== null) {
    event.resourceId = row.resource_id;
  }
  return event;
}

/**
 * Inserts a safe task/resource event row synchronously inside the caller's transaction.
 */
export function emitTaskEvent(
  sqlite: SqliteDatabase,
  input: EmitTaskEventInput
): TaskEvent {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const progressStage = input.progressStage ?? null;
  const progressPercent =
    typeof input.progressPercent === "number"
      ? Math.max(0, Math.min(100, Math.round(input.progressPercent)))
      : null;
  const resourceType = input.resourceType ?? null;
  const resourceId = input.resourceId ?? null;

  const result = sqlite
    .prepare(
      `INSERT INTO task_events (
        task_id,
        task_type,
        event_type,
        status,
        progress_stage,
        progress_percent,
        resource_type,
        resource_id,
        occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.taskId,
      input.taskType,
      input.eventType,
      input.status,
      progressStage,
      progressPercent,
      resourceType,
      resourceId,
      occurredAt
    );

  const id = Number(result.lastInsertRowid);
  const event: TaskEvent = {
    id,
    taskId: input.taskId,
    taskType: input.taskType,
    eventType: input.eventType,
    status: input.status,
    occurredAt,
  };
  if (progressStage !== null) {
    event.progressStage = progressStage;
  }
  if (progressPercent !== null) {
    event.progressPercent = progressPercent;
  }
  if (resourceType !== null) {
    event.resourceType = resourceType;
  }
  if (resourceId !== null) {
    event.resourceId = resourceId;
  }
  return event;
}

/**
 * Returns the highest monotonic event sequence ID (preserving sqlite_sequence after pruning).
 */
export function getLatestEventId(sqlite: SqliteDatabase): number {
  const row = sqlite
    .prepare(`SELECT MAX(id) AS max_id FROM task_events`)
    .get() as { max_id: number | null } | undefined;

  if (row && typeof row.max_id === "number") {
    return row.max_id;
  }

  try {
    const seqRow = sqlite
      .prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'task_events'`)
      .get() as { seq: number } | undefined;
    return seqRow?.seq ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Returns the oldest retained event ID, or null if no events are currently retained.
 */
export function getOldestEventId(sqlite: SqliteDatabase): number | null {
  const row = sqlite
    .prepare(`SELECT MIN(id) AS min_id FROM task_events`)
    .get() as { min_id: number | null } | undefined;
  return row?.min_id ?? null;
}

/**
 * Lists retained task events strictly after afterId in ascending monotonic order.
 */
export function listEventsAfter(
  sqlite: SqliteDatabase,
  afterId: number,
  limit = 200
): TaskEvent[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const rows = sqlite
    .prepare(
      `SELECT
        id,
        task_id,
        task_type,
        event_type,
        status,
        progress_stage,
        progress_percent,
        resource_type,
        resource_id,
        occurred_at
      FROM task_events
      WHERE id > ?
      ORDER BY id ASC
      LIMIT ?`
    )
    .all(afterId, safeLimit) as TaskEventRow[];

  return rows.map(mapRowToTaskEvent);
}

/**
 * Prunes events older than maxAgeDays (default 7) or exceeding maxCount (default 10,000).
 */
export function pruneOldEvents(
  sqlite: SqliteDatabase,
  options?: {
    now?: Date;
    maxAgeDays?: number;
    maxCount?: number;
  }
): { deletedCount: number } {
  const now = options?.now ?? new Date();
  const maxAgeDays = options?.maxAgeDays ?? MAX_RETAINED_EVENT_AGE_DAYS;
  const maxCount = options?.maxCount ?? MAX_RETAINED_EVENT_COUNT;
  const cutoffIso = new Date(
    now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const pruneTx = sqlite.transaction(() => {
    let deletedCount = 0;

    const ageResult = sqlite
      .prepare(`DELETE FROM task_events WHERE occurred_at < ?`)
      .run(cutoffIso);
    deletedCount += ageResult.changes;

    if (maxCount <= 0) {
      const allResult = sqlite.prepare(`DELETE FROM task_events`).run();
      deletedCount += allResult.changes;
      return { deletedCount };
    }

    const thresholdRow = sqlite
      .prepare(
        `SELECT id FROM task_events ORDER BY id DESC LIMIT 1 OFFSET ?`
      )
      .get(maxCount - 1) as { id: number } | undefined;

    if (thresholdRow) {
      const countResult = sqlite
        .prepare(`DELETE FROM task_events WHERE id < ?`)
        .run(thresholdRow.id);
      deletedCount += countResult.changes;
    }

    return { deletedCount };
  });

  return pruneTx.immediate();
}

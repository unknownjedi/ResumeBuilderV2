import type { SqliteDatabase } from "../server/db/client";
import { enqueueTask } from "../server/queue/task-queue";

export interface SchedulerTickOptions {
  now?: Date;
  isStartup?: boolean;
}

export interface SchedulerTickResult {
  enqueuedSourceIds: string[];
  skippedSourceIds: string[];
}

interface SchedulableSourceRow {
  id: string;
  source_type: string;
  refresh_interval_minutes: number;
  last_attempt_at: string | null;
}

const SCHEDULED_SOURCE_TYPES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "generic_career_page",
]);

function isMaintenanceNormal(sqlite: SqliteDatabase): boolean {
  const row = sqlite
    .prepare(`SELECT state FROM system_maintenance WHERE id = 1`)
    .get() as { state: string } | undefined;
  return !row || row.state === "normal";
}

function isSourceOverdue(
  source: SchedulableSourceRow,
  nowMs: number
): boolean {
  if (!source.last_attempt_at) {
    return true;
  }
  const lastAttemptMs = Date.parse(source.last_attempt_at);
  if (Number.isNaN(lastAttemptMs)) {
    return true;
  }
  const intervalMs = Math.max(1, source.refresh_interval_minutes) * 60_000;
  return lastAttemptMs + intervalMs <= nowMs;
}

/**
 * Checks enabled job sources and enqueues at most one `source.fetch` task per
 * overdue source (using a stable idempotency key so catch-up never replays missed intervals).
 */
export function runSchedulerTick(
  sqlite: SqliteDatabase,
  options?: SchedulerTickOptions
): SchedulerTickResult {
  const now = options?.now ?? new Date();
  const nowMs = now.getTime();
  const enqueuedSourceIds: string[] = [];
  const skippedSourceIds: string[] = [];

  if (!isMaintenanceNormal(sqlite)) {
    return { enqueuedSourceIds, skippedSourceIds };
  }

  const sources = sqlite
    .prepare(
      `SELECT id, source_type, refresh_interval_minutes, last_attempt_at
       FROM job_sources
       WHERE enabled = 1`
    )
    .all() as SchedulableSourceRow[];

  for (const source of sources) {
    if (!SCHEDULED_SOURCE_TYPES.has(source.source_type)) {
      skippedSourceIds.push(source.id);
      continue;
    }

    if (!isSourceOverdue(source, nowMs)) {
      skippedSourceIds.push(source.id);
      continue;
    }

    const result = enqueueTask(sqlite, {
      taskType: "source.fetch",
      payload: {
        sourceId: source.id,
        trigger: options?.isStartup ? "startup_catchup" : "scheduled",
      },
      idempotencyKey: `source.fetch:${source.id}`,
      resourceType: "source",
      resourceId: source.id,
      now,
    });

    if (result.deduplicated) {
      skippedSourceIds.push(source.id);
    } else {
      enqueuedSourceIds.push(source.id);
    }
  }

  return { enqueuedSourceIds, skippedSourceIds };
}

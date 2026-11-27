import crypto from "node:crypto";
import { getSqlite, type SqliteDatabase } from "../db/client";
import type { MaintenanceState } from "../db/schema/system";

export type MaintenanceTargetState = "restoring" | "resetting" | "paused";

export interface MaintenanceRecord {
  id: number;
  state: MaintenanceState;
  requestId: string | null;
  requestType: "restore" | "reset" | null;
  requestedAt: string | null;
  workerAckAt: string | null;
  workerHeartbeatAt: string | null;
  journalJson: string | null;
  updatedAt: string;
}

export interface BeginMaintenanceOptions {
  sqlite?: SqliteDatabase;
  targetState: MaintenanceTargetState;
  actor: string;
  waitMs?: number;
  pollIntervalMs?: number;
  now?: Date;
}

export interface BeginMaintenanceResult {
  requestId: string;
  previousState: MaintenanceState;
  state: MaintenanceTargetState;
  workerAcked: boolean;
  record: MaintenanceRecord;
}

export interface FinishMaintenanceOptions {
  sqlite?: SqliteDatabase;
  reason?: string;
  now?: Date;
}

export class MaintenanceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "MaintenanceError";
    this.code = code;
    this.status = status;
  }
}

interface MaintenanceRow {
  id: number;
  state: MaintenanceState;
  request_id: string | null;
  request_type: "restore" | "reset" | null;
  requested_at: string | null;
  worker_ack_at: string | null;
  worker_heartbeat_at: string | null;
  journal_json: string | null;
  updated_at: string;
}

const WORKER_HEARTBEAT_FRESH_MS = 20_000;
const DEFAULT_WAIT_MS = 2_500;
const DEFAULT_POLL_INTERVAL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mapMaintenanceRow(row: MaintenanceRow): MaintenanceRecord {
  return {
    id: row.id,
    state: row.state,
    requestId: row.request_id,
    requestType: row.request_type,
    requestedAt: row.requested_at,
    workerAckAt: row.worker_ack_at,
    workerHeartbeatAt: row.worker_heartbeat_at,
    journalJson: row.journal_json,
    updatedAt: row.updated_at,
  };
}

function ensureSingletonRow(sqlite: SqliteDatabase, nowIso: string): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO system_maintenance (id, state, updated_at) VALUES (1, 'normal', ?)`
    )
    .run(nowIso);
}

function isHeartbeatFresh(heartbeatAt: string | null, nowMs: number): boolean {
  if (!heartbeatAt) return false;
  const parsed = Date.parse(heartbeatAt);
  if (Number.isNaN(parsed)) return false;
  return nowMs - parsed < WORKER_HEARTBEAT_FRESH_MS;
}

function countRunningTasks(sqlite: SqliteDatabase): number {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt FROM background_tasks WHERE status = 'running'`
    )
    .get() as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

function resolveOpenSqlite(provided?: SqliteDatabase): SqliteDatabase {
  if (provided && provided.open) {
    return provided;
  }
  return getSqlite();
}

/**
 * Reads the `system_maintenance` singleton record (`id = 1`).
 */
export function getMaintenanceRecord(
  sqlite: SqliteDatabase = getSqlite()
): MaintenanceRecord {
  const nowIso = new Date().toISOString();
  const tx = sqlite.transaction(() => {
    ensureSingletonRow(sqlite, nowIso);
    const row = sqlite
      .prepare(
        `SELECT id, state, request_id, request_type, requested_at, worker_ack_at, worker_heartbeat_at, journal_json, updated_at
         FROM system_maintenance
         WHERE id = 1`
      )
      .get() as MaintenanceRow;
    return mapMaintenanceRow(row);
  });
  return tx.immediate();
}

/**
 * Updates `journal_json` on the `system_maintenance` singleton during multi-step maintenance.
 */
export function updateMaintenanceJournal(
  sqlite: SqliteDatabase,
  journal: Record<string, unknown>
): void {
  const nowIso = new Date().toISOString();
  const tx = sqlite.transaction(() => {
    ensureSingletonRow(sqlite, nowIso);
    sqlite
      .prepare(
        `UPDATE system_maintenance
         SET journal_json = ?,
             updated_at = ?
         WHERE id = 1`
      )
      .run(JSON.stringify(journal), nowIso);
  });
  tx.immediate();
}

/**
 * Coordinates maintenance pause/drain with the background worker:
 * 1. Atomically transitions `normal` -> `quiescing`.
 * 2. If worker heartbeat is fresh (< 20s) or tasks are currently `running`, polls up to `waitMs`
 *    for running tasks to finish and the worker to acknowledge `paused`.
 * 3. If running tasks fail to drain within `waitMs`, reverts to `normal` and throws a retryable 409.
 * 4. Otherwise promotes cleanly to `targetState` (`restoring` | `resetting` | `paused`).
 */
export async function beginMaintenance(
  options: BeginMaintenanceOptions
): Promise<BeginMaintenanceResult> {
  const sqlite = resolveOpenSqlite(options.sqlite);
  const startNow = options.now ?? new Date();
  const startIso = startNow.toISOString();
  const startMs = startNow.getTime();
  const requestId = crypto.randomUUID();
  const requestType: "restore" | "reset" | null =
    options.targetState === "restoring"
      ? "restore"
      : options.targetState === "resetting"
        ? "reset"
        : null;
  const waitMs = Math.max(0, options.waitMs ?? DEFAULT_WAIT_MS);
  const pollIntervalMs = Math.max(10, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

  const initTx = sqlite.transaction(() => {
    ensureSingletonRow(sqlite, startIso);
    const current = sqlite
      .prepare(
        `SELECT id, state, request_id, request_type, requested_at, worker_ack_at, worker_heartbeat_at, journal_json, updated_at
         FROM system_maintenance
         WHERE id = 1`
      )
      .get() as MaintenanceRow;

    if (current.state !== "normal") {
      throw new MaintenanceError(
        "MAINTENANCE_IN_PROGRESS",
        `Another maintenance operation is currently in progress (${current.state}).`,
        409
      );
    }

    const initialJournal = JSON.stringify({
      actor: options.actor,
      targetState: options.targetState,
      phase: "quiescing",
      startedAt: startIso,
    });

    sqlite
      .prepare(
        `UPDATE system_maintenance
         SET state = 'quiescing',
             request_id = ?,
             request_type = ?,
             requested_at = ?,
             worker_ack_at = NULL,
             journal_json = ?,
             updated_at = ?
         WHERE id = 1 AND state = 'normal'`
      )
      .run(requestId, requestType, startIso, initialJournal, startIso);

    const runningCount = countRunningTasks(sqlite);
    return {
      previousState: current.state,
      heartbeatFresh: isHeartbeatFresh(current.worker_heartbeat_at, startMs),
      runningCount,
    };
  });

  const initial = initTx.immediate();

  let workerAcked = false;
  const deadline = Date.now() + waitMs;

  if ((initial.heartbeatFresh || initial.runningCount > 0) && waitMs > 0) {
    while (Date.now() < deadline) {
      const probe = sqlite.transaction(() => {
        const row = sqlite
          .prepare(
            `SELECT state, worker_ack_at, worker_heartbeat_at FROM system_maintenance WHERE id = 1`
          )
          .get() as {
          state: MaintenanceState;
          worker_ack_at: string | null;
          worker_heartbeat_at: string | null;
        };
        const running = countRunningTasks(sqlite);
        return { row, running };
      });
      const snapshot = probe.immediate();

      if (snapshot.row.state === "paused") {
        workerAcked = true;
      }

      if (snapshot.running === 0) {
        if (snapshot.row.state === "paused" || !initial.heartbeatFresh) {
          break;
        }
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  // Final check & promotion to targetState
  const promoteNowIso = new Date().toISOString();
  const promoteTx = sqlite.transaction(() => {
    const current = sqlite
      .prepare(
        `SELECT id, state, request_id, request_type, requested_at, worker_ack_at, worker_heartbeat_at, journal_json, updated_at
         FROM system_maintenance
         WHERE id = 1`
      )
      .get() as MaintenanceRow;

    if (current.request_id !== requestId) {
      throw new MaintenanceError(
        "MAINTENANCE_CONFLICT",
        "Maintenance ownership changed before promotion.",
        409
      );
    }

    const runningRemaining = countRunningTasks(sqlite);
    if (runningRemaining > 0) {
      sqlite
        .prepare(
          `UPDATE system_maintenance
           SET state = 'normal',
               request_id = NULL,
               request_type = NULL,
               requested_at = NULL,
               worker_ack_at = NULL,
               journal_json = ?,
               updated_at = ?
           WHERE id = 1 AND request_id = ?`
        )
        .run(
          JSON.stringify({
            actor: options.actor,
            phase: "drain_timeout",
            finishedAt: promoteNowIso,
          }),
          promoteNowIso,
          requestId
        );

      throw new MaintenanceError(
        "MAINTENANCE_DRAIN_TIMEOUT",
        "Background tasks are still running; please retry once active tasks complete.",
        409
      );
    }

    const acked = current.state === "paused" || workerAcked;
    const promotedJournal = JSON.stringify({
      actor: options.actor,
      targetState: options.targetState,
      phase: options.targetState,
      workerAcked: acked,
      promotedAt: promoteNowIso,
    });

    sqlite
      .prepare(
        `UPDATE system_maintenance
         SET state = ?,
             journal_json = ?,
             updated_at = ?
         WHERE id = 1 AND request_id = ?`
      )
      .run(options.targetState, promotedJournal, promoteNowIso, requestId);

    const updated = sqlite
      .prepare(
        `SELECT id, state, request_id, request_type, requested_at, worker_ack_at, worker_heartbeat_at, journal_json, updated_at
         FROM system_maintenance
         WHERE id = 1`
      )
      .get() as MaintenanceRow;

    return {
      workerAcked: acked,
      record: mapMaintenanceRow(updated),
    };
  });

  const promoted = promoteTx.immediate();

  return {
    requestId,
    previousState: initial.previousState,
    state: options.targetState,
    workerAcked: promoted.workerAcked,
    record: promoted.record,
  };
}

/**
 * Restores `system_maintenance` back to `'normal'` and clears request metadata.
 * Safe to call inside `finally` blocks.
 */
export function finishMaintenance(
  options: FinishMaintenanceOptions = {}
): MaintenanceRecord {
  const sqlite = resolveOpenSqlite(options.sqlite);
  const nowIso = (options.now ?? new Date()).toISOString();

  const tx = sqlite.transaction(() => {
    ensureSingletonRow(sqlite, nowIso);
    const journalJson = options.reason
      ? JSON.stringify({
          lastCompletedReason: options.reason,
          finishedAt: nowIso,
        })
      : null;

    sqlite
      .prepare(
        `UPDATE system_maintenance
         SET state = 'normal',
             request_id = NULL,
             request_type = NULL,
             requested_at = NULL,
             worker_ack_at = NULL,
             journal_json = ?,
             updated_at = ?
         WHERE id = 1`
      )
      .run(journalJson, nowIso);

    const row = sqlite
      .prepare(
        `SELECT id, state, request_id, request_type, requested_at, worker_ack_at, worker_heartbeat_at, journal_json, updated_at
         FROM system_maintenance
         WHERE id = 1`
      )
      .get() as MaintenanceRow;

    return mapMaintenanceRow(row);
  });

  return tx.immediate();
}

import crypto from "node:crypto";
import {
  closeDatabase,
  getSqlite,
  type SqliteDatabase,
} from "../server/db/client";
import type { MaintenanceState } from "../server/db/schema/system";
import { pruneOldEvents } from "../server/events/task-events";
import {
  claimNextTask,
  completeTaskFailure,
  completeTaskSuccess,
  DEFAULT_LEASE_DURATION_MS,
  isCancellationRequested,
  LEASE_RENEWAL_INTERVAL_MS,
  markTaskCancelled,
  releaseWorkerLeases,
  renewLease,
  updateTaskProgress,
  type BackgroundTask,
} from "../server/queue/task-queue";
import {
  createTaskHandlerRegistry,
  NonRetryableTaskError,
  TaskCancelledError,
  type TaskHandler,
  type TaskHandlerRegistry,
} from "./handlers/index";
import { runSchedulerTick } from "./scheduler";

export const WORKER_IDLE_MIN_MS = 500;
export const WORKER_IDLE_MAX_MS = 1_000;
export const WORKER_SHUTDOWN_DRAIN_MS = 5_000;
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;
export const WORKER_SCHEDULER_INTERVAL_MS = 30_000;
export const WORKER_PRUNE_INTERVAL_MS = 15 * 60_000;

export interface StartWorkerOptions {
  sqlite?: SqliteDatabase;
  workerId?: string;
  handlers?: Record<string, TaskHandler>;
  registerSignals?: boolean;
  closeSqliteOnShutdown?: boolean;
  exitOnSignal?: boolean;
  idleMinMs?: number;
  idleMaxMs?: number;
  shutdownDrainMs?: number;
  leaseDurationMs?: number;
  leaseRenewalIntervalMs?: number;
  schedulerIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export interface WorkerHandle {
  workerId: string;
  shutdown: (reason?: string) => Promise<void>;
  done: Promise<void>;
}

function logWorker(
  level: "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>
): void {
  const entry = {
    ts: new Date().toISOString(),
    component: "worker",
    level,
    message,
    ...(meta ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function getMaintenanceState(sqlite: SqliteDatabase): MaintenanceState {
  const row = sqlite
    .prepare(`SELECT state FROM system_maintenance WHERE id = 1`)
    .get() as { state: MaintenanceState } | undefined;
  return row?.state ?? "normal";
}

function updateHeartbeatIfNormal(sqlite: SqliteDatabase, nowIso: string): void {
  const tx = sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE system_maintenance
         SET worker_heartbeat_at = ?,
             updated_at = ?
         WHERE id = 1 AND state = 'normal'`
      )
      .run(nowIso, nowIso);
  });
  tx.immediate();
}

function acknowledgePausedIfQuiescing(
  sqlite: SqliteDatabase,
  workerId: string,
  nowIso: string
): boolean {
  const tx = sqlite.transaction(() => {
    const row = sqlite
      .prepare(`SELECT state FROM system_maintenance WHERE id = 1`)
      .get() as { state: MaintenanceState } | undefined;

    if (!row || row.state !== "quiescing") {
      return false;
    }

    releaseWorkerLeases(sqlite, workerId, new Date(nowIso));

    const res = sqlite
      .prepare(
        `UPDATE system_maintenance
         SET state = 'paused',
             worker_ack_at = ?,
             worker_heartbeat_at = ?,
             updated_at = ?
         WHERE id = 1 AND state = 'quiescing'`
      )
      .run(nowIso, nowIso, nowIso);

    return res.changes === 1;
  });
  return tx.immediate();
}

function toSafeError(err: unknown): {
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
} {
  if (err instanceof NonRetryableTaskError) {
    return {
      errorCode: err.code,
      errorMessage: err.message,
      retryable: false,
    };
  }
  if (err instanceof Error) {
    return {
      errorCode: "TASK_EXECUTION_ERROR",
      errorMessage: err.message || "Task execution failed.",
      retryable: true,
    };
  }
  return {
    errorCode: "TASK_EXECUTION_ERROR",
    errorMessage: "Task execution failed with an unknown error.",
    retryable: true,
  };
}

/**
 * Starts the local background worker loop with lease renewal, maintenance coordination,
 * startup scheduler catch-up, and bounded graceful shutdown.
 */
export function startWorker(options: StartWorkerOptions = {}): WorkerHandle {
  const usesOwnedSingleton = !options.sqlite;
  const sqlite = options.sqlite ?? getSqlite();
  const workerId =
    options.workerId ??
    `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const registry: TaskHandlerRegistry = createTaskHandlerRegistry(
    options.handlers
  );

  const idleMinMs = options.idleMinMs ?? WORKER_IDLE_MIN_MS;
  const idleMaxMs = options.idleMaxMs ?? WORKER_IDLE_MAX_MS;
  const shutdownDrainMs = options.shutdownDrainMs ?? WORKER_SHUTDOWN_DRAIN_MS;
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const leaseRenewalIntervalMs =
    options.leaseRenewalIntervalMs ?? LEASE_RENEWAL_INTERVAL_MS;
  const schedulerIntervalMs =
    options.schedulerIntervalMs ?? WORKER_SCHEDULER_INTERVAL_MS;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? WORKER_HEARTBEAT_INTERVAL_MS;
  const registerSignals = options.registerSignals ?? true;
  const closeSqliteOnShutdown =
    options.closeSqliteOnShutdown ?? usesOwnedSingleton;
  const exitOnSignal = options.exitOnSignal ?? true;

  let stopping = false;
  let activeTaskPromise: Promise<void> | null = null;
  let sleepTimer: ReturnType<typeof setTimeout> | null = null;
  let sleepResolver: (() => void) | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const wakeLoop = () => {
    if (sleepTimer) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
    if (sleepResolver) {
      const resolve = sleepResolver;
      sleepResolver = null;
      resolve();
    }
  };

  const waitBounded = (ms: number) =>
    new Promise<void>((resolve) => {
      if (stopping) {
        resolve();
        return;
      }
      sleepResolver = resolve;
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        sleepResolver = null;
        resolve();
      }, ms);
    });

  const executeTask = async (task: BackgroundTask): Promise<void> => {
    const handler = registry.get(task.taskType);
    if (!handler) {
      completeTaskFailure(sqlite, task.id, workerId, {
        errorCode: "TASK_HANDLER_NOT_REGISTERED",
        errorMessage: `No handler registered for task type: ${task.taskType}`,
        retryable: false,
      });
      logWorker("warn", "No handler registered for task type", {
        workerId,
        taskId: task.id,
        taskType: task.taskType,
      });
      return;
    }

    let leaseLost = false;
    const renewalTimer = setInterval(() => {
      if (!sqlite.open) {
        leaseLost = true;
        return;
      }
      try {
        const renewed = renewLease(sqlite, task.id, workerId, leaseDurationMs);
        if (!renewed) {
          leaseLost = true;
          logWorker("warn", "Lost task lease during renewal", {
            workerId,
            taskId: task.id,
            taskType: task.taskType,
          });
        }
      } catch (err) {
        leaseLost = true;
        logWorker("error", "Lease renewal threw error", {
          workerId,
          taskId: task.id,
          taskType: task.taskType,
          errorCode: err instanceof Error ? err.name : "RENEW_ERROR",
        });
      }
    }, leaseRenewalIntervalMs);

    try {
      const result = await handler({
        sqlite,
        workerId,
        task,
        isCancelled: () =>
          stopping ||
          leaseLost ||
          !sqlite.open ||
          isCancellationRequested(sqlite, task.id),
        reportProgress: (progress) => {
          if (leaseLost || !sqlite.open) {
            return;
          }
          updateTaskProgress(sqlite, task.id, workerId, progress);
        },
      });

      if (leaseLost || !sqlite.open) {
        return;
      }

      if (isCancellationRequested(sqlite, task.id)) {
        markTaskCancelled(sqlite, task.id, workerId);
        return;
      }

      // If shutdown interrupted a running task before completion without a cancel request,
      // let releaseWorkerLeases re-queue it cleanly rather than marking it succeeded.
      if (stopping) {
        return;
      }

      completeTaskSuccess(sqlite, task.id, workerId, result ?? undefined);
    } catch (err) {
      if (leaseLost || !sqlite.open) {
        return;
      }

      if (err instanceof TaskCancelledError) {
        if (isCancellationRequested(sqlite, task.id)) {
          markTaskCancelled(sqlite, task.id, workerId);
        }
        return;
      }

      const safeErr = toSafeError(err);
      completeTaskFailure(sqlite, task.id, workerId, safeErr);
      logWorker("warn", "Task execution failed", {
        workerId,
        taskId: task.id,
        taskType: task.taskType,
        errorCode: safeErr.errorCode,
      });
    } finally {
      clearInterval(renewalTimer);
    }
  };

  const runLoop = async (): Promise<void> => {
    let lastHeartbeatAt = 0;
    let lastSchedulerTickAt = 0;
    let lastPruneAt = 0;
    let startupCatchupDone = false;
    let currentIdleMs = idleMinMs;

    logWorker("info", "Worker started", { workerId });

    while (!stopping) {
      const now = new Date();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();

      let maintenanceState: MaintenanceState = "normal";
      try {
        maintenanceState = getMaintenanceState(sqlite);
      } catch (err) {
        logWorker("error", "Failed reading maintenance state", {
          workerId,
          errorCode: err instanceof Error ? err.name : "DB_READ_ERROR",
        });
        await waitBounded(idleMaxMs);
        continue;
      }

      if (maintenanceState === "quiescing") {
        try {
          const acked = acknowledgePausedIfQuiescing(sqlite, workerId, nowIso);
          if (acked) {
            logWorker("info", "Worker acknowledged maintenance pause", {
              workerId,
            });
          }
        } catch (err) {
          logWorker("error", "Failed acknowledging maintenance pause", {
            workerId,
            errorCode: err instanceof Error ? err.name : "MAINTENANCE_ACK_ERROR",
          });
        }
        await waitBounded(idleMinMs);
        continue;
      }

      if (maintenanceState !== "normal") {
        // Strictly perform zero SQLite writes while paused, restoring, or resetting.
        await waitBounded(idleMinMs);
        continue;
      }

      // Normal mode maintenance tasks: heartbeat, scheduler, pruning
      if (nowMs - lastHeartbeatAt >= heartbeatIntervalMs) {
        try {
          updateHeartbeatIfNormal(sqlite, nowIso);
          lastHeartbeatAt = nowMs;
        } catch (err) {
          logWorker("warn", "Failed updating worker heartbeat", {
            workerId,
            errorCode: err instanceof Error ? err.name : "HEARTBEAT_ERROR",
          });
        }
      }

      if (
        !startupCatchupDone ||
        nowMs - lastSchedulerTickAt >= schedulerIntervalMs
      ) {
        try {
          runSchedulerTick(sqlite, {
            now,
            isStartup: !startupCatchupDone,
          });
          startupCatchupDone = true;
          lastSchedulerTickAt = nowMs;
        } catch (err) {
          logWorker("warn", "Scheduler tick failed", {
            workerId,
            errorCode: err instanceof Error ? err.name : "SCHEDULER_ERROR",
          });
        }
      }

      if (nowMs - lastPruneAt >= WORKER_PRUNE_INTERVAL_MS) {
        try {
          pruneOldEvents(sqlite, { now });
          lastPruneAt = nowMs;
        } catch (err) {
          logWorker("warn", "Event retention pruning failed", {
            workerId,
            errorCode: err instanceof Error ? err.name : "PRUNE_ERROR",
          });
        }
      }

      if (stopping) {
        break;
      }

      let claimed: BackgroundTask | null = null;
      try {
        claimed = claimNextTask(sqlite, workerId, {
          leaseDurationMs,
          now,
        });
      } catch (err) {
        logWorker("warn", "Failed claiming next task", {
          workerId,
          errorCode: err instanceof Error ? err.name : "CLAIM_ERROR",
        });
        await waitBounded(idleMaxMs);
        continue;
      }

      if (claimed) {
        currentIdleMs = idleMinMs;
        activeTaskPromise = executeTask(claimed);
        await activeTaskPromise;
        activeTaskPromise = null;
        continue;
      }

      await waitBounded(currentIdleMs);
      currentIdleMs = Math.min(idleMaxMs, currentIdleMs + 125);
    }
  };

  const loopDone = runLoop();

  const onSigInt = () => {
    void shutdown("SIGINT").then(() => {
      if (exitOnSignal) {
        process.exit(0);
      }
    });
  };

  const onSigTerm = () => {
    void shutdown("SIGTERM").then(() => {
      if (exitOnSignal) {
        process.exit(0);
      }
    });
  };

  if (registerSignals) {
    process.on("SIGINT", onSigInt);
    process.on("SIGTERM", onSigTerm);
  }

  const shutdown = (reason = "manual"): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      stopping = true;
      wakeLoop();
      logWorker("info", "Worker shutting down", { workerId, reason });

      if (activeTaskPromise) {
        await Promise.race([
          activeTaskPromise,
          new Promise<void>((resolve) => {
            setTimeout(resolve, shutdownDrainMs);
          }),
        ]);
      }

      try {
        await Promise.race([
          loopDone,
          new Promise<void>((resolve) => {
            setTimeout(resolve, 500);
          }),
        ]);
      } catch {
        // Loop errors are already logged inside runLoop.
      }

      if (sqlite.open) {
        try {
          const released = releaseWorkerLeases(sqlite, workerId);
          if (released > 0) {
            logWorker("info", "Released unfinished task leases on shutdown", {
              workerId,
              released,
            });
          }
        } catch (err) {
          logWorker("warn", "Failed releasing worker leases on shutdown", {
            workerId,
            errorCode: err instanceof Error ? err.name : "LEASE_RELEASE_ERROR",
          });
        }

        if (closeSqliteOnShutdown) {
          if (usesOwnedSingleton) {
            closeDatabase();
          } else {
            sqlite.close();
          }
        }
      }

      if (registerSignals) {
        process.off("SIGINT", onSigInt);
        process.off("SIGTERM", onSigTerm);
      }

      logWorker("info", "Worker stopped", { workerId });
    })();

    return shutdownPromise;
  };

  return {
    workerId,
    shutdown,
    done: loopDone,
  };
}

if (typeof require !== "undefined" && require.main === module) {
  startWorker();
}

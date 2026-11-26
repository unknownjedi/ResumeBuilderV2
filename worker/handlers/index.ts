import type { SqliteDatabase } from "../../server/db/client";
import type { TaskResourceType } from "../../server/db/schema/system";
import type { BackgroundTask } from "../../server/queue/task-queue";

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
 * Builds the task handler registry for Slice 1 and future Slices 2-6 handlers.
 */
export function createTaskHandlerRegistry(
  customHandlers?: Record<string, TaskHandler>
): TaskHandlerRegistry {
  const registry: TaskHandlerRegistry = new Map<string, TaskHandler>();
  registry.set("system.ping", handleSystemPing);

  if (customHandlers) {
    for (const [taskType, handler] of Object.entries(customHandlers)) {
      registry.set(taskType, handler);
    }
  }

  return registry;
}

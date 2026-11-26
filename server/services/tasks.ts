import type { BackgroundTask } from "../queue/task-queue";
import { redactPaths, redactString } from "../security/redaction";

export interface SerializedTask {
  id: string;
  taskType: string;
  status: BackgroundTask["status"];
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  cancelRequestedAt: string | null;
  progressStage: string | null;
  progressPercent: number | null;
  resourceType: BackgroundTask["resourceType"];
  resourceId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

/**
 * Serializes a background task for API responses, omitting raw payload JSON
 * and redacting paths/tokens from error messages.
 */
export function serializeTaskForApi(task: BackgroundTask): SerializedTask {
  return {
    id: task.id,
    taskType: task.taskType,
    status: task.status,
    priority: task.priority,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    runAfter: task.runAfter,
    cancelRequestedAt: task.cancelRequestedAt,
    progressStage: task.progressStage,
    progressPercent: task.progressPercent,
    resourceType: task.resourceType,
    resourceId: task.resourceId,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage
      ? redactPaths(redactString(task.errorMessage))
      : null,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const TASK_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_EVENT_TYPES = [
  "task.queued",
  "task.started",
  "task.progress",
  "task.succeeded",
  "task.failed",
  "task.cancelled",
  "resource.updated",
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export const TASK_RESOURCE_TYPES = [
  "job",
  "resume",
  "application",
  "source",
] as const;
export type TaskResourceType = (typeof TASK_RESOURCE_TYPES)[number];

export const MAINTENANCE_STATES = [
  "normal",
  "quiescing",
  "paused",
  "restoring",
  "resetting",
] as const;
export type MaintenanceState = (typeof MAINTENANCE_STATES)[number];

export const AI_RUN_STATUSES = [
  "succeeded",
  "failed",
  "rejected_validation",
  "refused",
] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const backgroundTasks = sqliteTable(
  "background_tasks",
  {
    id: text("id").primaryKey(),
    taskType: text("task_type").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    idempotencyKey: text("idempotency_key"),
    status: text("status", { enum: TASK_STATUSES })
      .notNull()
      .default("queued"),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(4),
    runAfter: text("run_after").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    cancelRequestedAt: text("cancel_requested_at"),
    progressStage: text("progress_stage"),
    progressPercent: integer("progress_percent"),
    resourceType: text("resource_type", { enum: TASK_RESOURCE_TYPES }),
    resourceId: text("resource_id"),
    resultSummaryJson: text("result_summary_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [
    uniqueIndex("background_tasks_active_idempotency_uidx")
      .on(t.taskType, t.idempotencyKey)
      .where(
        sql`${t.idempotencyKey} IS NOT NULL AND ${t.status} IN ('queued', 'running')`
      ),
    index("background_tasks_claim_idx").on(t.status, t.runAfter, t.priority),
  ]
);

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: text("task_id")
      .notNull()
      .references(() => backgroundTasks.id, { onDelete: "cascade" }),
    taskType: text("task_type").notNull(),
    eventType: text("event_type", { enum: TASK_EVENT_TYPES }).notNull(),
    status: text("status", { enum: TASK_STATUSES }).notNull(),
    progressStage: text("progress_stage"),
    progressPercent: integer("progress_percent"),
    resourceType: text("resource_type", { enum: TASK_RESOURCE_TYPES }),
    resourceId: text("resource_id"),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [
    index("task_events_task_id_idx").on(t.taskId),
    index("task_events_occurred_at_idx").on(t.occurredAt),
  ]
);

export const aiRuns = sqliteTable(
  "ai_runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => backgroundTasks.id, {
      onDelete: "set null",
    }),
    taskType: text("task_type").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    inputHash: text("input_hash").notNull(),
    status: text("status", { enum: AI_RUN_STATUSES }).notNull(),
    latencyMs: integer("latency_ms"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    estimatedCostUsd: real("estimated_cost_usd"),
    validationOutcome: text("validation_outcome"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("ai_runs_task_id_idx").on(t.taskId),
    index("ai_runs_created_at_idx").on(t.createdAt),
  ]
);

export const integrationTokens = sqliteTable(
  "integration_tokens",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(),
    expiresAt: text("expires_at"),
    scopesJson: text("scopes_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("integration_tokens_provider_uidx").on(t.provider)]
);

export const gmailSyncState = sqliteTable("gmail_sync_state", {
  id: text("id").primaryKey(),
  query: text("query").notNull().default(""),
  label: text("label"),
  historyId: text("history_id"),
  lastSyncAt: text("last_sync_at"),
  connectionState: text("connection_state").notNull().default("disconnected"),
  updatedAt: text("updated_at").notNull(),
});

export const systemMaintenance = sqliteTable("system_maintenance", {
  id: integer("id").primaryKey(),
  state: text("state", { enum: MAINTENANCE_STATES })
    .notNull()
    .default("normal"),
  requestId: text("request_id"),
  requestType: text("request_type", { enum: ["restore", "reset"] }),
  requestedAt: text("requested_at"),
  workerAckAt: text("worker_ack_at"),
  workerHeartbeatAt: text("worker_heartbeat_at"),
  journalJson: text("journal_json"),
  updatedAt: text("updated_at").notNull(),
});

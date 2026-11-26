export type ConnectorSourceType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "generic_career_page";

export type JobSourceType = ConnectorSourceType | "manual" | "gmail";

export type SourceHealthState =
  | "healthy"
  | "degraded"
  | "failing"
  | "paused"
  | "untested";

export type SourceRunOutcome =
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "skipped_not_modified";

export interface JobSourceItem {
  id: string;
  sourceType: JobSourceType;
  displayName: string;
  companyId: string | null;
  sourceIdentifier: string | null;
  baseUrl: string | null;
  enabled: boolean;
  refreshIntervalMinutes: number;
  minRefreshIntervalMinutes: number;
  healthState: SourceHealthState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessfulFullScanAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceRunItem {
  id: string;
  sourceId: string;
  taskId: string | null;
  startedAt: string;
  completedAt: string | null;
  fetchedCount: number;
  newCount: number;
  updatedCount: number;
  closedCount: number;
  isCompleteSnapshot: boolean;
  outcome: SourceRunOutcome;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: string;
}

export interface SourceTestResult {
  ok: boolean;
  sourceId: string;
  message: string;
  sampleCount: number | null;
  detectedFormat: string | null;
  errorCode: string | null;
}

export interface SourceRunTaskResponse {
  taskId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  sourceId: string;
  message: string | null;
}

export interface SourceFormInput {
  sourceType: ConnectorSourceType;
  displayName: string;
  sourceIdentifier?: string | null;
  baseUrl?: string | null;
  refreshIntervalMinutes: number;
  enabled: boolean;
}

export interface SourceTaskProgress {
  taskId: string;
  sourceId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progressStage: string | null;
  progressPercent: number | null;
  errorMessage: string | null;
}

export const SOURCE_TYPE_META: Record<
  ConnectorSourceType,
  {
    label: string;
    shortLabel: string;
    defaultIntervalMinutes: number;
    minIntervalMinutes: number;
    identifierLabel: string;
    identifierPlaceholder: string;
    urlPlaceholder: string;
    helperText: string;
  }
> = {
  greenhouse: {
    label: "Greenhouse",
    shortLabel: "Greenhouse",
    defaultIntervalMinutes: 360,
    minIntervalMinutes: 60,
    identifierLabel: "Board token",
    identifierPlaceholder: "e.g. stripe or acme-corp",
    urlPlaceholder: "https://boards.greenhouse.io/acme-corp",
    helperText:
      "Uses the public Greenhouse job board API. Provide a board token or public Greenhouse board URL.",
  },
  lever: {
    label: "Lever",
    shortLabel: "Lever",
    defaultIntervalMinutes: 360,
    minIntervalMinutes: 60,
    identifierLabel: "Site identifier",
    identifierPlaceholder: "e.g. netflix or acme",
    urlPlaceholder: "https://jobs.lever.co/acme",
    helperText:
      "Uses the public Lever postings JSON feed. Provide the Lever site slug or public board URL.",
  },
  ashby: {
    label: "Ashby",
    shortLabel: "Ashby",
    defaultIntervalMinutes: 360,
    minIntervalMinutes: 60,
    identifierLabel: "Job board name",
    identifierPlaceholder: "e.g. linear or acme",
    urlPlaceholder: "https://jobs.ashbyhq.com/acme",
    helperText:
      "Uses the public Ashby job postings endpoint. Provide the board name or public Ashby URL.",
  },
  generic_career_page: {
    label: "Generic Career Page (JSON-LD / RSS / Atom)",
    shortLabel: "Career Page",
    defaultIntervalMinutes: 720,
    minIntervalMinutes: 180,
    identifierLabel: "Optional slug",
    identifierPlaceholder: "Optional label",
    urlPlaceholder: "https://company.com/careers or https://company.com/jobs.rss",
    helperText:
      "Supports public career pages with Schema.org JobPosting JSON-LD or RSS 2.0 / Atom feeds. JS-rendered portals without structured data are unsupported — use Manual Import instead.",
  },
};

export function getSourceTypeLabel(type: JobSourceType): string {
  switch (type) {
    case "greenhouse":
      return "Greenhouse";
    case "lever":
      return "Lever";
    case "ashby":
      return "Ashby";
    case "generic_career_page":
      return "Generic Career Page";
    case "manual":
      return "Manual Import";
    case "gmail":
      return "Gmail";
  }
}

export function getMinIntervalMinutes(type: JobSourceType): number {
  if (type in SOURCE_TYPE_META) {
    return SOURCE_TYPE_META[type as ConnectorSourceType].minIntervalMinutes;
  }
  return 60;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return null;
}

function pickBoolean(obj: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "boolean") return val;
    if (val === 1) return true;
    if (val === 0) return false;
  }
  return null;
}

export function extractApiErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }
  const root = asRecord(payload);
  if (!root) return fallback;

  const nestedError = asRecord(root.error);
  if (nestedError) {
    const msg = pickString(nestedError, ["message", "detail"]);
    const code = pickString(nestedError, ["code"]);
    if (msg && code) return `${msg} (${code})`;
    if (msg) return msg;
  }

  const directError = pickString(root, ["message", "error", "detail"]);
  return directError ?? fallback;
}

function isSourceType(val: string | null): val is JobSourceType {
  return (
    val === "greenhouse" ||
    val === "lever" ||
    val === "ashby" ||
    val === "generic_career_page" ||
    val === "manual" ||
    val === "gmail"
  );
}

function isHealthState(val: string | null): val is SourceHealthState {
  return (
    val === "healthy" ||
    val === "degraded" ||
    val === "failing" ||
    val === "paused" ||
    val === "untested"
  );
}

function isRunOutcome(val: string | null): val is SourceRunOutcome {
  return (
    val === "running" ||
    val === "succeeded" ||
    val === "partial" ||
    val === "failed" ||
    val === "skipped_not_modified"
  );
}

export function normalizeJobSource(raw: unknown): JobSourceItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const id = pickString(rec, ["id"]);
  if (!id) return null;

  const rawType = pickString(rec, ["sourceType", "source_type"]);
  const sourceType: JobSourceType = isSourceType(rawType)
    ? rawType
    : "generic_career_page";
  const defaultMin = getMinIntervalMinutes(sourceType);
  const rawHealth = pickString(rec, ["healthState", "health_state"]);
  const enabled = pickBoolean(rec, ["enabled"]) ?? true;

  return {
    id,
    sourceType,
    displayName:
      pickString(rec, ["displayName", "display_name", "name"]) ?? "Untitled source",
    companyId: pickString(rec, ["companyId", "company_id"]),
    sourceIdentifier: pickString(rec, ["sourceIdentifier", "source_identifier"]),
    baseUrl: pickString(rec, ["baseUrl", "base_url"]),
    enabled,
    refreshIntervalMinutes:
      pickNumber(rec, ["refreshIntervalMinutes", "refresh_interval_minutes"]) ??
      (sourceType === "generic_career_page" ? 720 : 360),
    minRefreshIntervalMinutes:
      pickNumber(rec, [
        "minRefreshIntervalMinutes",
        "min_refresh_interval_minutes",
        "minimumIntervalMinutes",
      ]) ?? defaultMin,
    healthState: isHealthState(rawHealth)
      ? rawHealth
      : enabled
        ? "untested"
        : "paused",
    lastAttemptAt: pickString(rec, ["lastAttemptAt", "last_attempt_at"]),
    lastSuccessAt: pickString(rec, ["lastSuccessAt", "last_success_at"]),
    lastSuccessfulFullScanAt: pickString(rec, [
      "lastSuccessfulFullScanAt",
      "last_successful_full_scan_at",
    ]),
    consecutiveFailures:
      pickNumber(rec, ["consecutiveFailures", "consecutive_failures"]) ?? 0,
    lastErrorCode: pickString(rec, ["lastErrorCode", "last_error_code"]),
    lastErrorDetail: pickString(rec, ["lastErrorDetail", "last_error_detail"]),
    createdAt: pickString(rec, ["createdAt", "created_at"]) ?? "",
    updatedAt: pickString(rec, ["updatedAt", "updated_at"]) ?? "",
  };
}

export function normalizeSourceRun(raw: unknown): SourceRunItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const id = pickString(rec, ["id"]);
  const sourceId = pickString(rec, ["sourceId", "source_id"]);
  if (!id || !sourceId) return null;

  const rawOutcome = pickString(rec, ["outcome", "status"]);
  return {
    id,
    sourceId,
    taskId: pickString(rec, ["taskId", "task_id"]),
    startedAt: pickString(rec, ["startedAt", "started_at"]) ?? "",
    completedAt: pickString(rec, ["completedAt", "completed_at"]),
    fetchedCount: pickNumber(rec, ["fetchedCount", "fetched_count"]) ?? 0,
    newCount: pickNumber(rec, ["newCount", "new_count"]) ?? 0,
    updatedCount: pickNumber(rec, ["updatedCount", "updated_count"]) ?? 0,
    closedCount: pickNumber(rec, ["closedCount", "closed_count"]) ?? 0,
    isCompleteSnapshot:
      pickBoolean(rec, ["isCompleteSnapshot", "is_complete_snapshot"]) ?? false,
    outcome: isRunOutcome(rawOutcome) ? rawOutcome : "running",
    errorCode: pickString(rec, ["errorCode", "error_code"]),
    errorDetail: pickString(rec, ["errorDetail", "error_detail"]),
    createdAt: pickString(rec, ["createdAt", "created_at"]) ?? "",
  };
}

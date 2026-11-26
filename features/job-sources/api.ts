import {
  asRecord,
  extractApiErrorMessage,
  normalizeJobSource,
  normalizeSourceRun,
  type JobSourceItem,
  type SourceFormInput,
  type SourceRunItem,
  type SourceRunTaskResponse,
  type SourceTaskProgress,
  type SourceTestResult,
} from "./types";

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function listSources(): Promise<JobSourceItem[]> {
  const response = await fetch("/api/sources", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to load sources (HTTP ${response.status}).`)
    );
  }

  const root = asRecord(data);
  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(root?.sources)
      ? root.sources
      : Array.isArray(root?.items)
        ? root.items
        : [];

  return rawList
    .map(normalizeJobSource)
    .filter((item): item is JobSourceItem => item !== null);
}

export async function createSource(input: SourceFormInput): Promise<JobSourceItem> {
  const response = await fetch("/api/sources", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sourceType: input.sourceType,
      displayName: input.displayName.trim(),
      sourceIdentifier: input.sourceIdentifier?.trim() || null,
      baseUrl: input.baseUrl?.trim() || null,
      refreshIntervalMinutes: input.refreshIntervalMinutes,
      enabled: input.enabled,
    }),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to create source (HTTP ${response.status}).`)
    );
  }

  const root = asRecord(data);
  const candidate = root?.source ?? root?.item ?? data;
  const normalized = normalizeJobSource(candidate);
  if (!normalized) {
    throw new Error("Server returned an unexpected source payload.");
  }
  return normalized;
}

export async function updateSource(
  id: string,
  patch: Partial<SourceFormInput>
): Promise<JobSourceItem> {
  const body: Record<string, unknown> = {};
  if (patch.displayName !== undefined) body.displayName = patch.displayName.trim();
  if (patch.sourceIdentifier !== undefined) {
    body.sourceIdentifier = patch.sourceIdentifier?.trim() || null;
  }
  if (patch.baseUrl !== undefined) {
    body.baseUrl = patch.baseUrl?.trim() || null;
  }
  if (patch.refreshIntervalMinutes !== undefined) {
    body.refreshIntervalMinutes = patch.refreshIntervalMinutes;
  }
  if (patch.enabled !== undefined) {
    body.enabled = patch.enabled;
  }

  const response = await fetch(`/api/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to update source (HTTP ${response.status}).`)
    );
  }

  const root = asRecord(data);
  const candidate = root?.source ?? root?.item ?? data;
  const normalized = normalizeJobSource(candidate);
  if (!normalized) {
    throw new Error("Server returned an unexpected source payload.");
  }
  return normalized;
}

export async function deleteSource(id: string): Promise<void> {
  const response = await fetch(`/api/sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to remove source (HTTP ${response.status}).`)
    );
  }
}

export async function testSource(id: string): Promise<SourceTestResult> {
  const response = await fetch(`/api/sources/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const data = await parseJsonSafe(response);
  const root = asRecord(data);
  const result = asRecord(root?.result) ?? root;

  if (!response.ok) {
    const errRec = asRecord(root?.error);
    return {
      ok: false,
      sourceId: id,
      message: extractApiErrorMessage(
        data,
        `Source validation failed (HTTP ${response.status}).`
      ),
      sampleCount: null,
      detectedFormat: null,
      errorCode: typeof errRec?.code === "string" ? errRec.code : null,
    };
  }

  const valid =
    typeof result?.valid === "boolean"
      ? result.valid
      : typeof result?.ok === "boolean"
        ? result.ok
        : true;
  const sampleCount =
    typeof result?.sampleCount === "number"
      ? result.sampleCount
      : typeof result?.jobCount === "number"
        ? result.jobCount
        : typeof result?.fetchedCount === "number"
          ? result.fetchedCount
          : null;

  return {
    ok: valid,
    sourceId: id,
    message:
      typeof result?.message === "string" && result.message
        ? result.message
        : valid
          ? "Source responded with valid public job listings."
          : "Source validation did not return supported job listings.",
    sampleCount,
    detectedFormat:
      typeof result?.detectedFormat === "string"
        ? result.detectedFormat
        : typeof result?.format === "string"
          ? result.format
          : null,
    errorCode:
      typeof result?.errorCode === "string" ? result.errorCode : null,
  };
}

export async function runSourceScan(id: string): Promise<SourceRunTaskResponse> {
  const response = await fetch(`/api/sources/${encodeURIComponent(id)}/run`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to queue source scan (HTTP ${response.status}).`)
    );
  }

  const root = asRecord(data);
  const taskRec = asRecord(root?.task);
  const taskId =
    (typeof root?.taskId === "string" && root.taskId) ||
    (typeof taskRec?.id === "string" && taskRec.id) ||
    (typeof root?.id === "string" && root.id) ||
    "";
  const statusRaw =
    (typeof root?.status === "string" && root.status) ||
    (typeof taskRec?.status === "string" && taskRec.status) ||
    "queued";

  return {
    taskId,
    status: statusRaw as SourceRunTaskResponse["status"],
    sourceId: id,
    message: typeof root?.message === "string" ? root.message : null,
  };
}

export async function listSourceRuns(id: string): Promise<SourceRunItem[]> {
  const response = await fetch(`/api/sources/${encodeURIComponent(id)}/runs`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to load source runs (HTTP ${response.status}).`
      )
    );
  }

  const root = asRecord(data);
  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(root?.runs)
      ? root.runs
      : Array.isArray(root?.items)
        ? root.items
        : [];

  return rawList
    .map(normalizeSourceRun)
    .filter((item): item is SourceRunItem => item !== null);
}

export async function getTaskProgress(
  taskId: string,
  sourceId: string
): Promise<SourceTaskProgress | null> {
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await parseJsonSafe(response);
    const root = asRecord(data);
    const task = asRecord(root?.task) ?? root;
    if (!task || typeof task.status !== "string") return null;

    return {
      taskId,
      sourceId,
      status: task.status as SourceTaskProgress["status"],
      progressStage:
        typeof task.progressStage === "string" ? task.progressStage : null,
      progressPercent:
        typeof task.progressPercent === "number" ? task.progressPercent : null,
      errorMessage:
        typeof task.errorMessage === "string" ? task.errorMessage : null,
    };
  } catch {
    return null;
  }
}

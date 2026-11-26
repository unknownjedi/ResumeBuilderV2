import { analyzeJob } from "@/features/job-discovery/api";
import {
  asRecord,
  extractApiErrorMessage,
} from "@/features/job-discovery/types";
import { normalizeOverviewPayload, type OverviewPayload } from "./types";

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function getOverview(
  searchProfileId?: string | null
): Promise<OverviewPayload> {
  const qs = new URLSearchParams();
  if (searchProfileId) {
    qs.set("searchProfileId", searchProfileId);
  }
  const query = qs.toString();
  const response = await fetch(`/api/overview${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to load overview (HTTP ${response.status}).`
      )
    );
  }
  return normalizeOverviewPayload(data);
}

export async function analyzeTopCandidates(options: {
  searchProfileId?: string | null;
  candidateJobIds: string[];
  cap: number;
}): Promise<{ queuedCount: number; taskIds: string[] }> {
  const cap = Math.max(1, Math.min(options.cap || 10, 10));
  const body: Record<string, unknown> = { limit: cap };
  if (options.searchProfileId) {
    body.searchProfileId = options.searchProfileId;
  }
  if (options.candidateJobIds.length > 0) {
    body.jobIds = options.candidateJobIds.slice(0, cap);
  }

  const batchResponse = await fetch("/api/overview/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (batchResponse.status !== 404 && batchResponse.status !== 405) {
    const batchData = await parseJsonSafe(batchResponse);
    if (!batchResponse.ok) {
      throw new Error(
        extractApiErrorMessage(
          batchData,
          `Failed to analyze top candidates (HTTP ${batchResponse.status}).`
        )
      );
    }
    const root = asRecord(batchData);
    const taskIds = Array.isArray(root?.taskIds)
      ? root.taskIds.filter((id): id is string => typeof id === "string")
      : typeof root?.taskId === "string"
        ? [root.taskId]
        : [];
    const queuedCount =
      typeof root?.queuedCount === "number"
        ? root.queuedCount
        : taskIds.length || options.candidateJobIds.slice(0, cap).length;
    return { queuedCount, taskIds };
  }

  // Fallback: queue individual capped job analysis calls via /api/jobs/:id/analyze
  const targets = options.candidateJobIds.slice(0, cap);
  const taskIds: string[] = [];
  for (const jobId of targets) {
    const res = await analyzeJob(jobId, {
      searchProfileId: options.searchProfileId,
    });
    if (res.taskId) {
      taskIds.push(res.taskId);
    }
  }
  return { queuedCount: targets.length, taskIds };
}

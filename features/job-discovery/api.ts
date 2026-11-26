import {
  asRecord,
  extractApiErrorMessage,
  normalizeCompensationOverride,
  normalizeDuplicateCandidate,
  normalizeJobDetailItem,
  normalizeJobListItem,
  type CandidateResponse,
  type CompensationOverrideItem,
  type DuplicateCandidateItem,
  type ImportJobInput,
  type ImportJobResponse,
  type JobDetailItem,
  type JobListItem,
  type JobsListResponse,
  type ListJobsParams,
  type RequirementPriority,
  type SalaryPeriod,
  type SourceFilterOption,
  type UserJobDiscoveryState,
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

export async function listJobs(params: ListJobsParams = {}): Promise<JobsListResponse> {
  const qs = new URLSearchParams();
  if (params.q && params.q.trim()) qs.set("q", params.q.trim());
  if (params.state) qs.set("discoveryState", params.state);
  if (params.sourceId && params.sourceId !== "all") {
    qs.set("sourceId", params.sourceId);
  }
  if (params.workplaceType && params.workplaceType !== "all") {
    qs.set("workplaceType", params.workplaceType);
  }
  if (params.postedDate && params.postedDate !== "any") {
    const windowDays: Record<string, number> = {
      "24h": 1,
      "3d": 3,
      "7d": 7,
      "30d": 30,
    };
    const days = windowDays[params.postedDate];
    if (days) {
      qs.set(
        "postedSince",
        new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      );
    } else if (params.postedDate === "known_only") {
      qs.set("postedSince", "1970-01-01T00:00:00.000Z");
    }
  }
  if (params.sort) qs.set("sort", params.sort);
  if (params.searchProfileId) {
    qs.set("searchProfileId", params.searchProfileId);
  }
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (typeof params.offset === "number") qs.set("offset", String(params.offset));

  const query = qs.toString();
  const response = await fetch(`/api/jobs${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to load jobs (HTTP ${response.status}).`)
    );
  }

  const root = asRecord(data);
  const rawItems = Array.isArray(data)
    ? data
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(root?.jobs)
        ? root.jobs
        : [];

  const items = rawItems
    .map(normalizeJobListItem)
    .filter((item): item is JobListItem => item !== null);

  const rawSources = Array.isArray(root?.sources) ? root.sources : [];
  const sources: SourceFilterOption[] = rawSources
    .map((s) => {
      const r = asRecord(s);
      if (!r || typeof r.id !== "string") return null;
      return {
        id: r.id,
        displayName:
          typeof r.displayName === "string"
            ? r.displayName
            : typeof r.name === "string"
              ? r.name
              : r.id,
        sourceType: typeof r.sourceType === "string" ? r.sourceType : "manual",
      };
    })
    .filter((s): s is SourceFilterOption => s !== null);

  return {
    items,
    total: typeof root?.total === "number" ? root.total : items.length,
    pendingDuplicateCount:
      typeof root?.pendingDuplicateCount === "number"
        ? root.pendingDuplicateCount
        : items.filter((i) => i.hasDuplicateCandidates).length,
    sources,
  };
}

export async function getJobDetail(
  id: string,
  searchProfileId?: string | null
): Promise<JobDetailItem> {
  const qs = new URLSearchParams();
  if (searchProfileId) qs.set("searchProfileId", searchProfileId);
  const query = qs.toString();

  const response = await fetch(
    `/api/jobs/${encodeURIComponent(id)}${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to load job details (HTTP ${response.status}).`)
    );
  }

  const normalized = normalizeJobDetailItem(data);
  if (!normalized) {
    throw new Error("Server returned an unexpected job detail payload.");
  }
  return normalized;
}

export async function importManualJob(
  input: ImportJobInput
): Promise<ImportJobResponse> {
  const payload: Record<string, unknown> = {};
  if (input.url?.trim()) payload.url = input.url.trim();
  if (input.descriptionText?.trim()) {
    payload.descriptionText = input.descriptionText.trim();
  }
  if (input.title?.trim()) payload.title = input.title.trim();
  if (input.companyName?.trim()) payload.companyName = input.companyName.trim();
  if (input.locationText?.trim()) payload.locationText = input.locationText.trim();
  if (input.workplaceType && input.workplaceType !== "unspecified") {
    payload.workplaceType = input.workplaceType;
  }
  if (input.employmentType?.trim()) {
    payload.employmentType = input.employmentType.trim();
  }

  const response = await fetch("/api/jobs/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to import job (HTTP ${response.status}).`)
    );
  }

  const root = asRecord(data);
  const job = normalizeJobDetailItem(data);
  if (!job) {
    throw new Error("Server returned an unexpected job import payload.");
  }

  const rawDups = Array.isArray(root?.duplicateCandidates)
    ? root.duplicateCandidates
    : [];
  const duplicateCandidates = rawDups
    .map(normalizeDuplicateCandidate)
    .filter((d): d is DuplicateCandidateItem => d !== null);

  return {
    job,
    duplicateCandidates,
    created: typeof root?.created === "boolean" ? root.created : true,
  };
}

export async function updateJobDiscoveryState(
  id: string,
  state: UserJobDiscoveryState | "active" | null,
  options?: { searchProfileId?: string | null; notes?: string }
): Promise<{ state: UserJobDiscoveryState | null }> {
  const nextState: UserJobDiscoveryState | "active" = state ?? "active";
  const body: Record<string, unknown> = { state: nextState };
  if (options?.searchProfileId) {
    body.searchProfileId = options.searchProfileId;
  }
  if (options?.notes !== undefined) {
    body.notes = options.notes;
  }

  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to update job state (HTTP ${response.status}).`)
    );
  }

  const root = asRecord(data);
  const rawReturned =
    typeof root?.state === "string"
      ? root.state
      : typeof root?.discoveryState === "string"
        ? root.discoveryState
        : nextState;

  return {
    state: rawReturned === "active" ? null : (rawReturned as UserJobDiscoveryState),
  };
}

export async function listDuplicateCandidates(
  state: "proposed" | "dismissed" | "merged" | "all" = "proposed"
): Promise<DuplicateCandidateItem[]> {
  const response = await fetch(
    `/api/duplicates?state=${encodeURIComponent(state)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to load duplicate candidates (HTTP ${response.status}).`
      )
    );
  }

  const root = asRecord(data);
  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(root?.candidates)
      ? root.candidates
      : Array.isArray(root?.duplicates)
        ? root.duplicates
        : Array.isArray(root?.items)
          ? root.items
          : [];

  return rawList
    .map(normalizeDuplicateCandidate)
    .filter((item): item is DuplicateCandidateItem => item !== null);
}

export async function mergeDuplicateCandidate(
  candidateId: string,
  keepJobId?: string
): Promise<{ canonicalJobId: string | null }> {
  const response = await fetch(
    `/api/duplicates/${encodeURIComponent(candidateId)}/merge`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(keepJobId ? { keepJobId } : {}),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to merge duplicate jobs (HTTP ${response.status}).`
      )
    );
  }

  const root = asRecord(data);
  return {
    canonicalJobId:
      typeof root?.canonicalJobId === "string" ? root.canonicalJobId : null,
  };
}

export async function dismissDuplicateCandidate(
  candidateId: string
): Promise<void> {
  const response = await fetch(
    `/api/duplicates/${encodeURIComponent(candidateId)}/dismiss`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to dismiss duplicate suggestion (HTTP ${response.status}).`
      )
    );
  }
}

export async function analyzeJob(
  jobId: string,
  options?: {
    searchProfileId?: string | null;
    mode?: "auto_or_ai" | "ai_required" | "deterministic";
    recomputeMatches?: boolean;
  }
): Promise<{
  taskId: string | null;
  status: string | null;
  deduplicated: boolean;
}> {
  const body: Record<string, unknown> = {};
  if (options?.searchProfileId) body.searchProfileId = options.searchProfileId;
  if (options?.mode) body.mode = options.mode;
  if (options?.recomputeMatches !== undefined) {
    body.recomputeMatches = options.recomputeMatches;
  }

  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(data, `Failed to analyze job (HTTP ${response.status}).`)
    );
  }

  const root = asRecord(data);
  const taskRec = asRecord(root?.task);
  return {
    taskId:
      (typeof root?.taskId === "string" ? root.taskId : null) ??
      (typeof taskRec?.id === "string" ? taskRec.id : null),
    status:
      (typeof root?.status === "string" ? root.status : null) ??
      (typeof taskRec?.status === "string" ? taskRec.status : null),
    deduplicated: Boolean(root?.deduplicated),
  };
}

export async function recomputeJobMatch(
  jobId: string,
  searchProfileId: string
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/match`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ searchProfileId }),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to recompute match (HTTP ${response.status}).`
      )
    );
  }
  return asRecord(data) ?? {};
}

export interface UpdateJobRequirementPayload {
  candidateResponse?: CandidateResponse;
  userPriorityOverride?: RequirementPriority | null;
  overrideState?: "active" | "orphaned";
  evidenceLinkIds?: string[];
  recomputeMatches?: boolean;
}

export async function updateJobRequirement(
  jobId: string,
  requirementId: string,
  payload: UpdateJobRequirementPayload
): Promise<Record<string, unknown>> {
  const cleanBody: Record<string, unknown> = {};
  if (payload.candidateResponse !== undefined) {
    cleanBody.candidateResponse = payload.candidateResponse;
  }
  if (payload.userPriorityOverride !== undefined) {
    cleanBody.userPriorityOverride = payload.userPriorityOverride;
  }
  if (payload.overrideState !== undefined) {
    cleanBody.overrideState = payload.overrideState;
  }
  if (payload.evidenceLinkIds && payload.evidenceLinkIds.length > 0) {
    cleanBody.evidenceLinkIds = payload.evidenceLinkIds;
  }
  if (payload.recomputeMatches !== undefined) {
    cleanBody.recomputeMatches = payload.recomputeMatches;
  }

  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/requirements/${encodeURIComponent(requirementId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(cleanBody),
    }
  );
  const data = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to update requirement (HTTP ${response.status}).`
      )
    );
  }
  return asRecord(data) ?? {};
}

export interface UpsertCompensationOverridePayload {
  minAmount: number | null;
  maxAmount: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
  note?: string | null;
}

export async function upsertCompensationOverride(
  jobId: string,
  payload: UpsertCompensationOverridePayload
): Promise<CompensationOverrideItem | null> {
  const cleanBody: Record<string, unknown> = {
    minAmount: payload.minAmount,
    maxAmount: payload.maxAmount,
    currency: payload.currency,
    period: payload.period,
    note: payload.note ?? null,
  };
  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/compensation-override`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(cleanBody),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to save compensation override (HTTP ${response.status}).`
      )
    );
  }
  const root = asRecord(data);
  return normalizeCompensationOverride(
    root?.compensationOverride ?? root?.override ?? data
  );
}

export async function deleteCompensationOverride(jobId: string): Promise<void> {
  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/compensation-override`,
    {
      method: "DELETE",
      headers: { Accept: "application/json" },
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to remove compensation override (HTTP ${response.status}).`
      )
    );
  }
}

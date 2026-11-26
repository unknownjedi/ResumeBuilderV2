import type { EvidenceTargetType, VerificationStatus } from "@/features/career-profile/types";
import {
  asRecord,
  normalizeDocumentExport,
  normalizeResumeDraftDetail,
  normalizeResumeDraftSummary,
  normalizeResumeVersion,
  type DocumentExportRecord,
  type ExportFormat,
  type ResumeDraftDetail,
  type ResumeDraftState,
  type ResumeDraftSummary,
  type ResumeTemplateSettings,
  type ResumeVersionRecord,
  type StructuredResumeContent,
  type UserEditedState,
} from "./types";

export class ResumeApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "ResumeApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildApiError(data: unknown, status: number, fallback: string): ResumeApiError {
  if (typeof data === "string" && data.trim()) {
    return new ResumeApiError(data.trim(), status);
  }
  const obj = asRecord(data);
  if (!obj) {
    return new ResumeApiError(fallback, status);
  }
  const errObj = asRecord(obj.error);
  const code =
    (typeof errObj?.code === "string" ? errObj.code : null) ??
    (typeof obj.code === "string" ? obj.code : null);
  const message =
    (typeof errObj?.message === "string" ? errObj.message : null) ??
    (typeof obj.message === "string" ? obj.message : null) ??
    (typeof obj.error === "string" ? obj.error : null) ??
    fallback;
  const details = asRecord(errObj?.details) ?? asRecord(obj.details);
  return new ResumeApiError(message, status, code, details);
}

export async function tailorResumeForJob(
  jobId: string,
  input: { searchProfileId?: string; emphasizeFactIds?: string[] } = {}
): Promise<ResumeDraftDetail> {
  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/tailor-resume`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildApiError(
      data,
      response.status,
      `Failed to generate tailored resume (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const draft = normalizeResumeDraftDetail(root?.draft ?? root);
  if (!draft) {
    throw new ResumeApiError(
      "Server returned an invalid resume draft payload.",
      response.status
    );
  }
  return draft;
}

export async function listResumes(params: {
  jobId?: string;
  searchProfileId?: string;
} = {}): Promise<ResumeDraftSummary[]> {
  const qs = new URLSearchParams();
  if (params.jobId) qs.set("jobId", params.jobId);
  if (params.searchProfileId) qs.set("searchProfileId", params.searchProfileId);
  const query = qs.toString();

  const response = await fetch(`/api/resumes${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildApiError(
      data,
      response.status,
      `Failed to load resume drafts (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const rawList = Array.isArray(root?.drafts)
    ? root.drafts
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(data)
        ? data
        : [];
  return rawList
    .map(normalizeResumeDraftSummary)
    .filter((d): d is ResumeDraftSummary => d !== null);
}

export async function getResumeDraft(id: string): Promise<ResumeDraftDetail> {
  const response = await fetch(`/api/resumes/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildApiError(
      data,
      response.status,
      `Failed to load resume draft (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const draft = normalizeResumeDraftDetail(root?.draft ?? root);
  if (!draft) {
    throw new ResumeApiError(
      "Resume draft response could not be parsed.",
      response.status
    );
  }
  return draft;
}

export async function updateResumeDraft(
  id: string,
  patch: {
    structuredContent?: StructuredResumeContent;
    templateSettings?: ResumeTemplateSettings;
    state?: ResumeDraftState;
  }
): Promise<ResumeDraftDetail> {
  const response = await fetch(`/api/resumes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(patch),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildApiError(
      data,
      response.status,
      `Failed to save resume draft (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const draft = normalizeResumeDraftDetail(root?.draft ?? root);
  if (!draft) {
    throw new ResumeApiError(
      "Updated resume draft response could not be parsed.",
      response.status
    );
  }
  return draft;
}

export async function deleteResumeDraft(id: string): Promise<void> {
  const response = await fetch(`/api/resumes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildApiError(
      data,
      response.status,
      `Failed to delete resume draft (HTTP ${response.status}).`
    );
  }
}

export async function updateResumeClaim(
  draftId: string,
  claimId: string,
  patch: {
    text?: string;
    verificationStatus?: VerificationStatus;
    userEditedState?: UserEditedState;
    evidenceRefs?: Array<{
      factType: EvidenceTargetType;
      factId: string;
      excerpt?: string | null;
      evidenceLinkId?: string | null;
    }>;
  }
): Promise<ResumeDraftDetail> {
  const response = await fetch(
    `/api/resumes/${encodeURIComponent(draftId)}/claims/${encodeURIComponent(claimId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(patch),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildApiError(
      data,
      response.status,
      `Failed to update resume claim (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const draft = normalizeResumeDraftDetail(root?.draft ?? root);
  if (!draft) {
    throw new ResumeApiError(
      "Updated resume claim response could not be parsed.",
      response.status
    );
  }
  return draft;
}

export async function createResumeVersion(draftId: string): Promise<{
  version: ResumeVersionRecord | null;
  versions: ResumeVersionRecord[];
}> {
  const response = await fetch(
    `/api/resumes/${encodeURIComponent(draftId)}/versions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({}),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildApiError(
      data,
      response.status,
      `Failed to create resume version (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const version = normalizeResumeVersion(root?.version);
  const versions = Array.isArray(root?.versions)
    ? root.versions
        .map(normalizeResumeVersion)
        .filter((v): v is ResumeVersionRecord => v !== null)
    : version
      ? [version]
      : [];
  return { version, versions };
}

export interface ExportResumeResult {
  exportRecord: DocumentExportRecord | null;
  version: ResumeVersionRecord | null;
  downloadUrl: string | null;
}

export async function exportResumeDraft(
  draftId: string,
  format: ExportFormat
): Promise<ExportResumeResult> {
  const response = await fetch(
    `/api/resumes/${encodeURIComponent(draftId)}/export`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ format }),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildApiError(
      data,
      response.status,
      `Failed to export resume as ${format.toUpperCase()} (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const exportRecord = normalizeDocumentExport(root?.exportRecord ?? root?.export);
  const version = normalizeResumeVersion(root?.version);
  const downloadUrl =
    (typeof root?.downloadUrl === "string" ? root.downloadUrl : null) ??
    exportRecord?.downloadUrl ??
    null;
  return { exportRecord, version, downloadUrl };
}

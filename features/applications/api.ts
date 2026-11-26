import { ResumeApiError } from "@/features/resume-builder/api";
import {
  asRecord,
  normalizeDocumentExport,
  type DocumentExportRecord,
  type ExportFormat,
  type UserEditedState,
} from "@/features/resume-builder/types";
import {
  normalizeApplicationAnswer,
  normalizeApplicationRecord,
  normalizeCoverLetter,
  type ApplicationAnswerRecord,
  type ApplicationRecord,
  type ApplicationStatus,
  type CoverLetterLength,
  type CoverLetterRecord,
  type CoverLetterStructuredContent,
  type CoverLetterTone,
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

function buildError(data: unknown, status: number, fallback: string): ResumeApiError {
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

export async function listApplications(params: {
  status?: ApplicationStatus | "all";
  searchProfileId?: string;
} = {}): Promise<ApplicationRecord[]> {
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") {
    qs.set("status", params.status);
  }
  if (params.searchProfileId) {
    qs.set("searchProfileId", params.searchProfileId);
  }
  const query = qs.toString();

  const response = await fetch(`/api/applications${query ? `?${query}` : ""}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildError(
      data,
      response.status,
      `Failed to load applications (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const rawList = Array.isArray(root?.applications)
    ? root.applications
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(data)
        ? data
        : [];
  return rawList
    .map(normalizeApplicationRecord)
    .filter((a): a is ApplicationRecord => a !== null);
}

export async function createOrEnsureApplication(input: {
  jobId: string;
  searchProfileId?: string | null;
  resumeVersionId?: string | null;
  originalApplyUrl?: string | null;
  notes?: string | null;
}): Promise<ApplicationRecord> {
  const response = await fetch("/api/applications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(input),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildError(
      data,
      response.status,
      `Failed to prepare application (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const app = normalizeApplicationRecord(root?.application ?? root);
  if (!app) {
    throw new ResumeApiError(
      "Server returned an invalid application record.",
      response.status
    );
  }
  return app;
}

export async function updateApplication(
  id: string,
  patch: {
    resumeVersionId?: string | null;
    originalApplyUrl?: string | null;
    notes?: string | null;
  }
): Promise<ApplicationRecord> {
  const response = await fetch(`/api/applications/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(patch),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildError(
      data,
      response.status,
      `Failed to update application (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const app = normalizeApplicationRecord(root?.application ?? root);
  if (!app) {
    throw new ResumeApiError(
      "Updated application response could not be parsed.",
      response.status
    );
  }
  return app;
}

export async function transitionApplicationStatus(
  id: string,
  body: {
    status: ApplicationStatus;
    note?: string | null;
    appliedAt?: string;
    confirmSubmission?: boolean;
    resumeVersionId?: string | null;
    coverLetterId?: string | null;
    answerIds?: string[];
  }
): Promise<ApplicationRecord> {
  const response = await fetch(
    `/api/applications/${encodeURIComponent(id)}/status`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildError(
      data,
      response.status,
      `Failed to update application status (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const app = normalizeApplicationRecord(root?.application ?? root);
  if (!app) {
    throw new ResumeApiError(
      "Application status response could not be parsed.",
      response.status
    );
  }
  return app;
}

export async function generateCoverLetter(
  jobId: string,
  body: {
    searchProfileId?: string | null;
    applicationId?: string | null;
    tone?: CoverLetterTone;
    length?: CoverLetterLength;
  } = {}
): Promise<CoverLetterRecord> {
  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/cover-letter`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildError(
      data,
      response.status,
      `Failed to generate cover letter (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const coverLetter = normalizeCoverLetter(root?.coverLetter ?? root);
  if (!coverLetter) {
    throw new ResumeApiError(
      "Server returned an invalid cover letter payload.",
      response.status
    );
  }
  return coverLetter;
}

export async function updateCoverLetter(
  id: string,
  patch: {
    structuredContent?: CoverLetterStructuredContent;
    text?: string;
    userEditedState?: UserEditedState;
  }
): Promise<CoverLetterRecord> {
  const response = await fetch(
    `/api/cover-letters/${encodeURIComponent(id)}`,
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
    throw buildError(
      data,
      response.status,
      `Failed to save cover letter (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const coverLetter = normalizeCoverLetter(root?.coverLetter ?? root);
  if (!coverLetter) {
    throw new ResumeApiError(
      "Updated cover letter payload could not be parsed.",
      response.status
    );
  }
  return coverLetter;
}

export async function exportCoverLetter(
  id: string,
  format: ExportFormat
): Promise<{
  exportRecord: DocumentExportRecord | null;
  downloadUrl: string | null;
}> {
  const response = await fetch(
    `/api/cover-letters/${encodeURIComponent(id)}/export`,
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
    throw buildError(
      data,
      response.status,
      `Failed to export cover letter as ${format.toUpperCase()} (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const exportRecord = normalizeDocumentExport(root?.exportRecord ?? root?.export);
  const downloadUrl =
    (typeof root?.downloadUrl === "string" ? root.downloadUrl : null) ??
    exportRecord?.downloadUrl ??
    null;
  return { exportRecord, downloadUrl };
}

export async function generateApplicationAnswers(
  jobId: string,
  body: {
    searchProfileId?: string | null;
    applicationId?: string | null;
    promptKeys?: string[];
    customPrompt?: string;
  }
): Promise<ApplicationAnswerRecord[]> {
  const response = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/application-answers`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildError(
      data,
      response.status,
      `Failed to generate application answers (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const rawList = Array.isArray(root?.answers)
    ? root.answers
    : root?.answer
      ? [root.answer]
      : Array.isArray(data)
        ? data
        : [];
  return rawList
    .map(normalizeApplicationAnswer)
    .filter((a): a is ApplicationAnswerRecord => a !== null);
}

export async function updateApplicationAnswer(
  id: string,
  patch: {
    answerText?: string;
    promptText?: string;
    userEditedState?: UserEditedState;
  }
): Promise<ApplicationAnswerRecord> {
  const response = await fetch(
    `/api/application-answers/${encodeURIComponent(id)}`,
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
    throw buildError(
      data,
      response.status,
      `Failed to save application answer (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const answer = normalizeApplicationAnswer(root?.answer ?? root);
  if (!answer) {
    throw new ResumeApiError(
      "Updated application answer response could not be parsed.",
      response.status
    );
  }
  return answer;
}

export async function exportApplicationAnswers(body: {
  answerIds: string[];
  format: "txt" | "md";
}): Promise<{
  exportRecord: DocumentExportRecord | null;
  downloadUrl: string | null;
}> {
  const response = await fetch("/api/application-answers/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw buildError(
      data,
      response.status,
      `Failed to export application answers (HTTP ${response.status}).`
    );
  }
  const root = asRecord(data);
  const exportRecord = normalizeDocumentExport(root?.exportRecord ?? root?.export);
  const downloadUrl =
    (typeof root?.downloadUrl === "string" ? root.downloadUrl : null) ??
    exportRecord?.downloadUrl ??
    null;
  return { exportRecord, downloadUrl };
}

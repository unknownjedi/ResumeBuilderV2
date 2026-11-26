import {
  extractApiError,
  normalizeCareerProfilePayload,
  normalizeSourceDocument,
  type CareerProfilePayload,
  type ImportResumeResponse,
  type ProfileEntityRoute,
  type SourceDocumentDetailResponse,
  type VerificationStatus,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const SINGULAR_ENTITY_ROUTE: Record<ProfileEntityRoute | "profile", string> = {
  profile: "profile",
  experiences: "experience",
  projects: "project",
  achievements: "achievement",
  skills: "skill",
  education: "education",
  certifications: "certification",
  languages: "language",
};

export async function getCareerProfile(): Promise<CareerProfilePayload> {
  const response = await fetch("/api/profile?includeRejected=true", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiError(data, `Failed to load career profile (HTTP ${response.status}).`)
    );
  }
  return normalizeCareerProfilePayload(data);
}

export async function saveProfileHeader(
  payload: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch("/api/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiError(data, `Failed to save profile details (HTTP ${response.status}).`)
    );
  }
  return data;
}

export async function importResumeFile(
  file: File,
  useAi: boolean
): Promise<ImportResumeResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("useAi", useAi ? "true" : "false");

  const response = await fetch("/api/profile/import", {
    method: "POST",
    body: formData,
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiError(data, `Resume import failed (HTTP ${response.status}).`)
    );
  }

  const root = asRecord(data) ?? {};
  const sourceDocument = normalizeSourceDocument(root.sourceDocument);
  const extractedText =
    typeof root.extractedText === "string" ? root.extractedText : "";
  const extractionStatus =
    typeof root.extractionStatus === "string"
      ? (root.extractionStatus as ImportResumeResponse["extractionStatus"])
      : sourceDocument.extractionStatus;
  const aiStatus = typeof root.aiStatus === "string" ? root.aiStatus : null;
  const aiError = typeof root.aiError === "string" ? root.aiError : null;

  const createdCounts: Record<string, number> = {};
  const countsRec = asRecord(root.createdCounts);
  if (countsRec) {
    for (const [key, val] of Object.entries(countsRec)) {
      if (typeof val === "number" && Number.isFinite(val)) {
        createdCounts[key] = val;
      }
    }
  }

  const suggestionsRec = asRecord(root.profileSuggestions);
  const parseSuggestion = (key: string) => {
    const s = asRecord(suggestionsRec?.[key]);
    if (!s || typeof s.value !== "string" || !s.value.trim()) return null;
    return {
      value: s.value,
      excerpt: typeof s.excerpt === "string" ? s.excerpt : null,
      confidence: typeof s.confidence === "number" ? s.confidence : null,
    };
  };

  const profileSuggestions = suggestionsRec
    ? {
        headline: parseSuggestion("headline"),
        summary: parseSuggestion("summary"),
        location: parseSuggestion("location"),
      }
    : null;

  return {
    sourceDocument,
    extractedText,
    extractionStatus,
    aiStatus,
    createdCounts,
    profileSuggestions,
    aiError,
  };
}

export async function getSourceDocument(
  id: string
): Promise<SourceDocumentDetailResponse> {
  const response = await fetch(
    `/api/profile/source-documents/${encodeURIComponent(id)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiError(data, `Failed to load source document (HTTP ${response.status}).`)
    );
  }
  const root = asRecord(data) ?? {};
  const docRec = asRecord(root.sourceDocument);
  const extractedText =
    typeof root.extractedText === "string"
      ? root.extractedText
      : typeof docRec?.extractedText === "string"
        ? docRec.extractedText
        : "";
  return {
    sourceDocument: normalizeSourceDocument(root.sourceDocument),
    extractedText,
  };
}

export async function deleteSourceDocument(id: string): Promise<void> {
  const response = await fetch(
    `/api/profile/source-documents/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { Accept: "application/json" },
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiError(data, `Failed to delete document (HTTP ${response.status}).`)
    );
  }
}

export async function createProfileEntity(
  entity: ProfileEntityRoute | "evidence-links",
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/profile/${entity}`, {
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
      extractApiError(data, `Failed to create ${entity} record (HTTP ${response.status}).`)
    );
  }
  return asRecord(data) ?? {};
}

export async function updateProfileEntity(
  entity: ProfileEntityRoute | "evidence-links",
  id: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `/api/profile/${entity}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiError(data, `Failed to update ${entity} record (HTTP ${response.status}).`)
    );
  }
  return asRecord(data) ?? {};
}

export async function deleteProfileEntity(
  entity: ProfileEntityRoute | "evidence-links",
  id: string
): Promise<void> {
  const response = await fetch(
    `/api/profile/${entity}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { Accept: "application/json" },
    }
  );

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiError(data, `Failed to delete ${entity} record (HTTP ${response.status}).`)
    );
  }
}

export async function setEntityVerification(
  entity: ProfileEntityRoute | "profile",
  id: string,
  verificationStatus: VerificationStatus
): Promise<void> {
  const body = JSON.stringify({ verificationStatus });
  let response = await fetch(
    `/api/profile/${entity}/${encodeURIComponent(id)}/verification`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    }
  );

  const singular = SINGULAR_ENTITY_ROUTE[entity];
  if ((response.status === 404 || response.status === 400) && singular !== entity) {
    const firstData = await parseJsonSafe(response);
    if (response.status === 404) {
      response = await fetch(
        `/api/profile/${singular}/${encodeURIComponent(id)}/verification`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
        }
      );
    } else {
      throw new Error(
        extractApiError(
          firstData,
          `Failed to update verification status (HTTP ${response.status}).`
        )
      );
    }
  }

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiError(
        data,
        `Failed to update verification status (HTTP ${response.status}).`
      )
    );
  }
}

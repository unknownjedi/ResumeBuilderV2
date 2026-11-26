import {
  ConnectorError,
  type FetchBatch,
  type JobSourceConnector,
  type NormalizedJob,
  type SourceConfig,
  type ValidationResult,
} from "../types";
import {
  decodeHtmlEntities,
  extractRawItems,
  fetchPublicWithConditional,
  inferCountryCode,
  isRecord,
  nonEmptyString,
  normalizeDescription,
  normalizeWorkplaceType,
  parseIso8601Date,
  safeCanonicalUrl,
  throwIfHttpErrorStatus,
  validateStaticOrConfiguredUrl,
} from "../utils";

const BOARD_TOKEN_RE = /^[a-zA-Z0-9_-]+$/;
const GREENHOUSE_HOST_RE = /^(?:boards|job-boards(?:\.eu)?)\.greenhouse\.io$/;

/**
 * Extracts a Greenhouse board token from either a raw token or a public Greenhouse URL
 * (`boards.greenhouse.io/<token>`, `job-boards.greenhouse.io/<token>`, or `boards-api.greenhouse.io/v1/boards/<token>`).
 */
export function parseGreenhouseBoardToken(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Greenhouse board token or board URL is required.",
      { retryable: false }
    );
  }

  if (!trimmed.includes("://") && !trimmed.includes("/")) {
    if (!BOARD_TOKEN_RE.test(trimmed)) {
      throw new ConnectorError(
        "INVALID_CONFIG",
        "Greenhouse board token may only contain letters, numbers, hyphens, and underscores.",
        { retryable: false }
      );
    }
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch (err) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Invalid Greenhouse board URL.",
      { retryable: false, cause: err }
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Greenhouse board URL must use http or https.",
      { retryable: false }
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  let token: string | null = null;
  if (hostname === "boards-api.greenhouse.io") {
    if (segments[0] === "v1" && segments[1] === "boards" && segments[2]) {
      token = segments[2];
    }
  } else if (GREENHOUSE_HOST_RE.test(hostname)) {
    if (segments[0] === "embed" && segments[1] === "job_board") {
      token = nonEmptyString(parsed.searchParams.get("for"));
    } else if (segments[0]) {
      token = segments[0];
    }
  } else {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "URL must point to boards.greenhouse.io, job-boards.greenhouse.io, or boards-api.greenhouse.io.",
      { retryable: false }
    );
  }

  if (!token || !BOARD_TOKEN_RE.test(token)) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Could not extract a valid Greenhouse board token from URL.",
      { retryable: false }
    );
  }

  return token;
}

function resolveGreenhouseToken(config: SourceConfig): string {
  const candidate =
    nonEmptyString(config.sourceIdentifier) ?? nonEmptyString(config.baseUrl);
  if (!candidate) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Greenhouse source requires sourceIdentifier or baseUrl.",
      { retryable: false }
    );
  }
  return parseGreenhouseBoardToken(candidate);
}

function buildGreenhouseApiUrl(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
}

function readMetadataValue(
  metadata: unknown,
  matchNames: string[]
): string | null {
  if (!Array.isArray(metadata)) return null;
  for (const entry of metadata) {
    if (!isRecord(entry)) continue;
    const name = nonEmptyString(entry.name)?.toLowerCase();
    if (!name || !matchNames.some((candidate) => name.includes(candidate))) {
      continue;
    }
    if (typeof entry.value === "string") {
      const val = nonEmptyString(entry.value);
      if (val) return val;
    } else if (Array.isArray(entry.value)) {
      const firstStr = entry.value.find((item) => typeof item === "string");
      const val = nonEmptyString(firstStr);
      if (val) return val;
    }
  }
  return null;
}

export const greenhouseConnector: JobSourceConnector = {
  async validate(config: SourceConfig): Promise<ValidationResult> {
    try {
      const token = resolveGreenhouseToken(config);
      const apiUrl = buildGreenhouseApiUrl(token);
      await validateStaticOrConfiguredUrl(apiUrl, config);
      return {
        valid: true,
        normalizedIdentifier: token,
        normalizedBaseUrl: `https://boards.greenhouse.io/${token}`,
      };
    } catch (err) {
      if (err instanceof ConnectorError) {
        return {
          valid: false,
          errorCode: err.code,
          errorMessage: err.message,
        };
      }
      throw err;
    }
  },

  async fetch(config: SourceConfig): Promise<FetchBatch> {
    const token = resolveGreenhouseToken(config);
    const apiUrl = buildGreenhouseApiUrl(token);
    const fetchedAt = new Date().toISOString();

    const response = await fetchPublicWithConditional(apiUrl, config, {
      accept: "application/json",
    });

    if (response.status === 304) {
      return {
        jobs: [],
        isCompleteSnapshot: false,
        notModified: true,
        fetchedAt,
        sourceEtag: response.headers.get("etag") ?? config.lastEtag ?? undefined,
        sourceLastModified:
          response.headers.get("last-modified") ?? config.lastModified ?? undefined,
      };
    }

    throwIfHttpErrorStatus(response.status, "Greenhouse board");

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text());
    } catch (err) {
      throw new ConnectorError(
        "MALFORMED_RESPONSE",
        "Greenhouse API returned invalid JSON.",
        { retryable: false, httpStatus: response.status, cause: err }
      );
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.jobs)) {
      throw new ConnectorError(
        "MALFORMED_RESPONSE",
        "Greenhouse API response is missing a jobs array.",
        { retryable: false, httpStatus: response.status }
      );
    }

    return {
      jobs: parsed.jobs,
      isCompleteSnapshot: true,
      fetchedAt,
      sourceEtag: response.headers.get("etag") ?? undefined,
      sourceLastModified: response.headers.get("last-modified") ?? undefined,
    };
  },

  normalize(raw: unknown, config: SourceConfig): NormalizedJob[] {
    const items = extractRawItems(raw, "jobs");
    let fallbackToken = "";
    try {
      fallbackToken = resolveGreenhouseToken(config);
    } catch {
      fallbackToken = nonEmptyString(config.sourceIdentifier) ?? "";
    }

    const defaultCompany =
      nonEmptyString(config.companyName) ??
      nonEmptyString(config.displayName) ??
      (fallbackToken || "Unknown Company");

    return items.map((item) => {
      if (!isRecord(item)) {
        throw new ConnectorError(
          "MALFORMED_RESPONSE",
          "Greenhouse job item must be an object.",
          { retryable: false }
        );
      }

      const rawId = item.id;
      const externalId =
        typeof rawId === "number" && Number.isFinite(rawId)
          ? String(rawId)
          : nonEmptyString(rawId);

      const title = nonEmptyString(item.title);
      if (!externalId || !title) {
        throw new ConnectorError(
          "MALFORMED_RESPONSE",
          "Greenhouse job item is missing required id or title.",
          { retryable: false }
        );
      }

      const companyName =
        nonEmptyString(item.company_name) ?? defaultCompany;

      const rawContent = nonEmptyString(item.content);
      const decodedHtml = rawContent ? decodeHtmlEntities(rawContent) : null;
      const { descriptionText, descriptionHtmlSanitized } = normalizeDescription(
        decodedHtml,
        null
      );

      const locationText = isRecord(item.location)
        ? nonEmptyString(item.location.name)
        : nonEmptyString(item.location);

      const metadataWorkplace = readMetadataValue(item.metadata, [
        "workplace",
        "remote",
        "work location",
        "location type",
      ]);
      const workplaceType = normalizeWorkplaceType(
        metadataWorkplace,
        locationText
      );

      const employmentType = readMetadataValue(item.metadata, [
        "employment type",
        "job type",
        "commitment",
      ]);

      // Strictly map first_published -> employerPostedAt; never substitute updated_at.
      const employerPostedAt = parseIso8601Date(item.first_published);
      const sourceUpdatedAt = parseIso8601Date(item.updated_at);

      const canonicalUrl = safeCanonicalUrl(item.absolute_url);

      return {
        externalId,
        title,
        companyName,
        descriptionText,
        descriptionHtmlSanitized,
        locationText,
        countryCode: inferCountryCode(locationText),
        workplaceType,
        employmentType,
        seniorityMin: null,
        seniorityMax: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salarySourceType: null,
        employerPostedAt,
        sourceUpdatedAt,
        canonicalUrl,
        applyUrl: canonicalUrl,
        rawMetadata: {
          sourceType: "greenhouse",
          boardToken: fallbackToken || null,
          internalJobId: item.internal_job_id ?? null,
          requisitionId: item.requisition_id ?? null,
          firstPublished: item.first_published ?? null,
          updatedAt: item.updated_at ?? null,
          departments: Array.isArray(item.departments) ? item.departments : [],
          offices: Array.isArray(item.offices) ? item.offices : [],
          absoluteUrl: item.absolute_url ?? null,
        },
      };
    });
  },
};

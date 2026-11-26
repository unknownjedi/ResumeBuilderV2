import {
  ConnectorError,
  type FetchBatch,
  type JobSourceConnector,
  type NormalizedJob,
  type SalaryPeriod,
  type SalarySourceType,
  type SourceConfig,
  type ValidationResult,
  type WorkplaceType,
} from "../types";
import {
  extractRawItems,
  fetchPublicWithConditional,
  inferCountryCode,
  isRecord,
  nonEmptyString,
  normalizeDescription,
  normalizeSalaryPeriod,
  normalizeWorkplaceType,
  parseIso8601Date,
  safeCanonicalUrl,
  stableHashId,
  throwIfHttpErrorStatus,
  validateStaticOrConfiguredUrl,
} from "../utils";

const ASHBY_BOARD_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Extracts an Ashby board name from either a raw board name or a public Ashby URL
 * (`jobs.ashbyhq.com/<board>` or `api.ashbyhq.com/posting-api/job-board/<board>`).
 */
export function parseAshbyBoardName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Ashby board name or URL is required.",
      { retryable: false }
    );
  }

  if (!trimmed.includes("://") && !trimmed.includes("/")) {
    if (!ASHBY_BOARD_RE.test(trimmed)) {
      throw new ConnectorError(
        "INVALID_CONFIG",
        "Ashby board name contains invalid characters.",
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
      "Invalid Ashby board URL.",
      { retryable: false, cause: err }
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Ashby board URL must use http or https.",
      { retryable: false }
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  let board: string | null = null;
  if (hostname === "api.ashbyhq.com") {
    if (
      segments[0] === "posting-api" &&
      segments[1] === "job-board" &&
      segments[2]
    ) {
      board = decodeURIComponent(segments[2]);
    }
  } else if (hostname === "jobs.ashbyhq.com") {
    if (segments[0]) {
      board = decodeURIComponent(segments[0]);
    }
  } else {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "URL must point to jobs.ashbyhq.com or api.ashbyhq.com.",
      { retryable: false }
    );
  }

  if (!board || !ASHBY_BOARD_RE.test(board)) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Could not extract a valid Ashby board name from URL.",
      { retryable: false }
    );
  }

  return board;
}

function resolveAshbyBoard(config: SourceConfig): string {
  const candidate =
    nonEmptyString(config.sourceIdentifier) ?? nonEmptyString(config.baseUrl);
  if (!candidate) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Ashby source requires sourceIdentifier or baseUrl.",
      { retryable: false }
    );
  }
  return parseAshbyBoardName(candidate);
}

function buildAshbyApiUrl(board: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
}

function normalizeAshbyEmploymentType(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  switch (raw.toLowerCase()) {
    case "fulltime":
    case "full_time":
    case "full-time":
      return "Full-time";
    case "parttime":
    case "part_time":
    case "part-time":
      return "Part-time";
    case "intern":
    case "internship":
      return "Internship";
    case "contract":
    case "contractor":
      return "Contract";
    case "temporary":
      return "Temporary";
    default:
      return raw;
  }
}

function extractAshbyComponentSalary(component: unknown): {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salarySourceType: SalarySourceType | null;
} | null {
  if (!isRecord(component)) return null;

  const compType = nonEmptyString(component.compensationType)?.toLowerCase();
  if (compType && compType !== "salary") {
    return null;
  }

  const currency = nonEmptyString(component.currencyCode);
  const interval = nonEmptyString(component.interval);
  const minVal =
    typeof component.minValue === "number" && Number.isFinite(component.minValue)
      ? component.minValue
      : null;
  const maxVal =
    typeof component.maxValue === "number" && Number.isFinite(component.maxValue)
      ? component.maxValue
      : null;

  if (!currency || !interval || (minVal === null && maxVal === null)) {
    return null;
  }

  if (minVal !== null && minVal < 0) return null;
  if (maxVal !== null && maxVal < 0) return null;
  if (minVal !== null && maxVal !== null && maxVal < minVal) return null;

  return {
    salaryMin: minVal ?? maxVal,
    salaryMax: maxVal ?? minVal,
    salaryCurrency: currency.toUpperCase(),
    salaryPeriod: normalizeSalaryPeriod(interval),
    salarySourceType: "employer_disclosed",
  };
}

function extractAshbyCompensation(compensation: unknown): {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salarySourceType: SalarySourceType | null;
} {
  const empty = {
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salarySourceType: null,
  };

  if (!isRecord(compensation)) return empty;

  if (Array.isArray(compensation.summaryComponents)) {
    for (const comp of compensation.summaryComponents) {
      const parsed = extractAshbyComponentSalary(comp);
      if (parsed) return parsed;
    }
  }

  if (Array.isArray(compensation.compensationTiers)) {
    for (const tier of compensation.compensationTiers) {
      if (!isRecord(tier) || !Array.isArray(tier.components)) continue;
      for (const comp of tier.components) {
        const parsed = extractAshbyComponentSalary(comp);
        if (parsed) return parsed;
      }
    }
  }

  return empty;
}

export const ashbyConnector: JobSourceConnector = {
  async validate(config: SourceConfig): Promise<ValidationResult> {
    try {
      const board = resolveAshbyBoard(config);
      const apiUrl = buildAshbyApiUrl(board);
      await validateStaticOrConfiguredUrl(apiUrl, config);
      return {
        valid: true,
        normalizedIdentifier: board,
        normalizedBaseUrl: `https://jobs.ashbyhq.com/${board}`,
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
    const board = resolveAshbyBoard(config);
    const apiUrl = buildAshbyApiUrl(board);
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

    throwIfHttpErrorStatus(response.status, "Ashby job board");

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text());
    } catch (err) {
      throw new ConnectorError(
        "MALFORMED_RESPONSE",
        "Ashby API returned invalid JSON.",
        { retryable: false, httpStatus: response.status, cause: err }
      );
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.jobs)) {
      throw new ConnectorError(
        "MALFORMED_RESPONSE",
        "Ashby API response is missing a jobs array.",
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
    let fallbackBoard = "";
    try {
      fallbackBoard = resolveAshbyBoard(config);
    } catch {
      fallbackBoard = nonEmptyString(config.sourceIdentifier) ?? "";
    }

    const defaultCompany =
      nonEmptyString(config.companyName) ??
      nonEmptyString(config.displayName) ??
      (fallbackBoard || "Unknown Company");

    const normalized: NormalizedJob[] = [];

    for (const item of items) {
      if (!isRecord(item)) {
        throw new ConnectorError(
          "MALFORMED_RESPONSE",
          "Ashby job item must be an object.",
          { retryable: false }
        );
      }

      if (item.isListed === false) {
        continue;
      }

      const title = nonEmptyString(item.title);
      if (!title) {
        throw new ConnectorError(
          "MALFORMED_RESPONSE",
          "Ashby job item is missing required title.",
          { retryable: false }
        );
      }

      const canonicalUrl = safeCanonicalUrl(item.jobUrl);
      const applyUrl = safeCanonicalUrl(item.applyUrl) ?? canonicalUrl;
      const externalId =
        nonEmptyString(item.id) ??
        (canonicalUrl ? stableHashId("ashby", canonicalUrl) : null);

      if (!externalId) {
        throw new ConnectorError(
          "MALFORMED_RESPONSE",
          "Ashby job item is missing required id or jobUrl.",
          { retryable: false }
        );
      }

      const companyName = nonEmptyString(item.companyName) ?? defaultCompany;
      const locationText = nonEmptyString(item.location);

      const postalAddress =
        isRecord(item.address) && isRecord(item.address.postalAddress)
          ? item.address.postalAddress
          : null;
      const explicitCountry = postalAddress?.addressCountry;

      let workplaceType: WorkplaceType = normalizeWorkplaceType(
        item.workplaceType,
        locationText
      );
      if (workplaceType === "unspecified" && item.isRemote === true) {
        workplaceType = "remote";
      }

      const { descriptionText, descriptionHtmlSanitized } = normalizeDescription(
        nonEmptyString(item.descriptionHtml),
        nonEmptyString(item.descriptionPlain)
      );

      const salary = extractAshbyCompensation(item.compensation);

      normalized.push({
        externalId,
        title,
        companyName,
        descriptionText,
        descriptionHtmlSanitized,
        locationText,
        countryCode: inferCountryCode(locationText, explicitCountry),
        workplaceType,
        employmentType: normalizeAshbyEmploymentType(item.employmentType),
        seniorityMin: null,
        seniorityMax: null,
        salaryMin: salary.salaryMin,
        salaryMax: salary.salaryMax,
        salaryCurrency: salary.salaryCurrency,
        salaryPeriod: salary.salaryPeriod,
        salarySourceType: salary.salarySourceType,
        employerPostedAt: parseIso8601Date(item.publishedAt),
        sourceUpdatedAt: parseIso8601Date(item.updatedAt),
        canonicalUrl,
        applyUrl,
        rawMetadata: {
          sourceType: "ashby",
          boardName: fallbackBoard || null,
          department: item.department ?? null,
          team: item.team ?? null,
          publishedAt: item.publishedAt ?? null,
          updatedAt: item.updatedAt ?? null,
          isRemote: item.isRemote ?? null,
          workplaceTypeRaw: item.workplaceType ?? null,
          secondaryLocations: Array.isArray(item.secondaryLocations)
            ? item.secondaryLocations
            : [],
          jobUrl: item.jobUrl ?? null,
          applyUrl: item.applyUrl ?? null,
        },
      });
    }

    return normalized;
  },
};

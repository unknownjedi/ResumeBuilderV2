import {
  ConnectorError,
  type FetchBatch,
  type JobSourceConnector,
  type NormalizedJob,
  type SalaryPeriod,
  type SalarySourceType,
  type SourceConfig,
  type ValidationResult,
} from "../types";
import {
  escapeHtml,
  extractRawItems,
  fetchPublicWithConditional,
  inferCountryCode,
  isRecord,
  nonEmptyString,
  normalizeDescription,
  normalizeSalaryPeriod,
  normalizeWorkplaceType,
  parseEpochMsToIso,
  safeCanonicalUrl,
  throwIfHttpErrorStatus,
  validateStaticOrConfiguredUrl,
} from "../utils";

const LEVER_SITE_RE = /^[a-zA-Z0-9._-]+$/;
const LEVER_BOARD_HOST_RE = /^jobs(?:\.eu)?\.lever\.co$/;
const LEVER_API_HOST_RE = /^api(?:\.eu)?\.lever\.co$/;
const LEVER_PAGE_SIZE = 100;
const LEVER_MAX_PAGES = 50;

/**
 * Extracts a Lever site identifier from either a raw site name or a public Lever URL
 * (`jobs.lever.co/<site>`, `jobs.eu.lever.co/<site>`, or `api.lever.co/v0/postings/<site>`).
 */
export function parseLeverSiteIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Lever site identifier or URL is required.",
      { retryable: false }
    );
  }

  if (!trimmed.includes("://") && !trimmed.includes("/")) {
    if (!LEVER_SITE_RE.test(trimmed)) {
      throw new ConnectorError(
        "INVALID_CONFIG",
        "Lever site identifier contains invalid characters.",
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
      "Invalid Lever URL.",
      { retryable: false, cause: err }
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Lever URL must use http or https.",
      { retryable: false }
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  let site: string | null = null;
  if (LEVER_API_HOST_RE.test(hostname)) {
    if (segments[0] === "v0" && segments[1] === "postings" && segments[2]) {
      site = segments[2];
    }
  } else if (LEVER_BOARD_HOST_RE.test(hostname)) {
    if (segments[0]) {
      site = segments[0];
    }
  } else {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "URL must point to jobs.lever.co or api.lever.co.",
      { retryable: false }
    );
  }

  if (!site || !LEVER_SITE_RE.test(site)) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Could not extract a valid Lever site identifier from URL.",
      { retryable: false }
    );
  }

  return site;
}

function resolveLeverSite(config: SourceConfig): string {
  const candidate =
    nonEmptyString(config.sourceIdentifier) ?? nonEmptyString(config.baseUrl);
  if (!candidate) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Lever source requires sourceIdentifier or baseUrl.",
      { retryable: false }
    );
  }
  return parseLeverSiteIdentifier(candidate);
}

function buildLeverApiUrl(site: string, skip?: number, limit?: number): string {
  const base = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
  if (skip !== undefined && limit !== undefined) {
    return `${base}&skip=${skip}&limit=${limit}`;
  }
  return base;
}

function buildLeverHtmlDescription(item: Record<string, unknown>): {
  html: string | null;
  plain: string | null;
} {
  const htmlParts: string[] = [];
  const plainParts: string[] = [];

  const descHtml = nonEmptyString(item.description);
  if (descHtml) htmlParts.push(descHtml);
  const descPlain = nonEmptyString(item.descriptionPlain);
  if (descPlain) plainParts.push(descPlain);

  if (Array.isArray(item.lists)) {
    for (const list of item.lists) {
      if (!isRecord(list)) continue;
      const heading = nonEmptyString(list.text);
      const content = nonEmptyString(list.content);
      if (heading) {
        htmlParts.push(`<h3>${escapeHtml(heading)}</h3>`);
        plainParts.push(heading);
      }
      if (content) {
        const trimmed = content.trim();
        const wrapsUl = /^<ul[\s>]/i.test(trimmed) || /^<ol[\s>]/i.test(trimmed);
        htmlParts.push(wrapsUl ? trimmed : `<ul>${trimmed}</ul>`);
      }
    }
  }

  const addHtml = nonEmptyString(item.additional);
  if (addHtml) htmlParts.push(addHtml);
  const addPlain = nonEmptyString(item.additionalPlain);
  if (addPlain) plainParts.push(addPlain);

  return {
    html: htmlParts.length > 0 ? htmlParts.join("\n") : null,
    plain: plainParts.length > 0 ? plainParts.join("\n\n") : null,
  };
}

function extractLeverSalary(rawSalaryRange: unknown): {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salarySourceType: SalarySourceType | null;
} {
  if (!isRecord(rawSalaryRange)) {
    return {
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      salarySourceType: null,
    };
  }

  const min = rawSalaryRange.min;
  const max = rawSalaryRange.max;
  const currency = nonEmptyString(rawSalaryRange.currency);
  const interval = nonEmptyString(rawSalaryRange.interval);

  if (
    typeof min !== "number" ||
    !Number.isFinite(min) ||
    min < 0 ||
    typeof max !== "number" ||
    !Number.isFinite(max) ||
    max < min ||
    !currency ||
    !interval
  ) {
    return {
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      salarySourceType: null,
    };
  }

  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: currency.toUpperCase(),
    salaryPeriod: normalizeSalaryPeriod(interval),
    salarySourceType: "employer_disclosed",
  };
}

export const leverConnector: JobSourceConnector = {
  async validate(config: SourceConfig): Promise<ValidationResult> {
    try {
      const site = resolveLeverSite(config);
      const apiUrl = buildLeverApiUrl(site);
      await validateStaticOrConfiguredUrl(apiUrl, config);
      return {
        valid: true,
        normalizedIdentifier: site,
        normalizedBaseUrl: `https://jobs.lever.co/${site}`,
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

  async fetch(config: SourceConfig, cursor?: string): Promise<FetchBatch> {
    const site = resolveLeverSite(config);
    const fetchedAt = new Date().toISOString();

    let initialSkip = 0;
    if (cursor !== undefined && cursor !== "") {
      const parsedCursor = Number.parseInt(cursor, 10);
      if (!Number.isFinite(parsedCursor) || parsedCursor < 0 || String(parsedCursor) !== cursor.trim()) {
        throw new ConnectorError(
          "INVALID_CONFIG",
          "Invalid Lever pagination cursor.",
          { retryable: false }
        );
      }
      initialSkip = parsedCursor;
    }

    const collectedJobs: unknown[] = [];
    let currentSkip = initialSkip;
    let sourceEtag: string | undefined;
    let sourceLastModified: string | undefined;

    for (let pageIndex = 0; pageIndex < LEVER_MAX_PAGES; pageIndex++) {
      const isFirstRequest = pageIndex === 0 && initialSkip === 0;
      const url = isFirstRequest
        ? buildLeverApiUrl(site)
        : buildLeverApiUrl(site, currentSkip, LEVER_PAGE_SIZE);

      let pageItems: unknown[];
      try {
        const response = await fetchPublicWithConditional(url, config, {
          accept: "application/json",
          useConditionalHeaders: isFirstRequest,
        });

        if (isFirstRequest && response.status === 304) {
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

        throwIfHttpErrorStatus(response.status, "Lever postings feed");

        let parsed: unknown;
        try {
          parsed = JSON.parse(response.text());
        } catch (err) {
          throw new ConnectorError(
            "MALFORMED_RESPONSE",
            "Lever API returned invalid JSON.",
            { retryable: false, httpStatus: response.status, cause: err }
          );
        }

        if (!Array.isArray(parsed)) {
          throw new ConnectorError(
            "MALFORMED_RESPONSE",
            "Lever API response must be a JSON array of postings.",
            { retryable: false, httpStatus: response.status }
          );
        }

        if (pageIndex === 0) {
          sourceEtag = response.headers.get("etag") ?? undefined;
          sourceLastModified = response.headers.get("last-modified") ?? undefined;
        }

        pageItems = parsed;
      } catch (err) {
        if (collectedJobs.length > 0) {
          return {
            jobs: collectedJobs,
            nextCursor: String(currentSkip),
            isCompleteSnapshot: false,
            fetchedAt,
            sourceEtag,
            sourceLastModified,
          };
        }
        throw err;
      }

      collectedJobs.push(...pageItems);

      // If the initial un-limited call returned > 100 items at once, Lever delivered the entire board.
      if (isFirstRequest && pageItems.length > LEVER_PAGE_SIZE) {
        return {
          jobs: collectedJobs,
          isCompleteSnapshot: true,
          fetchedAt,
          sourceEtag,
          sourceLastModified,
        };
      }

      if (pageItems.length < LEVER_PAGE_SIZE) {
        return {
          jobs: collectedJobs,
          isCompleteSnapshot: initialSkip === 0,
          fetchedAt,
          sourceEtag,
          sourceLastModified,
        };
      }

      currentSkip += pageItems.length;
    }

    return {
      jobs: collectedJobs,
      nextCursor: String(currentSkip),
      isCompleteSnapshot: false,
      fetchedAt,
      sourceEtag,
      sourceLastModified,
    };
  },

  normalize(raw: unknown, config: SourceConfig): NormalizedJob[] {
    const items = extractRawItems(raw, "jobs");
    let fallbackSite = "";
    try {
      fallbackSite = resolveLeverSite(config);
    } catch {
      fallbackSite = nonEmptyString(config.sourceIdentifier) ?? "";
    }

    const defaultCompany =
      nonEmptyString(config.companyName) ??
      nonEmptyString(config.displayName) ??
      (fallbackSite || "Unknown Company");

    return items.map((item) => {
      if (!isRecord(item)) {
        throw new ConnectorError(
          "MALFORMED_RESPONSE",
          "Lever posting item must be an object.",
          { retryable: false }
        );
      }

      const externalId = nonEmptyString(item.id);
      const title = nonEmptyString(item.text) ?? nonEmptyString(item.title);
      if (!externalId || !title) {
        throw new ConnectorError(
          "MALFORMED_RESPONSE",
          "Lever posting is missing required id or text/title.",
          { retryable: false }
        );
      }

      const categories = isRecord(item.categories) ? item.categories : {};
      let locationText = nonEmptyString(categories.location);
      if (!locationText && Array.isArray(categories.allLocations)) {
        const locs = categories.allLocations
          .map((loc) => nonEmptyString(loc))
          .filter((loc): loc is string => loc !== null);
        if (locs.length > 0) {
          locationText = locs.join(" / ");
        }
      }

      const { html, plain } = buildLeverHtmlDescription(item);
      const { descriptionText, descriptionHtmlSanitized } = normalizeDescription(
        html,
        plain
      );

      const workplaceType = normalizeWorkplaceType(
        item.workplaceType,
        locationText
      );
      const employmentType = nonEmptyString(categories.commitment);
      const salary = extractLeverSalary(item.salaryRange);

      const employerPostedAt = parseEpochMsToIso(item.createdAt);
      const sourceUpdatedAt = parseEpochMsToIso(item.updatedAt);

      const canonicalUrl = safeCanonicalUrl(item.hostedUrl);
      const applyUrl = safeCanonicalUrl(item.applyUrl) ?? canonicalUrl;

      return {
        externalId,
        title,
        companyName: defaultCompany,
        descriptionText,
        descriptionHtmlSanitized,
        locationText,
        countryCode: inferCountryCode(locationText, item.country),
        workplaceType,
        employmentType,
        seniorityMin: null,
        seniorityMax: null,
        salaryMin: salary.salaryMin,
        salaryMax: salary.salaryMax,
        salaryCurrency: salary.salaryCurrency,
        salaryPeriod: salary.salaryPeriod,
        salarySourceType: salary.salarySourceType,
        employerPostedAt,
        sourceUpdatedAt,
        canonicalUrl,
        applyUrl,
        rawMetadata: {
          sourceType: "lever",
          siteIdentifier: fallbackSite || null,
          createdAt: item.createdAt ?? null,
          updatedAt: item.updatedAt ?? null,
          categories,
          workplaceTypeRaw: item.workplaceType ?? null,
          hostedUrl: item.hostedUrl ?? null,
          applyUrl: item.applyUrl ?? null,
        },
      };
    });
  },
};

import type { DnsLookupFn } from "../../security/ssrf";
import { genericCareersConnector } from "../generic-careers";
import {
  canonicalizeJobUrl,
  ConnectorError,
  type FetchBatch,
  type JobSourceConnector,
  type NormalizedJob,
  type SalaryPeriod,
  type SourceConfig,
  type ValidationResult,
  type WorkplaceType,
} from "../types";
import {
  inferCountryCode,
  isRecord,
  isRestrictedAutomatedSourceUrl,
  nonEmptyString,
  normalizeDescription,
  normalizeSalaryPeriod,
  normalizeWorkplaceType,
  parseIso8601Date,
  stableHashId,
  validateStaticOrConfiguredUrl,
} from "../utils";

export { isRestrictedAutomatedSourceUrl };

export interface ManualJobImportInput {
  url?: string | null;
  title?: string | null;
  companyName?: string | null;
  locationText?: string | null;
  workplaceType?: WorkplaceType | string | null;
  employmentType?: string | null;
  descriptionText?: string | null;
  descriptionHtml?: string | null;
  employerPostedAt?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: SalaryPeriod | string | null;
  /** Optional transport overrides for URL-based manual import. */
  fetchImpl?: typeof fetch;
  lookup?: DnsLookupFn;
  timeoutMs?: number;
}

function parseOptionalManualSalary(input: ManualJobImportInput): {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  hasExplicitSalary: boolean;
} {
  const min =
    typeof input.salaryMin === "number" && Number.isFinite(input.salaryMin)
      ? input.salaryMin
      : null;
  const max =
    typeof input.salaryMax === "number" && Number.isFinite(input.salaryMax)
      ? input.salaryMax
      : null;

  if (input.salaryMin !== undefined && input.salaryMin !== null && min === null) {
    throw new ConnectorError("INVALID_CONFIG", "salaryMin must be a finite number.", {
      retryable: false,
    });
  }
  if (input.salaryMax !== undefined && input.salaryMax !== null && max === null) {
    throw new ConnectorError("INVALID_CONFIG", "salaryMax must be a finite number.", {
      retryable: false,
    });
  }
  if ((min !== null && min < 0) || (max !== null && max < 0)) {
    throw new ConnectorError("INVALID_CONFIG", "Salary amounts cannot be negative.", {
      retryable: false,
    });
  }
  if (min !== null && max !== null && max < min) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "salaryMax cannot be less than salaryMin.",
      { retryable: false }
    );
  }

  const hasExplicitSalary = min !== null || max !== null;
  return {
    salaryMin: min ?? max,
    salaryMax: max ?? min,
    salaryCurrency: hasExplicitSalary
      ? nonEmptyString(input.salaryCurrency)?.toUpperCase() ?? null
      : null,
    salaryPeriod:
      hasExplicitSalary && input.salaryPeriod
        ? normalizeSalaryPeriod(input.salaryPeriod)
        : null,
    hasExplicitSalary,
  };
}

function normalizeManualTextImport(input: ManualJobImportInput): NormalizedJob {
  const rawDescription = nonEmptyString(input.descriptionText);
  const rawHtml = nonEmptyString(input.descriptionHtml);
  if (!rawDescription && !rawHtml) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Manual job import requires descriptionText when no URL is fetched.",
      { retryable: false }
    );
  }

  const rawUrl = nonEmptyString(input.url);
  let canonicalUrl: string | null = null;
  if (rawUrl) {
    canonicalUrl = canonicalizeJobUrl(rawUrl);
    if (!canonicalUrl) {
      throw new ConnectorError(
        "INVALID_CONFIG",
        "Reference URL must be a valid http or https URL.",
        { retryable: false }
      );
    }
  }

  let employerPostedAt: string | null = null;
  const rawPostedAt = nonEmptyString(input.employerPostedAt);
  if (rawPostedAt) {
    employerPostedAt = parseIso8601Date(rawPostedAt);
    if (!employerPostedAt) {
      throw new ConnectorError(
        "INVALID_CONFIG",
        "employerPostedAt must be a valid ISO-8601 date or timestamp.",
        { retryable: false }
      );
    }
  }

  const title = nonEmptyString(input.title) ?? "Untitled Role";
  const companyName = nonEmptyString(input.companyName) ?? "Unspecified Company";
  const locationText = nonEmptyString(input.locationText);

  const { descriptionText, descriptionHtmlSanitized } = normalizeDescription(
    rawHtml,
    rawDescription
  );

  const salary = parseOptionalManualSalary(input);
  const externalId = stableHashId(
    "manual",
    canonicalUrl,
    title,
    companyName,
    descriptionText.slice(0, 512)
  );

  return {
    externalId,
    title,
    companyName,
    descriptionText,
    descriptionHtmlSanitized,
    locationText,
    countryCode: inferCountryCode(locationText),
    workplaceType: normalizeWorkplaceType(input.workplaceType, locationText),
    employmentType: nonEmptyString(input.employmentType),
    seniorityMin: null,
    seniorityMax: null,
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    salaryCurrency: salary.salaryCurrency,
    salaryPeriod: salary.salaryPeriod,
    salarySourceType: salary.hasExplicitSalary ? "employer_disclosed" : null,
    employerPostedAt,
    sourceUpdatedAt: null,
    canonicalUrl,
    applyUrl: canonicalUrl,
    rawMetadata: {
      sourceType: "manual",
      importMode: "pasted_text",
      referenceUrl: canonicalUrl,
      isRestrictedReference: canonicalUrl
        ? isRestrictedAutomatedSourceUrl(canonicalUrl)
        : false,
    },
  };
}

/**
 * Normalizes a manually imported job from pasted JD text and/or a public job URL.
 *
 * - When `descriptionText` (or `descriptionHtml`) is provided, never fetches `url`
 *   and allows restricted URLs (such as LinkedIn or Naukri) to be saved as references.
 * - When `descriptionText` is omitted and `url` is provided, rejects restricted domains
 *   with `RESTRICTED_SOURCE` and otherwise fetches public structured JSON-LD / RSS/Atom
 *   data via `safeFetchPublicUrl`.
 */
export async function parseManualJobImport(
  input: ManualJobImportInput
): Promise<NormalizedJob> {
  const hasDescription =
    Boolean(nonEmptyString(input.descriptionText)) ||
    Boolean(nonEmptyString(input.descriptionHtml));
  const rawUrl = nonEmptyString(input.url);

  if (hasDescription) {
    return normalizeManualTextImport(input);
  }

  if (!rawUrl) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Manual import requires job description text or a public job URL.",
      { retryable: false }
    );
  }

  if (isRestrictedAutomatedSourceUrl(rawUrl)) {
    throw new ConnectorError(
      "RESTRICTED_SOURCE",
      "Automated fetching of LinkedIn and Naukri URLs is blocked. Paste the job description text to save the job with the URL as a reference.",
      { retryable: false }
    );
  }

  const fetchConfig: SourceConfig = {
    sourceType: "generic_career_page",
    baseUrl: rawUrl,
    companyName: nonEmptyString(input.companyName) ?? undefined,
    fetchImpl: input.fetchImpl,
    lookup: input.lookup,
    timeoutMs: input.timeoutMs,
  };

  await validateStaticOrConfiguredUrl(rawUrl, fetchConfig);
  const batch = await genericCareersConnector.fetch(fetchConfig);
  const normalizedJobs = genericCareersConnector.normalize(batch.jobs, fetchConfig);

  if (normalizedJobs.length === 0) {
    throw new ConnectorError(
      "UNSUPPORTED_STRUCTURE",
      "No structured job posting found at the provided URL. Please paste the job description text directly.",
      { retryable: false }
    );
  }

  const targetCanonical = canonicalizeJobUrl(rawUrl);
  const baseJob =
    normalizedJobs.find((job) => job.canonicalUrl === targetCanonical) ??
    normalizedJobs[0];

  const overrideLocation = nonEmptyString(input.locationText) ?? baseJob.locationText;
  const overrideSalary = parseOptionalManualSalary(input);

  let overridePostedAt = baseJob.employerPostedAt;
  const rawPostedAt = nonEmptyString(input.employerPostedAt);
  if (rawPostedAt) {
    const parsedPosted = parseIso8601Date(rawPostedAt);
    if (!parsedPosted) {
      throw new ConnectorError(
        "INVALID_CONFIG",
        "employerPostedAt must be a valid ISO-8601 date or timestamp.",
        { retryable: false }
      );
    }
    overridePostedAt = parsedPosted;
  }

  return {
    ...baseJob,
    title: nonEmptyString(input.title) ?? baseJob.title,
    companyName: nonEmptyString(input.companyName) ?? baseJob.companyName,
    locationText: overrideLocation,
    countryCode: inferCountryCode(overrideLocation) ?? baseJob.countryCode,
    workplaceType: input.workplaceType
      ? normalizeWorkplaceType(input.workplaceType, overrideLocation)
      : baseJob.workplaceType,
    employmentType: nonEmptyString(input.employmentType) ?? baseJob.employmentType,
    employerPostedAt: overridePostedAt,
    salaryMin: overrideSalary.hasExplicitSalary
      ? overrideSalary.salaryMin
      : baseJob.salaryMin,
    salaryMax: overrideSalary.hasExplicitSalary
      ? overrideSalary.salaryMax
      : baseJob.salaryMax,
    salaryCurrency: overrideSalary.hasExplicitSalary
      ? overrideSalary.salaryCurrency ?? baseJob.salaryCurrency
      : baseJob.salaryCurrency,
    salaryPeriod: overrideSalary.hasExplicitSalary
      ? overrideSalary.salaryPeriod ?? baseJob.salaryPeriod
      : baseJob.salaryPeriod,
    salarySourceType: overrideSalary.hasExplicitSalary
      ? "employer_disclosed"
      : baseJob.salarySourceType,
    canonicalUrl: targetCanonical ?? baseJob.canonicalUrl,
    rawMetadata: {
      ...baseJob.rawMetadata,
      sourceType: "manual",
      importMode: "url_fetch",
      referenceUrl: targetCanonical ?? baseJob.canonicalUrl,
    },
  };
}

function readManualInputFromConfig(config: SourceConfig): ManualJobImportInput {
  const cfg = isRecord(config.config) ? config.config : {};
  return {
    url: nonEmptyString(cfg.url) ?? nonEmptyString(config.baseUrl),
    title: nonEmptyString(cfg.title),
    companyName: nonEmptyString(cfg.companyName) ?? nonEmptyString(config.companyName),
    locationText: nonEmptyString(cfg.locationText),
    workplaceType: nonEmptyString(cfg.workplaceType),
    employmentType: nonEmptyString(cfg.employmentType),
    descriptionText: nonEmptyString(cfg.descriptionText),
    descriptionHtml: nonEmptyString(cfg.descriptionHtml),
    employerPostedAt: nonEmptyString(cfg.employerPostedAt),
    salaryMin: typeof cfg.salaryMin === "number" ? cfg.salaryMin : undefined,
    salaryMax: typeof cfg.salaryMax === "number" ? cfg.salaryMax : undefined,
    salaryCurrency: nonEmptyString(cfg.salaryCurrency),
    salaryPeriod: nonEmptyString(cfg.salaryPeriod),
    fetchImpl: config.fetchImpl,
    lookup: config.lookup,
    timeoutMs: config.timeoutMs,
  };
}

export const manualImportConnector: JobSourceConnector = {
  async validate(config: SourceConfig): Promise<ValidationResult> {
    const input = readManualInputFromConfig(config);
    const hasDescription =
      Boolean(nonEmptyString(input.descriptionText)) ||
      Boolean(nonEmptyString(input.descriptionHtml));
    const rawUrl = nonEmptyString(input.url);

    if (!hasDescription && !rawUrl) {
      return {
        valid: false,
        errorCode: "INVALID_CONFIG",
        errorMessage: "Manual import requires descriptionText or a public URL.",
      };
    }

    if (rawUrl) {
      const canonical = canonicalizeJobUrl(rawUrl);
      if (!canonical) {
        return {
          valid: false,
          errorCode: "INVALID_CONFIG",
          errorMessage: "Manual import URL must be a valid http or https URL.",
        };
      }
      if (!hasDescription && isRestrictedAutomatedSourceUrl(rawUrl)) {
        return {
          valid: false,
          errorCode: "RESTRICTED_SOURCE",
          errorMessage:
            "Automated fetching of LinkedIn and Naukri URLs is blocked. Paste the job description text to save the URL as a reference.",
        };
      }
      if (!hasDescription) {
        try {
          await validateStaticOrConfiguredUrl(rawUrl, config);
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
      }
      return {
        valid: true,
        normalizedBaseUrl: canonical,
      };
    }

    return { valid: true };
  },

  async fetch(config: SourceConfig): Promise<FetchBatch> {
    const input = readManualInputFromConfig(config);
    const normalized = await parseManualJobImport(input);
    return {
      jobs: [normalized],
      // A single manual import is never a full board snapshot that can close other jobs.
      isCompleteSnapshot: false,
      fetchedAt: new Date().toISOString(),
    };
  },

  normalize(raw: unknown, config: SourceConfig): NormalizedJob[] {
    const items = Array.isArray(raw)
      ? raw
      : isRecord(raw) && Array.isArray(raw.jobs)
        ? raw.jobs
        : [raw];

    return items.map((item) => {
      if (!isRecord(item)) {
        throw new ConnectorError(
          "MALFORMED_RESPONSE",
          "Manual import item must be an object.",
          { retryable: false }
        );
      }

      // Already normalized by fetch()
      if (
        typeof item.externalId === "string" &&
        typeof item.title === "string" &&
        typeof item.descriptionText === "string" &&
        isRecord(item.rawMetadata)
      ) {
        return item as unknown as NormalizedJob;
      }

      const input: ManualJobImportInput = {
        url: nonEmptyString(item.url) ?? nonEmptyString(config.baseUrl),
        title: nonEmptyString(item.title),
        companyName:
          nonEmptyString(item.companyName) ?? nonEmptyString(config.companyName),
        locationText: nonEmptyString(item.locationText),
        workplaceType: nonEmptyString(item.workplaceType),
        employmentType: nonEmptyString(item.employmentType),
        descriptionText: nonEmptyString(item.descriptionText),
        descriptionHtml: nonEmptyString(item.descriptionHtml),
        employerPostedAt: nonEmptyString(item.employerPostedAt),
        salaryMin: typeof item.salaryMin === "number" ? item.salaryMin : undefined,
        salaryMax: typeof item.salaryMax === "number" ? item.salaryMax : undefined,
        salaryCurrency: nonEmptyString(item.salaryCurrency),
        salaryPeriod: nonEmptyString(item.salaryPeriod),
      };

      return normalizeManualTextImport(input);
    });
  },
};

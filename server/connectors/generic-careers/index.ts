import * as cheerio from "cheerio";
import {
  canonicalizeJobUrl,
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
  fetchPublicWithConditional,
  inferCountryCode,
  isRecord,
  isRestrictedAutomatedSourceUrl,
  nonEmptyString,
  normalizeDescription,
  normalizeSalaryPeriod,
  normalizeWorkplaceType,
  parseFeedDateToIso,
  parseIso8601Date,
  stableHashId,
  throwIfHttpErrorStatus,
  validateStaticOrConfiguredUrl,
} from "../utils";

export interface ExtractedJsonLdJob {
  kind: "jsonld";
  pageUrl: string;
  item: Record<string, unknown>;
}

export interface ExtractedFeedJob {
  kind: "rss" | "atom";
  feedUrl: string;
  feedTitle: string | null;
  id: string | null;
  title: string;
  link: string | null;
  description: string;
  publishedAt: string | null;
  updatedAt: string | null;
  author: string | null;
  location: string | null;
}

export type GenericExtractedJob = ExtractedJsonLdJob | ExtractedFeedJob;

function resolveCareerPageUrl(config: SourceConfig): string {
  const raw =
    nonEmptyString(config.baseUrl) ?? nonEmptyString(config.sourceIdentifier);
  if (!raw) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "Generic career page source requires a public baseUrl.",
      { retryable: false }
    );
  }
  return raw;
}

function resolveMaybeRelativeUrl(rawUrl: unknown, baseUrl: string): string | null {
  const str = nonEmptyString(rawUrl);
  if (!str) return null;
  try {
    const resolved = new URL(str, baseUrl).toString();
    return canonicalizeJobUrl(resolved);
  } catch {
    return null;
  }
}

function isJobPostingType(typeValue: unknown): boolean {
  const checkSingle = (val: unknown): boolean => {
    const str = nonEmptyString(val);
    if (!str) return false;
    const normalized = str.toLowerCase();
    return (
      normalized === "jobposting" ||
      normalized === "https://schema.org/jobposting" ||
      normalized === "http://schema.org/jobposting" ||
      normalized.endsWith("/jobposting")
    );
  };

  if (Array.isArray(typeValue)) {
    return typeValue.some(checkSingle);
  }
  return checkSingle(typeValue);
}

function collectSchemaJobPostings(
  node: unknown,
  results: Record<string, unknown>[],
  seen: Set<unknown>
): void {
  if (node === null || typeof node !== "object" || seen.has(node)) {
    return;
  }
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      collectSchemaJobPostings(item, results, seen);
    }
    return;
  }

  if (!isRecord(node)) return;

  if (isJobPostingType(node["@type"])) {
    results.push(node);
  }

  if (Array.isArray(node["@graph"])) {
    for (const graphItem of node["@graph"]) {
      collectSchemaJobPostings(graphItem, results, seen);
    }
  }
}

function looksLikeXmlFeed(body: string, contentType: string | null): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (
    ct.includes("application/rss+xml") ||
    ct.includes("application/atom+xml") ||
    ct.includes("application/xml") ||
    ct.includes("text/xml")
  ) {
    return true;
  }

  const trimmed = body.replace(/^\uFEFF/, "").trimStart();
  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return false;
  }

  return /^<\?xml[\s?]/i.test(trimmed) || /^<(?:rss|feed)[\s>]/i.test(trimmed);
}

function looksLikeJsonLd(body: string, contentType: string | null): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/ld+json") || ct.includes("application/json")) {
    return true;
  }
  const trimmed = body.replace(/^\uFEFF/, "").trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseRssOrAtomFeed(xmlBody: string, feedUrl: string): ExtractedFeedJob[] {
  const $ = cheerio.load(xmlBody, { xmlMode: true });

  const rssChannel = $("rss > channel").first();
  if (rssChannel.length > 0) {
    const channelTitle = nonEmptyString(rssChannel.children("title").first().text());
    const jobs: ExtractedFeedJob[] = [];

    rssChannel.children("item").each((_idx, el) => {
      const node = $(el);
      const title = nonEmptyString(node.children("title").first().text());
      const link = nonEmptyString(node.children("link").first().text());
      const guid = nonEmptyString(node.children("guid").first().text());
      const pubDate = nonEmptyString(node.children("pubDate").first().text());
      const creator =
        nonEmptyString(node.find("dc\\:creator").first().text()) ??
        nonEmptyString(node.children("author").first().text());
      const location = nonEmptyString(node.children("location").first().text());
      const contentEncoded = nonEmptyString(
        node.find("content\\:encoded").first().text()
      );
      const description =
        contentEncoded ?? node.children("description").first().text();

      if (!title) return;

      jobs.push({
        kind: "rss",
        feedUrl,
        feedTitle: channelTitle,
        id: guid ?? link,
        title,
        link,
        description: description ?? "",
        publishedAt: pubDate,
        updatedAt: null,
        author: creator,
        location,
      });
    });

    return jobs;
  }

  const atomFeed = $("feed").first();
  if (atomFeed.length > 0) {
    const xmlns = atomFeed.attr("xmlns") ?? "";
    const hasAtomMarker =
      xmlns.toLowerCase().includes("atom") ||
      atomFeed.children("entry").length > 0 ||
      atomFeed.children("title").length > 0 ||
      atomFeed.children("id").length > 0;

    if (!hasAtomMarker) {
      throw new ConnectorError(
        "UNSUPPORTED_STRUCTURE",
        "XML document is not a supported RSS 2.0 or Atom feed.",
        { retryable: false }
      );
    }

    const feedTitle = nonEmptyString(atomFeed.children("title").first().text());
    const jobs: ExtractedFeedJob[] = [];

    atomFeed.children("entry").each((_idx, el) => {
      const node = $(el);
      const id = nonEmptyString(node.children("id").first().text());
      const title = nonEmptyString(node.children("title").first().text());
      const altLink = node.children('link[rel="alternate"]').first().attr("href");
      const firstLinkHref = node.children("link").first().attr("href");
      const firstLinkText = node.children("link").first().text();
      const link = nonEmptyString(altLink ?? firstLinkHref ?? firstLinkText);
      const publishedAt = nonEmptyString(node.children("published").first().text());
      const updatedAt = nonEmptyString(node.children("updated").first().text());
      const author = nonEmptyString(
        node.children("author").children("name").first().text()
      );
      const contentEl = node.children("content").first();
      const summaryEl = node.children("summary").first();
      const description =
        (contentEl.length > 0 ? contentEl.text() : "") ||
        (summaryEl.length > 0 ? summaryEl.text() : "");

      if (!title) return;

      jobs.push({
        kind: "atom",
        feedUrl,
        feedTitle,
        id: id ?? link,
        title,
        link,
        description,
        publishedAt,
        updatedAt,
        author,
        location: null,
      });
    });

    return jobs;
  }

  throw new ConnectorError(
    "UNSUPPORTED_STRUCTURE",
    "XML document is not a supported RSS 2.0 or Atom feed.",
    { retryable: false }
  );
}

/**
 * Extracts ONLY Schema.org `JobPosting` JSON-LD blocks or RSS 2.0 / Atom items
 * from a fetched response body. Rejects arbitrary HTML/JS career portals.
 */
export function extractStructuredJobsFromDocument(
  body: string,
  pageUrl: string,
  contentType: string | null = null
): GenericExtractedJob[] {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new ConnectorError(
      "UNSUPPORTED_STRUCTURE",
      "Career page returned an empty response.",
      { retryable: false }
    );
  }

  if (looksLikeXmlFeed(trimmed, contentType)) {
    return parseRssOrAtomFeed(trimmed, pageUrl);
  }

  if (looksLikeJsonLd(trimmed, contentType)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new ConnectorError(
        "MALFORMED_RESPONSE",
        "Career endpoint returned invalid JSON-LD.",
        { retryable: false, cause: err }
      );
    }

    const postings: Record<string, unknown>[] = [];
    collectSchemaJobPostings(parsed, postings, new Set());
    if (postings.length === 0) {
      throw new ConnectorError(
        "UNSUPPORTED_STRUCTURE",
        "JSON document does not contain Schema.org JobPosting objects.",
        { retryable: false }
      );
    }
    return postings.map((item) => ({
      kind: "jsonld",
      pageUrl,
      item,
    }));
  }

  const $ = cheerio.load(trimmed);
  const jsonLdScripts = $("script").filter((_idx, el) => {
    const typeAttr = ($(el).attr("type") ?? "").toLowerCase().split(";")[0].trim();
    return typeAttr === "application/ld+json";
  });

  if (jsonLdScripts.length === 0) {
    throw new ConnectorError(
      "UNSUPPORTED_STRUCTURE",
      "Page does not contain Schema.org JobPosting JSON-LD or an RSS/Atom feed. Use manual import to paste the job description.",
      { retryable: false }
    );
  }

  const postings: Record<string, unknown>[] = [];
  let hadMalformedJsonLd = false;

  jsonLdScripts.each((_idx, el) => {
    const rawJson = $(el).html() ?? $(el).text();
    const content = rawJson.trim();
    if (!content) return;
    try {
      const parsed = JSON.parse(content);
      collectSchemaJobPostings(parsed, postings, new Set());
    } catch {
      hadMalformedJsonLd = true;
    }
  });

  if (postings.length > 0) {
    return postings.map((item) => ({
      kind: "jsonld",
      pageUrl,
      item,
    }));
  }

  if (hadMalformedJsonLd) {
    throw new ConnectorError(
      "MALFORMED_RESPONSE",
      "Page contains malformed JSON-LD script blocks.",
      { retryable: false }
    );
  }

  throw new ConnectorError(
    "UNSUPPORTED_STRUCTURE",
    "Page JSON-LD does not contain any Schema.org JobPosting entries.",
    { retryable: false }
  );
}

function extractSchemaLocation(jobLocation: unknown): {
  locationText: string | null;
  countryCode: string | null;
} {
  const candidates = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  const formattedParts: string[] = [];
  let explicitCountry: string | undefined;

  for (const loc of candidates) {
    if (typeof loc === "string") {
      const clean = nonEmptyString(loc);
      if (clean) formattedParts.push(clean);
      continue;
    }

    if (!isRecord(loc)) continue;

    const address = loc.address;
    if (typeof address === "string") {
      const clean = nonEmptyString(address);
      if (clean) formattedParts.push(clean);
      continue;
    }

    if (isRecord(address)) {
      const countryRaw = isRecord(address.addressCountry)
        ? nonEmptyString(address.addressCountry.name)
        : nonEmptyString(address.addressCountry);
      if (countryRaw && !explicitCountry) {
        explicitCountry = countryRaw;
      }

      const pieces = [
        nonEmptyString(address.addressLocality),
        nonEmptyString(address.addressRegion),
        countryRaw,
      ].filter((p): p is string => p !== null);

      if (pieces.length > 0) {
        formattedParts.push(pieces.join(", "));
        continue;
      }
    }

    const placeName = nonEmptyString(loc.name);
    if (placeName) {
      formattedParts.push(placeName);
    }
  }

  const locationText =
    formattedParts.length > 0 ? Array.from(new Set(formattedParts)).join(" / ") : null;

  return {
    locationText,
    countryCode: inferCountryCode(locationText, explicitCountry),
  };
}

function extractSchemaSalary(baseSalary: unknown): {
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

  if (!isRecord(baseSalary)) return empty;

  const currency = nonEmptyString(baseSalary.currency);
  const valueNode = isRecord(baseSalary.value) ? baseSalary.value : baseSalary;

  const exactVal =
    typeof valueNode.value === "number" && Number.isFinite(valueNode.value)
      ? valueNode.value
      : null;
  const minVal =
    typeof valueNode.minValue === "number" && Number.isFinite(valueNode.minValue)
      ? valueNode.minValue
      : exactVal;
  const maxVal =
    typeof valueNode.maxValue === "number" && Number.isFinite(valueNode.maxValue)
      ? valueNode.maxValue
      : exactVal;
  const unitText = nonEmptyString(valueNode.unitText);

  if (
    !currency ||
    !unitText ||
    minVal === null ||
    maxVal === null ||
    minVal < 0 ||
    maxVal < minVal
  ) {
    return empty;
  }

  return {
    salaryMin: minVal,
    salaryMax: maxVal,
    salaryCurrency: currency.toUpperCase(),
    salaryPeriod: normalizeSalaryPeriod(unitText),
    salarySourceType: "employer_disclosed",
  };
}

function normalizeJsonLdJob(
  entry: ExtractedJsonLdJob,
  config: SourceConfig
): NormalizedJob {
  const jp = entry.item;
  const title = nonEmptyString(jp.title) ?? nonEmptyString(jp.name);
  if (!title) {
    throw new ConnectorError(
      "MALFORMED_RESPONSE",
      "Schema.org JobPosting is missing required title.",
      { retryable: false }
    );
  }

  let companyName: string | null = null;
  if (typeof jp.hiringOrganization === "string") {
    companyName = nonEmptyString(jp.hiringOrganization);
  } else if (isRecord(jp.hiringOrganization)) {
    companyName = nonEmptyString(jp.hiringOrganization.name);
  }
  companyName =
    companyName ??
    nonEmptyString(config.companyName) ??
    nonEmptyString(config.displayName) ??
    "Unknown Company";

  const canonicalUrl =
    resolveMaybeRelativeUrl(jp.url, entry.pageUrl) ??
    canonicalizeJobUrl(entry.pageUrl);

  let identifierValue: string | null = null;
  if (typeof jp.identifier === "string") {
    identifierValue = nonEmptyString(jp.identifier);
  } else if (typeof jp.identifier === "number" && Number.isFinite(jp.identifier)) {
    identifierValue = String(jp.identifier);
  } else if (isRecord(jp.identifier)) {
    identifierValue = nonEmptyString(jp.identifier.value);
  }

  const externalId =
    identifierValue ??
    canonicalUrl ??
    stableHashId("jsonld", title, companyName, entry.pageUrl);

  const rawDesc = nonEmptyString(jp.description);
  const { descriptionText, descriptionHtmlSanitized } = normalizeDescription(
    rawDesc,
    rawDesc
  );

  const { locationText, countryCode } = extractSchemaLocation(jp.jobLocation);
  const workplaceType: WorkplaceType = normalizeWorkplaceType(
    jp.jobLocationType,
    locationText
  );

  let employmentType: string | null = null;
  if (typeof jp.employmentType === "string") {
    employmentType = nonEmptyString(jp.employmentType);
  } else if (Array.isArray(jp.employmentType)) {
    const parts = jp.employmentType
      .map((item) => nonEmptyString(item))
      .filter((item): item is string => item !== null);
    if (parts.length > 0) employmentType = parts.join(", ");
  }

  const salary = extractSchemaSalary(jp.baseSalary);
  const employerPostedAt = parseIso8601Date(jp.datePosted);

  return {
    externalId,
    title,
    companyName,
    descriptionText,
    descriptionHtmlSanitized,
    locationText,
    countryCode,
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
    sourceUpdatedAt: null,
    canonicalUrl,
    applyUrl: canonicalUrl,
    rawMetadata: {
      sourceType: "generic_career_page",
      format: "schema_org_jsonld",
      pageUrl: entry.pageUrl,
      datePosted: jp.datePosted ?? null,
      validThrough: jp.validThrough ?? null,
      identifier: jp.identifier ?? null,
      jobLocationType: jp.jobLocationType ?? null,
    },
  };
}

function normalizeFeedJob(
  entry: ExtractedFeedJob,
  config: SourceConfig
): NormalizedJob {
  const canonicalUrl = resolveMaybeRelativeUrl(entry.link, entry.feedUrl);
  const externalId =
    nonEmptyString(entry.id) ??
    canonicalUrl ??
    stableHashId(entry.kind, entry.title, entry.publishedAt, entry.feedUrl);

  const companyName =
    nonEmptyString(config.companyName) ??
    nonEmptyString(config.displayName) ??
    nonEmptyString(entry.author) ??
    nonEmptyString(entry.feedTitle) ??
    "Unknown Company";

  const { descriptionText, descriptionHtmlSanitized } = normalizeDescription(
    entry.description,
    entry.description
  );

  const locationText = nonEmptyString(entry.location);

  return {
    externalId,
    title: entry.title,
    companyName,
    descriptionText,
    descriptionHtmlSanitized,
    locationText,
    countryCode: inferCountryCode(locationText),
    workplaceType: normalizeWorkplaceType(undefined, locationText),
    employmentType: null,
    seniorityMin: null,
    seniorityMax: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salarySourceType: null,
    employerPostedAt: parseFeedDateToIso(entry.publishedAt),
    sourceUpdatedAt: parseFeedDateToIso(entry.updatedAt),
    canonicalUrl,
    applyUrl: canonicalUrl,
    rawMetadata: {
      sourceType: "generic_career_page",
      format: entry.kind,
      feedUrl: entry.feedUrl,
      feedTitle: entry.feedTitle,
      publishedAt: entry.publishedAt,
      updatedAt: entry.updatedAt,
    },
  };
}

export const genericCareersConnector: JobSourceConnector = {
  async validate(config: SourceConfig): Promise<ValidationResult> {
    try {
      const rawUrl = resolveCareerPageUrl(config);
      if (isRestrictedAutomatedSourceUrl(rawUrl)) {
        return {
          valid: false,
          errorCode: "RESTRICTED_SOURCE",
          errorMessage:
            "Automated fetching of LinkedIn and Naukri is not permitted. Use manual import to paste the job description and store the URL as a reference.",
        };
      }
      const parsed = await validateStaticOrConfiguredUrl(rawUrl, config);
      return {
        valid: true,
        normalizedBaseUrl: canonicalizeJobUrl(parsed.toString()) ?? parsed.toString(),
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
    const rawUrl = resolveCareerPageUrl(config);
    if (isRestrictedAutomatedSourceUrl(rawUrl)) {
      throw new ConnectorError(
        "RESTRICTED_SOURCE",
        "Automated fetching of LinkedIn and Naukri is not permitted. Use manual import instead.",
        { retryable: false }
      );
    }

    const parsed = await validateStaticOrConfiguredUrl(rawUrl, config);
    const fetchedAt = new Date().toISOString();

    const response = await fetchPublicWithConditional(parsed.toString(), config, {
      accept:
        "application/ld+json, application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9",
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

    throwIfHttpErrorStatus(response.status, "Career page");

    const extractedJobs = extractStructuredJobsFromDocument(
      response.text(),
      response.url,
      response.headers.get("content-type")
    );

    return {
      jobs: extractedJobs,
      isCompleteSnapshot: true,
      fetchedAt,
      sourceEtag: response.headers.get("etag") ?? undefined,
      sourceLastModified: response.headers.get("last-modified") ?? undefined,
    };
  },

  normalize(raw: unknown, config: SourceConfig): NormalizedJob[] {
    if (typeof raw === "string") {
      const pageUrl =
        nonEmptyString(config.baseUrl) ?? "https://example.invalid/careers";
      const extracted = extractStructuredJobsFromDocument(raw, pageUrl);
      return extracted.map((item) =>
        item.kind === "jsonld"
          ? normalizeJsonLdJob(item, config)
          : normalizeFeedJob(item, config)
      );
    }

    const items = Array.isArray(raw)
      ? raw
      : isRecord(raw) && Array.isArray(raw.jobs)
        ? raw.jobs
        : [raw];

    return items.map((item) => {
      if (!isRecord(item)) {
        throw new ConnectorError(
          "MALFORMED_RESPONSE",
          "Generic career item must be an object.",
          { retryable: false }
        );
      }

      if (item.kind === "jsonld" && isRecord(item.item)) {
        return normalizeJsonLdJob(item as unknown as ExtractedJsonLdJob, config);
      }

      if (item.kind === "rss" || item.kind === "atom") {
        return normalizeFeedJob(item as unknown as ExtractedFeedJob, config);
      }

      if (isJobPostingType(item["@type"])) {
        const pageUrl =
          nonEmptyString(config.baseUrl) ?? "https://example.invalid/careers";
        return normalizeJsonLdJob(
          { kind: "jsonld", pageUrl, item },
          config
        );
      }

      throw new ConnectorError(
        "UNSUPPORTED_STRUCTURE",
        "Item is not a supported Schema.org JobPosting or RSS/Atom entry.",
        { retryable: false }
      );
    });
  },
};

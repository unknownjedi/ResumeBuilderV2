import * as cheerio from "cheerio";
import sanitizeHtml from "sanitize-html";
import type { DnsLookupFn } from "../security/ssrf";

export type ConnectorErrorCode =
  | "NETWORK_TIMEOUT"
  | "RATE_LIMITED"
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "UNSUPPORTED_STRUCTURE"
  | "MALFORMED_RESPONSE"
  | "PARTIAL_PAGINATION"
  | "INVALID_CONFIG"
  | "RESTRICTED_SOURCE";

const DEFAULT_RETRYABLE_CODES: ReadonlySet<ConnectorErrorCode> = new Set([
  "NETWORK_TIMEOUT",
  "RATE_LIMITED",
]);

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    options?: {
      retryable?: boolean;
      httpStatus?: number;
      cause?: unknown;
    }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ConnectorError";
    this.code = code;
    this.retryable = options?.retryable ?? DEFAULT_RETRYABLE_CODES.has(code);
    this.httpStatus = options?.httpStatus;
  }
}

export type ConnectorSourceType =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "generic_career_page"
  | "manual";

export type WorkplaceType = "remote" | "hybrid" | "onsite" | "unspecified";
export type SalaryPeriod = "hour" | "month" | "year" | "unknown";
export type SalarySourceType = "employer_disclosed" | "unknown";

export interface SourceConfig {
  id?: string;
  sourceType: ConnectorSourceType | (string & {});
  displayName?: string;
  companyName?: string;
  sourceIdentifier?: string | null;
  baseUrl?: string | null;
  lastEtag?: string | null;
  lastModified?: string | null;
  config?: Record<string, unknown>;
  /** Optional dependency injection overrides for tests or custom transport. */
  fetchImpl?: typeof fetch;
  lookup?: DnsLookupFn;
  timeoutMs?: number;
}

export interface ValidationResult {
  valid: boolean;
  normalizedIdentifier?: string;
  normalizedBaseUrl?: string;
  errorCode?: ConnectorErrorCode;
  errorMessage?: string;
  warnings?: string[];
}

export interface FetchBatch {
  jobs: unknown[];
  nextCursor?: string;
  isCompleteSnapshot: boolean;
  fetchedAt: string; // ISO-8601 UTC
  sourceEtag?: string;
  sourceLastModified?: string;
  /** True when the remote source returned HTTP 304 Not Modified. */
  notModified?: boolean;
}

export interface NormalizedJob {
  externalId: string;
  title: string;
  companyName: string;
  descriptionText: string;
  descriptionHtmlSanitized: string | null;
  locationText: string | null;
  countryCode: string | null;
  workplaceType: WorkplaceType;
  employmentType: string | null;
  seniorityMin: number | null;
  seniorityMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salarySourceType: SalarySourceType | null;
  employerPostedAt: string | null;
  sourceUpdatedAt: string | null;
  canonicalUrl: string | null;
  applyUrl: string | null;
  rawMetadata: Record<string, unknown>;
}

export interface JobSourceConnector {
  validate(config: SourceConfig): Promise<ValidationResult>;
  fetch(config: SourceConfig, cursor?: string): Promise<FetchBatch>;
  normalize(raw: unknown, config: SourceConfig): NormalizedJob[];
}

const ALLOWED_JOB_HTML_TAGS = [
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
];

const SANITIZE_JOB_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_JOB_HTML_TAGS,
  allowedAttributes: {
    a: ["href", "rel"],
  },
  allowedSchemes: ["http", "https"],
  allowedSchemesByTag: {
    a: ["http", "https"],
  },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (_tagName, attribs): sanitizeHtml.Tag => {
      const rawHref = typeof attribs.href === "string" ? attribs.href.trim() : "";
      if (rawHref) {
        try {
          const parsed = new URL(rawHref);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return {
              tagName: "a",
              attribs: {
                href: parsed.toString(),
                rel: "noopener noreferrer",
              },
            };
          }
        } catch {
          // Invalid or relative URL; drop the anchor tag while keeping text
        }
      }
      const emptyAttribs: sanitizeHtml.Attributes = {};
      return { tagName: "span", attribs: emptyAttribs };
    },
  },
};

const TRACKING_QUERY_PARAMS = new Set([
  "gh_src",
  "ref",
  "ref_src",
  "referrer",
  "source",
  "src",
  "trk",
  "trkinfo",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "hsctatracking",
  "lever-source",
  "lever-origin",
  "igshid",
]);

/**
 * Sanitizes untrusted job description HTML using a strict tag/attribute allowlist
 * and extracts normalized plain text using Cheerio.
 */
export function sanitizeJobHtml(rawHtml: string): { html: string; text: string } {
  if (!rawHtml || !rawHtml.trim()) {
    return { html: "", text: "" };
  }

  const sanitized = sanitizeHtml(rawHtml, SANITIZE_JOB_HTML_OPTIONS).trim();
  if (!sanitized) {
    return { html: "", text: "" };
  }

  const $ = cheerio.load(sanitized, null, false);
  $("br").replaceWith("\n");
  $("li").each((_idx, el) => {
    const node = $(el);
    node.prepend("\n- ");
  });
  $("p, h1, h2, h3, h4, h5, h6, ul, ol").each((_idx, el) => {
    const node = $(el);
    node.prepend("\n");
    node.append("\n");
  });

  const extracted = $.text()
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    html: sanitized,
    text: extracted,
  };
}

/**
 * Canonicalizes a public HTTP(S) job URL by stripping tracking query parameters,
 * normalizing the trailing path slash, and sorting remaining query parameters.
 * Returns null for blank, unparseable, or non-HTTP(S) URLs.
 */
export function canonicalizeJobUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const keptEntries: Array<[string, string]> = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(lower)) {
      continue;
    }
    keptEntries.push([key, value]);
  }

  keptEntries.sort(([aKey, aVal], [bKey, bVal]) => {
    if (aKey !== bKey) return aKey.localeCompare(bKey);
    return aVal.localeCompare(bVal);
  });

  parsed.search = "";
  for (const [key, value] of keptEntries) {
    parsed.searchParams.append(key, value);
  }

  if (parsed.pathname.length > 1) {
    const stripped = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = stripped || "/";
  }

  return parsed.toString();
}

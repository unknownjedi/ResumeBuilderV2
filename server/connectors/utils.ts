import crypto from "node:crypto";
import net from "node:net";
import {
  isPrivateOrReservedIp,
  safeFetchPublicUrl,
  SsrfError,
  validatePublicHttpUrl,
  type SafeFetchResult,
} from "../security/ssrf";
import {
  canonicalizeJobUrl,
  ConnectorError,
  sanitizeJobHtml,
  type SalaryPeriod,
  type SourceConfig,
  type WorkplaceType,
} from "./types";

export const DEFAULT_CONNECTOR_USER_AGENT =
  "PersonalJobCopilot/0.1 (local-first job discovery)";

const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function mapSsrfErrorToConnectorError(err: unknown): ConnectorError {
  if (err instanceof ConnectorError) {
    return err;
  }

  if (err instanceof SsrfError) {
    switch (err.code) {
      case "REQUEST_TIMEOUT":
      case "DNS_RESOLUTION_FAILED":
      case "TOO_MANY_REDIRECTS":
      case "FETCH_FAILED":
        return new ConnectorError("NETWORK_TIMEOUT", err.message, {
          retryable: true,
          cause: err,
        });
      case "INVALID_URL":
      case "BLOCKED_PROTOCOL":
      case "CREDENTIALS_NOT_ALLOWED":
        return new ConnectorError("INVALID_CONFIG", err.message, {
          retryable: false,
          cause: err,
        });
      case "BLOCKED_HOST":
        return new ConnectorError("ACCESS_DENIED", err.message, {
          retryable: false,
          cause: err,
        });
      case "RESPONSE_TOO_LARGE":
        return new ConnectorError("MALFORMED_RESPONSE", err.message, {
          retryable: false,
          cause: err,
        });
    }
  }

  return new ConnectorError(
    "NETWORK_TIMEOUT",
    err instanceof Error ? err.message : "Network request failed.",
    { retryable: true, cause: err }
  );
}

export function throwIfHttpErrorStatus(status: number, sourceLabel: string): void {
  if (status >= 200 && status < 300) return;

  if (status === 429) {
    throw new ConnectorError(
      "RATE_LIMITED",
      `${sourceLabel} rate limit exceeded (HTTP 429).`,
      { retryable: true, httpStatus: status }
    );
  }

  if (status === 401 || status === 403) {
    throw new ConnectorError(
      "ACCESS_DENIED",
      `${sourceLabel} denied access (HTTP ${status}).`,
      { retryable: false, httpStatus: status }
    );
  }

  if (status === 404 || status === 410) {
    throw new ConnectorError(
      "NOT_FOUND",
      `${sourceLabel} was not found (HTTP ${status}).`,
      { retryable: false, httpStatus: status }
    );
  }

  if (status >= 500) {
    throw new ConnectorError(
      "NETWORK_TIMEOUT",
      `${sourceLabel} returned a server error (HTTP ${status}).`,
      { retryable: true, httpStatus: status }
    );
  }

  throw new ConnectorError(
    "MALFORMED_RESPONSE",
    `${sourceLabel} returned unexpected HTTP status ${status}.`,
    { retryable: false, httpStatus: status }
  );
}

export async function fetchPublicWithConditional(
  url: string,
  config: SourceConfig,
  options?: {
    accept?: string;
    useConditionalHeaders?: boolean;
    extraHeaders?: Record<string, string>;
  }
): Promise<SafeFetchResult> {
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_CONNECTOR_USER_AGENT,
    Accept: options?.accept ?? "application/json, text/html;q=0.9, */*;q=0.8",
    ...options?.extraHeaders,
  };

  if (options?.useConditionalHeaders !== false) {
    if (config.lastEtag) {
      headers["If-None-Match"] = config.lastEtag;
    }
    if (config.lastModified) {
      headers["If-Modified-Since"] = config.lastModified;
    }
  }

  try {
    return await safeFetchPublicUrl(url, {
      method: "GET",
      headers,
      fetchImpl: config.fetchImpl,
      lookup: config.lookup,
      timeoutMs: config.timeoutMs,
    });
  } catch (err) {
    throw mapSsrfErrorToConnectorError(err);
  }
}

export async function validateStaticOrConfiguredUrl(
  urlString: string,
  config?: SourceConfig
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlString.trim());
  } catch (err) {
    throw new ConnectorError("INVALID_CONFIG", "Invalid URL format.", {
      retryable: false,
      cause: err,
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConnectorError(
      "INVALID_CONFIG",
      `Unsupported URL protocol ${parsed.protocol}; expected http or https.`,
      { retryable: false }
    );
  }

  if (parsed.username || parsed.password) {
    throw new ConnectorError(
      "INVALID_CONFIG",
      "URLs containing embedded credentials are not allowed.",
      { retryable: false }
    );
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").trim().toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new ConnectorError("ACCESS_DENIED", "Local hostnames are not permitted.", {
      retryable: false,
    });
  }

  if (net.isIP(hostname) !== 0 && isPrivateOrReservedIp(hostname)) {
    throw new ConnectorError(
      "ACCESS_DENIED",
      "Target IP address is in a private or reserved range.",
      { retryable: false }
    );
  }

  if (config?.lookup) {
    try {
      await validatePublicHttpUrl(parsed.toString(), { lookup: config.lookup });
    } catch (err) {
      throw mapSsrfErrorToConnectorError(err);
    }
  }

  return parsed;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/**
 * Strictly parses an ISO-8601 date or timestamp string into a UTC ISO-8601 string.
 * Returns null for invalid, relative, or calendar-overflow dates (e.g. 2026-02-31).
 */
export function parseIso8601Date(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;

  const dateOnly = ISO_DATE_ONLY_RE.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return new Date(Date.UTC(year, month - 1, day)).toISOString();
  }

  const dateTime = ISO_DATETIME_RE.exec(raw);
  if (!dateTime) return null;

  const year = Number(dateTime[1]);
  const month = Number(dateTime[2]);
  const day = Number(dateTime[3]);
  const hour = Number(dateTime[4]);
  const minute = Number(dateTime[5]);
  const second = dateTime[6] ? Number(dateTime[6]) : 0;

  if (!isValidCalendarDate(year, month, day)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  // Normalize "+0000" style offset without colon if needed for Date.parse
  const normalizedInput = raw.replace(
    /([+-]\d{2})(\d{2})$/,
    "$1:$2"
  );
  const ms = Date.parse(normalizedInput);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Converts a finite epoch-millisecond timestamp into an ISO-8601 UTC string.
 */
export function parseEpochMsToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  // Sanity guard against seconds passed instead of ms or absurd far-future values
  // 1995-01-01T00:00:00Z = 788918400000, 2100-01-01T00:00:00Z = 4102444800000
  if (value < 788_918_400_000 || value > 4_102_444_800_000) {
    return null;
  }
  return new Date(value).toISOString();
}

/**
 * Parses ISO-8601 or RFC 2822 feed dates (e.g., RSS pubDate or Atom published).
 */
export function parseFeedDateToIso(value: unknown): string | null {
  const iso = parseIso8601Date(value);
  if (iso) return iso;

  const raw = nonEmptyString(value);
  if (!raw) return null;

  // Require an explicit 4-digit year so relative phrases never parse
  if (!/\b\d{4}\b/.test(raw)) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decodes HTML entities (used by feeds such as Greenhouse `content` that return
 * HTML-entity-encoded HTML fragments). Decodes `&amp;` last so double-encoded
 * entities stay safe.
 */
export function decodeHtmlEntities(input: string): string {
  if (!input || !input.includes("&")) return input;

  return input
    .replace(/&#(\d+);/g, (match, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(/&(lt|gt|quot|apos|nbsp);/gi, (_match, name: string) => {
      return NAMED_HTML_ENTITIES[name.toLowerCase()] ?? _match;
    })
    .replace(/&amp;/gi, "&");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Converts HTML or plain text into `{ descriptionText, descriptionHtmlSanitized }`.
 */
export function normalizeDescription(
  rawHtml: string | null | undefined,
  rawPlain: string | null | undefined
): { descriptionText: string; descriptionHtmlSanitized: string | null } {
  const htmlCandidate = nonEmptyString(rawHtml);
  if (htmlCandidate) {
    const { html, text } = sanitizeJobHtml(htmlCandidate);
    if (text) {
      return {
        descriptionText: text,
        descriptionHtmlSanitized: html || null,
      };
    }
  }

  const plainCandidate = nonEmptyString(rawPlain);
  if (plainCandidate) {
    const normalizedPlain = plainCandidate.replace(/\r\n/g, "\n").trim();
    return {
      descriptionText: normalizedPlain,
      descriptionHtmlSanitized: null,
    };
  }

  return {
    descriptionText: "",
    descriptionHtmlSanitized: null,
  };
}

export function normalizeWorkplaceType(
  explicitValue: unknown,
  locationText?: string | null
): WorkplaceType {
  const raw = nonEmptyString(explicitValue)?.toLowerCase();
  if (raw) {
    if (raw === "remote" || raw === "telecommute" || raw.includes("remote")) {
      return "remote";
    }
    if (raw === "hybrid" || raw.includes("hybrid")) {
      return "hybrid";
    }
    if (
      raw === "onsite" ||
      raw === "on-site" ||
      raw === "on_site" ||
      raw === "in-person" ||
      raw === "in_person" ||
      raw === "office"
    ) {
      return "onsite";
    }
  }

  if (locationText) {
    const loc = locationText.toLowerCase();
    if (/\bhybrid\b/.test(loc)) return "hybrid";
    if (/\bremote\b/.test(loc) && !/\bnot remote\b/.test(loc)) return "remote";
    if (/\bon-?site\b/.test(loc)) return "onsite";
  }

  return "unspecified";
}

export function normalizeSalaryPeriod(value: unknown): SalaryPeriod | null {
  const raw = nonEmptyString(value)?.toLowerCase();
  if (!raw) return null;

  if (
    raw === "year" ||
    raw === "yearly" ||
    raw === "annual" ||
    raw === "annually" ||
    raw === "yr" ||
    raw === "1 year" ||
    raw === "per-year-salary"
  ) {
    return "year";
  }

  if (
    raw === "month" ||
    raw === "monthly" ||
    raw === "mo" ||
    raw === "1 month" ||
    raw === "per-month-salary"
  ) {
    return "month";
  }

  if (
    raw === "hour" ||
    raw === "hourly" ||
    raw === "hr" ||
    raw === "1 hour" ||
    raw === "per-hour-wage" ||
    raw === "per-hour-salary"
  ) {
    return "hour";
  }

  return "unknown";
}

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  us: "US",
  "united kingdom": "GB",
  uk: "GB",
  "great britain": "GB",
  canada: "CA",
  germany: "DE",
  india: "IN",
  australia: "AU",
  france: "FR",
  singapore: "SG",
  netherlands: "NL",
  ireland: "IE",
  spain: "ES",
  poland: "PL",
  brazil: "BR",
  japan: "JP",
};

export function inferCountryCode(
  locationText: string | null,
  explicitCountry?: unknown
): string | null {
  const explicit = nonEmptyString(explicitCountry);
  if (explicit) {
    if (/^[A-Za-z]{2}$/.test(explicit)) {
      return explicit.toUpperCase();
    }
    const mapped = COUNTRY_NAME_TO_CODE[explicit.toLowerCase()];
    if (mapped) return mapped;
  }

  if (!locationText) return null;

  const segments = locationText
    .split(/[,/|-]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  for (let i = segments.length - 1; i >= 0; i--) {
    const mapped = COUNTRY_NAME_TO_CODE[segments[i]];
    if (mapped) return mapped;
  }

  return null;
}

export function extractRawItems(raw: unknown, wrapperKey: string): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (isRecord(raw)) {
    const nested = raw[wrapperKey];
    if (Array.isArray(nested)) {
      return nested;
    }
    return [raw];
  }
  throw new ConnectorError(
    "MALFORMED_RESPONSE",
    "Expected an object or array of raw job items.",
    { retryable: false }
  );
}

export function stableHashId(prefix: string, ...parts: Array<string | null | undefined>): string {
  const input = parts.map((p) => p ?? "").join("\u0000");
  const digest = crypto.createHash("sha256").update(input).digest("hex").slice(0, 24);
  return `${prefix}:${digest}`;
}

export function safeCanonicalUrl(value: unknown): string | null {
  const str = nonEmptyString(value);
  return str ? canonicalizeJobUrl(str) : null;
}

const RESTRICTED_AUTOMATED_DOMAINS = ["linkedin.com", "naukri.com"] as const;

/**
 * Returns true if the URL targets a restricted domain (LinkedIn or Naukri)
 * that must not be fetched automatically by MVP connectors.
 * Restricted URLs may still be saved as reference URLs when the user pastes JD text manually.
 */
export function isRestrictedAutomatedSourceUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.replace(/\.+$/, "").toLowerCase();
  if (!hostname) return false;

  return RESTRICTED_AUTOMATED_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}


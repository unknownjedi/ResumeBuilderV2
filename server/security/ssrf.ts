import dns from "node:dns/promises";
import net from "node:net";

export type SsrfErrorCode =
  | "INVALID_URL"
  | "BLOCKED_PROTOCOL"
  | "CREDENTIALS_NOT_ALLOWED"
  | "BLOCKED_HOST"
  | "DNS_RESOLUTION_FAILED"
  | "TOO_MANY_REDIRECTS"
  | "RESPONSE_TOO_LARGE"
  | "REQUEST_TIMEOUT"
  | "FETCH_FAILED";

export class SsrfError extends Error {
  readonly code: SsrfErrorCode;

  constructor(code: SsrfErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SsrfError";
    this.code = code;
  }
}

export interface LookupAddress {
  address: string;
  family: number;
}

export type DnsLookupFn = (hostname: string) => Promise<LookupAddress[]>;

export interface ValidatePublicUrlOptions {
  lookup?: DnsLookupFn;
}

export interface ValidatedPublicUrl {
  url: URL;
  addresses: LookupAddress[];
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  lookup?: DnsLookupFn;
  fetchImpl?: typeof fetch;
}

export interface SafeFetchResult {
  status: number;
  statusText: string;
  headers: Headers;
  url: string;
  body: Buffer;
  text: () => string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

function parseIpv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function ipv4InCidr(ipUint32: number, baseIp: string, prefixLen: number): boolean {
  const base = parseIpv4ToUint32(baseIp);
  if (base === null) return false;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipUint32 & mask) === (base & mask);
}

function isBlockedIpv4(ip: string): boolean {
  const n = parseIpv4ToUint32(ip);
  if (n === null) return true;

  return (
    ipv4InCidr(n, "0.0.0.0", 8) || // "This" network / unspecified
    ipv4InCidr(n, "10.0.0.0", 8) || // RFC 1918 private
    ipv4InCidr(n, "100.64.0.0", 10) || // CGNAT RFC 6598
    ipv4InCidr(n, "127.0.0.0", 8) || // Loopback
    ipv4InCidr(n, "169.254.0.0", 16) || // Link-local
    ipv4InCidr(n, "172.16.0.0", 12) || // RFC 1918 private
    ipv4InCidr(n, "192.0.0.0", 24) || // IETF protocol assignments
    ipv4InCidr(n, "192.0.2.0", 24) || // TEST-NET-1
    ipv4InCidr(n, "192.88.99.0", 24) || // 6to4 relay anycast
    ipv4InCidr(n, "192.168.0.0", 16) || // RFC 1918 private
    ipv4InCidr(n, "198.18.0.0", 15) || // Benchmarking
    ipv4InCidr(n, "198.51.100.0", 24) || // TEST-NET-2
    ipv4InCidr(n, "203.0.113.0", 24) || // TEST-NET-3
    ipv4InCidr(n, "224.0.0.0", 4) || // Multicast
    ipv4InCidr(n, "240.0.0.0", 4) // Reserved + broadcast 255.255.255.255
  );
}

function expandIpv6ToBytes(ip: string): Uint8Array | null {
  if (ip.includes("%")) return null;

  const lastColon = ip.lastIndexOf(":");
  let normalized = ip;
  if (ip.includes(".") && lastColon !== -1) {
    const ipv4Part = ip.slice(lastColon + 1);
    const ipv4Uint = parseIpv4ToUint32(ipv4Part);
    if (ipv4Uint === null) return null;
    const high = ((ipv4Uint >>> 16) & 0xffff).toString(16);
    const low = (ipv4Uint & 0xffff).toString(16);
    normalized = `${ip.slice(0, lastColon)}:${high}:${low}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const tokens = part.split(":");
    const groups: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(token)) return null;
      groups.push(parseInt(token, 16));
    }
    return groups;
  };

  let groups: number[];
  if (halves.length === 2) {
    const left = parseGroups(halves[0]);
    const right = parseGroups(halves[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    const parsed = parseGroups(normalized);
    if (!parsed || parsed.length !== 8) return null;
    groups = parsed;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  return bytes;
}

function isBlockedIpv6(ip: string): boolean {
  const bytes = expandIpv6ToBytes(ip);
  if (!bytes) return true;

  const isAllZeroPrefix = (count: number): boolean => {
    for (let i = 0; i < count; i++) {
      if (bytes[i] !== 0) return false;
    }
    return true;
  };

  // ::/128 unspecified
  if (isAllZeroPrefix(16)) return true;

  // ::1/128 loopback
  if (isAllZeroPrefix(15) && bytes[15] === 1) return true;

  // ::ffff:0:0/96 IPv4-mapped IPv6
  if (isAllZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    const embeddedV4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isBlockedIpv4(embeddedV4);
  }

  // ::/96 deprecated IPv4-compatible IPv6
  if (isAllZeroPrefix(12)) {
    const embeddedV4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isBlockedIpv4(embeddedV4);
  }

  // 64:ff9b::/96 NAT64 well-known prefix and 64:ff9b:1::/48 local-use NAT64
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (bytes[4] === 0x00 && bytes[5] === 0x01) {
      return true;
    }
    if (
      bytes[4] === 0 &&
      bytes[5] === 0 &&
      bytes[6] === 0 &&
      bytes[7] === 0 &&
      bytes[8] === 0 &&
      bytes[9] === 0 &&
      bytes[10] === 0 &&
      bytes[11] === 0
    ) {
      const embeddedV4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
      return isBlockedIpv4(embeddedV4);
    }
  }

  // 100::/64 discard-only
  if (
    bytes[0] === 0x01 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0 &&
    bytes[3] === 0 &&
    bytes[4] === 0 &&
    bytes[5] === 0 &&
    bytes[6] === 0 &&
    bytes[7] === 0
  ) {
    return true;
  }

  // 2001::/32 Teredo, 2001:2::/48 benchmarking, 2001:db8::/32 documentation
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x00 && bytes[3] === 0x00) return true;
    if (bytes[2] === 0x00 && bytes[3] === 0x02 && bytes[4] === 0x00 && bytes[5] === 0x00) return true;
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  }

  // fc00::/7 unique local addresses
  if ((bytes[0] & 0xfe) === 0xfc) return true;

  // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;

  // fec0::/10 deprecated site-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true;

  // ff00::/8 multicast
  if (bytes[0] === 0xff) return true;

  return false;
}

/**
 * Returns true if the given IPv4 or IPv6 address belongs to a loopback,
 * private, link-local, CGNAT, multicast, or otherwise reserved non-public range.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "").trim();
  const family = net.isIP(clean);
  if (family === 4) {
    return isBlockedIpv4(clean);
  }
  if (family === 6) {
    return isBlockedIpv6(clean);
  }
  return true;
}

async function defaultDnsLookup(hostname: string): Promise<LookupAddress[]> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => ({
    address: entry.address,
    family: entry.family,
  }));
}

/**
 * Validates that a URL is an http/https URL without credentials and does not
 * target or resolve to any loopback, private, link-local, CGNAT, multicast, or reserved IP.
 */
export async function validatePublicHttpUrl(
  urlString: string,
  options?: ValidatePublicUrlOptions
): Promise<ValidatedPublicUrl> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch (err) {
    throw new SsrfError("INVALID_URL", "Invalid URL format.", { cause: err });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError("BLOCKED_PROTOCOL", `Protocol ${parsed.protocol} is not allowed.`);
  }

  if (parsed.username || parsed.password) {
    throw new SsrfError("CREDENTIALS_NOT_ALLOWED", "URLs containing embedded credentials are not allowed.");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").trim().toLowerCase();
  if (!hostname) {
    throw new SsrfError("INVALID_URL", "URL hostname is missing.");
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new SsrfError("BLOCKED_HOST", "Local hostnames are not permitted.");
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new SsrfError("BLOCKED_HOST", "Target IP address is in a blocked range.");
    }
    return {
      url: parsed,
      addresses: [{ address: hostname, family: net.isIP(hostname) }],
    };
  }

  const lookup = options?.lookup ?? defaultDnsLookup;
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname);
  } catch (err) {
    throw new SsrfError("DNS_RESOLUTION_FAILED", "Failed to resolve target hostname.", { cause: err });
  }

  if (!addresses || addresses.length === 0) {
    throw new SsrfError("DNS_RESOLUTION_FAILED", "Hostname did not resolve to any IP addresses.");
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr.address)) {
      throw new SsrfError("BLOCKED_HOST", "Target hostname resolved to a blocked IP range.");
    }
  }

  return { url: parsed, addresses };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function combineSignals(timeoutMs: number, externalSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new SsrfError("REQUEST_TIMEOUT", `Request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
    didTimeout: () => timedOut,
  };
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new SsrfError("RESPONSE_TOO_LARGE", `Response exceeds maximum allowed size of ${maxBytes} bytes.`);
    }
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SsrfError("RESPONSE_TOO_LARGE", `Response exceeded maximum allowed size of ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

/**
 * Performs an HTTP(S) fetch with SSRF validation, manual redirect verification
 * (up to maxRedirects hops), timeout enforcement, and bounded response reading.
 */
export async function safeFetchPublicUrl(
  urlString: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const fetchImpl = options.fetchImpl ?? fetch;

  let currentUrl = urlString;
  let currentMethod = (options.method ?? "GET").toUpperCase();
  let currentBody = options.body;

  const { signal, cleanup, didTimeout } = combineSignals(timeoutMs, options.signal);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const { url } = await validatePublicHttpUrl(currentUrl, { lookup: options.lookup });

      let response: Response;
      try {
        const requestBody: BodyInit | undefined =
          currentMethod === "GET" || currentMethod === "HEAD" || currentBody === undefined
            ? undefined
            : typeof currentBody === "string"
              ? currentBody
              : new Uint8Array(currentBody);

        response = await fetchImpl(url.toString(), {
          method: currentMethod,
          headers: options.headers,
          body: requestBody,
          redirect: "manual",
          signal,
        });
      } catch (err) {
        if (err instanceof SsrfError) throw err;
        if (didTimeout()) {
          throw new SsrfError("REQUEST_TIMEOUT", `Request timed out after ${timeoutMs}ms.`, { cause: err });
        }
        throw new SsrfError("FETCH_FAILED", "Network request failed.", { cause: err });
      }

      if (isRedirectStatus(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get("location");
        if (!location) {
          throw new SsrfError("FETCH_FAILED", `Redirect status ${response.status} missing Location header.`);
        }
        if (hop === maxRedirects) {
          throw new SsrfError("TOO_MANY_REDIRECTS", `Exceeded maximum of ${maxRedirects} redirects.`);
        }
        currentUrl = new URL(location, url).toString();
        if (response.status === 301 || response.status === 302 || response.status === 303) {
          currentMethod = "GET";
          currentBody = undefined;
        }
        continue;
      }

      const body = await readBoundedBody(response, maxBytes);
      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        url: url.toString(),
        body,
        text: () => body.toString("utf8"),
      };
    }

    throw new SsrfError("TOO_MANY_REDIRECTS", `Exceeded maximum of ${maxRedirects} redirects.`);
  } finally {
    cleanup();
  }
}

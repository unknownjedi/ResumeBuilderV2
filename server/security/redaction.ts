const REDACTED = "[REDACTED]";
const REDACTED_EMAIL = "[REDACTED_EMAIL]";

const SENSITIVE_KEY_EXACT = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "setcookie",
  "x-api-key",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "oauthtoken",
  "oauth_token",
  "secret",
  "password",
  "passwd",
  "privatekey",
  "private_key",
  "encryptionkey",
  "encryption_key",
  "credential",
  "credentials",
  "prompt",
  "systemprompt",
  "system_prompt",
  "userprompt",
  "user_prompt",
  "userpayload",
  "user_payload",
  "rawprompt",
  "raw_prompt",
  "rawtext",
  "raw_text",
  "extractedtext",
  "extracted_text",
  "resumetext",
  "resume_text",
  "coverlettertext",
  "cover_letter_text",
  "documentcontent",
  "document_content",
  "emailbody",
  "email_body",
  "bodytext",
  "body_text",
  "bodyhtml",
  "body_html",
  "jobdescription",
  "job_description",
  "descriptiontext",
  "description_text",
  "descriptionhtml",
  "description_html",
  "personaltext",
  "personal_text",
  "profilesummary",
  "profile_summary",
  "summary",
  "phone",
  "email",
  "address",
  "ssn",
]);

const SAFE_TOKEN_METADATA_KEYS = new Set([
  "tokenusage",
  "token_usage",
  "inputtokens",
  "input_tokens",
  "outputtokens",
  "output_tokens",
  "totaltokens",
  "total_tokens",
  "promptversion",
  "prompt_version",
  "prompthash",
  "prompt_hash",
]);

const SENSITIVE_KEY_SUBSTRING_RE = /(api_?key|secret|password|passwd|cookie|oauth|credential|private_?key|encryption_?key|auth_?header|access_?token|refresh_?token|bearer)/i;

const STRING_REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`],
  [/(?:sk-proj-|sk-ant-|sk-)[A-Za-z0-9_-]{12,}/g, REDACTED],
  [/AIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/([?&](?:api_?key|token|access_token|refresh_token|code|secret|password|key)=)[^&\s]+/gi, `$1${REDACTED}`],
  [/(https?:\/\/)([^:@\s/]+):([^@\s/]+)@/gi, `$1${REDACTED}:${REDACTED}@`],
  [/((?:cookie|set-cookie|authorization|x-api-key)\s*[:=]\s*)[^\r\n;]+/gi, `$1${REDACTED}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTED_EMAIL],
];

/**
 * Scrubs API keys, bearer tokens, URL query secrets, cookie headers,
 * embedded credentials, and email addresses from arbitrary strings.
 */
export function redactString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of STRING_REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Redacts local filesystem user/home directory prefixes from diagnostic strings.
 */
export function redactPaths(input: string): string {
  return input
    .replace(/\/Users\/[^/\s]+/g, "/Users/[REDACTED]")
    .replace(/\/home\/[^/\s]+/g, "/home/[REDACTED]")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, "C:\\Users\\[REDACTED]");
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (SAFE_TOKEN_METADATA_KEYS.has(normalized)) {
    return false;
  }
  if (SENSITIVE_KEY_EXACT.has(normalized)) {
    return true;
  }
  if (normalized.endsWith("token") && !normalized.endsWith("tokens")) {
    return true;
  }
  return SENSITIVE_KEY_SUBSTRING_RE.test(normalized);
}

/**
 * Recursively clones and redacts secrets, prompts, cookies, and personal text
 * from structured log or diagnostic payloads.
 */
export function redactValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactPaths(redactString(value));
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    const errRecord = value as Error & { code?: unknown };
    return {
      name: value.name,
      code: typeof errRecord.code === "string" ? errRecord.code : undefined,
      message: redactPaths(redactString(value.message)),
    };
  }
  if (depth >= 8) {
    return "[TRUNCATED]";
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(v, depth + 1, seen);
    }
  }
  return out;
}

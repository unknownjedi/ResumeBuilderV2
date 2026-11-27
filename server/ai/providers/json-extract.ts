import { z } from "zod";
import { redactPaths, redactString } from "../../security/redaction";
import { AiProviderError, type TokenUsage } from "../types";

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(trimmed);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

function tryParseExactJson(raw: string): unknown | undefined {
  const cleaned = stripMarkdownFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}

function findBalancedJsonSubstring(text: string): string | null {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  let openChar = "{";
  let closeChar = "}";

  if (startObj !== -1 && (startArr === -1 || startObj < startArr)) {
    start = startObj;
    openChar = "{";
    closeChar = "}";
  } else if (startArr !== -1) {
    start = startArr;
    openChar = "[";
    closeChar = "]";
  }

  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function tryParseJson(raw: string): unknown | undefined {
  const exact = tryParseExactJson(raw);
  if (exact !== undefined) return exact;

  const cleaned = stripMarkdownFences(raw);
  const balanced = findBalancedJsonSubstring(cleaned);
  if (!balanced) return undefined;
  try {
    return JSON.parse(balanced);
  } catch {
    return undefined;
  }
}

function extractUsageFromRecord(record: Record<string, unknown>): TokenUsage | undefined {
  const partObj =
    typeof record.part === "object" && record.part !== null
      ? (record.part as Record<string, unknown>)
      : null;

  const usageObj =
    (typeof record.usage === "object" && record.usage !== null
      ? (record.usage as Record<string, unknown>)
      : null) ??
    (typeof record.stats === "object" && record.stats !== null
      ? (record.stats as Record<string, unknown>)
      : null) ??
    (partObj && typeof partObj.tokens === "object" && partObj.tokens !== null
      ? (partObj.tokens as Record<string, unknown>)
      : null);

  if (!usageObj) {
    if (typeof record.total_cost_usd === "number") {
      return { costUsd: record.total_cost_usd };
    }
    if (partObj && typeof partObj.cost === "number") {
      return { costUsd: partObj.cost };
    }
    return undefined;
  }

  const inputTokens =
    typeof usageObj.input_tokens === "number"
      ? usageObj.input_tokens
      : typeof usageObj.prompt_tokens === "number"
        ? usageObj.prompt_tokens
        : typeof usageObj.input === "number"
          ? usageObj.input
          : undefined;
  const outputTokens =
    typeof usageObj.output_tokens === "number"
      ? usageObj.output_tokens
      : typeof usageObj.completion_tokens === "number"
        ? usageObj.completion_tokens
        : typeof usageObj.output === "number"
          ? usageObj.output
          : undefined;
  const totalTokens =
    typeof usageObj.total_tokens === "number"
      ? usageObj.total_tokens
      : typeof usageObj.total === "number"
        ? usageObj.total
        : inputTokens !== undefined && outputTokens !== undefined
          ? inputTokens + outputTokens
          : undefined;
  const costUsd =
    typeof record.total_cost_usd === "number"
      ? record.total_cost_usd
      : typeof usageObj.cost_usd === "number"
        ? usageObj.cost_usd
        : partObj && typeof partObj.cost === "number"
          ? partObj.cost
          : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    costUsd === undefined
  ) {
    return undefined;
  }

  return { inputTokens, outputTokens, totalTokens, costUsd };
}

function unwrapEnvelope(value: unknown, depth = 0): { payload: unknown; usage?: TokenUsage } {
  if (depth > 4 || value === null || typeof value !== "object" || Array.isArray(value)) {
    return { payload: value };
  }

  const record = value as Record<string, unknown>;
  const usage = extractUsageFromRecord(record);

  if (record.is_error === true) {
    throw new AiProviderError(
      "PROVIDER_UNAVAILABLE",
      "AI provider reported an execution error."
    );
  }

  if (record.structured_output !== undefined) {
    return { payload: record.structured_output, usage };
  }

  for (const key of ["result", "response", "output", "text", "content"] as const) {
    const inner = record[key];
    if (typeof inner === "string") {
      const parsedInner = tryParseJson(inner);
      if (parsedInner !== undefined) {
        const nested = unwrapEnvelope(parsedInner, depth + 1);
        return { payload: nested.payload, usage: usage ?? nested.usage };
      }
    } else if (inner !== undefined && typeof inner === "object") {
      const nested = unwrapEnvelope(inner, depth + 1);
      return { payload: nested.payload, usage: usage ?? nested.usage };
    }
  }

  if (typeof record.message === "object" && record.message !== null) {
    const nested = unwrapEnvelope(record.message, depth + 1);
    return { payload: nested.payload, usage: usage ?? nested.usage };
  }

  return { payload: value, usage };
}

function extractNdjsonErrorMessage(rec: Record<string, unknown>): string | null {
  if (rec.is_error !== true && rec.type !== "error") {
    return null;
  }
  const errObj =
    typeof rec.error === "object" && rec.error !== null
      ? (rec.error as Record<string, unknown>)
      : null;
  const rawMessage =
    (errObj && typeof errObj.message === "string" && errObj.message) ||
    (typeof rec.message === "string" && rec.message) ||
    (typeof rec.result === "string" && rec.result) ||
    "AI CLI reported an execution error.";
  const safe = redactPaths(redactString(rawMessage)).trim().slice(0, 200);
  return safe || "AI CLI reported an execution error.";
}

function parseNdjsonFallback(rawText: string): { payload: unknown; usage?: TokenUsage } | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const textParts: string[] = [];
  let usage: TokenUsage | undefined;
  let lastValidPayload: unknown;
  let parsedJsonLineCount = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedJsonLineCount++;
        const rec = parsed as Record<string, unknown>;

        const errorMsg = extractNdjsonErrorMessage(rec);
        if (errorMsg) {
          const lower = errorMsg.toLowerCase();
          if (lower.includes("rate limit") || lower.includes("429") || lower.includes("quota")) {
            throw new AiProviderError("RATE_LIMIT", errorMsg, { retryable: true });
          }
          throw new AiProviderError("PROVIDER_UNAVAILABLE", errorMsg, { retryable: false });
        }

        const lineUsage = extractUsageFromRecord(rec);
        if (lineUsage) usage = lineUsage;

        if (typeof rec.part === "object" && rec.part !== null) {
          const part = rec.part as Record<string, unknown>;
          if (
            (part.type === undefined || part.type === "text") &&
            typeof part.text === "string"
          ) {
            textParts.push(part.text);
          }
        }
        const unwrapped = unwrapEnvelope(rec);
        if (unwrapped.payload !== rec) {
          lastValidPayload = unwrapped.payload;
        }
      }
    } catch (err) {
      if (err instanceof AiProviderError) {
        throw err;
      }
      // Ignore non-JSON diagnostic lines in NDJSON output
    }
  }

  if (parsedJsonLineCount === 0) {
    return null;
  }

  if (textParts.length > 0) {
    const joined = tryParseJson(textParts.join(""));
    if (joined !== undefined) {
      return { payload: joined, usage };
    }
  }

  if (lastValidPayload !== undefined) {
    return { payload: lastValidPayload, usage };
  }

  return null;
}

/**
 * Extracts structured JSON from raw CLI or HTTP model output and validates it
 * strictly against the supplied Zod schema.
 */
export function parseAndValidateStructuredOutput<T>(
  rawText: string,
  schema: z.ZodType<T>
): { data: T; usage?: TokenUsage } {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new AiProviderError("INVALID_OUTPUT", "AI provider returned an empty response.");
  }

  let candidate: unknown;
  let usage: TokenUsage | undefined;

  const exactParsed = tryParseExactJson(trimmed);
  if (exactParsed !== undefined) {
    const directCheck = schema.safeParse(exactParsed);
    if (directCheck.success) {
      return { data: directCheck.data };
    }
    const unwrapped = unwrapEnvelope(exactParsed);
    candidate = unwrapped.payload;
    usage = unwrapped.usage;
  } else {
    const ndjson = parseNdjsonFallback(trimmed);
    if (ndjson) {
      candidate = ndjson.payload;
      usage = ndjson.usage;
    } else {
      const balancedParsed = tryParseJson(trimmed);
      if (balancedParsed === undefined) {
        throw new AiProviderError("INVALID_OUTPUT", "AI provider output did not contain valid JSON.");
      }
      const directCheck = schema.safeParse(balancedParsed);
      if (directCheck.success) {
        return { data: directCheck.data };
      }
      const unwrapped = unwrapEnvelope(balancedParsed);
      candidate = unwrapped.payload;
      usage = unwrapped.usage;
    }
  }

  const validated = schema.safeParse(candidate);
  if (!validated.success) {
    throw new AiProviderError(
      "INVALID_OUTPUT",
      `AI output failed schema validation: ${validated.error.issues[0]?.message ?? "schema mismatch"}`
    );
  }

  return { data: validated.data, usage };
}

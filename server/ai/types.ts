import { z } from "zod";

export const AI_PROVIDER_TYPES = [
  "none",
  "claude",
  "codex",
  "opencode",
  "agy",
  "gemini",
  "custom",
  "openai-compatible",
] as const;

export const AiProviderTypeSchema = z.enum(AI_PROVIDER_TYPES);
export type AiProviderType = z.infer<typeof AiProviderTypeSchema>;

export const CLI_PROVIDER_TYPES = [
  "claude",
  "codex",
  "opencode",
  "agy",
  "gemini",
  "custom",
] as const;

export type CliProviderType = (typeof CLI_PROVIDER_TYPES)[number];

export const AiConfigSchema = z.object({
  provider: AiProviderTypeSchema.default("none"),
  cliCommand: z.string().trim().max(256).default(""),
  cliArgsTemplate: z.string().trim().max(1024).default(""),
  model: z.string().trim().max(128).default(""),
  baseUrl: z.string().trim().max(512).default(""),
  temperature: z.number().min(0).max(2).default(0.2),
  timeoutMs: z.number().int().min(5_000).max(600_000).default(120_000),
  dataSharingAccepted: z.boolean().default(false),
  dailyAnalysisCap: z.number().int().min(1).max(500).default(25),
  actionAnalysisCap: z.number().int().min(1).max(100).default(10),
});

export type AiConfig = z.infer<typeof AiConfigSchema>;

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface LlmGenerateInput<T> {
  task: string;
  systemPrompt: string;
  userPayload: unknown;
  schema: z.ZodType<T>;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  taskId?: string;
  promptVersion?: string;
}

export interface LlmGenerateResult<T> {
  data: T;
  model: string;
  provider: AiProviderType;
  usage?: TokenUsage;
  latencyMs: number;
}

export interface LlmProvider {
  readonly id: AiProviderType;
  generateStructured<T>(input: LlmGenerateInput<T>): Promise<LlmGenerateResult<T>>;
}

export type AiErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "DATA_SHARING_NOT_ACCEPTED"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "INVALID_OUTPUT"
  | "FACTUALITY_FAILED"
  | "UNSUPPORTED_CAPABILITY"
  | "CANCELLED";

export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;

  constructor(
    code: AiErrorCode,
    message: string,
    options?: { retryable?: boolean; cause?: unknown }
  ) {
    super(message, { cause: options?.cause });
    this.name = "AiProviderError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export interface CliDetectionInfo {
  id: Exclude<CliProviderType, "custom">;
  command: string;
  available: boolean;
}

export interface AiProviderTestResult {
  ok: boolean;
  provider: AiProviderType;
  model: string;
  latencyMs: number;
  code?: AiErrorCode;
  message: string;
}

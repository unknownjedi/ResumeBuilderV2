import crypto from "node:crypto";
import { getDb, type AppDatabase } from "../../db/client";
import { aiRuns, type AiRunStatus } from "../../db/schema/system";
import { logger } from "../../logging/logger";
import { getSettings } from "../../services/settings";
import {
  AiProviderError,
  type AiConfig,
  type AiProviderTestResult,
  type LlmGenerateInput,
  type LlmGenerateResult,
  type LlmProvider,
} from "../types";
import { CliLlmProvider, testCliProvider } from "./cli-provider";
import {
  OpenAiCompatibleProvider,
  testOpenAiCompatibleProvider,
} from "./openai-compatible";

/**
 * Resolves the active AI configuration from persisted `app_settings` + env defaults.
 */
export function resolveEffectiveAiConfig(db: AppDatabase = getDb()): AiConfig {
  return getSettings(db).ai;
}

/**
 * Instantiates an LlmProvider adapter for the given AiConfig.
 */
export function createAiProvider(config: AiConfig): LlmProvider {
  switch (config.provider) {
    case "none":
      throw new AiProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "No AI provider is configured. Select a local AI CLI or OpenAI-compatible endpoint in Settings."
      );
    case "openai-compatible":
      return new OpenAiCompatibleProvider(config);
    case "claude":
    case "codex":
    case "opencode":
    case "agy":
    case "gemini":
    case "custom":
      return new CliLlmProvider(config.provider, config);
  }
}

export interface TrackedGenerateInput<T>
  extends Omit<LlmGenerateInput<T>, "model"> {
  model?: string;
  schemaVersion?: string;
  promptVersion?: string;
  db?: AppDatabase;
  configOverride?: Partial<AiConfig>;
}

function hashInput(
  task: string,
  promptVersion: string,
  schemaVersion: string,
  userPayload: unknown
): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        task,
        promptVersion,
        schemaVersion,
        userPayload,
      })
    )
    .digest("hex");
}

function mapErrorToRunStatus(err: AiProviderError): AiRunStatus {
  if (err.code === "INVALID_OUTPUT" || err.code === "FACTUALITY_FAILED") {
    return "rejected_validation";
  }
  if (err.code === "UNSUPPORTED_CAPABILITY") {
    return "refused";
  }
  return "failed";
}

function recordAiRun(
  db: AppDatabase,
  entry: {
    taskId?: string;
    taskType: string;
    provider: string;
    model: string;
    promptVersion: string;
    schemaVersion: string;
    inputHash: string;
    status: AiRunStatus;
    latencyMs: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    validationOutcome: string;
    errorCode?: string;
  }
): void {
  try {
    db.insert(aiRuns)
      .values({
        id: crypto.randomUUID(),
        taskId: entry.taskId ?? null,
        taskType: entry.taskType,
        provider: entry.provider,
        model: entry.model,
        promptVersion: entry.promptVersion,
        schemaVersion: entry.schemaVersion,
        inputHash: entry.inputHash,
        status: entry.status,
        latencyMs: entry.latencyMs,
        promptTokens: entry.promptTokens ?? null,
        completionTokens: entry.completionTokens ?? null,
        totalTokens: entry.totalTokens ?? null,
        estimatedCostUsd: entry.estimatedCostUsd ?? null,
        validationOutcome: entry.validationOutcome,
        errorCode: entry.errorCode ?? null,
        createdAt: new Date().toISOString(),
      })
      .run();
  } catch (err) {
    logger.warn("ai_run.record_failed", "Failed to persist ai_runs telemetry row.", {
      taskId: entry.taskId,
      errorCode: "AI_RUN_RECORD_FAILED",
      meta: { reason: err instanceof Error ? err.message : "unknown" },
    });
  }
}

/**
 * Executes a structured AI call using the effective settings and records
 * non-sensitive run telemetry in `ai_runs`.
 */
export async function generateStructuredWithTracking<T>(
  input: TrackedGenerateInput<T>
): Promise<LlmGenerateResult<T>> {
  const db = input.db ?? getDb();
  const baseConfig = resolveEffectiveAiConfig(db);
  const config: AiConfig = {
    ...baseConfig,
    ...(input.configOverride ?? {}),
  };

  if (config.provider === "none") {
    throw new AiProviderError(
      "PROVIDER_NOT_CONFIGURED",
      "No AI provider is configured. Select a local AI CLI or endpoint in Settings."
    );
  }

  if (!config.dataSharingAccepted) {
    throw new AiProviderError(
      "DATA_SHARING_NOT_ACCEPTED",
      "Accept the AI data-sharing disclosure in Settings before running AI features."
    );
  }

  const promptVersion = input.promptVersion ?? "v1";
  const schemaVersion = input.schemaVersion ?? "v1";
  const model = (input.model ?? config.model).trim() || config.provider;
  const inputHash = hashInput(
    input.task,
    promptVersion,
    schemaVersion,
    input.userPayload
  );

  const provider = createAiProvider(config);
  const startedAt = Date.now();

  try {
    const result = await provider.generateStructured({
      task: input.task,
      systemPrompt: input.systemPrompt,
      userPayload: input.userPayload,
      schema: input.schema,
      model,
      temperature: input.temperature ?? config.temperature,
      timeoutMs: input.timeoutMs ?? config.timeoutMs,
      signal: input.signal,
      taskId: input.taskId,
      promptVersion,
    });

    recordAiRun(db, {
      taskId: input.taskId,
      taskType: input.task,
      provider: result.provider,
      model: result.model,
      promptVersion,
      schemaVersion,
      inputHash,
      status: "succeeded",
      latencyMs: result.latencyMs,
      promptTokens: result.usage?.inputTokens,
      completionTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
      estimatedCostUsd: result.usage?.costUsd,
      validationOutcome: "valid",
    });

    logger.info("ai.generate.succeeded", "Structured AI generation completed.", {
      taskId: input.taskId,
      meta: {
        taskType: input.task,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        totalTokens: result.usage?.totalTokens,
      },
    });

    return result;
  } catch (err) {
    const aiErr =
      err instanceof AiProviderError
        ? err
        : new AiProviderError("PROVIDER_UNAVAILABLE", "AI generation failed.", {
            cause: err,
          });
    const latencyMs = Date.now() - startedAt;

    recordAiRun(db, {
      taskId: input.taskId,
      taskType: input.task,
      provider: config.provider,
      model,
      promptVersion,
      schemaVersion,
      inputHash,
      status: mapErrorToRunStatus(aiErr),
      latencyMs,
      validationOutcome:
        aiErr.code === "INVALID_OUTPUT" || aiErr.code === "FACTUALITY_FAILED"
          ? aiErr.code
          : "error",
      errorCode: aiErr.code,
    });

    logger.error("ai.generate.failed", "Structured AI generation failed.", {
      taskId: input.taskId,
      errorCode: aiErr.code,
      meta: {
        taskType: input.task,
        provider: config.provider,
        model,
        latencyMs,
      },
    });

    throw aiErr;
  }
}

/**
 * Tests the effective (or candidate) AI provider configuration without persisting settings.
 */
export async function testAiProviderConfig(
  candidateOverride?: Partial<AiConfig>,
  db: AppDatabase = getDb()
): Promise<AiProviderTestResult> {
  const effective = resolveEffectiveAiConfig(db);
  const config: AiConfig = {
    ...effective,
    ...(candidateOverride ?? {}),
  };

  if (config.provider === "none") {
    return {
      ok: false,
      provider: "none",
      model: "",
      latencyMs: 0,
      code: "PROVIDER_NOT_CONFIGURED",
      message: "No AI provider is selected.",
    };
  }

  if (config.provider === "openai-compatible") {
    return testOpenAiCompatibleProvider(config);
  }

  return testCliProvider(config.provider, config);
}

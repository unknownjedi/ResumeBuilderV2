import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import {
  tokenizeArgsTemplate,
  validateExecutableCommand,
} from "../ai/providers/cli-provider";
import {
  AiConfigSchema,
  AiProviderError,
  AiProviderTypeSchema,
  type AiConfig,
} from "../ai/types";
import { getDb, type AppDatabase } from "../db/client";
import { appSettings } from "../db/schema/system";

const SETTINGS_SCHEMA_VERSION = 1;
const SETTINGS_KEY_APP = "app_settings_v1";

export const AppSettingsSchema = z.object({
  ai: AiConfigSchema,
  autoAnalyzeJobs: z.boolean().default(false),
  defaultPaperSize: z.enum(["A4", "Letter"]).default("A4"),
  scheduledBackupsEnabled: z.boolean().default(false),
  backupRetentionCount: z.number().int().min(1).max(100).default(10),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const AiConfigPatchSchema = z
  .object({
    provider: AiProviderTypeSchema.optional(),
    cliCommand: z.string().trim().max(256).optional(),
    cliArgsTemplate: z.string().trim().max(1024).optional(),
    model: z.string().trim().max(128).optional(),
    baseUrl: z.string().trim().max(512).optional(),
    temperature: z.number().min(0).max(2).optional(),
    timeoutMs: z.number().int().min(5_000).max(600_000).optional(),
    dataSharingAccepted: z.boolean().optional(),
    dailyAnalysisCap: z.number().int().min(1).max(500).optional(),
    actionAnalysisCap: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const AppSettingsPatchSchema = z
  .object({
    ai: AiConfigPatchSchema.optional(),
    autoAnalyzeJobs: z.boolean().optional(),
    defaultPaperSize: z.enum(["A4", "Letter"]).optional(),
    scheduledBackupsEnabled: z.boolean().optional(),
    backupRetentionCount: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type AppSettingsPatch = z.infer<typeof AppSettingsPatchSchema>;

export interface AppSettingsRecord extends AppSettings {
  schemaVersion: number;
  updatedAt: string | null;
}

/**
 * Resolves first-run AI defaults from environment variables (non-secret values only).
 */
export function getDefaultAiConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): AiConfig {
  const rawProvider = env.AI_PROVIDER?.trim();
  const parsedProvider = AiProviderTypeSchema.safeParse(rawProvider);

  return AiConfigSchema.parse({
    provider: parsedProvider.success ? parsedProvider.data : "none",
    cliCommand: env.AI_CLI_COMMAND?.trim() ?? "",
    cliArgsTemplate: env.AI_CLI_ARGS_TEMPLATE?.trim() ?? "",
    model: env.AI_MODEL?.trim() ?? "",
    baseUrl: env.AI_BASE_URL?.trim() ?? "",
  });
}

export function getDefaultAppSettings(
  env: NodeJS.ProcessEnv = process.env
): AppSettings {
  return AppSettingsSchema.parse({
    ai: getDefaultAiConfigFromEnv(env),
    autoAnalyzeJobs: false,
    defaultPaperSize: "A4",
    scheduledBackupsEnabled: false,
    backupRetentionCount: 10,
  });
}

/**
 * Reads effective non-secret application settings, merging env defaults with
 * persisted overrides in `app_settings`.
 */
export function getSettings(db: AppDatabase = getDb()): AppSettingsRecord {
  const defaults = getDefaultAppSettings();
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SETTINGS_KEY_APP))
    .get();

  if (!row) {
    return {
      ...defaults,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      updatedAt: null,
    };
  }

  let parsedJson: unknown = {};
  try {
    parsedJson = JSON.parse(row.valueJson);
  } catch {
    parsedJson = {};
  }

  const raw = (typeof parsedJson === "object" && parsedJson !== null
    ? parsedJson
    : {}) as Record<string, unknown>;
  const rawAi = (typeof raw.ai === "object" && raw.ai !== null
    ? raw.ai
    : {}) as Record<string, unknown>;

  const merged = AppSettingsSchema.safeParse({
    ai: {
      ...defaults.ai,
      ...rawAi,
    },
    autoAnalyzeJobs:
      typeof raw.autoAnalyzeJobs === "boolean"
        ? raw.autoAnalyzeJobs
        : defaults.autoAnalyzeJobs,
    defaultPaperSize:
      raw.defaultPaperSize === "Letter" || raw.defaultPaperSize === "A4"
        ? raw.defaultPaperSize
        : defaults.defaultPaperSize,
    scheduledBackupsEnabled:
      typeof raw.scheduledBackupsEnabled === "boolean"
        ? raw.scheduledBackupsEnabled
        : defaults.scheduledBackupsEnabled,
    backupRetentionCount:
      typeof raw.backupRetentionCount === "number"
        ? raw.backupRetentionCount
        : defaults.backupRetentionCount,
  });

  return {
    ...(merged.success ? merged.data : defaults),
    schemaVersion: row.schemaVersion,
    updatedAt: row.updatedAt,
  };
}

/**
 * Validates and persists non-secret application settings in `app_settings`.
 * Unknown/secret keys are rejected by strict Zod schemas.
 */
export function updateSettings(
  patchInput: AppSettingsPatch,
  db: AppDatabase = getDb()
): AppSettingsRecord {
  const patch = AppSettingsPatchSchema.parse(patchInput);
  const current = getSettings(db);

  const nextSettings = AppSettingsSchema.parse({
    ai: {
      ...current.ai,
      ...(patch.ai ?? {}),
    },
    autoAnalyzeJobs: patch.autoAnalyzeJobs ?? current.autoAnalyzeJobs,
    defaultPaperSize: patch.defaultPaperSize ?? current.defaultPaperSize,
    scheduledBackupsEnabled:
      patch.scheduledBackupsEnabled ?? current.scheduledBackupsEnabled,
    backupRetentionCount:
      patch.backupRetentionCount ?? current.backupRetentionCount,
  });

  if (nextSettings.ai.cliCommand.trim()) {
    try {
      validateExecutableCommand(nextSettings.ai.cliCommand);
    } catch (err) {
      throw new ZodError([
        {
          code: "custom",
          path: ["ai", "cliCommand"],
          message:
            err instanceof AiProviderError
              ? err.message
              : "Invalid CLI command.",
        },
      ]);
    }
  }

  if (nextSettings.ai.cliArgsTemplate.trim()) {
    try {
      tokenizeArgsTemplate(nextSettings.ai.cliArgsTemplate);
    } catch (err) {
      throw new ZodError([
        {
          code: "custom",
          path: ["ai", "cliArgsTemplate"],
          message:
            err instanceof AiProviderError
              ? err.message
              : "Invalid CLI arguments template.",
        },
      ]);
    }
  }

  const nowIso = new Date().toISOString();
  const valueJson = JSON.stringify(nextSettings);

  db.insert(appSettings)
    .values({
      key: SETTINGS_KEY_APP,
      valueJson,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        valueJson,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        updatedAt: nowIso,
      },
    })
    .run();

  return {
    ...nextSettings,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    updatedAt: nowIso,
  };
}

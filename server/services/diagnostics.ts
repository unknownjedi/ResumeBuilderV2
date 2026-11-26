import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { detectAvailableClis } from "../ai/providers/cli-provider";
import type { CliDetectionInfo } from "../ai/types";
import { getDb, getSqlite, type AppDatabase, type SqliteDatabase } from "../db/client";
import { jobSources, sourceRuns } from "../db/schema/jobs";
import {
  backgroundTasks,
  systemMaintenance,
  type TaskStatus,
} from "../db/schema/system";
import { ensureAppDirectories, resolveAppDataDir } from "../files/paths";
import { getSettings } from "./settings";

const APP_SCHEMA_VERSION = 1;

export interface DiagnosticsReport {
  generatedAt: string;
  appVersion: string;
  schemaVersion: number;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  playwrightVersion: string | null;
  pdfBrowser: {
    available: boolean;
    source: "managed" | "custom_override";
  };
  database: {
    healthy: boolean;
    journalMode: string | null;
    foreignKeysEnabled: boolean;
  };
  worker: {
    maintenanceState: string;
    heartbeatAt: string | null;
    heartbeatAgeSeconds: number | null;
    healthy: boolean;
  };
  queue: Record<TaskStatus, number>;
  ai: {
    provider: string;
    model: string;
    dataSharingAccepted: boolean;
    dailyAnalysisCap: number;
    actionAnalysisCap: number;
    detectedClis: CliDetectionInfo[];
  };
  lastSourceRuns: Array<{
    id: string;
    sourceId: string;
    sourceName: string;
    sourceType: string;
    outcome: string;
    fetchedCount: number;
    newCount: number;
    updatedCount: number;
    closedCount: number;
    errorCode: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  recentTaskErrors: Array<{
    id: string;
    taskType: string;
    errorCode: string | null;
    attempts: number;
    updatedAt: string;
    completedAt: string | null;
  }>;
  storageBytes: {
    database: number;
    documents: number;
    exports: number;
    backups: number;
    logs: number;
    playwrightBrowsers: number;
    total: number;
  };
}

function readPlaywrightVersion(): string | null {
  try {
    const pkgPath = path.resolve(
      process.cwd(),
      "node_modules",
      "playwright",
      "package.json"
    );
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function readAppVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function computeDirectoryBytes(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const stat = fs.lstatSync(dirPath);
    if (stat.isSymbolicLink()) return 0;
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;

    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile()) {
        try {
          total += fs.statSync(fullPath).size;
        } catch {
          // Ignore transient files
        }
      } else if (entry.isDirectory()) {
        total += computeDirectoryBytes(fullPath);
      }
    }
    return total;
  } catch {
    return 0;
  }
}

async function checkPdfBrowserAvailability(
  playwrightBrowsersDir: string
): Promise<{ available: boolean; source: "managed" | "custom_override" }> {
  const overridePath = process.env.PDF_BROWSER_EXECUTABLE_PATH?.trim();
  if (overridePath) {
    return {
      available: fs.existsSync(overridePath),
      source: "custom_override",
    };
  }

  try {
    if (!process.env.PLAYWRIGHT_BROWSERS_PATH?.trim()) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersDir;
    }
    const pw = await import("playwright");
    const execPath = pw.chromium.executablePath();
    return {
      available: Boolean(execPath && fs.existsSync(execPath)),
      source: "managed",
    };
  } catch {
    return {
      available: false,
      source: "managed",
    };
  }
}

/**
 * Generates a redacted local diagnostic report containing runtime versions,
 * worker/DB health, queue counts, last source runs, recent task error codes,
 * detected CLIs, and storage usage—with zero raw paths, secrets, or PII.
 */
export async function getDiagnosticsReport(options?: {
  db?: AppDatabase;
  sqlite?: SqliteDatabase;
  baseDataDir?: string;
}): Promise<DiagnosticsReport> {
  const db = options?.db ?? getDb();
  const sqlite = options?.sqlite ?? getSqlite();
  const baseDir = options?.baseDataDir ?? resolveAppDataDir();
  const paths = ensureAppDirectories(baseDir);

  let dbHealthy = false;
  let journalMode: string | null = null;
  let foreignKeysEnabled = false;

  try {
    sqlite.prepare("SELECT 1").get();
    dbHealthy = true;
    const jmRow = sqlite.pragma("journal_mode", { simple: true });
    journalMode = typeof jmRow === "string" ? jmRow : null;
    const fkRow = sqlite.pragma("foreign_keys", { simple: true });
    foreignKeysEnabled = fkRow === 1;
  } catch {
    dbHealthy = false;
  }

  const maintenanceRow = db
    .select()
    .from(systemMaintenance)
    .where(eq(systemMaintenance.id, 1))
    .get();

  const heartbeatAt = maintenanceRow?.workerHeartbeatAt ?? null;
  let heartbeatAgeSeconds: number | null = null;
  if (heartbeatAt) {
    const parsedMs = Date.parse(heartbeatAt);
    if (Number.isFinite(parsedMs)) {
      heartbeatAgeSeconds = Math.max(0, Math.round((Date.now() - parsedMs) / 1000));
    }
  }

  const queueCounts: Record<TaskStatus, number> = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  const queueRows = sqlite
    .prepare(`SELECT status, COUNT(*) AS cnt FROM background_tasks GROUP BY status`)
    .all() as Array<{ status: TaskStatus; cnt: number }>;
  for (const row of queueRows) {
    if (row.status in queueCounts) {
      queueCounts[row.status] = row.cnt;
    }
  }

  const lastSourceRunRows = db
    .select({
      id: sourceRuns.id,
      sourceId: sourceRuns.sourceId,
      sourceName: jobSources.displayName,
      sourceType: jobSources.sourceType,
      outcome: sourceRuns.outcome,
      fetchedCount: sourceRuns.fetchedCount,
      newCount: sourceRuns.newCount,
      updatedCount: sourceRuns.updatedCount,
      closedCount: sourceRuns.closedCount,
      errorCode: sourceRuns.errorCode,
      startedAt: sourceRuns.startedAt,
      completedAt: sourceRuns.completedAt,
    })
    .from(sourceRuns)
    .innerJoin(jobSources, eq(sourceRuns.sourceId, jobSources.id))
    .orderBy(desc(sourceRuns.startedAt))
    .limit(10)
    .all();

  const recentErrors = db
    .select({
      id: backgroundTasks.id,
      taskType: backgroundTasks.taskType,
      errorCode: backgroundTasks.errorCode,
      attempts: backgroundTasks.attempts,
      updatedAt: backgroundTasks.updatedAt,
      completedAt: backgroundTasks.completedAt,
    })
    .from(backgroundTasks)
    .where(eq(backgroundTasks.status, "failed"))
    .orderBy(desc(backgroundTasks.updatedAt))
    .limit(10)
    .all();

  const settings = getSettings(db);
  const pdfBrowser = await checkPdfBrowserAvailability(paths.playwrightBrowsers);

  const databaseBytes = computeDirectoryBytes(paths.database);
  const documentsBytes = computeDirectoryBytes(path.join(paths.base, "documents"));
  const exportsBytes = computeDirectoryBytes(path.join(paths.base, "exports"));
  const backupsBytes = computeDirectoryBytes(paths.backups);
  const logsBytes = computeDirectoryBytes(paths.logs);
  const browsersBytes = computeDirectoryBytes(paths.playwrightBrowsers);

  return {
    generatedAt: new Date().toISOString(),
    appVersion: readAppVersion(),
    schemaVersion: APP_SCHEMA_VERSION,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    playwrightVersion: readPlaywrightVersion(),
    pdfBrowser,
    database: {
      healthy: dbHealthy,
      journalMode,
      foreignKeysEnabled,
    },
    worker: {
      maintenanceState: maintenanceRow?.state ?? "normal",
      heartbeatAt,
      heartbeatAgeSeconds,
      healthy: heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= 60,
    },
    queue: queueCounts,
    ai: {
      provider: settings.ai.provider,
      model: settings.ai.model,
      dataSharingAccepted: settings.ai.dataSharingAccepted,
      dailyAnalysisCap: settings.ai.dailyAnalysisCap,
      actionAnalysisCap: settings.ai.actionAnalysisCap,
      detectedClis: detectAvailableClis(),
    },
    lastSourceRuns: lastSourceRunRows,
    recentTaskErrors: recentErrors,
    storageBytes: {
      database: databaseBytes,
      documents: documentsBytes,
      exports: exportsBytes,
      backups: backupsBytes,
      logs: logsBytes,
      playwrightBrowsers: browsersBytes,
      total:
        databaseBytes +
        documentsBytes +
        exportsBytes +
        backupsBytes +
        logsBytes +
        browsersBytes,
    },
  };
}

import fs from "node:fs";
import path from "node:path";
import { resolveAppDataDir } from "../files/paths";
import { redactValue } from "../security/redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntryInput {
  level: LogLevel;
  event: string;
  message: string;
  taskId?: string;
  sourceId?: string;
  errorCode?: string;
  meta?: Record<string, unknown>;
}

export interface StructuredLogRecord {
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;
  taskId?: string;
  sourceId?: string;
  errorCode?: string;
  meta?: unknown;
}

const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB

export function getLogFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveAppDataDir(env), "logs", "app.log");
}

function rotateLogIfNeeded(logPath: string): void {
  try {
    const stats = fs.statSync(logPath);
    if (stats.size >= MAX_LOG_FILE_BYTES) {
      const rotatedPath = `${logPath}.1`;
      fs.renameSync(logPath, rotatedPath);
    }
  } catch {
    // Ignore if file does not exist yet
  }
}

/**
 * Formats and writes a redacted structured JSON line to APP_DATA_DIR/logs/app.log.
 */
export function writeLog(entry: LogEntryInput): void {
  const record: StructuredLogRecord = {
    timestamp: new Date().toISOString(),
    level: entry.level,
    event: entry.event,
    message: String(redactValue(entry.message)),
    ...(entry.taskId ? { taskId: entry.taskId } : {}),
    ...(entry.sourceId ? { sourceId: entry.sourceId } : {}),
    ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    ...(entry.meta !== undefined ? { meta: redactValue(entry.meta) } : {}),
  };

  const line = `${JSON.stringify(record)}\n`;

  try {
    const logPath = getLogFilePath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
    rotateLogIfNeeded(logPath);
    fs.appendFileSync(logPath, line, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Logging must never crash a request or worker task
  }
}

export const logger = {
  debug(event: string, message: string, context?: Omit<LogEntryInput, "level" | "event" | "message">): void {
    writeLog({ level: "debug", event, message, ...context });
  },
  info(event: string, message: string, context?: Omit<LogEntryInput, "level" | "event" | "message">): void {
    writeLog({ level: "info", event, message, ...context });
  },
  warn(event: string, message: string, context?: Omit<LogEntryInput, "level" | "event" | "message">): void {
    writeLog({ level: "warn", event, message, ...context });
  },
  error(event: string, message: string, context?: Omit<LogEntryInput, "level" | "event" | "message">): void {
    writeLog({ level: "error", event, message, ...context });
  },
};

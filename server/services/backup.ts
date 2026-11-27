import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import * as tar from "tar";
import { z } from "zod";
import {
  closeDatabase,
  createSqliteConnection,
  getSqlite,
  type SqliteDatabase,
} from "../db/client";
import { emitTaskEvent } from "../events/task-events";
import {
  assertPathWithin,
  ensureAppDirectories,
  writeSecureFile,
} from "../files/paths";
import {
  beginMaintenance,
  finishMaintenance,
} from "./maintenance";

export const BACKUP_MANIFEST_SCHEMA_VERSION = 1;
export const BACKUP_TRIGGER_TYPES = [
  "manual",
  "pre_restore",
  "pre_reset",
  "scheduled",
] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGER_TYPES)[number];

export const MAX_BACKUP_ARCHIVE_BYTES = 100 * 1024 * 1024; // 100 MiB upload/archive bound
export const MAX_TAR_ENTRIES = 5_000;
export const MAX_TAR_SINGLE_FILE_BYTES = 100 * 1024 * 1024; // 100 MiB
export const MAX_TAR_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024; // 512 MiB
export const RESET_CONFIRMATION_PHRASE = "DELETE ALL LOCAL DATA";

const ALLOWED_ARCHIVE_TOP_DIRS = new Set([
  "database",
  "documents",
  "exports",
]);

export const BackupManifestFileSchema = z.object({
  path: z.string().min(1),
  sizeBytes: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const BackupManifestSchema = z.object({
  schemaVersion: z.literal(BACKUP_MANIFEST_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  appVersion: z.string().min(1),
  trigger: z.enum(BACKUP_TRIGGER_TYPES),
  dbChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(BackupManifestFileSchema),
});

export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export interface BackupArchiveSummary {
  filename: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  trigger: BackupTrigger;
  fileCount: number;
  dbChecksumSha256: string;
  validManifest: boolean;
}

export interface BackupValidationResult {
  valid: true;
  entryCount: number;
  totalUncompressedBytes: number;
  manifest: {
    schemaVersion: number;
    createdAt: string;
    trigger: BackupTrigger;
    fileCount: number;
    dbChecksumSha256: string;
  };
  stagingDir?: string;
}

export interface RestoreResult {
  preRestoreBackupFilename: string | null;
  restoredFileCount: number;
  dbChecksumSha256: string;
}

export interface ResetDataResult {
  safetyBackupFilename: string | null;
}

export class BackupServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "BackupServiceError";
    this.code = code;
    this.status = status;
  }
}

function sha256File(filePath: string): { sha256: string; sizeBytes: number } {
  const hash = crypto.createHash("sha256");
  const buf = fs.readFileSync(/*turbopackIgnore: true*/ filePath);
  hash.update(buf);
  return {
    sha256: hash.digest("hex"),
    sizeBytes: buf.byteLength,
  };
}

function ensurePrivateDir(dirPath: string): void {
  fs.mkdirSync(dirPath, {
    recursive: true,
    ...(process.platform !== "win32" ? { mode: 0o700 } : {}),
  });
  if (process.platform !== "win32") {
    fs.chmodSync(dirPath, 0o700);
  }
}

function sanitizeSafeBackupFilename(filename: string): string {
  const trimmed = filename.trim();
  if (
    !trimmed ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed.includes("\0") ||
    !/^[A-Za-z0-9._-]+\.(?:tar\.gz|tgz)$/.test(trimmed)
  ) {
    throw new BackupServiceError(
      "INVALID_BACKUP_FILENAME",
      400,
      "Invalid backup archive filename."
    );
  }
  return trimmed;
}

function formatArchiveTimestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate()
  )}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(
    now.getUTCSeconds()
  )}`;
}

function normalizeArchiveEntryPath(rawEntryPath: string): string | null {
  if (!rawEntryPath || rawEntryPath.includes("\0")) {
    return null;
  }
  if (rawEntryPath.includes("\\")) {
    return null;
  }
  if (/^[A-Za-z]:/.test(rawEntryPath) || rawEntryPath.startsWith("/")) {
    return null;
  }

  let normalized = rawEntryPath.replace(/^\.\//, "");
  normalized = normalized.replace(/\/+$/, "");
  if (!normalized || normalized === ".") {
    return "";
  }

  const segments = normalized.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") {
      return null;
    }
  }
  return segments.join("/");
}

function isAllowedArchiveFilePath(relPath: string): boolean {
  if (relPath === "manifest.json" || relPath === "database/app.sqlite") {
    return true;
  }
  return (
    relPath.startsWith("documents/originals/") ||
    relPath.startsWith("documents/generated/") ||
    relPath.startsWith("exports/resumes/") ||
    relPath.startsWith("exports/cover-letters/")
  );
}

function isAllowedArchiveDirPath(relPath: string): boolean {
  return (
    relPath === "" ||
    relPath === "database" ||
    relPath === "documents" ||
    relPath === "documents/originals" ||
    relPath === "documents/generated" ||
    relPath === "exports" ||
    relPath === "exports/resumes" ||
    relPath === "exports/cover-letters"
  );
}

function copyDirectoryContentsNoSymlinks(
  srcDir: string,
  destDir: string
): Array<{ absPath: string; relSuffix: string }> {
  const collected: Array<{ absPath: string; relSuffix: string }> = [];
  if (!fs.existsSync(/*turbopackIgnore: true*/ srcDir)) {
    return collected;
  }

  const walk = (currentSrc: string, relBase: string) => {
    const entries = fs.readdirSync(/*turbopackIgnore: true*/ currentSrc, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const nextSrc = path.join(currentSrc, entry.name);
      const nextRel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(nextSrc, nextRel);
      } else if (entry.isFile()) {
        const destFile = assertPathWithin(destDir, nextRel);
        ensurePrivateDir(path.dirname(destFile));
        fs.copyFileSync(/*turbopackIgnore: true*/ nextSrc, destFile);
        if (process.platform !== "win32") {
          fs.chmodSync(destFile, 0o600);
        }
        collected.push({ absPath: destFile, relSuffix: nextRel });
      }
    }
  };

  walk(srcDir, "");
  return collected;
}

function pruneOldBackups(
  backupsDir: string,
  retentionCount: number,
  protectedFilename?: string
): void {
  if (!Number.isFinite(retentionCount) || retentionCount < 1) {
    return;
  }
  const files = fs
    .readdirSync(/*turbopackIgnore: true*/ backupsDir)
    .filter((f) => f.endsWith(".tar.gz") || f.endsWith(".tgz"))
    .map((filename) => {
      const fullPath = assertPathWithin(backupsDir, filename);
      const stat = fs.statSync(/*turbopackIgnore: true*/ fullPath);
      return { filename, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  let nonPreCount = 0;
  for (const item of files) {
    if (item.filename === protectedFilename) {
      continue;
    }
    const isSafetySnapshot =
      item.filename.includes("-pre_restore-") ||
      item.filename.includes("-pre_reset-");
    if (isSafetySnapshot) {
      continue;
    }
    nonPreCount += 1;
    if (nonPreCount > retentionCount) {
      fs.rmSync(/*turbopackIgnore: true*/ item.fullPath, { force: true });
    }
  }
}

/**
 * Creates an atomic local `.tar.gz` backup archive using SQLite's online
 * backup API plus private documents/exports. Never includes `secrets/`, `logs/`,
 * or `runtime/`.
 */
export async function createBackupArchive(options?: {
  sqlite?: SqliteDatabase;
  appDataDir?: string;
  trigger?: BackupTrigger;
  retentionCount?: number;
  now?: Date;
}): Promise<BackupArchiveSummary> {
  const trigger = options?.trigger ?? "manual";
  const now = options?.now ?? new Date();
  const paths = ensureAppDirectories(options?.appDataDir);
  const sqlite = options?.sqlite ?? getSqlite();

  const stageId = crypto.randomUUID().slice(0, 8);
  const stageDir = assertPathWithin(paths.tmp, `backup-stage-${stageId}`);
  const archiveFilename = `backup-${formatArchiveTimestamp(now)}-${trigger}-${stageId}.tar.gz`;
  const stagedArchivePath = assertPathWithin(paths.tmp, `${archiveFilename}.part`);
  const finalArchivePath = assertPathWithin(paths.backups, archiveFilename);

  ensurePrivateDir(stageDir);

  try {
    const dbStageDir = assertPathWithin(stageDir, "database");
    ensurePrivateDir(dbStageDir);
    const stagedDbPath = assertPathWithin(dbStageDir, "app.sqlite");

    await sqlite.backup(stagedDbPath);
    if (process.platform !== "win32" && fs.existsSync(/*turbopackIgnore: true*/ stagedDbPath)) {
      fs.chmodSync(stagedDbPath, 0o600);
    }

    const dbHash = sha256File(stagedDbPath);
    const manifestFiles: Array<{ path: string; sizeBytes: number; sha256: string }> = [
      {
        path: "database/app.sqlite",
        sizeBytes: dbHash.sizeBytes,
        sha256: dbHash.sha256,
      },
    ];

    const docBuckets: Array<{ srcDir: string; archivePrefix: string }> = [
      { srcDir: paths.originals, archivePrefix: "documents/originals" },
      { srcDir: paths.generated, archivePrefix: "documents/generated" },
      { srcDir: paths.resumeExports, archivePrefix: "exports/resumes" },
      { srcDir: paths.coverLetterExports, archivePrefix: "exports/cover-letters" },
    ];

    for (const bucket of docBuckets) {
      const targetBucketDir = assertPathWithin(stageDir, bucket.archivePrefix);
      const copied = copyDirectoryContentsNoSymlinks(bucket.srcDir, targetBucketDir);
      for (const item of copied) {
        const fileHash = sha256File(item.absPath);
        manifestFiles.push({
          path: `${bucket.archivePrefix}/${item.relSuffix}`,
          sizeBytes: fileHash.sizeBytes,
          sha256: fileHash.sha256,
        });
      }
    }

    manifestFiles.sort((a, b) => a.path.localeCompare(b.path));

    const manifest: BackupManifest = {
      schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
      createdAt: now.toISOString(),
      appVersion: "0.1.0",
      trigger,
      dbChecksumSha256: dbHash.sha256,
      files: manifestFiles,
    };

    writeSecureFile(
      assertPathWithin(stageDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    const stageEntries = new Set(
      fs.readdirSync(/*turbopackIgnore: true*/ stageDir)
    );
    const topLevelEntries = ["manifest.json", "database"];
    for (const dirName of ["documents", "exports"]) {
      if (stageEntries.has(dirName)) {
        topLevelEntries.push(dirName);
      }
    }

    await tar.create(
      {
        gzip: true,
        file: stagedArchivePath,
        cwd: stageDir,
        portable: true,
        follow: false,
      },
      topLevelEntries
    );

    fs.renameSync(stagedArchivePath, finalArchivePath);
    if (process.platform !== "win32") {
      fs.chmodSync(finalArchivePath, 0o600);
    }

    if (typeof options?.retentionCount === "number") {
      pruneOldBackups(paths.backups, options.retentionCount, archiveFilename);
    }

    const stat = fs.statSync(/*turbopackIgnore: true*/ finalArchivePath);
    return {
      filename: archiveFilename,
      filePath: finalArchivePath,
      sizeBytes: stat.size,
      createdAt: manifest.createdAt,
      trigger: manifest.trigger,
      fileCount: manifest.files.length,
      dbChecksumSha256: manifest.dbChecksumSha256,
      validManifest: true,
    };
  } finally {
    fs.rmSync(/*turbopackIgnore: true*/ stageDir, { recursive: true, force: true });
    fs.rmSync(/*turbopackIgnore: true*/ stagedArchivePath, { force: true });
  }
}

async function readManifestFromArchive(
  archivePath: string
): Promise<BackupManifest | null> {
  let rawManifest = "";
  let found = false;
  try {
    await tar.list({
      file: archivePath,
      onReadEntry: (entry) => {
        const norm = normalizeArchiveEntryPath(entry.path);
        if (norm === "manifest.json" && entry.type === "File") {
          found = true;
          const chunks: Buffer[] = [];
          let total = 0;
          entry.on("data", (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total <= 1024 * 1024) {
              chunks.push(chunk);
            }
          });
          entry.on("end", () => {
            rawManifest = Buffer.concat(chunks).toString("utf-8");
          });
        } else {
          entry.resume();
        }
      },
    });
    if (!found || !rawManifest) {
      return null;
    }
    const parsed = BackupManifestSchema.safeParse(JSON.parse(rawManifest));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Lists `.tar.gz` backup archives stored inside the local `backups` directory.
 */
export async function listBackups(
  appDataDir?: string
): Promise<BackupArchiveSummary[]> {
  const paths = ensureAppDirectories(appDataDir);
  const filenames = fs
    .readdirSync(/*turbopackIgnore: true*/ paths.backups)
    .filter((f) => f.endsWith(".tar.gz") || f.endsWith(".tgz"));

  const summaries: BackupArchiveSummary[] = [];
  for (const filename of filenames) {
    const filePath = assertPathWithin(paths.backups, filename);
    const stat = fs.statSync(/*turbopackIgnore: true*/ filePath);
    if (!stat.isFile()) continue;
    const manifest = await readManifestFromArchive(filePath);
    summaries.push({
      filename,
      filePath,
      sizeBytes: stat.size,
      createdAt: manifest?.createdAt ?? stat.mtime.toISOString(),
      trigger: manifest?.trigger ?? "manual",
      fileCount: manifest?.files.length ?? 0,
      dbChecksumSha256: manifest?.dbChecksumSha256 ?? "",
      validManifest: manifest !== null,
    });
  }

  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveBackupArchivePath(
  filename: string,
  appDataDir?: string
): string {
  const safeName = sanitizeSafeBackupFilename(filename);
  const paths = ensureAppDirectories(appDataDir);
  const targetPath = assertPathWithin(paths.backups, safeName);
  if (!fs.existsSync(/*turbopackIgnore: true*/ targetPath)) {
    throw new BackupServiceError(
      "BACKUP_NOT_FOUND",
      404,
      `Backup archive not found: ${safeName}`
    );
  }
  return targetPath;
}

export function deleteBackupArchive(
  filename: string,
  appDataDir?: string
): void {
  const targetPath = resolveBackupArchivePath(filename, appDataDir);
  fs.rmSync(/*turbopackIgnore: true*/ targetPath, { force: true });
}

/**
 * Validates a backup `.tar.gz` archive inside an isolated staging directory:
 * rejects tar-bombs, symlinks/hardlinks, path traversal, disallowed prefixes,
 * manifest checksum mismatches, and SQLite corruption before any live file is touched.
 */
export async function validateBackupArchive(options: {
  archivePath: string;
  appDataDir?: string;
  keepStagingDir?: boolean;
}): Promise<BackupValidationResult> {
  const paths = ensureAppDirectories(options.appDataDir);
  if (!fs.existsSync(/*turbopackIgnore: true*/ options.archivePath)) {
    throw new BackupServiceError(
      "ARCHIVE_NOT_FOUND",
      404,
      "Backup archive file does not exist."
    );
  }

  const stat = fs.statSync(/*turbopackIgnore: true*/ options.archivePath);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BACKUP_ARCHIVE_BYTES) {
    throw new BackupServiceError(
      "INVALID_ARCHIVE_SIZE",
      400,
      `Backup archive size must be between 1 byte and ${MAX_BACKUP_ARCHIVE_BYTES} bytes.`
    );
  }

  let entryCount = 0;
  let totalUncompressedBytes = 0;
  let securityRejection: BackupServiceError | null = null;

  const rejectStream = (
    err: BackupServiceError,
    parser: tar.Parser,
    readStream: fs.ReadStream,
    rejectPromise: (reason?: unknown) => void
  ) => {
    if (!securityRejection) {
      securityRejection = err;
    }
    readStream.destroy();
    parser.abort(err);
    rejectPromise(err);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(/*turbopackIgnore: true*/ options.archivePath);
      const parser = new tar.Parser({
        strict: true,
        onReadEntry: (entry) => {
          entryCount += 1;
          if (entryCount > MAX_TAR_ENTRIES) {
            rejectStream(
              new BackupServiceError(
                "TAR_ENTRY_LIMIT_EXCEEDED",
                400,
                `Backup archive exceeds maximum entry limit (${MAX_TAR_ENTRIES}).`
              ),
              parser,
              readStream,
              reject
            );
            return;
          }

          if (
            entry.type === "SymbolicLink" ||
            entry.type === "Link" ||
            entry.type === "BlockDevice" ||
            entry.type === "CharacterDevice" ||
            entry.type === "FIFO"
          ) {
            rejectStream(
              new BackupServiceError(
                "UNSAFE_ARCHIVE_ENTRY_TYPE",
                400,
                `Disallowed archive entry type "${entry.type}" for "${entry.path}".`
              ),
              parser,
              readStream,
              reject
            );
            return;
          }

          const norm = normalizeArchiveEntryPath(entry.path);
          if (norm === null) {
            rejectStream(
              new BackupServiceError(
                "UNSAFE_ARCHIVE_PATH",
                400,
                `Disallowed or traversing path inside backup archive: "${entry.path}".`
              ),
              parser,
              readStream,
              reject
            );
            return;
          }

          if (entry.type === "Directory") {
            if (!isAllowedArchiveDirPath(norm)) {
              rejectStream(
                new BackupServiceError(
                  "DISALLOWED_ARCHIVE_PATH",
                  400,
                  `Disallowed directory inside backup archive: "${norm}".`
                ),
                parser,
                readStream,
                reject
              );
              return;
            }
            entry.resume();
            return;
          }

          if (entry.type !== "File") {
            rejectStream(
              new BackupServiceError(
                "UNSAFE_ARCHIVE_ENTRY_TYPE",
                400,
                `Unsupported archive entry type "${entry.type}".`
              ),
              parser,
              readStream,
              reject
            );
            return;
          }

          if (!isAllowedArchiveFilePath(norm)) {
            rejectStream(
              new BackupServiceError(
                "DISALLOWED_ARCHIVE_PATH",
                400,
                `Disallowed file path inside backup archive: "${norm}".`
              ),
              parser,
              readStream,
              reject
            );
            return;
          }

          const declaredSize = typeof entry.size === "number" ? entry.size : 0;
          if (declaredSize < 0 || declaredSize > MAX_TAR_SINGLE_FILE_BYTES) {
            rejectStream(
              new BackupServiceError(
                "TAR_FILE_TOO_LARGE",
                400,
                `Archive entry "${norm}" exceeds per-file limit.`
              ),
              parser,
              readStream,
              reject
            );
            return;
          }

          let actualEntryBytes = 0;
          entry.on("data", (chunk: Buffer) => {
            actualEntryBytes += chunk.byteLength;
            totalUncompressedBytes += chunk.byteLength;
            if (
              actualEntryBytes > MAX_TAR_SINGLE_FILE_BYTES ||
              totalUncompressedBytes > MAX_TAR_TOTAL_UNCOMPRESSED_BYTES
            ) {
              rejectStream(
                new BackupServiceError(
                  "TAR_BOMB_DETECTED",
                  400,
                  "Archive exceeded uncompressed size limit during inspection."
                ),
                parser,
                readStream,
                reject
              );
            }
          });
          entry.resume();
        },
      });

      readStream.on("error", reject);
      parser.on("error", reject);
      parser.on("end", () => resolve());
      readStream.pipe(parser);
    });
  } catch (err) {
    if (securityRejection) {
      throw securityRejection;
    }
    if (err instanceof BackupServiceError) {
      throw err;
    }
    throw new BackupServiceError(
      "INVALID_BACKUP_ARCHIVE",
      400,
      err instanceof Error ? `Invalid backup archive: ${err.message}` : "Invalid backup archive."
    );
  }

  if (securityRejection) {
    throw securityRejection;
  }

  const stageDir = assertPathWithin(
    paths.tmp,
    `restore-stage-${crypto.randomUUID().slice(0, 8)}`
  );
  ensurePrivateDir(stageDir);

  let cleanupNeeded = !options.keepStagingDir;
  try {
    await tar.extract({
      file: options.archivePath,
      cwd: stageDir,
      preservePaths: false,
      unlink: false,
      filter: (entryPath, statOrEntry) => {
        if (statOrEntry && "type" in statOrEntry) {
          const entryType = (statOrEntry as { type?: string }).type;
          if (entryType !== "File" && entryType !== "Directory") {
            return false;
          }
        }
        const norm = normalizeArchiveEntryPath(entryPath);
        if (norm === null) return false;
        return isAllowedArchiveDirPath(norm) || isAllowedArchiveFilePath(norm);
      },
    });

    const manifestPath = assertPathWithin(stageDir, "manifest.json");
    if (!fs.existsSync(/*turbopackIgnore: true*/ manifestPath)) {
      throw new BackupServiceError(
        "MISSING_MANIFEST",
        400,
        "Backup archive is missing manifest.json."
      );
    }

    let manifest: BackupManifest;
    try {
      const parsedJson = JSON.parse(
        fs.readFileSync(/*turbopackIgnore: true*/ manifestPath, "utf-8")
      );
      manifest = BackupManifestSchema.parse(parsedJson);
    } catch {
      throw new BackupServiceError(
        "INVALID_MANIFEST",
        400,
        "Backup archive manifest.json failed schema validation."
      );
    }

    // Check that every extracted file matches manifest (no unmanifested payload)
    const manifestedPaths = new Set(manifest.files.map((f) => f.path));
    const walkStageFiles = (dir: string, relBase: string) => {
      for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ dir, {
        withFileTypes: true,
      })) {
        if (entry.isSymbolicLink()) {
          throw new BackupServiceError(
            "UNSAFE_ARCHIVE_ENTRY_TYPE",
            400,
            "Symlinks are prohibited inside backup staging."
          );
        }
        const full = path.join(dir, entry.name);
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walkStageFiles(full, rel);
        } else if (entry.isFile()) {
          if (rel === "manifest.json") continue;
          if (!manifestedPaths.has(rel)) {
            throw new BackupServiceError(
              "UNEXPECTED_ARCHIVE_FILE",
              400,
              `Backup archive contains unmanifested file "${rel}".`
            );
          }
        }
      }
    };
    walkStageFiles(stageDir, "");

    for (const fileEntry of manifest.files) {
      if (!isAllowedArchiveFilePath(fileEntry.path)) {
        throw new BackupServiceError(
          "DISALLOWED_MANIFEST_PATH",
          400,
          `Manifest references disallowed path "${fileEntry.path}".`
        );
      }
      const target = assertPathWithin(stageDir, fileEntry.path);
      if (!fs.existsSync(/*turbopackIgnore: true*/ target)) {
        throw new BackupServiceError(
          "MISSING_ARCHIVE_FILE",
          400,
          `Backup archive is missing manifested file "${fileEntry.path}".`
        );
      }
      const verified = sha256File(target);
      if (verified.sha256 !== fileEntry.sha256) {
        throw new BackupServiceError(
          "CHECKSUM_MISMATCH",
          400,
          `Checksum mismatch for "${fileEntry.path}".`
        );
      }
    }

    const stagedDbPath = assertPathWithin(stageDir, "database/app.sqlite");
    if (!fs.existsSync(/*turbopackIgnore: true*/ stagedDbPath)) {
      throw new BackupServiceError(
        "MISSING_DATABASE_SNAPSHOT",
        400,
        "Backup archive does not include database/app.sqlite."
      );
    }

    const dbVerifyHash = sha256File(stagedDbPath);
    if (dbVerifyHash.sha256 !== manifest.dbChecksumSha256) {
      throw new BackupServiceError(
        "DB_CHECKSUM_MISMATCH",
        400,
        "SQLite snapshot checksum does not match manifest.dbChecksumSha256."
      );
    }

    let inspectDb: SqliteDatabase | null = null;
    try {
      inspectDb = new BetterSqlite3(stagedDbPath, { readonly: true });
      const check = inspectDb.pragma("integrity_check", { simple: true });
      if (check !== "ok") {
        throw new BackupServiceError(
          "DB_INTEGRITY_FAILED",
          400,
          `Backup SQLite integrity_check failed: ${String(check)}`
        );
      }
    } catch (err) {
      if (err instanceof BackupServiceError) throw err;
      throw new BackupServiceError(
        "CORRUPT_DATABASE_SNAPSHOT",
        400,
        "Staged SQLite database failed integrity validation."
      );
    } finally {
      if (inspectDb?.open) {
        inspectDb.close();
      }
    }

    return {
      valid: true,
      entryCount,
      totalUncompressedBytes,
      manifest: {
        schemaVersion: manifest.schemaVersion,
        createdAt: manifest.createdAt,
        trigger: manifest.trigger,
        fileCount: manifest.files.length,
        dbChecksumSha256: manifest.dbChecksumSha256,
      },
      ...(options.keepStagingDir ? { stagingDir: stageDir } : {}),
    };
  } catch (err) {
    cleanupNeeded = true;
    throw err;
  } finally {
    if (cleanupNeeded) {
      fs.rmSync(/*turbopackIgnore: true*/ stageDir, {
        recursive: true,
        force: true,
      });
    }
  }
}

function replaceDirectoryWithRollback(
  liveDir: string,
  stagedSourceDir: string,
  rollbackDir: string
): void {
  if (fs.existsSync(/*turbopackIgnore: true*/ liveDir)) {
    ensurePrivateDir(path.dirname(rollbackDir));
    fs.renameSync(liveDir, rollbackDir);
  }
  ensurePrivateDir(liveDir);
  if (fs.existsSync(/*turbopackIgnore: true*/ stagedSourceDir)) {
    copyDirectoryContentsNoSymlinks(stagedSourceDir, liveDir);
  }
}

function restoreDirectoryFromRollback(
  liveDir: string,
  rollbackDir: string
): void {
  fs.rmSync(/*turbopackIgnore: true*/ liveDir, { recursive: true, force: true });
  if (fs.existsSync(/*turbopackIgnore: true*/ rollbackDir)) {
    fs.renameSync(rollbackDir, liveDir);
  }
}

/**
 * Restores live workspace database, documents, and exports from a verified
 * `.tar.gz` backup archive after coordinating maintenance drain and creating a
 * `pre_restore` safety backup. Automatically rolls back on error.
 */
export async function restoreFromBackupArchive(options: {
  archivePath: string;
  appDataDir?: string;
  sqlite?: SqliteDatabase;
  confirmRestore: boolean;
  createPreRestoreBackup?: boolean;
}): Promise<RestoreResult> {
  if (!options.confirmRestore) {
    throw new BackupServiceError(
      "CONFIRMATION_REQUIRED",
      400,
      "Explicit confirmation is required before restoring a backup archive."
    );
  }

  const paths = ensureAppDirectories(options.appDataDir);
  const validation = await validateBackupArchive({
    archivePath: options.archivePath,
    appDataDir: paths.base,
    keepStagingDir: true,
  });

  const stageDir = validation.stagingDir!;
  const rollbackDir = assertPathWithin(
    paths.tmp,
    `restore-rollback-${crypto.randomUUID().slice(0, 8)}`
  );
  ensurePrivateDir(rollbackDir);

  const usingSingleton = !options.sqlite;
  const activeSqlite = options.sqlite ?? getSqlite();
  let maintenanceEntered = false;
  let preRestoreBackupFilename: string | null = null;

  try {
    await beginMaintenance({
      sqlite: activeSqlite,
      targetState: "restoring",
      actor: "restore",
    });
    maintenanceEntered = true;

    if (options.createPreRestoreBackup !== false) {
      const preBackup = await createBackupArchive({
        sqlite: activeSqlite,
        appDataDir: paths.base,
        trigger: "pre_restore",
      });
      preRestoreBackupFilename = preBackup.filename;
    }

    if (usingSingleton) {
      closeDatabase();
    } else if (activeSqlite.open) {
      activeSqlite.close();
    }

    const targets: Array<{ live: string; staged: string; rollback: string }> = [
      {
        live: paths.database,
        staged: assertPathWithin(stageDir, "database"),
        rollback: assertPathWithin(rollbackDir, "database"),
      },
      {
        live: paths.originals,
        staged: assertPathWithin(stageDir, "documents/originals"),
        rollback: assertPathWithin(rollbackDir, "documents-originals"),
      },
      {
        live: paths.generated,
        staged: assertPathWithin(stageDir, "documents/generated"),
        rollback: assertPathWithin(rollbackDir, "documents-generated"),
      },
      {
        live: paths.resumeExports,
        staged: assertPathWithin(stageDir, "exports/resumes"),
        rollback: assertPathWithin(rollbackDir, "exports-resumes"),
      },
      {
        live: paths.coverLetterExports,
        staged: assertPathWithin(stageDir, "exports/cover-letters"),
        rollback: assertPathWithin(rollbackDir, "exports-cover-letters"),
      },
    ];

    const swapped: Array<{ live: string; rollback: string }> = [];
    try {
      for (const target of targets) {
        replaceDirectoryWithRollback(target.live, target.staged, target.rollback);
        swapped.push({ live: target.live, rollback: target.rollback });
      }
    } catch (swapErr) {
      for (const item of swapped.reverse()) {
        restoreDirectoryFromRollback(item.live, item.rollback);
      }
      throw new BackupServiceError(
        "RESTORE_SWAP_FAILED",
        500,
        swapErr instanceof Error
          ? `Restore failed cleanly and rolled back: ${swapErr.message}`
          : "Restore failed and rolled back."
      );
    }

    const reopenedSqlite = usingSingleton
      ? getSqlite()
      : createSqliteConnection(paths.databaseFile);
    try {
      finishMaintenance({
        sqlite: reopenedSqlite,
        reason: "restore_completed",
      });
      maintenanceEntered = false;
    } finally {
      if (!usingSingleton && reopenedSqlite.open) {
        reopenedSqlite.close();
      }
    }

    return {
      preRestoreBackupFilename,
      restoredFileCount: validation.manifest.fileCount,
      dbChecksumSha256: validation.manifest.dbChecksumSha256,
    };
  } finally {
    if (maintenanceEntered) {
      try {
        const recoverSqlite = usingSingleton ? getSqlite() : activeSqlite;
        if (recoverSqlite.open) {
          finishMaintenance({
            sqlite: recoverSqlite,
            reason: "restore_aborted",
          });
        }
      } catch {
        // Best-effort cleanup
      }
    }
    fs.rmSync(/*turbopackIgnore: true*/ stageDir, {
      recursive: true,
      force: true,
    });
    fs.rmSync(/*turbopackIgnore: true*/ rollbackDir, {
      recursive: true,
      force: true,
    });
  }
}

/**
 * Deletes all local SQLite data, uploaded documents, and generated exports after
 * requiring exact confirmation text `"DELETE ALL LOCAL DATA"`. Never touches
 * `runtime/playwright-browsers` or `backups/` (saving an optional `pre_reset`
 * archive first).
 */
export async function resetAllLocalData(options: {
  confirmationText: string;
  appDataDir?: string;
  sqlite?: SqliteDatabase;
  createSafetyBackup?: boolean;
}): Promise<ResetDataResult> {
  if (options.confirmationText !== RESET_CONFIRMATION_PHRASE) {
    throw new BackupServiceError(
      "CONFIRMATION_REQUIRED",
      400,
      `Confirmation text must exactly equal "${RESET_CONFIRMATION_PHRASE}".`
    );
  }

  const paths = ensureAppDirectories(options.appDataDir);
  const usingSingleton = !options.sqlite;
  const activeSqlite = options.sqlite ?? getSqlite();
  let maintenanceEntered = false;
  let safetyBackupFilename: string | null = null;

  try {
    await beginMaintenance({
      sqlite: activeSqlite,
      targetState: "resetting",
      actor: "reset",
    });
    maintenanceEntered = true;

    if (options.createSafetyBackup !== false) {
      const safetyBackup = await createBackupArchive({
        sqlite: activeSqlite,
        appDataDir: paths.base,
        trigger: "pre_reset",
      });
      safetyBackupFilename = safetyBackup.filename;
    }

    if (usingSingleton) {
      closeDatabase();
    } else if (activeSqlite.open) {
      activeSqlite.close();
    }

    // Wipe database, originals, generated, and exports — preserve backups & runtime/playwright-browsers.
    for (const dirToWipe of [
      paths.database,
      paths.originals,
      paths.generated,
      paths.resumeExports,
      paths.coverLetterExports,
    ]) {
      fs.rmSync(/*turbopackIgnore: true*/ dirToWipe, {
        recursive: true,
        force: true,
      });
    }

    ensureAppDirectories(paths.base);

    const freshSqlite = usingSingleton
      ? getSqlite()
      : createSqliteConnection(paths.databaseFile);
    try {
      finishMaintenance({
        sqlite: freshSqlite,
        reason: "reset_completed",
      });
      maintenanceEntered = false;
    } finally {
      if (!usingSingleton && freshSqlite.open) {
        freshSqlite.close();
      }
    }

    return { safetyBackupFilename };
  } finally {
    if (maintenanceEntered) {
      try {
        const recoverSqlite = usingSingleton ? getSqlite() : activeSqlite;
        if (recoverSqlite.open) {
          finishMaintenance({
            sqlite: recoverSqlite,
            reason: "reset_aborted",
          });
        }
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

export function getAllowedBackupRootLabel(): string[] {
  return Array.from(ALLOWED_ARCHIVE_TOP_DIRS);
}

export function emitBackupCompletedEvent(
  sqlite: SqliteDatabase,
  taskId: string,
  nowIso: string
): void {
  sqlite
    .transaction(() => {
      emitTaskEvent(sqlite, {
        eventType: "resource.updated",
        taskId,
        taskType: "backup.create",
        status: "succeeded",
        resourceType: null,
        resourceId: null,
        occurredAt: nowIso,
      });
    })
    .immediate();
}

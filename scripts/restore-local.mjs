import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import * as tar from "tar";

function resolveAppDataDir(env = process.env) {
  const override = env.APP_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "PersonalJobCopilot");
    case "win32":
      return path.join(
        env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local"),
        "PersonalJobCopilot"
      );
    default:
      return path.join(
        env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share"),
        "personal-job-copilot"
      );
  }
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");
  const archiveArg = fileIdx >= 0 ? args[fileIdx + 1] : args[0];
  if (!archiveArg) {
    console.error("Usage: node scripts/restore-local.mjs --file <path-to-backup.tar.gz>");
    process.exit(1);
  }

  const archivePath = path.resolve(archiveArg);
  if (!fs.existsSync(archivePath)) {
    console.error(`Archive not found: ${archivePath}`);
    process.exit(1);
  }

  const appDataDir = resolveAppDataDir();
  const tmpDir = path.join(appDataDir, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const stageDir = path.join(tmpDir, `cli-restore-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(stageDir, { recursive: true, mode: 0o700 });

  try {
    await tar.list({
      file: archivePath,
      onReadEntry: (entry) => {
        if (entry.type !== "File" && entry.type !== "Directory") {
          throw new Error(`Unsupported entry type "${entry.type}" in archive.`);
        }
        if (entry.path.includes("..") || path.isAbsolute(entry.path)) {
          throw new Error(`Unsafe archive path: ${entry.path}`);
        }
        entry.resume();
      },
    });

    await tar.extract({ file: archivePath, cwd: stageDir, preservePaths: false });

    const manifestPath = path.join(stageDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error("Backup archive is missing manifest.json.");
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    for (const entry of manifest.files ?? []) {
      const candidate = path.resolve(stageDir, entry.path);
      if (!candidate.startsWith(stageDir + path.sep)) {
        throw new Error(`Manifest path escapes stage: ${entry.path}`);
      }
      if (!fs.existsSync(candidate) || sha256File(candidate) !== entry.sha256) {
        throw new Error(`Checksum mismatch for ${entry.path}`);
      }
    }

    const stagedDb = path.join(stageDir, "database", "app.sqlite");
    const db = new BetterSqlite3(stagedDb, { readonly: true });
    const integrity = db.pragma("integrity_check", { simple: true });
    db.close();
    if (integrity !== "ok") {
      throw new Error(`SQLite integrity_check failed: ${integrity}`);
    }

    const mappings = [
      [path.join(appDataDir, "database"), path.join(stageDir, "database")],
      [path.join(appDataDir, "documents", "originals"), path.join(stageDir, "documents", "originals")],
      [path.join(appDataDir, "documents", "generated"), path.join(stageDir, "documents", "generated")],
      [path.join(appDataDir, "exports", "resumes"), path.join(stageDir, "exports", "resumes")],
      [path.join(appDataDir, "exports", "cover-letters"), path.join(stageDir, "exports", "cover-letters")],
    ];

    for (const [liveDir, srcDir] of mappings) {
      fs.rmSync(liveDir, { recursive: true, force: true });
      fs.mkdirSync(liveDir, { recursive: true, mode: 0o700 });
      if (fs.existsSync(srcDir)) {
        fs.cpSync(srcDir, liveDir, { recursive: true });
      }
    }

    console.log(
      JSON.stringify({
        ok: true,
        restoredFiles: manifest.files?.length ?? 0,
        appDataDir,
      })
    );
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

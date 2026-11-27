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
  return {
    sha256: crypto.createHash("sha256").update(data).digest("hex"),
    sizeBytes: data.byteLength,
  };
}

function copyTree(srcDir, destDir) {
  const copied = [];
  if (!fs.existsSync(srcDir)) return copied;
  const walk = (cur, relBase) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const src = path.join(cur, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(src, rel);
      } else if (entry.isFile()) {
        const dest = path.join(destDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
        fs.copyFileSync(src, dest);
        copied.push({ absPath: dest, rel });
      }
    }
  };
  walk(srcDir, "");
  return copied;
}

async function main() {
  const appDataDir = resolveAppDataDir();
  const dbFile = path.join(appDataDir, "database", "app.sqlite");
  if (!fs.existsSync(dbFile)) {
    console.error(`No SQLite database found at ${dbFile}`);
    process.exit(1);
  }

  const backupsDir = path.join(appDataDir, "backups");
  const tmpDir = path.join(appDataDir, "tmp");
  fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  const id = crypto.randomUUID().slice(0, 8);
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const archiveName = `backup-${stamp}-manual-${id}.tar.gz`;
  const stageDir = path.join(tmpDir, `cli-backup-${id}`);
  const archiveDest = path.join(backupsDir, archiveName);

  fs.mkdirSync(path.join(stageDir, "database"), { recursive: true, mode: 0o700 });

  const sqlite = new BetterSqlite3(dbFile, { readonly: true });
  try {
    const stagedDb = path.join(stageDir, "database", "app.sqlite");
    await sqlite.backup(stagedDb);

    const dbHash = sha256File(stagedDb);
    const files = [
      { path: "database/app.sqlite", sizeBytes: dbHash.sizeBytes, sha256: dbHash.sha256 },
    ];

    const buckets = [
      [path.join(appDataDir, "documents", "originals"), "documents/originals"],
      [path.join(appDataDir, "documents", "generated"), "documents/generated"],
      [path.join(appDataDir, "exports", "resumes"), "exports/resumes"],
      [path.join(appDataDir, "exports", "cover-letters"), "exports/cover-letters"],
    ];

    for (const [src, prefix] of buckets) {
      for (const item of copyTree(src, path.join(stageDir, prefix))) {
        const h = sha256File(item.absPath);
        files.push({ path: `${prefix}/${item.rel}`, sizeBytes: h.sizeBytes, sha256: h.sha256 });
      }
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
      schemaVersion: 1,
      createdAt: now.toISOString(),
      appVersion: "0.1.0",
      trigger: "manual",
      dbChecksumSha256: dbHash.sha256,
      files,
    };
    fs.writeFileSync(path.join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    const entries = ["manifest.json", "database"];
    for (const d of ["documents", "exports"]) {
      if (fs.existsSync(path.join(stageDir, d))) entries.push(d);
    }

    await tar.create(
      { gzip: true, file: archiveDest, cwd: stageDir, portable: true, follow: false },
      entries
    );
    if (process.platform !== "win32") fs.chmodSync(archiveDest, 0o600);

    console.log(JSON.stringify({ ok: true, archivePath: archiveDest, fileCount: files.length }));
  } finally {
    sqlite.close();
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

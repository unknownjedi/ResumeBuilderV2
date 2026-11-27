import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection } from "@/server/db/client";
import { ensureAppDirectories, writeSecureFile } from "@/server/files/paths";
import { guardMutation, validateHostAndOrigin } from "@/server/security/host-origin";
import { redactString, redactValue } from "@/server/security/redaction";
import { isPrivateOrReservedIp, validatePublicHttpUrl } from "@/server/security/ssrf";
import {
  createBackupArchive,
  listBackups,
  resetAllLocalData,
  restoreFromBackupArchive,
  validateBackupArchive,
} from "@/server/services/backup";
import { beginMaintenance, finishMaintenance, getMaintenanceRecord } from "@/server/services/maintenance";
import { getProfileSingleton, upsertProfile } from "@/server/services/profile";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/server/db/schema/index";

const tempDirs: string[] = [];

function makeTempDir(prefix = "pjc-slice6-sec-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * Builds a deterministic ustar `.tar.gz` buffer with a single controlled entry
 * (supporting arbitrary traversing filenames, symlinks, or disallowed directories)
 * without relying on OS tar behavior.
 */
function buildSingleEntryTarGz(options: {
  name: string;
  typeflag?: "0" | "2";
  linkname?: string;
  content?: string;
}): Buffer {
  const contentBuf = Buffer.from(options.content ?? "", "utf-8");
  const header = Buffer.alloc(512, 0);
  const typeflag = options.typeflag ?? "0";
  const size = typeflag === "0" ? contentBuf.byteLength : 0;

  header.write(options.name, 0, 100, "utf-8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("14000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156); // checksum placeholder
  header.write(typeflag, 156, 1, "ascii");
  if (options.linkname) {
    header.write(options.linkname, 157, 100, "utf-8");
  }
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let chksum = 0;
  for (let i = 0; i < 512; i++) {
    chksum += header[i];
  }
  header.write(chksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

  const blocks: Buffer[] = [header];
  if (size > 0) {
    const paddedSize = Math.ceil(size / 512) * 512;
    const dataBlock = Buffer.alloc(paddedSize, 0);
    contentBuf.copy(dataBlock);
    blocks.push(dataBlock);
  }
  blocks.push(Buffer.alloc(1024, 0)); // EOF trailer

  return zlib.gzipSync(Buffer.concat(blocks));
}

describe("Slice 6 Security Audit, Backup, Restore & Reset", () => {
  it("enforces local Host and Origin checks for mutations and blocks CSRF origins", () => {
    const allowedGet = validateHostAndOrigin(
      new Request("http://127.0.0.1:3000/api/settings", {
        method: "GET",
        headers: { host: "127.0.0.1:3000" },
      })
    );
    expect(allowedGet.ok).toBe(true);

    const allowedPost = guardMutation(
      new Request("http://localhost:3000/api/backup", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
      })
    );
    expect(allowedPost).toBeNull();

    const evilHost = validateHostAndOrigin(
      new Request("http://evil.example.com/api/settings", {
        method: "GET",
        headers: { host: "evil.example.com:3000" },
      })
    );
    expect(evilHost.ok).toBe(false);

    const evilOrigin = guardMutation(
      new Request("http://127.0.0.1:3000/api/data/reset", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://evil.example.com",
        },
      })
    );
    expect(evilOrigin?.status).toBe(403);
  });

  it("blocks private/loopback/metadata IPs, unsafe URL schemes, and embedded credentials in SSRF checks", async () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.10")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("fc00::1")).toBe(true);
    expect(isPrivateOrReservedIp("93.184.216.34")).toBe(false);

    await expect(
      validatePublicHttpUrl("file:///etc/passwd")
    ).rejects.toThrow();
    await expect(
      validatePublicHttpUrl("https://user:secret@example.com/jobs")
    ).rejects.toThrow();
    await expect(
      validatePublicHttpUrl("http://169.254.169.254/latest/meta-data/", {
        lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      })
    ).rejects.toThrow();

    const okUrl = await validatePublicHttpUrl("https://boards.greenhouse.io/acme", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect(okUrl.url.hostname).toBe("boards.greenhouse.io");
  });

  it("redacts tokens and absolute filesystem paths in logs/diagnostics", () => {
    const raw = "Authorization: Bearer sk_test_secret_12345 failed on /Users/alice/secret.txt";
    const cleaned = redactString(raw);
    expect(cleaned).not.toContain("sk_test_secret_12345");
    expect(cleaned).not.toContain("/Users/alice/secret.txt");

    const obj = redactValue({ apiKey: "secret-key-999", ok: true }) as Record<
      string,
      unknown
    >;
    expect(obj.apiKey).not.toBe("secret-key-999");
    expect(obj.ok).toBe(true);
  });

  it("rejects path traversal, symlinks, and disallowed paths in uploaded backup archives", async () => {
    const appDataDir = makeTempDir();
    const paths = ensureAppDirectories(appDataDir);

    const traversalArchive = path.join(paths.tmp, "traversal.tar.gz");
    writeSecureFile(
      traversalArchive,
      buildSingleEntryTarGz({
        name: "../../etc/evil.txt",
        typeflag: "0",
        content: "pwned",
      })
    );
    await expect(
      validateBackupArchive({ archivePath: traversalArchive, appDataDir })
    ).rejects.toThrow(/Disallowed|traversing|escape/i);

    const symlinkArchive = path.join(paths.tmp, "symlink.tar.gz");
    writeSecureFile(
      symlinkArchive,
      buildSingleEntryTarGz({
        name: "documents/originals/link.txt",
        typeflag: "2",
        linkname: "/etc/passwd",
      })
    );
    await expect(
      validateBackupArchive({ archivePath: symlinkArchive, appDataDir })
    ).rejects.toThrow(/Disallowed archive entry type|SymbolicLink/i);

    const secretPathArchive = path.join(paths.tmp, "secrets.tar.gz");
    writeSecureFile(
      secretPathArchive,
      buildSingleEntryTarGz({
        name: "secrets/api.key",
        typeflag: "0",
        content: "should-never-extract",
      })
    );
    await expect(
      validateBackupArchive({ archivePath: secretPathArchive, appDataDir })
    ).rejects.toThrow(/Disallowed/i);
  });

  it("creates clean backups excluding secrets/logs/runtime, restores cleanly with pre_restore snapshot, and resets data safely", async () => {
    const appDataDir = makeTempDir();
    const paths = ensureAppDirectories(appDataDir);
    const sqlite = createSqliteConnection(paths.databaseFile);
    const db = drizzle(sqlite, { schema });

    try {
      upsertProfile(
        {
          fullName: "Nora Lin",
          email: "nora@example.com",
          headline: "Original Verified Engineer",
          verificationStatus: "verified",
          origin: "manual",
        },
        db
      );

      // Place files in included + excluded directories
      writeSecureFile(path.join(paths.originals, "resume.txt"), "Original Resume Text");
      writeSecureFile(path.join(paths.resumeExports, "export-v1.txt"), "Resume Export v1");
      writeSecureFile(path.join(paths.secrets, "token.txt"), "SUPER_SECRET_DO_NOT_BACKUP");
      writeSecureFile(path.join(paths.logs, "worker.log"), "sensitive runtime log");
      writeSecureFile(
        path.join(paths.playwrightBrowsers, "chromium-marker.txt"),
        "keep-browser-binary"
      );

      const backup = await createBackupArchive({
        sqlite,
        appDataDir,
        trigger: "manual",
      });

      const entryPaths: string[] = [];
      await tar.list({
        file: backup.filePath,
        onReadEntry: (entry) => {
          entryPaths.push(entry.path);
          entry.resume();
        },
      });

      expect(entryPaths).toContain("manifest.json");
      expect(entryPaths).toContain("database/app.sqlite");
      expect(entryPaths).toContain("documents/originals/resume.txt");
      expect(entryPaths).toContain("exports/resumes/export-v1.txt");
      expect(entryPaths.some((p) => p.includes("secrets"))).toBe(false);
      expect(entryPaths.some((p) => p.includes("logs"))).toBe(false);
      expect(entryPaths.some((p) => p.includes("playwright-browsers"))).toBe(false);

      const validation = await validateBackupArchive({
        archivePath: backup.filePath,
        appDataDir,
      });
      expect(validation.valid).toBe(true);
      expect(validation.manifest.trigger).toBe("manual");

      // Mutate profile + maintenance state check before restore
      upsertProfile(
        {
          fullName: "Mutated Name",
          headline: "Overwritten Headline",
        },
        db
      );
      expect(getProfileSingleton(db)?.fullName).toBe("Mutated Name");

      const mStart = await beginMaintenance({
        sqlite,
        targetState: "paused",
        actor: "unit-test",
      });
      expect(mStart.state).toBe("paused");
      finishMaintenance({ sqlite, reason: "unit-done" });
      expect(getMaintenanceRecord(sqlite).state).toBe("normal");

      const restoreResult = await restoreFromBackupArchive({
        archivePath: backup.filePath,
        appDataDir,
        sqlite,
        confirmRestore: true,
        createPreRestoreBackup: true,
      });
      expect(restoreResult.preRestoreBackupFilename).toBeTruthy();

      const restoredSqlite = createSqliteConnection(paths.databaseFile);
      try {
        const restoredDb = drizzle(restoredSqlite, { schema });
        expect(getProfileSingleton(restoredDb)?.fullName).toBe("Nora Lin");
        expect(getProfileSingleton(restoredDb)?.headline).toBe(
          "Original Verified Engineer"
        );
        expect(
          fs.readFileSync(path.join(paths.originals, "resume.txt"), "utf-8")
        ).toBe("Original Resume Text");

        // Wrong confirmation phrase fails reset
        await expect(
          resetAllLocalData({
            confirmationText: "delete all",
            appDataDir,
            sqlite: restoredSqlite,
          })
        ).rejects.toThrow(/DELETE ALL LOCAL DATA/);

        // Valid confirmation resets DB & files while preserving runtime/playwright-browsers
        const resetResult = await resetAllLocalData({
          confirmationText: "DELETE ALL LOCAL DATA",
          appDataDir,
          sqlite: restoredSqlite,
          createSafetyBackup: true,
        });
        expect(resetResult.safetyBackupFilename).toBeTruthy();
        expect(
          fs.existsSync(path.join(paths.playwrightBrowsers, "chromium-marker.txt"))
        ).toBe(true);
        expect(fs.existsSync(path.join(paths.originals, "resume.txt"))).toBe(false);

        const postResetSqlite = createSqliteConnection(paths.databaseFile);
        try {
          const postResetDb = drizzle(postResetSqlite, { schema });
          expect(getProfileSingleton(postResetDb)).toBeNull();
        } finally {
          postResetSqlite.close();
        }

        const listed = await listBackups(appDataDir);
        expect(listed.some((b) => b.trigger === "pre_restore")).toBe(true);
        expect(listed.some((b) => b.trigger === "pre_reset")).toBe(true);
      } finally {
        if (restoredSqlite.open) restoredSqlite.close();
      }
    } finally {
      if (sqlite.open) sqlite.close();
    }
  });
});

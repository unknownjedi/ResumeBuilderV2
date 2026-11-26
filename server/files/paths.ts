import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AppPaths {
  base: string;
  database: string;
  databaseFile: string;
  originals: string;
  generated: string;
  resumeExports: string;
  coverLetterExports: string;
  backups: string;
  logs: string;
  secrets: string;
  playwrightBrowsers: string;
  tmp: string;
}

const isPosix = process.platform !== "win32";

/**
 * Resolves the OS-appropriate application data directory, honoring APP_DATA_DIR when set.
 */
export function resolveAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.APP_DATA_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }

  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "PersonalJobCopilot");
    case "win32": {
      const localAppData = env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local");
      return path.join(localAppData, "PersonalJobCopilot");
    }
    default: {
      const xdgDataHome = env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
      return path.join(xdgDataHome, "personal-job-copilot");
    }
  }
}

function ensurePrivateDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, {
    recursive: true,
    ...(isPosix ? { mode: 0o700 } : {}),
  });
  if (isPosix) {
    fs.chmodSync(dirPath, 0o700);
  }
}

/**
 * Ensures all local workspace directories exist with user-only permissions (0700 on POSIX).
 */
export function ensureAppDirectories(baseDir?: string): AppPaths {
  const base = baseDir?.trim() ? path.resolve(baseDir) : resolveAppDataDir();

  const paths: AppPaths = {
    base,
    database: path.join(base, "database"),
    databaseFile: path.join(base, "database", "app.sqlite"),
    originals: path.join(base, "documents", "originals"),
    generated: path.join(base, "documents", "generated"),
    resumeExports: path.join(base, "exports", "resumes"),
    coverLetterExports: path.join(base, "exports", "cover-letters"),
    backups: path.join(base, "backups"),
    logs: path.join(base, "logs"),
    secrets: path.join(base, "secrets"),
    playwrightBrowsers: path.join(base, "runtime", "playwright-browsers"),
    tmp: path.join(base, "tmp"),
  };

  ensurePrivateDirectory(paths.base);
  ensurePrivateDirectory(paths.database);
  ensurePrivateDirectory(path.join(base, "documents"));
  ensurePrivateDirectory(paths.originals);
  ensurePrivateDirectory(paths.generated);
  ensurePrivateDirectory(path.join(base, "exports"));
  ensurePrivateDirectory(paths.resumeExports);
  ensurePrivateDirectory(paths.coverLetterExports);
  ensurePrivateDirectory(paths.backups);
  ensurePrivateDirectory(paths.logs);
  ensurePrivateDirectory(paths.secrets);
  ensurePrivateDirectory(path.join(base, "runtime"));
  ensurePrivateDirectory(paths.playwrightBrowsers);
  ensurePrivateDirectory(paths.tmp);

  return paths;
}

/**
 * Writes a file with private user-only permissions (0600 on POSIX).
 */
export function writeSecureFile(
  filePath: string,
  data: string | NodeJS.ArrayBufferView
): void {
  const resolved = path.resolve(filePath);
  ensurePrivateDirectory(path.dirname(resolved));
  fs.writeFileSync(resolved, data, isPosix ? { mode: 0o600 } : undefined);
  if (isPosix) {
    fs.chmodSync(resolved, 0o600);
  }
}

function findNearestExistingAncestor(targetPath: string): string | null {
  let current = targetPath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return current;
}

function isSubpath(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  if (relative === "") {
    return true;
  }
  return !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

/**
 * Resolves targetPath relative to baseDir and throws if it escapes baseDir (including via symlinks).
 */
export function assertPathWithin(baseDir: string, targetPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, targetPath);

  if (!isSubpath(resolvedBase, resolvedTarget)) {
    throw new Error(`Path escapes base directory: ${targetPath}`);
  }

  if (fs.existsSync(resolvedBase)) {
    const realBase = fs.realpathSync(/*turbopackIgnore: true*/ resolvedBase);
    const existingAncestor = findNearestExistingAncestor(resolvedTarget);
    if (existingAncestor) {
      const realAncestor = fs.realpathSync(/*turbopackIgnore: true*/ existingAncestor);
      const remainder = path.relative(existingAncestor, resolvedTarget);
      const effectiveRealTarget = remainder ? path.resolve(realAncestor, remainder) : realAncestor;
      if (!isSubpath(realBase, effectiveRealTarget)) {
        throw new Error(`Resolved path escapes base directory via symlink: ${targetPath}`);
      }
    }
  }

  return resolvedTarget;
}

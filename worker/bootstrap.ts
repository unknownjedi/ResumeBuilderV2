import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
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

async function main(): Promise<void> {
  const appDataDir = resolveAppDataDir();
  const browsersPath = path.join(appDataDir, "runtime", "playwright-browsers");
  const isPosix = process.platform !== "win32";

  fs.mkdirSync(browsersPath, {
    recursive: true,
    ...(isPosix ? { mode: 0o700 } : {}),
  });
  if (isPosix) {
    fs.chmodSync(browsersPath, 0o700);
  }

  process.env.APP_DATA_DIR = appDataDir;
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

  const workerModule = await import("./index");
  workerModule.startWorker();
}

void main().catch((err) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: "worker-bootstrap",
      level: "error",
      message: "Worker bootstrap failed",
      errorCode: err instanceof Error ? err.name : "BOOTSTRAP_ERROR",
    })
  );
  process.exit(1);
});

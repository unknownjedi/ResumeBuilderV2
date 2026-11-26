import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function resolveAppDataDir(env = process.env) {
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
      const xdg = env.XDG_DATA_HOME?.trim() || path.join(home, ".local", "share");
      return path.join(xdg, "personal-job-copilot");
    }
  }
}

function main() {
  const appDataDir = resolveAppDataDir();
  const browsersPath = path.join(appDataDir, "runtime", "playwright-browsers");
  fs.mkdirSync(browsersPath, { recursive: true, mode: 0o700 });

  const cliBin = path.resolve(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "playwright.cmd" : "playwright"
  );

  if (!fs.existsSync(cliBin)) {
    console.error("Local playwright CLI binary not found. Run npm install first.");
    process.exit(1);
  }

  console.log(`Installing Playwright Chromium into: ${browsersPath}`);
  const result = spawnSync(cliBin, ["install", "chromium"], {
    stdio: "inherit",
    env: {
      ...process.env,
      APP_DATA_DIR: appDataDir,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
    },
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();

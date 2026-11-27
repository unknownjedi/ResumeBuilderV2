import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const modeArg = process.argv.includes("--mode")
  ? process.argv[process.argv.indexOf("--mode") + 1]
  : "start";
const isDev = modeArg === "dev";
const FORCE_KILL_AFTER_MS = 1_500;

function prefixLines(stream, label, dest) {
  let remainder = "";
  stream.on("data", (chunk) => {
    const text = remainder + chunk.toString("utf-8");
    const lines = text.split(/\r?\n/);
    remainder = lines.pop() ?? "";
    for (const line of lines) {
      dest.write(`[${label}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (remainder) {
      dest.write(`[${label}] ${remainder}\n`);
      remainder = "";
    }
  });
}

function sendSignalToChild(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    child.kill(signal);
  } catch {
    // Process already exited
  }
}

function main() {
  const port = process.env.PORT?.trim() || "3000";
  const hostname = process.env.HOSTNAME?.trim() || "127.0.0.1";
  const nextBin = require.resolve("next/dist/bin/next");

  const webArgs = isDev
    ? [nextBin, "dev", "--hostname", hostname, "-p", port]
    : [nextBin, "start", "--hostname", hostname, "-p", port];

  let workerCmdArgs;
  if (isDev) {
    const tsxCli = require.resolve("tsx/cli");
    workerCmdArgs = [tsxCli, "watch", "worker/bootstrap.ts"];
  } else {
    const workerEntry = path.resolve(
      process.cwd(),
      "worker/dist/worker/bootstrap.js"
    );
    if (!fs.existsSync(workerEntry)) {
      console.error(
        `Worker build missing at ${workerEntry}. Run "npm run build" first.`
      );
      process.exit(1);
    }
    workerCmdArgs = [workerEntry];
  }

  // Stay in the caller's foreground process group (`detached: false`) so terminal Ctrl+C
  // and Playwright webServer teardown never leave orphaned web/worker processes behind.
  const spawnOpts = {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  };

  const web = spawn(process.execPath, webArgs, spawnOpts);
  const worker = spawn(process.execPath, workerCmdArgs, spawnOpts);

  prefixLines(web.stdout, "web", process.stdout);
  prefixLines(web.stderr, "web", process.stderr);
  prefixLines(worker.stdout, "worker", process.stdout);
  prefixLines(worker.stderr, "worker", process.stderr);

  const children = [
    { name: "web", proc: web, exited: false },
    { name: "worker", proc: worker, exited: false },
  ];

  let shuttingDown = false;
  let forceExitCode = 0;
  let forceTimer = null;

  const finalizeIfAllExited = () => {
    if (children.every((c) => c.exited)) {
      if (forceTimer) {
        clearTimeout(forceTimer);
        forceTimer = null;
      }
      process.exit(forceExitCode);
    }
  };

  const beginShutdown = (reason, exitCode = 0, immediateKill = false) => {
    if (immediateKill) {
      for (const c of children) {
        sendSignalToChild(c.proc, "SIGKILL");
      }
      process.exit(exitCode);
      return;
    }

    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    forceExitCode = exitCode;

    // Give worker & web a clean grace signal first so SQLite leases release & SSE streams close cleanly
    const signal = reason === "SIGINT" ? "SIGINT" : "SIGTERM";
    for (const c of children) {
      if (!c.exited) {
        sendSignalToChild(c.proc, signal);
      }
    }

    // Escalate after bounded grace window so open browser HTTP keep-alive sockets never hang Ctrl+C
    forceTimer = setTimeout(() => {
      for (const c of children) {
        if (!c.exited) {
          sendSignalToChild(c.proc, "SIGKILL");
        }
      }
      setTimeout(() => process.exit(forceExitCode), 100);
    }, FORCE_KILL_AFTER_MS);
    forceTimer.unref?.();
  };

  for (const entry of children) {
    entry.proc.on("exit", (code, signal) => {
      entry.exited = true;
      if (!shuttingDown) {
        const unexpectedCode =
          typeof code === "number" ? code : signal ? 1 : 0;
        if (unexpectedCode !== 0) {
          console.error(
            `[${entry.name}] exited unexpectedly (${signal || `code ${unexpectedCode}`}); shutting down.`
          );
        }
        beginShutdown("SIGTERM", unexpectedCode);
      }
      finalizeIfAllExited();
    });

    entry.proc.on("error", (err) => {
      console.error(`[${entry.name}] failed to start: ${err.message}`);
      entry.exited = true;
      beginShutdown("SIGTERM", 1);
      finalizeIfAllExited();
    });
  }

  let sigintCount = 0;
  process.on("SIGINT", () => {
    sigintCount += 1;
    if (sigintCount >= 2) {
      beginShutdown("SIGINT", 0, true);
      return;
    }
    beginShutdown("SIGINT", 0, false);
  });

  process.on("SIGTERM", () => {
    beginShutdown("SIGTERM", 0, false);
  });

  process.on("exit", () => {
    for (const c of children) {
      if (!c.exited) {
        sendSignalToChild(c.proc, "SIGKILL");
      }
    }
  });
}

main();

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/client";
import {
  emitTaskEvent,
  getLatestEventId,
  listEventsAfter,
  pruneOldEvents,
} from "@/server/events/task-events";
import {
  assertPathWithin,
  ensureAppDirectories,
  resolveAppDataDir,
} from "@/server/files/paths";
import {
  claimNextTask,
  completeTaskFailure,
  completeTaskSuccess,
  enqueueTask,
  getTaskById,
  markTaskCancelled,
  releaseWorkerLeases,
  requestCancellation,
} from "@/server/queue/task-queue";
import { validateHostAndOrigin } from "@/server/security/host-origin";
import { redactString, redactValue } from "@/server/security/redaction";
import { isPrivateOrReservedIp, validatePublicHttpUrl } from "@/server/security/ssrf";
import { getSettings, updateSettings } from "@/server/services/settings";
import { getDiagnosticsReport } from "@/server/services/diagnostics";
import { CliLlmProvider } from "@/server/ai/providers/cli-provider";
import { z } from "zod";

describe("Slice 1 Foundation", () => {
  it("resolves APP_DATA_DIR and blocks path traversal", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pjc-paths-"));
    try {
      const resolved = resolveAppDataDir({ ...process.env, APP_DATA_DIR: tmpRoot });
      expect(resolved).toBe(path.resolve(tmpRoot));
      const dirs = ensureAppDirectories(tmpRoot);
      expect(fs.existsSync(dirs.database)).toBe(true);
      expect(fs.existsSync(dirs.playwrightBrowsers)).toBe(true);
      expect(() => assertPathWithin(dirs.resumeExports, path.join(dirs.resumeExports, "..", "secrets", "k"))).toThrow();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("enqueues, claims, deduplicates, retries, cancels, and prunes tasks + events", () => {
    const { sqlite } = createTestDatabase();
    try {
      const first = enqueueTask(sqlite, {
        taskType: "source.fetch",
        payload: { sourceId: "src-1" },
        idempotencyKey: "source.fetch:src-1",
        resourceType: "source",
        resourceId: "src-1",
      });
      expect(first.deduplicated).toBe(false);

      const dup = enqueueTask(sqlite, {
        taskType: "source.fetch",
        payload: { sourceId: "src-1" },
        idempotencyKey: "source.fetch:src-1",
      });
      expect(dup.deduplicated).toBe(true);
      expect(dup.task.id).toBe(first.task.id);

      const claimed = claimNextTask(sqlite, "worker-1");
      expect(claimed?.id).toBe(first.task.id);
      expect(claimed?.status).toBe("running");

      const retry = completeTaskFailure(sqlite, first.task.id, "worker-1", {
        errorCode: "NETWORK_TIMEOUT",
        errorMessage: "Timed out",
        retryable: true,
        random: () => 0.5,
      });
      expect(retry?.status).toBe("queued");
      expect(retry?.attempts).toBe(1);

      // Force run_after to past to re-claim and test cancellation
      sqlite.prepare("UPDATE background_tasks SET run_after = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(first.task.id);
      const reClaimed = claimNextTask(sqlite, "worker-2");
      expect(reClaimed?.id).toBe(first.task.id);

      const cancelReq = requestCancellation(sqlite, first.task.id);
      expect(cancelReq?.cancelRequestedAt).toBeTruthy();

      const cancelled = markTaskCancelled(sqlite, first.task.id, "worker-2");
      expect(cancelled?.status).toBe("cancelled");

      const ping = enqueueTask(sqlite, { taskType: "system.ping", payload: {} });
      const claimedPing = claimNextTask(sqlite, "worker-2");
      expect(claimedPing?.id).toBe(ping.task.id);
      const released = releaseWorkerLeases(sqlite, "worker-2");
      expect(released).toBe(1);
      expect(getTaskById(sqlite, ping.task.id)?.status).toBe("queued");

      const rePing = claimNextTask(sqlite, "worker-3");
      completeTaskSuccess(sqlite, rePing!.id, "worker-3");
      expect(getLatestEventId(sqlite)).toBeGreaterThan(0);

      // Emit and prune events
      sqlite.transaction(() => {
        for (let i = 0; i < 15; i += 1) {
          emitTaskEvent(sqlite, {
            taskId: ping.task.id,
            taskType: "system.ping",
            eventType: "task.progress",
            status: "running",
            progressStage: `step-${i}`,
          });
        }
      })();
      const pruned = pruneOldEvents(sqlite, { maxCount: 5 });
      expect(pruned.deletedCount).toBeGreaterThan(0);
      expect(listEventsAfter(sqlite, 0, 100).length).toBeLessThanOrEqual(5);
    } finally {
      sqlite.close();
    }
  });

  it("enforces Host/Origin, SSRF, and redaction security checks", async () => {
    const validGet = new Request("http://127.0.0.1:3000/api/settings", {
      headers: { host: "127.0.0.1:3000" },
    });
    expect(validateHostAndOrigin(validGet).ok).toBe(true);

    const badHost = new Request("http://evil.example:3000/api/settings", {
      headers: { host: "evil.example:3000" },
    });
    expect(validateHostAndOrigin(badHost).ok).toBe(false);

    const badOriginPost = new Request("http://127.0.0.1:3000/api/settings", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://evil.example" },
    });
    expect(validateHostAndOrigin(badOriginPost).ok).toBe(false);

    const okOriginPost = new Request("http://127.0.0.1:3000/api/settings", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    });
    expect(validateHostAndOrigin(okOriginPost).ok).toBe(true);

    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);

    await expect(validatePublicHttpUrl("http://127.0.0.1:3000/test")).rejects.toThrow();
    await expect(validatePublicHttpUrl("file:///etc/passwd")).rejects.toThrow();

    expect(redactString("Bearer sk-proj-abc12345678901234567")).not.toContain("sk-proj-");
    const redacted = redactValue({ apiKey: "secret-key", safeCount: 12 }) as Record<string, unknown>;
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.safeCount).toBe(12);
  });

  it("persists CLI-first AI settings without API keys and executes custom CLI structured JSON", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pjc-settings-"));
    const prevAppData = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = tmpRoot;
    const { db, sqlite } = createTestDatabase();
    try {
      const updated = updateSettings(
        {
          ai: {
            provider: "custom",
            cliCommand: process.execPath,
            cliArgsTemplate:
              '-e "const fs=require(\'fs\'); const i=fs.readFileSync(0,\'utf8\'); console.log(JSON.stringify({ok:true, model:\'{{model}}\', len:i.length}))"',
            model: "local-test-model",
            dataSharingAccepted: true,
          },
          defaultPaperSize: "Letter",
        },
        db
      );

      expect(updated.ai.provider).toBe("custom");
      expect(updated.ai.model).toBe("local-test-model");
      expect(updated.defaultPaperSize).toBe("Letter");
      expect(getSettings(db).ai.provider).toBe("custom");

      const cliProvider = new CliLlmProvider("custom", updated.ai);
      const result = await cliProvider.generateStructured({
        task: "unit-test",
        systemPrompt: "Return JSON",
        userPayload: { hello: "world" },
        schema: z.object({ ok: z.boolean(), model: z.string(), len: z.number() }),
        model: "local-test-model",
      });

      expect(result.data.ok).toBe(true);
      expect(result.data.model).toBe("local-test-model");
      expect(result.data.len).toBeGreaterThan(10);

      const diag = await getDiagnosticsReport({ db, sqlite });
      expect(diag.ai.provider).toBe("custom");
      expect(diag.ai.model).toBe("local-test-model");
      expect(JSON.stringify(diag)).not.toContain(tmpRoot);
    } finally {
      if (prevAppData === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = prevAppData;
      sqlite.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

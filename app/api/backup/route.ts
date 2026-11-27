import { NextResponse } from "next/server";
import { z } from "zod";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import { getSqlite, getDb } from "@/server/db/client";
import { enqueueTask } from "@/server/queue/task-queue";
import {
  BACKUP_TRIGGER_TYPES,
  BackupServiceError,
  createBackupArchive,
} from "@/server/services/backup";
import { getSettings } from "@/server/services/settings";
import { serializeTaskForApi } from "@/server/services/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBackupBodySchema = z
  .object({
    trigger: z.enum(BACKUP_TRIGGER_TYPES).optional().default("manual"),
    async: z.boolean().optional().default(false),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsed = await parseJsonBody(req, { allowEmpty: true });
  if (!parsed.ok) return parsed.response;

  try {
    const input = CreateBackupBodySchema.parse(parsed.data);
    const sqlite = getSqlite();

    if (input.async) {
      const enqueued = enqueueTask(sqlite, {
        taskType: "backup.create",
        payload: { trigger: input.trigger },
      });
      return NextResponse.json(
        {
          ok: true,
          taskId: enqueued.task.id,
          deduplicated: enqueued.deduplicated,
          task: serializeTaskForApi(enqueued.task),
        },
        { status: 202 }
      );
    }

    const settings = getSettings(getDb());
    const backup = await createBackupArchive({
      sqlite,
      trigger: input.trigger,
      retentionCount: settings.backupRetentionCount,
    });

    return NextResponse.json({
      ok: true,
      backup: {
        filename: backup.filename,
        sizeBytes: backup.sizeBytes,
        createdAt: backup.createdAt,
        trigger: backup.trigger,
        fileCount: backup.fileCount,
        dbChecksumSha256: backup.dbChecksumSha256,
        validManifest: backup.validManifest,
      },
    });
  } catch (err) {
    if (err instanceof BackupServiceError) {
      return NextResponse.json(
        { ok: false, error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: err.issues[0]?.message ?? "Invalid backup request.",
          },
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKUP_ERROR",
          message: err instanceof Error ? err.message : "Backup failed.",
        },
      },
      { status: 500 }
    );
  }
}

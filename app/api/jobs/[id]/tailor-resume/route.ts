import { NextResponse } from "next/server";
import { z } from "zod";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import { getDb, getSqlite } from "@/server/db/client";
import { enqueueTask } from "@/server/queue/task-queue";
import { mapMaterialsServiceError } from "@/server/services/applications";
import {
  createOrTailorResumeDraft,
  MaterialModeSchema,
  resolveCanonicalJobRow,
} from "@/server/services/resumes";
import { serializeTaskForApi } from "@/server/services/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TailorResumeBodySchema = z
  .object({
    searchProfileId: z.string().trim().min(1).max(128).nullable().optional(),
    mode: MaterialModeSchema.optional(),
    regenerate: z.boolean().optional().default(false),
    templateSettings: z.record(z.string(), z.unknown()).optional(),
    emphasizeFactIds: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
    async: z.boolean().optional(),
  })
  .strict();

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req, { allowEmpty: true });
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id } = await context.params;
    const input = TailorResumeBodySchema.parse(parsedBody.data);
    const db = getDb();

    if (input.async) {
      const canonicalJob = resolveCanonicalJobRow(db, id);
      const sqlite = getSqlite();
      const enqueued = enqueueTask(sqlite, {
        taskType: "resume.generate",
        payload: {
          jobId: canonicalJob.id,
          searchProfileId: input.searchProfileId ?? undefined,
          mode: input.mode ?? "auto_or_ai",
          regenerate: input.regenerate,
          materialType: "resume",
        },
        idempotencyKey: input.regenerate
          ? null
          : `resume.generate:${canonicalJob.id}:${input.searchProfileId ?? "default"}`,
        resourceType: "resume",
        resourceId: null,
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

    const draft = await createOrTailorResumeDraft({
      jobId: id,
      searchProfileId: input.searchProfileId,
      mode: input.mode,
      regenerate: input.regenerate,
      templateSettings: input.templateSettings as Record<string, never> | undefined,
      db,
    });

    return NextResponse.json({
      ok: true,
      draft,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to generate tailored resume."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

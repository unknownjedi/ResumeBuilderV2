import { NextResponse } from "next/server";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import { getDb, getSqlite } from "@/server/db/client";
import { enqueueTask } from "@/server/queue/task-queue";
import {
  generateAndSaveCoverLetter,
  GenerateCoverLetterRequestSchema,
  mapMaterialsServiceError,
} from "@/server/services/applications";
import { resolveCanonicalJobRow } from "@/server/services/resumes";
import { serializeTaskForApi } from "@/server/services/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const input = GenerateCoverLetterRequestSchema.parse(parsedBody.data);
    const db = getDb();

    if (input.async) {
      const canonicalJob = resolveCanonicalJobRow(db, id);
      const sqlite = getSqlite();
      const enqueued = enqueueTask(sqlite, {
        taskType: "resume.generate",
        payload: {
          jobId: canonicalJob.id,
          searchProfileId: input.searchProfileId ?? undefined,
          applicationId: input.applicationId ?? undefined,
          mode: input.mode ?? "auto_or_ai",
          tone: input.tone ?? undefined,
          length: input.length,
          regenerate: Boolean(input.regenerate),
          materialType: "cover_letter",
        },
        resourceType: "application",
        resourceId: input.applicationId ?? null,
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

    const coverLetter = await generateAndSaveCoverLetter({
      jobId: id,
      searchProfileId: input.searchProfileId,
      applicationId: input.applicationId,
      mode: input.mode,
      tone: input.tone,
      length: input.length,
      regenerate: input.regenerate,
      db,
    });

    return NextResponse.json({
      ok: true,
      coverLetter,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to generate cover letter."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

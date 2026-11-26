import { NextResponse } from "next/server";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import { getDb, getSqlite } from "@/server/db/client";
import { enqueueTask } from "@/server/queue/task-queue";
import {
  exportCoverLetter,
  ExportCoverLetterRequestSchema,
  getCoverLetterDetail,
  mapMaterialsServiceError,
} from "@/server/services/applications";
import { serializeTaskForApi } from "@/server/services/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id } = await context.params;
    const input = ExportCoverLetterRequestSchema.parse(parsedBody.data);
    const db = getDb();

    if (input.async) {
      const existing = getCoverLetterDetail(id, db);
      if (!existing) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "COVER_LETTER_NOT_FOUND",
              message: `Cover letter not found: ${id}`,
            },
          },
          { status: 404 }
        );
      }

      const sqlite = getSqlite();
      const enqueued = enqueueTask(sqlite, {
        taskType: "document.export",
        payload: {
          documentType: "cover_letter",
          coverLetterId: id,
          format: input.format,
          paperSize: input.paperSize,
        },
        resourceType: "application",
        resourceId: existing.applicationId ?? id,
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

    const result = await exportCoverLetter({
      coverLetterId: id,
      format: input.format,
      paperSize: input.paperSize,
      db,
    });

    return NextResponse.json({
      ok: true,
      exportRecord: result.exportRecord,
      coverLetter: result.coverLetter,
      downloadUrl: result.downloadUrl,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to export cover letter."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

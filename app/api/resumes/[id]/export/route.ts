import { NextResponse } from "next/server";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import { getDb, getSqlite } from "@/server/db/client";
import { enqueueTask } from "@/server/queue/task-queue";
import { mapMaterialsServiceError } from "@/server/services/applications";
import {
  exportResumeDocument,
  getResumeDraftDetail,
  ResumeExportRequestSchema,
} from "@/server/services/resumes";
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
    const input = ResumeExportRequestSchema.parse(parsedBody.data);
    const db = getDb();

    if (input.async) {
      const existing = getResumeDraftDetail(id, db);
      if (!existing) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "RESUME_NOT_FOUND",
              message: `Resume draft not found: ${id}`,
            },
          },
          { status: 404 }
        );
      }
      const sqlite = getSqlite();
      const enqueued = enqueueTask(sqlite, {
        taskType: "document.export",
        payload: {
          documentType: "resume",
          resumeDraftId: id,
          versionId: input.versionId,
          format: input.format,
          paperSize: input.paperSize,
        },
        resourceType: "resume",
        resourceId: id,
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

    const result = await exportResumeDocument({
      resumeDraftId: id,
      format: input.format,
      versionId: input.versionId,
      paperSize: input.paperSize,
      db,
    });

    return NextResponse.json({
      ok: true,
      exportRecord: result.exportRecord,
      version: result.version,
      downloadUrl: result.downloadUrl,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to export resume document."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

import { NextResponse } from "next/server";
import { getSqlite } from "@/server/db/client";
import {
  EnqueueSourceRunSchema,
  enqueueSourceRun,
} from "@/server/services/sources";
import { serializeTaskForApi } from "@/server/services/tasks";
import {
  checkLocalMutation,
  handleSourceError,
  parseJsonBody,
} from "../../_helpers";

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
    const input = EnqueueSourceRunSchema.parse(parsedBody.data);
    const sqlite = getSqlite();
    const enqueued = enqueueSourceRun(sqlite, id, {
      trigger: input.trigger ?? "manual",
    });

    return NextResponse.json(
      {
        ok: true,
        taskId: enqueued.taskId,
        deduplicated: enqueued.deduplicated,
        task: serializeTaskForApi(enqueued.task),
      },
      { status: 202 }
    );
  } catch (err) {
    return handleSourceError(err, "Failed to enqueue source run.");
  }
}

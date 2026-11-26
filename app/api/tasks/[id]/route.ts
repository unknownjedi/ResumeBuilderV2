import { NextResponse } from "next/server";
import { getSqlite } from "@/server/db/client";
import { getTaskById } from "@/server/queue/task-queue";
import { validateHostAndOrigin } from "@/server/security/host-origin";
import { serializeTaskForApi } from "@/server/services/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const hostCheck = validateHostAndOrigin(req);
  if (!hostCheck.ok) {
    return NextResponse.json(
      { ok: false, error: { code: hostCheck.code, message: hostCheck.message } },
      { status: hostCheck.status }
    );
  }

  const { id } = await context.params;
  if (!id || id.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "Task ID is required." } },
      { status: 400 }
    );
  }

  const sqlite = getSqlite();
  const task = getTaskById(sqlite, id);
  if (!task) {
    return NextResponse.json(
      { ok: false, error: { code: "TASK_NOT_FOUND", message: "Task not found." } },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    task: serializeTaskForApi(task),
  });
}

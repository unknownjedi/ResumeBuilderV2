import { NextResponse } from "next/server";
import { getSqlite } from "@/server/db/client";
import { getTaskById, requestCancellation } from "@/server/queue/task-queue";
import { guardMutation } from "@/server/security/host-origin";
import { serializeTaskForApi } from "@/server/services/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = guardMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  if (!id || id.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "Task ID is required." } },
      { status: 400 }
    );
  }

  const sqlite = getSqlite();
  const existing = getTaskById(sqlite, id);
  if (!existing) {
    return NextResponse.json(
      { ok: false, error: { code: "TASK_NOT_FOUND", message: "Task not found." } },
      { status: 404 }
    );
  }

  if (
    existing.status === "succeeded" ||
    existing.status === "failed" ||
    existing.status === "cancelled"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "TASK_ALREADY_COMPLETED",
          message: "Completed tasks cannot be cancelled.",
        },
      },
      { status: 409 }
    );
  }

  const updated = requestCancellation(sqlite, id);
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: { code: "TASK_NOT_FOUND", message: "Task not found." } },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    task: serializeTaskForApi(updated),
  });
}

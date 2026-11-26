import { NextResponse } from "next/server";
import { z } from "zod";
import { getSqlite } from "@/server/db/client";
import { TASK_STATUSES } from "@/server/db/schema/system";
import { listTasks } from "@/server/queue/task-queue";
import { validateHostAndOrigin } from "@/server/security/host-origin";
import { serializeTaskForApi } from "@/server/services/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TaskStatusSchema = z.enum(TASK_STATUSES);

const ListTasksQuerySchema = z.object({
  status: z.string().optional(),
  taskType: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const hostCheck = validateHostAndOrigin(req);
  if (!hostCheck.ok) {
    return NextResponse.json(
      { ok: false, error: { code: hostCheck.code, message: hostCheck.message } },
      { status: hostCheck.status }
    );
  }

  const url = new URL(req.url);
  const parsed = ListTasksQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    taskType: url.searchParams.get("taskType") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid query parameters.",
        },
      },
      { status: 400 }
    );
  }

  let statuses: Array<z.infer<typeof TaskStatusSchema>> | undefined;
  if (parsed.data.status) {
    const rawList = parsed.data.status
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const validatedStatuses: Array<z.infer<typeof TaskStatusSchema>> = [];
    for (const s of rawList) {
      const sCheck = TaskStatusSchema.safeParse(s);
      if (!sCheck.success) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "VALIDATION_ERROR",
              message: `Invalid task status filter: ${s}`,
            },
          },
          { status: 400 }
        );
      }
      validatedStatuses.push(sCheck.data);
    }
    if (validatedStatuses.length > 0) {
      statuses = validatedStatuses;
    }
  }

  const sqlite = getSqlite();
  const tasks = listTasks(sqlite, {
    status: statuses,
    taskType: parsed.data.taskType,
    limit: parsed.data.limit ?? 50,
    offset: parsed.data.offset ?? 0,
  });

  return NextResponse.json({
    ok: true,
    tasks: tasks.map(serializeTaskForApi),
  });
}

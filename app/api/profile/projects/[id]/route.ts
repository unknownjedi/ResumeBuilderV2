import { NextResponse } from "next/server";
import {
  ProjectUpdateSchema,
  deleteProject,
  getProjectById,
  updateProject,
} from "@/server/services/profile";
import {
  checkLocalGet,
  checkLocalMutation,
  handleProfileError,
  notFoundResponse,
  parseJsonBody,
} from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const project = getProjectById(id);
  if (!project) {
    return notFoundResponse(`Project not found: ${id}`);
  }
  return NextResponse.json({ ok: true, project });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id } = await context.params;
    const input = ProjectUpdateSchema.parse(parsedBody.data);
    const project = updateProject(id, input);
    return NextResponse.json({ ok: true, project });
  } catch (err) {
    return handleProfileError(err, "Failed to update project.");
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = deleteProject(id);
  if (!deleted) {
    return notFoundResponse(`Project not found: ${id}`);
  }
  return NextResponse.json({ ok: true, deletedId: id });
}

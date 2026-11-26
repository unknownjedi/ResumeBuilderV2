import { NextResponse } from "next/server";
import {
  SkillUpdateSchema,
  deleteSkill,
  getSkillById,
  updateSkill,
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
  const skill = getSkillById(id);
  if (!skill) {
    return notFoundResponse(`Skill not found: ${id}`);
  }
  return NextResponse.json({ ok: true, skill });
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
    const input = SkillUpdateSchema.parse(parsedBody.data);
    const skill = updateSkill(id, input);
    return NextResponse.json({ ok: true, skill });
  } catch (err) {
    return handleProfileError(err, "Failed to update skill.");
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = deleteSkill(id);
  if (!deleted) {
    return notFoundResponse(`Skill not found: ${id}`);
  }
  return NextResponse.json({ ok: true, deletedId: id });
}

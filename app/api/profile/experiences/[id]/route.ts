import { NextResponse } from "next/server";
import {
  ExperienceUpdateSchema,
  deleteExperience,
  getExperienceById,
  updateExperience,
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
  const experience = getExperienceById(id);
  if (!experience) {
    return notFoundResponse(`Experience not found: ${id}`);
  }
  return NextResponse.json({ ok: true, experience });
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
    const input = ExperienceUpdateSchema.parse(parsedBody.data);
    const experience = updateExperience(id, input);
    return NextResponse.json({ ok: true, experience });
  } catch (err) {
    return handleProfileError(err, "Failed to update experience.");
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = deleteExperience(id);
  if (!deleted) {
    return notFoundResponse(`Experience not found: ${id}`);
  }
  return NextResponse.json({ ok: true, deletedId: id });
}

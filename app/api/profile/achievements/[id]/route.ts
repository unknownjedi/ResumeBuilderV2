import { NextResponse } from "next/server";
import {
  AchievementUpdateSchema,
  deleteAchievement,
  getAchievementById,
  updateAchievement,
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
  const achievement = getAchievementById(id);
  if (!achievement) {
    return notFoundResponse(`Achievement not found: ${id}`);
  }
  return NextResponse.json({ ok: true, achievement });
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
    const input = AchievementUpdateSchema.parse(parsedBody.data);
    const achievement = updateAchievement(id, input);
    return NextResponse.json({ ok: true, achievement });
  } catch (err) {
    return handleProfileError(err, "Failed to update achievement.");
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = deleteAchievement(id);
  if (!deleted) {
    return notFoundResponse(`Achievement not found: ${id}`);
  }
  return NextResponse.json({ ok: true, deletedId: id });
}

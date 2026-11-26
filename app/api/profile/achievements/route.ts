import { NextResponse } from "next/server";
import {
  AchievementCreateSchema,
  createAchievement,
  listAchievements,
} from "@/server/services/profile";
import {
  checkLocalGet,
  checkLocalMutation,
  handleProfileError,
  parseIncludeRejected,
  parseJsonBody,
} from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  const items = listAchievements(undefined, {
    includeRejected: parseIncludeRejected(req),
  });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = AchievementCreateSchema.parse(parsedBody.data);
    const achievement = createAchievement(input);
    return NextResponse.json({ ok: true, achievement }, { status: 201 });
  } catch (err) {
    return handleProfileError(err, "Failed to create achievement.");
  }
}

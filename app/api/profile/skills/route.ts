import { NextResponse } from "next/server";
import {
  SkillCreateSchema,
  createSkill,
  listSkills,
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

  const items = listSkills(undefined, {
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
    const input = SkillCreateSchema.parse(parsedBody.data);
    const skill = createSkill(input);
    return NextResponse.json({ ok: true, skill }, { status: 201 });
  } catch (err) {
    return handleProfileError(err, "Failed to create skill.");
  }
}

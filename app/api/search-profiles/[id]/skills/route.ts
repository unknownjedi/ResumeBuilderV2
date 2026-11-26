import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import {
  addSearchProfileSkill,
  CreateSearchProfileSkillSchema,
  listSearchProfileSkills,
} from "@/server/services/search-profiles";
import {
  checkLocalGet,
  checkLocalMutation,
  handleSearchProfileError,
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

  try {
    const { id } = await context.params;
    const items = listSearchProfileSkills(id, getDb());
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return handleSearchProfileError(
      err,
      "Failed to list search profile skills."
    );
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id } = await context.params;
    const input = CreateSearchProfileSkillSchema.parse(parsedBody.data);
    const skill = addSearchProfileSkill(id, input, getDb());
    return NextResponse.json({ ok: true, skill }, { status: 201 });
  } catch (err) {
    return handleSearchProfileError(err, "Failed to add search profile skill.");
  }
}

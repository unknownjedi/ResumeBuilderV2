import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import {
  deleteSearchProfileSkill,
  updateSearchProfileSkill,
  UpdateSearchProfileSkillSchema,
} from "@/server/services/search-profiles";
import {
  checkLocalMutation,
  handleSearchProfileError,
  parseJsonBody,
} from "../../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string; skillId: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id, skillId } = await context.params;
    const input = UpdateSearchProfileSkillSchema.parse(parsedBody.data);
    const skill = updateSearchProfileSkill(id, skillId, input, getDb());
    return NextResponse.json({ ok: true, skill });
  } catch (err) {
    return handleSearchProfileError(
      err,
      "Failed to update search profile skill."
    );
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string; skillId: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  try {
    const { id, skillId } = await context.params;
    const result = deleteSearchProfileSkill(id, skillId, getDb());
    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "SEARCH_PROFILE_SKILL_NOT_FOUND",
            message: `Search profile skill not found: ${skillId}`,
          },
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleSearchProfileError(
      err,
      "Failed to delete search profile skill."
    );
  }
}

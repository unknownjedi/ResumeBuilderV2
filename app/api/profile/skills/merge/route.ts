import { NextResponse } from "next/server";
import { SkillMergeSchema, mergeSkills } from "@/server/services/profile";
import {
  checkLocalMutation,
  handleProfileError,
  parseJsonBody,
} from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = SkillMergeSchema.parse(parsedBody.data);
    const skill = mergeSkills(input.sourceSkillId, input.targetSkillId);
    return NextResponse.json({
      ok: true,
      skill,
      mergedFromId: input.sourceSkillId,
    });
  } catch (err) {
    return handleProfileError(err, "Failed to merge skills.");
  }
}

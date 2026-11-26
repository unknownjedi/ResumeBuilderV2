import { NextResponse } from "next/server";
import {
  ExperienceCreateSchema,
  createExperience,
  listExperiences,
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

  const items = listExperiences(undefined, {
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
    const input = ExperienceCreateSchema.parse(parsedBody.data);
    const experience = createExperience(input);
    return NextResponse.json({ ok: true, experience }, { status: 201 });
  } catch (err) {
    return handleProfileError(err, "Failed to create experience.");
  }
}

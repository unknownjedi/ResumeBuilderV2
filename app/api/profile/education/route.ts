import { NextResponse } from "next/server";
import {
  EducationCreateSchema,
  createEducation,
  listEducation,
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

  const items = listEducation(undefined, {
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
    const input = EducationCreateSchema.parse(parsedBody.data);
    const education = createEducation(input);
    return NextResponse.json({ ok: true, education }, { status: 201 });
  } catch (err) {
    return handleProfileError(err, "Failed to create education record.");
  }
}

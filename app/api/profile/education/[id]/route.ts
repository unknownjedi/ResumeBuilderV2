import { NextResponse } from "next/server";
import {
  EducationUpdateSchema,
  deleteEducation,
  getEducationById,
  updateEducation,
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
  const education = getEducationById(id);
  if (!education) {
    return notFoundResponse(`Education record not found: ${id}`);
  }
  return NextResponse.json({ ok: true, education });
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
    const input = EducationUpdateSchema.parse(parsedBody.data);
    const education = updateEducation(id, input);
    return NextResponse.json({ ok: true, education });
  } catch (err) {
    return handleProfileError(err, "Failed to update education record.");
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = deleteEducation(id);
  if (!deleted) {
    return notFoundResponse(`Education record not found: ${id}`);
  }
  return NextResponse.json({ ok: true, deletedId: id });
}

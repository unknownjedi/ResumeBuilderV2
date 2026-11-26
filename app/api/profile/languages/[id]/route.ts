import { NextResponse } from "next/server";
import {
  LanguageUpdateSchema,
  deleteLanguage,
  getLanguageById,
  updateLanguage,
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
  const language = getLanguageById(id);
  if (!language) {
    return notFoundResponse(`Language not found: ${id}`);
  }
  return NextResponse.json({ ok: true, language });
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
    const input = LanguageUpdateSchema.parse(parsedBody.data);
    const language = updateLanguage(id, input);
    return NextResponse.json({ ok: true, language });
  } catch (err) {
    return handleProfileError(err, "Failed to update language.");
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = deleteLanguage(id);
  if (!deleted) {
    return notFoundResponse(`Language not found: ${id}`);
  }
  return NextResponse.json({ ok: true, deletedId: id });
}

import { NextResponse } from "next/server";
import {
  deleteSourceDocument,
  getSourceDocumentWithText,
} from "@/server/services/profile";
import {
  checkLocalGet,
  checkLocalMutation,
  notFoundResponse,
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
  const sourceDocument = getSourceDocumentWithText(id);
  if (!sourceDocument) {
    return notFoundResponse(`Source document not found: ${id}`);
  }
  return NextResponse.json({ ok: true, sourceDocument });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = deleteSourceDocument(id);
  if (!deleted) {
    return notFoundResponse(`Source document not found: ${id}`);
  }
  return NextResponse.json({ ok: true, deletedId: id });
}

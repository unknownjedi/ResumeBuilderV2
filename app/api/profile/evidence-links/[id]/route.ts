import { NextResponse } from "next/server";
import {
  EvidenceLinkUpdateSchema,
  deleteEvidenceLink,
  getEvidenceLinkById,
  updateEvidenceLink,
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
  const evidenceLink = getEvidenceLinkById(id);
  if (!evidenceLink) {
    return notFoundResponse(`Evidence link not found: ${id}`);
  }
  return NextResponse.json({ ok: true, evidenceLink });
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
    const input = EvidenceLinkUpdateSchema.parse(parsedBody.data);
    const evidenceLink = updateEvidenceLink(id, input);
    return NextResponse.json({ ok: true, evidenceLink });
  } catch (err) {
    return handleProfileError(err, "Failed to update evidence link.");
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = deleteEvidenceLink(id);
  if (!deleted) {
    return notFoundResponse(`Evidence link not found: ${id}`);
  }
  return NextResponse.json({ ok: true, deletedId: id });
}

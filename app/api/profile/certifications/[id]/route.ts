import { NextResponse } from "next/server";
import {
  CertificationUpdateSchema,
  deleteCertification,
  getCertificationById,
  updateCertification,
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
  const certification = getCertificationById(id);
  if (!certification) {
    return notFoundResponse(`Certification not found: ${id}`);
  }
  return NextResponse.json({ ok: true, certification });
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
    const input = CertificationUpdateSchema.parse(parsedBody.data);
    const certification = updateCertification(id, input);
    return NextResponse.json({ ok: true, certification });
  } catch (err) {
    return handleProfileError(err, "Failed to update certification.");
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const deleted = deleteCertification(id);
  if (!deleted) {
    return notFoundResponse(`Certification not found: ${id}`);
  }
  return NextResponse.json({ ok: true, deletedId: id });
}

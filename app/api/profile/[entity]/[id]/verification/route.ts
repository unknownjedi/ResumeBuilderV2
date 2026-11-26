import { NextResponse } from "next/server";
import {
  VerificationPatchSchema,
  updateEntityVerification,
} from "@/server/services/profile";
import {
  checkLocalMutation,
  handleProfileError,
  parseJsonBody,
} from "../../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ entity: string; id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { entity, id } = await context.params;
    const { verificationStatus } = VerificationPatchSchema.parse(parsedBody.data);
    const result = updateEntityVerification(entity, id, verificationStatus);
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return handleProfileError(err, "Failed to update verification status.");
  }
}

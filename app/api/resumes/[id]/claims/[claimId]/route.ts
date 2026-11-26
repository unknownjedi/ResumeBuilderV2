import { NextResponse } from "next/server";
import { z } from "zod";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import {
  ClaimEvidenceRefSchema,
  ClaimUserEditedStateSchema,
} from "@/server/ai/schemas/resume-generation";
import { getDb } from "@/server/db/client";
import { VERIFICATION_STATUSES } from "@/server/db/schema/career";
import { mapMaterialsServiceError } from "@/server/services/applications";
import { updateResumeClaim } from "@/server/services/resumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ClaimPatchBodySchema = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(),
    userEditedState: ClaimUserEditedStateSchema.optional(),
    verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
    evidenceRefs: z.array(ClaimEvidenceRefSchema).max(50).optional(),
  })
  .strict();

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string; claimId: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id, claimId } = await context.params;
    const input = ClaimPatchBodySchema.parse(parsedBody.data);

    const effectiveUserEditedState =
      input.userEditedState ??
      (input.verificationStatus === "verified" ? "user_verified" : undefined);

    const draft = updateResumeClaim(
      {
        resumeDraftId: id,
        claimId,
        text: input.text,
        userEditedState: effectiveUserEditedState,
        evidenceRefs: input.evidenceRefs,
      },
      getDb()
    );

    return NextResponse.json({
      ok: true,
      draft,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to update resume claim."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

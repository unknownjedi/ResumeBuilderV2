import { NextResponse } from "next/server";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import {
  mapMaterialsServiceError,
  transitionApplicationStatus,
  TransitionApplicationStatusSchema,
} from "@/server/services/applications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id } = await context.params;
    const input = TransitionApplicationStatusSchema.parse(parsedBody.data);
    const newStatus = input.newStatus ?? input.status;
    if (!newStatus) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "newStatus (or status) is required.",
          },
        },
        { status: 400 }
      );
    }

    const application = transitionApplicationStatus(
      {
        applicationId: id,
        newStatus,
        note: input.note,
        resumeVersionId: input.resumeVersionId,
        coverLetterId: input.coverLetterId,
        answerIds: input.answerIds,
        confirmSubmission: input.confirmSubmission,
        appliedAt: input.appliedAt,
      },
      getDb()
    );

    return NextResponse.json({
      ok: true,
      application,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to transition application status."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

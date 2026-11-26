import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import {
  SetUserJobStateSchema,
  setUserJobState,
} from "@/server/services/jobs";
import {
  checkLocalMutation,
  handleJobError,
  parseJsonBody,
} from "../../_helpers";

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
    const input = SetUserJobStateSchema.parse(parsedBody.data);
    const state = setUserJobState(
      {
        jobId: id,
        searchProfileId: input.searchProfileId,
        state: input.state,
        notes: input.notes,
      },
      getDb()
    );

    return NextResponse.json({
      ok: true,
      state,
    });
  } catch (err) {
    return handleJobError(err, "Failed to update job discovery state.");
  }
}

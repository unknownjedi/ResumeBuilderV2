import { NextResponse } from "next/server";
import { getDb, getSqlite } from "@/server/db/client";
import {
  MergeDuplicateSchema,
  mergeDuplicateCandidate,
} from "@/server/services/jobs";
import {
  checkLocalMutation,
  handleJobError,
  parseJsonBody,
} from "../../../jobs/_helpers";

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
    const input = MergeDuplicateSchema.parse(parsedBody.data);
    const merged = mergeDuplicateCandidate(
      id,
      { keepJobId: input.keepJobId },
      getDb(),
      getSqlite()
    );

    return NextResponse.json({
      ok: true,
      merged,
    });
  } catch (err) {
    return handleJobError(err, "Failed to merge duplicate candidate.");
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, getSqlite } from "@/server/db/client";
import {
  computeJobMatch,
  MatchingServiceError,
  recomputeMatchesForJob,
} from "@/server/services/matching";
import {
  checkLocalMutation,
  handleJobError,
  parseJsonBody,
} from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MatchJobBodySchema = z
  .object({
    searchProfileId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req, { allowEmpty: true });
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id } = await context.params;
    const input = MatchJobBodySchema.parse(parsedBody.data);

    const db = getDb();
    const sqlite = getSqlite();

    if (input.searchProfileId) {
      const match = computeJobMatch({
        jobId: id,
        searchProfileId: input.searchProfileId,
        db,
        sqlite,
      });
      return NextResponse.json({
        ok: true,
        match,
      });
    }

    const result = recomputeMatchesForJob(id, db, sqlite);
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    if (err instanceof MatchingServiceError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: err.code,
            message: err.message,
          },
        },
        { status: err.status }
      );
    }
    return handleJobError(err, "Failed to recompute job match.");
  }
}

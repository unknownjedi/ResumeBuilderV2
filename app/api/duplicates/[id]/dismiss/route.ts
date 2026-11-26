import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { dismissDuplicateCandidate } from "@/server/services/jobs";
import {
  checkLocalMutation,
  handleJobError,
} from "../../../jobs/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  try {
    const { id } = await context.params;
    const dismissed = dismissDuplicateCandidate(id, getDb());

    return NextResponse.json({
      ok: true,
      dismissed,
    });
  } catch (err) {
    return handleJobError(err, "Failed to dismiss duplicate candidate.");
  }
}

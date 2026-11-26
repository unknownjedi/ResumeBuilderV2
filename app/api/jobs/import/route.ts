import { NextResponse } from "next/server";
import { getDb, getSqlite } from "@/server/db/client";
import { ManualJobImportSchema, ingestManualJob } from "@/server/services/jobs";
import {
  checkLocalMutation,
  handleJobError,
  parseJsonBody,
} from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = ManualJobImportSchema.parse(parsedBody.data);
    const result = await ingestManualJob(input, getDb(), getSqlite());
    return NextResponse.json(
      { ok: true, ...result },
      { status: result.created ? 201 : 200 }
    );
  } catch (err) {
    return handleJobError(err, "Failed to import job.");
  }
}

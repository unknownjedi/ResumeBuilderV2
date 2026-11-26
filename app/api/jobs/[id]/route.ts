import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getJobDetail } from "@/server/services/jobs";
import { checkLocalGet, handleJobError } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const { id } = await context.params;
    const url = new URL(req.url);
    const searchProfileId =
      url.searchParams.get("searchProfileId")?.trim() || undefined;

    const detail = getJobDetail(id, getDb(), { searchProfileId });
    if (!detail) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "JOB_NOT_FOUND", message: `Job not found: ${id}` },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      ...detail,
    });
  } catch (err) {
    return handleJobError(err, "Failed to load job details.");
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { listSourceRuns } from "@/server/services/sources";
import { checkLocalGet, handleSourceError } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const { id } = await context.params;
    const url = new URL(req.url);
    const query = RunsQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const runs = listSourceRuns(id, query);
    return NextResponse.json({ ok: true, runs });
  } catch (err) {
    return handleSourceError(err, "Failed to load source runs.");
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { DUPLICATE_STATES } from "@/server/db/schema/jobs";
import { listDuplicateCandidates } from "@/server/services/jobs";
import { checkLocalGet, handleJobError } from "../jobs/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ListDuplicatesQuerySchema = z.object({
  state: z.enum([...DUPLICATE_STATES, "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const url = new URL(req.url);
    const query = ListDuplicatesQuerySchema.parse({
      state: url.searchParams.get("state") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const items = listDuplicateCandidates(getDb(), query);
    return NextResponse.json({
      ok: true,
      items,
    });
  } catch (err) {
    return handleJobError(err, "Failed to list duplicate candidates.");
  }
}

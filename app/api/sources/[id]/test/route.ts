import { NextResponse } from "next/server";
import { testSource } from "@/server/services/sources";
import { checkLocalMutation, handleSourceError } from "../../_helpers";

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
    const result = await testSource(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleSourceError(err, "Failed to validate job source.");
  }
}

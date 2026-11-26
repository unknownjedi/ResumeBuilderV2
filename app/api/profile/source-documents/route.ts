import { NextResponse } from "next/server";
import { listSourceDocuments } from "@/server/services/profile";
import { checkLocalGet } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  const items = listSourceDocuments();
  return NextResponse.json({ ok: true, items });
}

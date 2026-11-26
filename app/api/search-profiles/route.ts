import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { searchProfiles } from "@/server/db/schema/jobs";
import { validateHostAndOrigin } from "@/server/security/host-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const hostCheck = validateHostAndOrigin(req);
  if (!hostCheck.ok) {
    return NextResponse.json(
      { ok: false, error: { code: hostCheck.code, message: hostCheck.message } },
      { status: hostCheck.status }
    );
  }

  const db = getDb();
  const rows = db
    .select({
      id: searchProfiles.id,
      name: searchProfiles.name,
      enabled: searchProfiles.enabled,
    })
    .from(searchProfiles)
    .orderBy(asc(searchProfiles.createdAt))
    .all();

  return NextResponse.json({
    ok: true,
    items: rows.map((row, idx) => ({
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      isDefault: idx === 0,
    })),
  });
}

import { NextResponse } from "next/server";
import { getDb, getSqlite } from "@/server/db/client";
import { validateHostAndOrigin } from "@/server/security/host-origin";
import {
  getOverviewData,
  OverviewServiceError,
} from "@/server/services/overview";

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

  try {
    const url = new URL(req.url);
    const searchProfileId =
      url.searchParams.get("searchProfileId")?.trim() || undefined;

    const overview = getOverviewData({
      searchProfileId,
      db: getDb(),
      sqlite: getSqlite(),
    });

    return NextResponse.json({
      ok: true,
      ...overview,
    });
  } catch (err) {
    if (err instanceof OverviewServiceError) {
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
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "OVERVIEW_INTERNAL_ERROR",
          message: "Failed to load overview data.",
        },
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { validateHostAndOrigin } from "@/server/security/host-origin";
import { getDiagnosticsReport } from "@/server/services/diagnostics";

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

  const report = await getDiagnosticsReport();
  return NextResponse.json({
    ok: true,
    diagnostics: report,
  });
}

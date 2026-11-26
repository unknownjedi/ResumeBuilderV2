import fs from "node:fs";
import { NextResponse } from "next/server";
import { checkLocalGet } from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import { mapMaterialsServiceError } from "@/server/services/applications";
import { getExportDownloadInfo } from "@/server/services/resumes";

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
    const info = getExportDownloadInfo(id, getDb());
    const buffer = fs.readFileSync(info.filePath);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": info.mimeType,
        "Content-Disposition": `attachment; filename="${info.fileName}"`,
        "Content-Length": String(buffer.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to download exported document."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

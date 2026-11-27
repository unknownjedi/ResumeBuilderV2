import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { checkLocalGet } from "@/app/api/jobs/_helpers";
import {
  BackupServiceError,
  resolveBackupArchivePath,
} from "@/server/services/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ filename: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const { filename } = await context.params;
    const archivePath = resolveBackupArchivePath(decodeURIComponent(filename));
    const safeName = path.basename(archivePath).replace(/"/g, "");
    const buffer = fs.readFileSync(/*turbopackIgnore: true*/ archivePath);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof BackupServiceError) {
      return NextResponse.json(
        { ok: false, error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKUP_DOWNLOAD_ERROR",
          message:
            err instanceof Error ? err.message : "Failed to download backup.",
        },
      },
      { status: 500 }
    );
  }
}

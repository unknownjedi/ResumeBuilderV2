import { NextResponse } from "next/server";
import { checkLocalGet } from "@/app/api/jobs/_helpers";
import { listBackups } from "@/server/services/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const backups = await listBackups();
    return NextResponse.json({
      ok: true,
      backups: backups.map((b) => ({
        filename: b.filename,
        sizeBytes: b.sizeBytes,
        createdAt: b.createdAt,
        trigger: b.trigger,
        fileCount: b.fileCount,
        dbChecksumSha256: b.dbChecksumSha256,
        validManifest: b.validManifest,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BACKUP_LIST_ERROR",
          message: err instanceof Error ? err.message : "Failed to list backups.",
        },
      },
      { status: 500 }
    );
  }
}

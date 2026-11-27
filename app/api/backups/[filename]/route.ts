import { NextResponse } from "next/server";
import { checkLocalMutation } from "@/app/api/jobs/_helpers";
import { BackupServiceError, deleteBackupArchive } from "@/server/services/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  context: { params: Promise<{ filename: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  try {
    const { filename } = await context.params;
    deleteBackupArchive(decodeURIComponent(filename));
    return NextResponse.json({ ok: true });
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
          code: "BACKUP_DELETE_ERROR",
          message: err instanceof Error ? err.message : "Failed to delete backup.",
        },
      },
      { status: 500 }
    );
  }
}

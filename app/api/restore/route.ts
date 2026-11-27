import crypto from "node:crypto";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkLocalMutation } from "@/app/api/jobs/_helpers";
import { assertPathWithin, ensureAppDirectories, writeSecureFile } from "@/server/files/paths";
import {
  BackupServiceError,
  MAX_BACKUP_ARCHIVE_BYTES,
  resolveBackupArchivePath,
  restoreFromBackupArchive,
} from "@/server/services/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RestoreByFilenameSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    confirmRestore: z.boolean(),
    createPreRestoreBackup: z.boolean().optional().default(true),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const contentType = req.headers.get("content-type") ?? "";
  let tempUploadPath: string | null = null;

  try {
    let targetArchivePath: string;
    let confirmRestore = false;
    let createPreRestoreBackup = true;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const uploaded = formData.get("file");
      const rawConfirm = formData.get("confirmRestore");
      const rawPreBackup = formData.get("createPreRestoreBackup");
      confirmRestore = rawConfirm === "true" || rawConfirm === "1";
      if (rawPreBackup === "false" || rawPreBackup === "0") {
        createPreRestoreBackup = false;
      }

      if (!(uploaded instanceof File)) {
        throw new BackupServiceError(
          "MISSING_ARCHIVE_FILE",
          400,
          "Upload a .tar.gz backup archive under field 'file'."
        );
      }
      if (uploaded.size === 0 || uploaded.size > MAX_BACKUP_ARCHIVE_BYTES) {
        throw new BackupServiceError(
          "INVALID_ARCHIVE_SIZE",
          400,
          `Backup archive size must be between 1 byte and ${MAX_BACKUP_ARCHIVE_BYTES} bytes.`
        );
      }
      const bytes = Buffer.from(await uploaded.arrayBuffer());
      const paths = ensureAppDirectories();
      tempUploadPath = assertPathWithin(
        paths.tmp,
        `restore-upload-${crypto.randomUUID().slice(0, 8)}.tar.gz`
      );
      writeSecureFile(tempUploadPath, bytes);
      targetArchivePath = tempUploadPath;
    } else {
      const rawJson: unknown = await req.json().catch(() => null);
      const parsed = RestoreByFilenameSchema.parse(rawJson);
      confirmRestore = parsed.confirmRestore;
      createPreRestoreBackup = parsed.createPreRestoreBackup;
      targetArchivePath = resolveBackupArchivePath(parsed.filename);
    }

    const result = await restoreFromBackupArchive({
      archivePath: targetArchivePath,
      confirmRestore,
      createPreRestoreBackup,
    });

    return NextResponse.json({
      ok: true,
      preRestoreBackupFilename: result.preRestoreBackupFilename,
      restoredFileCount: result.restoredFileCount,
      dbChecksumSha256: result.dbChecksumSha256,
    });
  } catch (err) {
    if (err instanceof BackupServiceError) {
      return NextResponse.json(
        { ok: false, error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: err.issues[0]?.message ?? "Invalid restore request.",
          },
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RESTORE_ERROR",
          message: err instanceof Error ? err.message : "Restore failed.",
        },
      },
      { status: 500 }
    );
  } finally {
    if (tempUploadPath) {
      fs.rmSync(/*turbopackIgnore: true*/ tempUploadPath, { force: true });
    }
  }
}

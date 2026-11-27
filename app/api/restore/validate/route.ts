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
  validateBackupArchive,
} from "@/server/services/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ValidateByFilenameSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const contentType = req.headers.get("content-type") ?? "";
  let tempUploadPath: string | null = null;

  try {
    let targetArchivePath: string;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const uploaded = formData.get("file");
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
        `validate-upload-${crypto.randomUUID().slice(0, 8)}.tar.gz`
      );
      writeSecureFile(tempUploadPath, bytes);
      targetArchivePath = tempUploadPath;
    } else {
      const rawJson: unknown = await req.json().catch(() => null);
      const parsed = ValidateByFilenameSchema.parse(rawJson);
      targetArchivePath = resolveBackupArchivePath(parsed.filename);
    }

    const validation = await validateBackupArchive({
      archivePath: targetArchivePath,
    });

    return NextResponse.json({
      ok: true,
      validation: {
        valid: validation.valid,
        entryCount: validation.entryCount,
        totalUncompressedBytes: validation.totalUncompressedBytes,
        manifest: validation.manifest,
      },
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
            message: err.issues[0]?.message ?? "Invalid restore validation request.",
          },
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RESTORE_VALIDATE_ERROR",
          message:
            err instanceof Error ? err.message : "Failed to validate backup archive.",
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

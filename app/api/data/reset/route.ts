import { NextResponse } from "next/server";
import { z } from "zod";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import {
  BackupServiceError,
  resetAllLocalData,
} from "@/server/services/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ResetDataBodySchema = z
  .object({
    confirmationText: z.string(),
    createSafetyBackup: z.boolean().optional().default(true),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = ResetDataBodySchema.parse(parsedBody.data);
    const result = await resetAllLocalData({
      confirmationText: input.confirmationText,
      createSafetyBackup: input.createSafetyBackup,
    });

    return NextResponse.json({
      ok: true,
      safetyBackupFilename: result.safetyBackupFilename,
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
            message: err.issues[0]?.message ?? "Invalid reset request.",
          },
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "DATA_RESET_ERROR",
          message:
            err instanceof Error ? err.message : "Failed to reset local data.",
        },
      },
      { status: 500 }
    );
  }
}

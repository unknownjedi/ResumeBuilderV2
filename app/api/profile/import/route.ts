import { NextResponse } from "next/server";
import { importResumeDocument } from "@/server/ai/workflows/parse-resume";
import { logger } from "@/server/logging/logger";
import { guardMutation } from "@/server/security/host-origin";
import {
  MAX_UPLOAD_BYTES,
  UploadValidationError,
} from "@/server/security/upload-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MULTIPART_CONTENT_LENGTH = MAX_UPLOAD_BYTES + 1024 * 1024;

function parseUseAiField(raw: FormDataEntryValue | null): boolean | null {
  if (raw === null) return false;
  if (typeof raw !== "string") return null;

  const normalized = raw.trim().toLowerCase();
  if (normalized === "" || normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") {
    return false;
  }
  if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") {
    return true;
  }
  return null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = guardMutation(req);
  if (blocked) return blocked;

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_CONTENT_TYPE",
          message: "Request must use multipart/form-data.",
        },
      },
      { status: 400 }
    );
  }

  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_CONTENT_LENGTH) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FILE_TOO_LARGE",
            message: "Uploaded file exceeds the 15 MiB maximum size.",
          },
        },
        { status: 413 }
      );
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_MULTIPART",
          message: "Could not parse multipart/form-data request.",
        },
      },
      { status: 400 }
    );
  }

  const fileEntry = formData.get("file");
  if (
    !fileEntry ||
    typeof fileEntry === "string" ||
    typeof fileEntry.arrayBuffer !== "function"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "MISSING_FILE",
          message: "A file field is required.",
        },
      },
      { status: 400 }
    );
  }

  const useAi = parseUseAiField(formData.get("useAi"));
  if (useAi === null) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid useAi flag; expected boolean string.",
        },
      },
      { status: 400 }
    );
  }

  if (fileEntry.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FILE_TOO_LARGE",
          message: "Uploaded file exceeds the 15 MiB maximum size.",
        },
      },
      { status: 413 }
    );
  }

  const fileName =
    typeof (fileEntry as File).name === "string" && (fileEntry as File).name.trim()
      ? (fileEntry as File).name
      : "resume";

  try {
    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await importResumeDocument({
      fileName,
      buffer,
      mimeType: fileEntry.type || undefined,
      useAi,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    if (err instanceof UploadValidationError) {
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

    logger.error("profile.import.failed", "Unexpected failure importing resume document.", {
      errorCode: "IMPORT_FAILED",
    });

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "IMPORT_FAILED",
          message: "Failed to import resume document.",
        },
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { guardMutation, validateHostAndOrigin } from "@/server/security/host-origin";
import { SourceServiceError } from "@/server/services/sources";

export function checkLocalGet(req: Request): NextResponse | null {
  const hostCheck = validateHostAndOrigin(req);
  if (hostCheck.ok) {
    return null;
  }
  return NextResponse.json(
    { ok: false, error: { code: hostCheck.code, message: hostCheck.message } },
    { status: hostCheck.status }
  );
}

export function checkLocalMutation(req: Request): NextResponse | null {
  return guardMutation(req);
}

export async function parseJsonBody(
  req: Request,
  options?: { allowEmpty?: boolean }
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Unable to read request body.",
          },
        },
        { status: 400 }
      ),
    };
  }

  if (options?.allowEmpty && rawText.trim().length === 0) {
    return { ok: true, data: {} };
  }

  try {
    return { ok: true, data: JSON.parse(rawText) };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_JSON",
            message: "Request body must be valid JSON.",
          },
        },
        { status: 400 }
      ),
    };
  }
}

export function handleSourceError(
  err: unknown,
  fallbackMessage = "Source operation failed."
): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: err.issues[0]?.message ?? "Invalid request payload.",
          issues: err.issues,
        },
      },
      { status: 400 }
    );
  }
  if (err instanceof SourceServiceError) {
    const headers: Record<string, string> = {};
    if (
      err.status === 429 &&
      typeof err.meta?.retryAfterSeconds === "number"
    ) {
      headers["Retry-After"] = String(err.meta.retryAfterSeconds);
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.meta ? { meta: err.meta } : {}),
        },
      },
      { status: err.status, headers }
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "SOURCE_INTERNAL_ERROR",
        message: fallbackMessage,
      },
    },
    { status: 500 }
  );
}

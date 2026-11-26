import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { guardMutation, validateHostAndOrigin } from "@/server/security/host-origin";
import { ProfileServiceError } from "@/server/services/profile";

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

export function parseIncludeRejected(req: Request): boolean {
  const url = new URL(req.url);
  return url.searchParams.get("includeRejected") === "true";
}

export async function parseJsonBody(
  req: Request
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  try {
    const data = await req.json();
    return { ok: true, data };
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

export function handleProfileError(
  err: unknown,
  fallbackMessage = "Career profile operation failed."
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
  if (err instanceof ProfileServiceError) {
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
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "PROFILE_INTERNAL_ERROR",
        message: fallbackMessage,
      },
    },
    { status: 500 }
  );
}

export function notFoundResponse(message: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "PROFILE_ENTITY_NOT_FOUND",
        message,
      },
    },
    { status: 404 }
  );
}

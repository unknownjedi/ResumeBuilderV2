import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  guardMutation,
  validateHostAndOrigin,
} from "@/server/security/host-origin";
import { SearchProfileServiceError } from "@/server/services/search-profiles";

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
  req: Request
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

export function handleSearchProfileError(
  err: unknown,
  fallbackMessage = "Search profile operation failed."
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
  if (err instanceof SearchProfileServiceError) {
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
        code: "SEARCH_PROFILE_INTERNAL_ERROR",
        message: fallbackMessage,
      },
    },
    { status: 500 }
  );
}

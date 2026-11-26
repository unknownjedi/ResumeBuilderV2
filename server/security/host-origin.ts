import { NextResponse } from "next/server";

const ALLOWED_LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost):(\d{1,5})$/;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type HostOriginValidationResult =
  | { ok: true }
  | { ok: false; status: 403; code: string; message: string };

/**
 * Validate that the incoming request targets the local loopback Host header
 * (`127.0.0.1:<port>` or `localhost:<port>`) and, for state-changing requests,
 * carries an exact matching `http://<host>` Origin header.
 */
export function validateHostAndOrigin(req: Request): HostOriginValidationResult {
  const hostHeader = req.headers.get("host")?.trim() ?? "";
  const hostMatch = ALLOWED_LOCAL_HOST_RE.exec(hostHeader);

  if (!hostMatch) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN_HOST",
      message: "Requests are only accepted for 127.0.0.1:<port> or localhost:<port>.",
    };
  }

  const port = Number(hostMatch[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN_HOST",
      message: "Host header port is out of valid range.",
    };
  }

  const method = req.method.toUpperCase();
  if (MUTATION_METHODS.has(method)) {
    const originHeader = req.headers.get("origin")?.trim() ?? "";
    const expectedOrigin = `http://${hostHeader}`;

    if (!originHeader || originHeader === "null" || originHeader !== expectedOrigin) {
      return {
        ok: false,
        status: 403,
        code: "FORBIDDEN_ORIGIN",
        message: "Mutation requests require a matching local Origin header.",
      };
    }
  }

  return { ok: true };
}

/**
 * Guard helper for Next.js App Router mutation endpoints.
 * Returns a 403 NextResponse if validation fails, or null if permitted.
 */
export function guardMutation(req: Request): NextResponse | null {
  const result = validateHostAndOrigin(req);
  if (result.ok) {
    return null;
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: result.code,
        message: result.message,
      },
    },
    { status: result.status }
  );
}

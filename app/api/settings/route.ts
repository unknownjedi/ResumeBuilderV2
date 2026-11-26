import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { detectAvailableClis } from "@/server/ai/providers/cli-provider";
import { guardMutation, validateHostAndOrigin } from "@/server/security/host-origin";
import {
  AppSettingsPatchSchema,
  getSettings,
  updateSettings,
} from "@/server/services/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const hostCheck = validateHostAndOrigin(req);
  if (!hostCheck.ok) {
    return NextResponse.json(
      { ok: false, error: { code: hostCheck.code, message: hostCheck.message } },
      { status: hostCheck.status }
    );
  }

  const settings = getSettings();
  return NextResponse.json({
    ok: true,
    settings,
    detectedClis: detectAvailableClis(),
  });
}

async function handleSave(req: Request): Promise<NextResponse> {
  const blocked = guardMutation(req);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON.",
        },
      },
      { status: 400 }
    );
  }

  try {
    const patch = AppSettingsPatchSchema.parse(body);
    const updated = updateSettings(patch);
    return NextResponse.json({
      ok: true,
      settings: updated,
      detectedClis: detectAvailableClis(),
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: err.issues[0]?.message ?? "Invalid settings payload.",
            issues: err.issues,
          },
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "SETTINGS_UPDATE_FAILED",
          message: "Failed to update settings.",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleSave(req);
}

export async function PATCH(req: Request): Promise<NextResponse> {
  return handleSave(req);
}

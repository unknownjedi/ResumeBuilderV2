import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { testAiProviderConfig } from "@/server/ai/providers/index";
import { detectAvailableClis } from "@/server/ai/providers/cli-provider";
import { guardMutation } from "@/server/security/host-origin";
import { AiConfigPatchSchema } from "@/server/services/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AiTestRequestSchema = AiConfigPatchSchema.optional();

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = guardMutation(req);
  if (blocked) return blocked;

  let body: unknown = undefined;
  const rawText = await req.text();
  if (rawText.trim()) {
    try {
      body = JSON.parse(rawText);
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
  }

  try {
    const candidate = AiTestRequestSchema.parse(body);
    const result = await testAiProviderConfig(candidate);
    return NextResponse.json({
      ok: result.ok,
      result,
      detectedClis: detectAvailableClis(),
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: err.issues[0]?.message ?? "Invalid AI test configuration.",
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
          code: "AI_TEST_FAILED",
          message: "Failed to test AI provider.",
        },
      },
      { status: 500 }
    );
  }
}

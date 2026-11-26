import { NextResponse } from "next/server";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import {
  generateAndSaveApplicationAnswers,
  GenerateApplicationAnswersRequestSchema,
  mapMaterialsServiceError,
} from "@/server/services/applications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req, { allowEmpty: true });
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id } = await context.params;
    const input = GenerateApplicationAnswersRequestSchema.parse(parsedBody.data);

    const result = await generateAndSaveApplicationAnswers({
      jobId: id,
      searchProfileId: input.searchProfileId,
      applicationId: input.applicationId,
      prompts: input.prompts,
      promptKeys: input.promptKeys,
      customPrompt: input.customPrompt,
      mode: input.mode,
      regenerate: input.regenerate,
      db: getDb(),
    });

    return NextResponse.json({
      ok: true,
      answers: result.items,
      modelProvider: result.modelProvider,
      modelName: result.modelName,
      promptVersion: result.promptVersion,
      usedAi: result.usedAi,
      fallbackReason: result.fallbackReason,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to generate application answers."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

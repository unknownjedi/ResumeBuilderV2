import { NextResponse } from "next/server";
import { checkLocalMutation, parseJsonBody } from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import {
  exportApplicationAnswers,
  ExportApplicationAnswersSchema,
  mapMaterialsServiceError,
} from "@/server/services/applications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = ExportApplicationAnswersSchema.parse(parsedBody.data);
    const result = exportApplicationAnswers({
      answerIds: input.answerIds,
      format: input.format,
      db: getDb(),
    });

    return NextResponse.json({
      ok: true,
      exportRecord: result.exportRecord,
      downloadUrl: result.downloadUrl,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to export application answers."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

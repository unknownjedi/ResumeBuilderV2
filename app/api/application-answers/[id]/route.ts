import { NextResponse } from "next/server";
import {
  checkLocalGet,
  checkLocalMutation,
  parseJsonBody,
} from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import {
  getApplicationAnswerDetail,
  mapMaterialsServiceError,
  updateApplicationAnswer,
} from "@/server/services/applications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const { id } = await context.params;
    const answer = getApplicationAnswerDetail(id, getDb());
    if (!answer) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "ANSWER_NOT_FOUND",
            message: `Application answer not found: ${id}`,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      answer,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to load application answer."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id } = await context.params;
    const answer = updateApplicationAnswer(id, parsedBody.data, getDb());

    return NextResponse.json({
      ok: true,
      answer,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to update application answer."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

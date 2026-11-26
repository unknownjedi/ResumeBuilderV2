import { NextResponse } from "next/server";
import {
  checkLocalGet,
  checkLocalMutation,
  parseJsonBody,
} from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import {
  getCoverLetterDetail,
  mapMaterialsServiceError,
  updateCoverLetter,
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
    const coverLetter = getCoverLetterDetail(id, getDb());
    if (!coverLetter) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "COVER_LETTER_NOT_FOUND",
            message: `Cover letter not found: ${id}`,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      coverLetter,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to load cover letter."
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
    const coverLetter = updateCoverLetter(id, parsedBody.data, getDb());

    return NextResponse.json({
      ok: true,
      coverLetter,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to update cover letter."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

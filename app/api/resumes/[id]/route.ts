import { NextResponse } from "next/server";
import {
  checkLocalGet,
  checkLocalMutation,
  parseJsonBody,
} from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import { mapMaterialsServiceError } from "@/server/services/applications";
import {
  deleteResumeDraft,
  getResumeDraftDetail,
  updateResumeDraft,
} from "@/server/services/resumes";

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
    const draft = getResumeDraftDetail(id, getDb());
    if (!draft) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RESUME_NOT_FOUND",
            message: `Resume draft not found: ${id}`,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      draft,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to load resume draft."
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
    const draft = updateResumeDraft(id, parsedBody.data, getDb());

    return NextResponse.json({
      ok: true,
      draft,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to update resume draft."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  try {
    const { id } = await context.params;
    const result = deleteResumeDraft(id, getDb());

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to delete resume draft."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

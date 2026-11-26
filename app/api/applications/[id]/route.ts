import { NextResponse } from "next/server";
import {
  checkLocalGet,
  checkLocalMutation,
  parseJsonBody,
} from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import {
  getApplicationDetail,
  mapMaterialsServiceError,
  updateApplicationMetadata,
  UpdateApplicationMetadataSchema,
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
    const application = getApplicationDetail(id, getDb());
    if (!application) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "APPLICATION_NOT_FOUND",
            message: `Application not found: ${id}`,
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      application,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to load application details."
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
    const patch = UpdateApplicationMetadataSchema.parse(parsedBody.data);
    const application = updateApplicationMetadata(id, patch, getDb());

    return NextResponse.json({
      ok: true,
      application,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to update application."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

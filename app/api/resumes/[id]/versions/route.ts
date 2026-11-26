import { NextResponse } from "next/server";
import { z } from "zod";
import {
  checkLocalGet,
  checkLocalMutation,
  parseJsonBody,
} from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import { mapMaterialsServiceError } from "@/server/services/applications";
import {
  createImmutableResumeVersion,
  getResumeDraftDetail,
} from "@/server/services/resumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateVersionBodySchema = z.object({}).strict();

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const { id } = await context.params;
    const detail = getResumeDraftDetail(id, getDb());
    if (!detail) {
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
      versions: detail.versions,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to load resume versions."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

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
    CreateVersionBodySchema.parse(parsedBody.data);

    const db = getDb();
    const res = createImmutableResumeVersion(id, db);
    const detail = getResumeDraftDetail(id, db);

    return NextResponse.json(
      {
        ok: true,
        created: res.created,
        version: res.version,
        versions: detail?.versions ?? [res.version],
      },
      { status: res.created ? 201 : 200 }
    );
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to create immutable resume version."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

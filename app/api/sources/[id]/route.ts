import { NextResponse } from "next/server";
import {
  UpdateSourceSchema,
  deleteSource,
  getSourceById,
  updateSource,
} from "@/server/services/sources";
import {
  checkLocalGet,
  checkLocalMutation,
  handleSourceError,
  parseJsonBody,
} from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  const { id } = await context.params;
  const source = getSourceById(id);
  if (!source) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "SOURCE_NOT_FOUND", message: `Source not found: ${id}` },
      },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, source });
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
    const input = UpdateSourceSchema.parse(parsedBody.data);
    const source = updateSource(id, input);
    return NextResponse.json({ ok: true, source });
  } catch (err) {
    return handleSourceError(err, "Failed to update job source.");
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
    const result = deleteSource(id);
    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "SOURCE_NOT_FOUND",
            message: `Source not found: ${id}`,
          },
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleSourceError(err, "Failed to delete job source.");
  }
}

import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import {
  deleteSearchProfile,
  getSearchProfileById,
  updateSearchProfile,
  UpdateSearchProfileSchema,
} from "@/server/services/search-profiles";
import {
  checkLocalGet,
  checkLocalMutation,
  handleSearchProfileError,
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

  try {
    const { id } = await context.params;
    const searchProfile = getSearchProfileById(id, getDb());
    if (!searchProfile) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "SEARCH_PROFILE_NOT_FOUND",
            message: `Search profile not found: ${id}`,
          },
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, searchProfile });
  } catch (err) {
    return handleSearchProfileError(err, "Failed to load search profile.");
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
    const input = UpdateSearchProfileSchema.parse(parsedBody.data);
    const searchProfile = updateSearchProfile(id, input, getDb());
    return NextResponse.json({ ok: true, searchProfile });
  } catch (err) {
    return handleSearchProfileError(err, "Failed to update search profile.");
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
    const result = deleteSearchProfile(id, getDb());
    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "SEARCH_PROFILE_NOT_FOUND",
            message: `Search profile not found: ${id}`,
          },
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleSearchProfileError(err, "Failed to delete search profile.");
  }
}

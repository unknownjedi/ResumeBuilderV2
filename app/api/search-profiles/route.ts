import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import {
  createSearchProfile,
  CreateSearchProfileSchema,
  listSearchProfiles,
} from "@/server/services/search-profiles";
import {
  checkLocalGet,
  checkLocalMutation,
  handleSearchProfileError,
  parseJsonBody,
} from "./_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const items = listSearchProfiles(getDb());
    return NextResponse.json({
      ok: true,
      items,
    });
  } catch (err) {
    return handleSearchProfileError(err, "Failed to list search profiles.");
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = CreateSearchProfileSchema.parse(parsedBody.data);
    const searchProfile = createSearchProfile(input, getDb());
    return NextResponse.json({ ok: true, searchProfile }, { status: 201 });
  } catch (err) {
    return handleSearchProfileError(err, "Failed to create search profile.");
  }
}

import { NextResponse } from "next/server";
import {
  ProfileUpsertSchema,
  getFullCareerProfile,
  upsertProfile,
} from "@/server/services/profile";
import {
  checkLocalGet,
  checkLocalMutation,
  handleProfileError,
  parseIncludeRejected,
  parseJsonBody,
} from "./_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  const includeRejected = parseIncludeRejected(req);
  const data = getFullCareerProfile(undefined, { includeRejected });
  return NextResponse.json({
    ok: true,
    ...data,
  });
}

async function handleUpsert(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = ProfileUpsertSchema.parse(parsedBody.data);
    const profile = upsertProfile(input);
    return NextResponse.json({
      ok: true,
      profile,
    });
  } catch (err) {
    return handleProfileError(err, "Failed to update career profile.");
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleUpsert(req);
}

export async function PATCH(req: Request): Promise<NextResponse> {
  return handleUpsert(req);
}

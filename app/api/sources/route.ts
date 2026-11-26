import { NextResponse } from "next/server";
import {
  CreateSourceSchema,
  createSource,
  listSources,
} from "@/server/services/sources";
import {
  checkLocalGet,
  checkLocalMutation,
  handleSourceError,
  parseJsonBody,
} from "./_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";

  const items = listSources(undefined, { includeArchived });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = CreateSourceSchema.parse(parsedBody.data);
    const source = createSource(input);
    return NextResponse.json({ ok: true, source }, { status: 201 });
  } catch (err) {
    return handleSourceError(err, "Failed to create job source.");
  }
}

import { NextResponse } from "next/server";
import {
  EvidenceLinkCreateSchema,
  EvidenceTargetTypeSchema,
  createEvidenceLink,
  listEvidenceLinks,
} from "@/server/services/profile";
import {
  checkLocalGet,
  checkLocalMutation,
  handleProfileError,
  parseIncludeRejected,
  parseJsonBody,
} from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const url = new URL(req.url);
    const rawTargetType = url.searchParams.get("targetType");
    const targetType = rawTargetType
      ? EvidenceTargetTypeSchema.parse(rawTargetType)
      : undefined;
    const targetId = url.searchParams.get("targetId") ?? undefined;
    const sourceDocumentId = url.searchParams.get("sourceDocumentId") ?? undefined;

    const items = listEvidenceLinks(undefined, {
      targetType,
      targetId,
      sourceDocumentId,
      includeRejected: parseIncludeRejected(req),
    });
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return handleProfileError(err, "Failed to list evidence links.");
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = EvidenceLinkCreateSchema.parse(parsedBody.data);
    const evidenceLink = createEvidenceLink(input);
    return NextResponse.json({ ok: true, evidenceLink }, { status: 201 });
  } catch (err) {
    return handleProfileError(err, "Failed to create evidence link.");
  }
}

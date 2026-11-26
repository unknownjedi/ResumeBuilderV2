import { NextResponse } from "next/server";
import { z } from "zod";
import {
  checkLocalGet,
  checkLocalMutation,
  parseJsonBody,
} from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import { RESUME_DRAFT_STATES, type ResumeDraftState } from "@/server/db/schema/applications";
import { mapMaterialsServiceError } from "@/server/services/applications";
import {
  createOrTailorResumeDraft,
  listResumeDrafts,
  MaterialModeSchema,
} from "@/server/services/resumes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateResumeDraftBodySchema = z
  .object({
    jobId: z.string().trim().min(1, "jobId is required in MVP.").max(128),
    searchProfileId: z.string().trim().min(1).max(128).nullable().optional(),
    mode: MaterialModeSchema.optional(),
    regenerate: z.boolean().optional(),
    templateSettings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("jobId")?.trim() || undefined;
    const searchProfileId =
      url.searchParams.get("searchProfileId")?.trim() || undefined;
    const stateParam = url.searchParams.get("state")?.trim() || undefined;
    const state =
      stateParam &&
      (RESUME_DRAFT_STATES as readonly string[]).includes(stateParam)
        ? (stateParam as ResumeDraftState)
        : undefined;
    const includeArchivedParam = url.searchParams.get("includeArchived");
    const includeArchived =
      includeArchivedParam === "false" ? false : true;

    const drafts = listResumeDrafts(getDb(), {
      jobId,
      searchProfileId,
      state,
      includeArchived,
    });

    return NextResponse.json({
      ok: true,
      drafts,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to list resume drafts."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const input = CreateResumeDraftBodySchema.parse(parsedBody.data);
    const draft = await createOrTailorResumeDraft({
      jobId: input.jobId,
      searchProfileId: input.searchProfileId,
      mode: input.mode,
      regenerate: input.regenerate,
      templateSettings: input.templateSettings as Record<string, never> | undefined,
      db: getDb(),
    });

    return NextResponse.json(
      {
        ok: true,
        draft,
      },
      { status: 201 }
    );
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to create tailored resume draft."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

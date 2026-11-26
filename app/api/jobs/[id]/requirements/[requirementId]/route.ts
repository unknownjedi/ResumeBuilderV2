import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, getSqlite } from "@/server/db/client";
import { evidenceLinks } from "@/server/db/schema/career";
import {
  CANDIDATE_RESPONSES,
  REQUIREMENT_PRIORITIES,
} from "@/server/db/schema/jobs";
import {
  MatchingServiceError,
  updateJobRequirementOverride,
} from "@/server/services/matching";
import {
  checkLocalMutation,
  handleJobError,
  parseJsonBody,
} from "../../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchRequirementBodySchema = z
  .object({
    candidateResponse: z.enum(CANDIDATE_RESPONSES).optional(),
    userPriorityOverride: z.enum(REQUIREMENT_PRIORITIES).nullable().optional(),
    overrideState: z.enum(["active", "orphaned"]).optional(),
    evidenceLinkIds: z
      .array(z.string().trim().min(1).max(128))
      .max(50)
      .optional(),
    recomputeMatches: z.boolean().optional().default(true),
  })
  .strict()
  .refine(
    (data) =>
      data.candidateResponse !== undefined ||
      data.userPriorityOverride !== undefined ||
      data.overrideState !== undefined,
    {
      message:
        "Provide candidateResponse, userPriorityOverride, or overrideState.",
    }
  );

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string; requirementId: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id, requirementId } = await context.params;
    const input = PatchRequirementBodySchema.parse(parsedBody.data);

    const db = getDb();
    const sqlite = getSqlite();

    const uniqueEvidenceIds = Array.from(new Set(input.evidenceLinkIds ?? []));
    if (input.candidateResponse === "candidate_confirms_has") {
      if (uniqueEvidenceIds.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "EVIDENCE_REQUIRED",
              message:
                "Confirming possession of a requirement requires at least one career-profile evidence link.",
            },
          },
          { status: 400 }
        );
      }

      const foundLinks = db
        .select({
          id: evidenceLinks.id,
          verificationStatus: evidenceLinks.verificationStatus,
        })
        .from(evidenceLinks)
        .where(inArray(evidenceLinks.id, uniqueEvidenceIds))
        .all();

      const validLinks = foundLinks.filter(
        (l) => l.verificationStatus !== "rejected"
      );
      if (validLinks.length !== uniqueEvidenceIds.length) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "INVALID_EVIDENCE_LINKS",
              message:
                "One or more referenced evidence links do not exist or have been rejected.",
            },
          },
          { status: 400 }
        );
      }
    }

    const result = updateJobRequirementOverride(
      {
        jobId: id,
        requirementId,
        candidateResponse: input.candidateResponse,
        userPriorityOverride: input.userPriorityOverride,
        overrideState: input.overrideState,
        recomputeMatches: input.recomputeMatches,
      },
      db,
      sqlite
    );

    return NextResponse.json({
      ok: true,
      requirement: result.requirement,
      recomputedCount: result.recomputedCount,
      evidenceLinkIds: uniqueEvidenceIds,
    });
  } catch (err) {
    if (err instanceof MatchingServiceError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: err.code,
            message: err.message,
          },
        },
        { status: err.status }
      );
    }
    return handleJobError(err, "Failed to update job requirement override.");
  }
}

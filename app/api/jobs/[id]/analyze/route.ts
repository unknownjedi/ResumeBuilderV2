import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { JOB_ANALYSIS_VERSION } from "@/server/ai/schemas/job-analysis";
import { computeNormalizedDescriptionHash } from "@/server/ai/workflows/analyze-job";
import { getDb, getSqlite } from "@/server/db/client";
import { jobs } from "@/server/db/schema/jobs";
import { enqueueTask } from "@/server/queue/task-queue";
import { getSettings } from "@/server/services/settings";
import { serializeTaskForApi } from "@/server/services/tasks";
import {
  checkLocalMutation,
  handleJobError,
  parseJsonBody,
} from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AnalyzeJobBodySchema = z
  .object({
    mode: z
      .enum(["auto_or_ai", "ai_required", "deterministic"])
      .optional()
      .default("auto_or_ai"),
    searchProfileId: z.string().trim().min(1).max(128).optional(),
    recomputeMatches: z.boolean().optional().default(true),
  })
  .strict();

function resolveCanonicalJob(
  db: ReturnType<typeof getDb>,
  jobId: string
): typeof jobs.$inferSelect | null {
  let current = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!current) return null;

  const visited = new Set<string>([current.id]);
  let hops = 0;
  while (current.mergedIntoJobId && hops < 10) {
    if (visited.has(current.mergedIntoJobId)) break;
    visited.add(current.mergedIntoJobId);
    const parent = db
      .select()
      .from(jobs)
      .where(eq(jobs.id, current.mergedIntoJobId))
      .get();
    if (!parent) break;
    current = parent;
    hops++;
  }
  return current;
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
    const input = AnalyzeJobBodySchema.parse(parsedBody.data);

    const db = getDb();
    const sqlite = getSqlite();

    const job = resolveCanonicalJob(db, id);
    if (!job) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "JOB_NOT_FOUND", message: `Job not found: ${id}` },
        },
        { status: 404 }
      );
    }

    if (input.mode === "ai_required") {
      const settings = getSettings(db);
      if (settings.ai.provider === "none") {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "PROVIDER_NOT_CONFIGURED",
              message:
                "No AI provider is configured. Select a local AI CLI or endpoint in Settings.",
            },
          },
          { status: 400 }
        );
      }
      if (!settings.ai.dataSharingAccepted) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: "DATA_SHARING_NOT_ACCEPTED",
              message:
                "Accept the AI data-sharing disclosure in Settings before running AI job analysis.",
            },
          },
          { status: 400 }
        );
      }
    }

    const descriptionHash = computeNormalizedDescriptionHash(
      job.descriptionText
    );
    const alreadyAnalyzed =
      job.analyzedDescriptionHash === descriptionHash &&
      job.analysisVersion === JOB_ANALYSIS_VERSION &&
      (input.mode === "deterministic"
        ? job.analysisStatus === "deterministic" || job.analysisStatus === "ai"
        : job.analysisStatus === "ai");

    const idempotencyKey = `job.analyze:${job.id}:${descriptionHash}:${JOB_ANALYSIS_VERSION}:${input.mode}`;

    const enqueued = enqueueTask(sqlite, {
      taskType: "job.analyze",
      payload: {
        jobId: job.id,
        mode: input.mode,
        searchProfileId: input.searchProfileId,
        recomputeMatches: input.recomputeMatches,
      },
      idempotencyKey,
      resourceType: "job",
      resourceId: job.id,
    });

    return NextResponse.json(
      {
        ok: true,
        taskId: enqueued.task.id,
        deduplicated: enqueued.deduplicated,
        alreadyAnalyzed,
        descriptionHash,
        task: serializeTaskForApi(enqueued.task),
      },
      { status: 202 }
    );
  } catch (err) {
    return handleJobError(err, "Failed to enqueue job analysis.");
  }
}

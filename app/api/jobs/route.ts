import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, getSqlite } from "@/server/db/client";
import {
  JOB_STATUSES,
  USER_JOB_DISCOVERY_STATES,
  WORKPLACE_TYPES,
} from "@/server/db/schema/jobs";
import { JOB_SORT_OPTIONS, searchJobs } from "@/server/services/jobs";
import { checkLocalGet, handleJobError } from "./_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WorkplaceTypeSchema = z.enum(WORKPLACE_TYPES);
const JobStatusSchema = z.enum(JOB_STATUSES);

const SearchJobsQuerySchema = z.object({
  q: z.string().trim().max(500).optional(),
  searchProfileId: z.string().trim().min(1).max(128).optional(),
  sourceId: z.string().trim().min(1).max(128).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  workplaceType: z.string().optional(),
  employmentType: z.string().optional(),
  status: z.string().optional(),
  salaryPresent: z.enum(["true", "false"]).optional(),
  postedSince: z.string().trim().min(1).max(64).optional(),
  firstSeenSince: z.string().trim().min(1).max(64).optional(),
  discoveryState: z
    .enum([...USER_JOB_DISCOVERY_STATES, "unreviewed", "active", "all"])
    .optional(),
  sort: z.enum(JOB_SORT_OPTIONS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(50_000).optional(),
});

function splitCommaParam(values: string[]): string[] {
  return values
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const url = new URL(req.url);
    const sp = url.searchParams;

    const rawWorkplace = sp.getAll("workplaceType");
    const rawEmployment = sp.getAll("employmentType");
    const rawStatus = sp.getAll("status");

    const parsed = SearchJobsQuerySchema.parse({
      q: sp.get("q") ?? undefined,
      searchProfileId: sp.get("searchProfileId") ?? undefined,
      sourceId: sp.get("sourceId") ?? undefined,
      company: sp.get("company") ?? undefined,
      workplaceType: rawWorkplace.length > 0 ? rawWorkplace.join(",") : undefined,
      employmentType:
        rawEmployment.length > 0 ? rawEmployment.join(",") : undefined,
      status: rawStatus.length > 0 ? rawStatus.join(",") : undefined,
      salaryPresent: sp.get("salaryPresent") ?? undefined,
      postedSince: sp.get("postedSince") ?? undefined,
      firstSeenSince: sp.get("firstSeenSince") ?? undefined,
      discoveryState: sp.get("discoveryState") ?? undefined,
      sort: sp.get("sort") ?? undefined,
      limit: sp.get("limit") ?? undefined,
      offset: sp.get("offset") ?? undefined,
    });

    const workplaceTypes = splitCommaParam(rawWorkplace).map((w) =>
      WorkplaceTypeSchema.parse(w)
    );
    const statuses = splitCommaParam(rawStatus).map((s) =>
      JobStatusSchema.parse(s)
    );
    const employmentTypes = splitCommaParam(rawEmployment);

    if (parsed.postedSince && Number.isNaN(Date.parse(parsed.postedSince))) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "postedSince must be a valid ISO-8601 timestamp.",
          },
        },
        { status: 400 }
      );
    }

    if (
      parsed.firstSeenSince &&
      Number.isNaN(Date.parse(parsed.firstSeenSince))
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "firstSeenSince must be a valid ISO-8601 timestamp.",
          },
        },
        { status: 400 }
      );
    }

    const result = searchJobs(
      {
        q: parsed.q,
        searchProfileId: parsed.searchProfileId,
        sourceId: parsed.sourceId,
        company: parsed.company,
        workplaceType: workplaceTypes.length > 0 ? workplaceTypes : undefined,
        employmentType:
          employmentTypes.length > 0 ? employmentTypes : undefined,
        status: statuses.length > 0 ? statuses : undefined,
        salaryPresent:
          parsed.salaryPresent === undefined
            ? undefined
            : parsed.salaryPresent === "true",
        postedSince: parsed.postedSince,
        firstSeenSince: parsed.firstSeenSince,
        discoveryState: parsed.discoveryState,
        sort: parsed.sort,
        limit: parsed.limit,
        offset: parsed.offset,
      },
      getDb(),
      getSqlite()
    );

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return handleJobError(err, "Failed to search jobs.");
  }
}

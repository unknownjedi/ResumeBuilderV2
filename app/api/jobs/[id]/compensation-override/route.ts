import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, getSqlite } from "@/server/db/client";
import { SALARY_PERIODS } from "@/server/db/schema/jobs";
import {
  deleteCompensationOverride,
  MatchingServiceError,
  upsertCompensationOverride,
} from "@/server/services/matching";
import {
  checkLocalMutation,
  handleJobError,
  parseJsonBody,
} from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutCompensationOverrideBodySchema = z
  .object({
    minAmount: z.number().finite().nonnegative().nullable().optional(),
    maxAmount: z.number().finite().nonnegative().nullable().optional(),
    currency: z
      .union([z.string().trim().max(10), z.null()])
      .optional()
      .transform((v) => {
        if (v === undefined) return undefined;
        if (v === null || v === "") return null;
        return v.toUpperCase();
      })
      .refine(
        (v) => v === undefined || v === null || /^[A-Z]{3}$/.test(v),
        { message: "currency must be a 3-letter ISO 4217 code." }
      ),
    period: z.enum(SALARY_PERIODS).nullable().optional(),
    note: z
      .union([z.string().trim().max(1000), z.null()])
      .optional()
      .transform((v) => (v === "" ? null : v ?? null)),
    recomputeMatches: z.boolean().optional().default(true),
  })
  .strict()
  .refine((data) => data.minAmount != null || data.maxAmount != null, {
    message: "Provide at least minAmount or maxAmount.",
  })
  .refine(
    (data) =>
      data.minAmount == null ||
      data.maxAmount == null ||
      data.minAmount <= data.maxAmount,
    { message: "minAmount cannot exceed maxAmount." }
  );

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const blocked = checkLocalMutation(req);
  if (blocked) return blocked;

  const parsedBody = await parseJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  try {
    const { id } = await context.params;
    const input = PutCompensationOverrideBodySchema.parse(parsedBody.data);

    const result = upsertCompensationOverride(
      {
        jobId: id,
        minAmount: input.minAmount,
        maxAmount: input.maxAmount,
        currency: input.currency,
        period: input.period,
        note: input.note,
        recomputeMatches: input.recomputeMatches,
      },
      getDb(),
      getSqlite()
    );

    return NextResponse.json({
      ok: true,
      override: result.override,
      recomputedCount: result.recomputedCount,
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
    return handleJobError(err, "Failed to save compensation override.");
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
    const result = deleteCompensationOverride(id, getDb(), getSqlite());

    return NextResponse.json({
      ok: true,
      ...result,
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
    return handleJobError(err, "Failed to delete compensation override.");
  }
}

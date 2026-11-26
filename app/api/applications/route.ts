import { NextResponse } from "next/server";
import {
  checkLocalGet,
  checkLocalMutation,
  parseJsonBody,
} from "@/app/api/jobs/_helpers";
import { getDb } from "@/server/db/client";
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
} from "@/server/db/schema/applications";
import {
  createOrPrepareApplication,
  CreateOrPrepareApplicationSchema,
  listApplications,
  mapMaterialsServiceError,
} from "@/server/services/applications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = checkLocalGet(req);
  if (blocked) return blocked;

  try {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status")?.trim() || undefined;
    const searchProfileId =
      url.searchParams.get("searchProfileId")?.trim() || undefined;

    if (
      statusParam &&
      !(APPLICATION_STATUSES as readonly string[]).includes(statusParam)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_APPLICATION_STATUS",
            message: `Invalid application status filter: ${statusParam}`,
          },
        },
        { status: 400 }
      );
    }

    const applicationsList = listApplications(getDb(), {
      status: statusParam as ApplicationStatus | undefined,
      searchProfileId,
    });

    return NextResponse.json({
      ok: true,
      applications: applicationsList,
    });
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to list applications."
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
    const input = CreateOrPrepareApplicationSchema.parse(parsedBody.data);
    const application = createOrPrepareApplication(input, getDb());

    return NextResponse.json(
      {
        ok: true,
        application,
      },
      { status: 201 }
    );
  } catch (err) {
    const mapped = mapMaterialsServiceError(
      err,
      "Failed to create application."
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

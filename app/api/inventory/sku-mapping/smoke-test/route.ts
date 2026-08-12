import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { canMutateSharedAttribution } from "@/lib/marketplace-attribution/access";
import { isSharedSkuMappingEnabled } from "@/lib/marketplace-attribution/feature-flags";
import { runSmokeTests } from "@/lib/marketplace-attribution/smoke-test";

export async function GET(request: NextRequest) {
  if (!isSharedSkuMappingEnabled())
    return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canMutateSharedAttribution(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const results = await runSmokeTests(session);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not run smoke tests.",
      },
      { status: 500 },
    );
  }
}

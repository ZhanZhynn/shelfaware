import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { canMutateSharedAttribution } from "@/lib/marketplace-attribution/access";
import { isSharedSkuMappingEnabled, isSharedSkuMappingMutationsEnabled } from "@/lib/marketplace-attribution/feature-flags";
import { proposeMigrationCandidates } from "@/lib/marketplace-attribution/migration-assistant";

export async function GET(request: NextRequest) {
  if (!isSharedSkuMappingEnabled())
    return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  if (!isSharedSkuMappingMutationsEnabled())
    return NextResponse.json({ error: "Shared SKU mapping mutations are not enabled." }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canMutateSharedAttribution(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await proposeMigrationCandidates();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not generate migration candidates.",
      },
      { status: 500 },
    );
  }
}

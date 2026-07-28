import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import {
  calculateSourcingLandedCost,
  normalizeSourcingCostConfig,
} from "@/lib/sourcing/landed-cost";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";

const optionalPositive = z.coerce.number().positive().optional().nullable();
const optionalPositiveInteger = z.coerce
  .number()
  .int()
  .positive()
  .optional()
  .nullable();
const schema = z.object({
  workspaceId: z.string().min(1),
  unitCostCny: z.coerce.number().nonnegative().optional().nullable(),
  piecesPerSellingUnit: optionalPositiveInteger,
  cartonLengthCm: optionalPositive,
  cartonWidthCm: optionalPositive,
  cartonHeightCm: optionalPositive,
  piecesPerCarton: optionalPositiveInteger,
  marketPriceMyr: optionalPositive,
  marketPack: optionalPositiveInteger,
  overrideCostMyr: optionalPositive,
  shippingOverrideMyrPerPiece: z.coerce
    .number()
    .nonnegative()
    .optional()
    .nullable(),
});

export async function POST(request: NextRequest) {
  const user = await getSessionFromRequest(request);
  try {
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return NextResponse.json(
        {
          error: "Invalid landed-cost inputs",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    await requireWorkspaceRole(user, parsed.data.workspaceId, [
      "admin",
      "sourcer",
    ]);
    const workspace = await prisma.workspace.findUnique({
      where: { id: parsed.data.workspaceId },
      select: { sourcingCostConfig: true },
    });
    if (!workspace)
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    return NextResponse.json(
      calculateSourcingLandedCost(
        parsed.data,
        normalizeSourcingCostConfig(workspace.sourcingCostConfig),
      ),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Landed-cost request failed",
      },
      { status: error instanceof SourcingAccessError ? error.status : 500 },
    );
  }
}

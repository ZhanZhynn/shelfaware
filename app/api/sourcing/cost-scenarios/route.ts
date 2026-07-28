import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { getSessionFromRequest } from "@/utils/auth";
import { prisma } from "@/prisma/client";
import { requireWorkspaceRole, SourcingAccessError } from "@/lib/sourcing/auth";
import {
  calculateSourcingLandedCost,
  normalizeSourcingCostConfig,
} from "@/lib/sourcing/landed-cost";
import { invalidateAllServerCaches } from "@/lib/cache";

const optionalPositive = z.coerce.number().positive().optional().nullable();
const optionalPositiveInteger = z.coerce
  .number()
  .int()
  .positive()
  .optional()
  .nullable();
const inputsSchema = z.object({
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
const createSchema = z.object({
  workspaceId: z.string().min(1),
  caseId: z.string().min(1),
  quoteId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  inputs: inputsSchema,
});

function failure(error: unknown) {
  const status =
    error instanceof SourcingAccessError
      ? error.status
      : error instanceof ZodError
        ? 400
        : 500;
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Cost scenario request failed",
    },
    { status },
  );
}

async function getCaseForAdmin(
  user: { id: string; role: string | null },
  caseId: string,
) {
  const sourcingCase = await prisma.sourcingCase.findUnique({
    where: { id: caseId },
    select: { id: true, workspaceId: true },
  });
  if (!sourcingCase)
    throw new SourcingAccessError("Sourcing case not found", 404);
  await requireWorkspaceRole(user, sourcingCase.workspaceId, ["admin"]);
  return sourcingCase;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const caseId = request.nextUrl.searchParams.get("caseId");
    if (!caseId)
      return NextResponse.json(
        { error: "caseId is required" },
        { status: 400 },
      );
    await getCaseForAdmin(user, caseId);
    const scenarios = await prisma.sourcingCostScenario.findMany({
      where: { caseId },
      include: { createdBy: { select: { name: true, email: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(scenarios);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const input = createSchema.parse(await request.json());
    const sourcingCase = await getCaseForAdmin(user, input.caseId);
    if (sourcingCase.workspaceId !== input.workspaceId)
      return NextResponse.json(
        { error: "Scenario workspace does not match the sourcing case" },
        { status: 400 },
      );
    const quote = await prisma.sourcingQuote.findFirst({
      where: { id: input.quoteId, caseId: input.caseId },
      select: { id: true },
    });
    if (!quote)
      return NextResponse.json(
        { error: "Quote does not belong to this sourcing case" },
        { status: 400 },
      );
    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { sourcingCostConfig: true },
    });
    if (!workspace)
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    const costConfig = normalizeSourcingCostConfig(
      workspace.sourcingCostConfig,
    );
    const result = calculateSourcingLandedCost(input.inputs, costConfig);
    if (!result)
      return NextResponse.json(
        {
          error:
            "A supplier cost or RM override is required to save a scenario",
        },
        { status: 400 },
      );
    const scenario = await prisma.sourcingCostScenario.create({
      data: {
        workspaceId: input.workspaceId,
        caseId: input.caseId,
        quoteId: input.quoteId,
        name: input.name,
        inputs: input.inputs as Prisma.InputJsonValue,
        costConfigSnapshot: costConfig as Prisma.InputJsonValue,
        resultSnapshot: result as Prisma.InputJsonValue,
        createdById: user.id,
      },
      include: { createdBy: { select: { name: true, email: true } } },
    });
    void invalidateAllServerCaches();
    return NextResponse.json(scenario, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export { inputsSchema };

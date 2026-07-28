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
import { inputsSchema } from "../route";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  inputs: inputsSchema.optional(),
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

async function scenarioForAdmin(
  user: { id: string; role: string | null },
  id: string,
) {
  const scenario = await prisma.sourcingCostScenario.findUnique({
    where: { id },
  });
  if (!scenario) throw new SourcingAccessError("Cost scenario not found", 404);
  await requireWorkspaceRole(user, scenario.workspaceId, ["admin"]);
  return scenario;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scenario = await scenarioForAdmin(user, (await params).id);
    const input = updateSchema.parse(await request.json());
    const update: Prisma.SourcingCostScenarioUpdateInput = {
      updatedAt: new Date(),
    };
    if (input.name) update.name = input.name;
    if (input.inputs) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: scenario.workspaceId },
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
      update.inputs = input.inputs as Prisma.InputJsonValue;
      update.costConfigSnapshot = costConfig as Prisma.InputJsonValue;
      update.resultSnapshot = result as Prisma.InputJsonValue;
    }
    const updated = await prisma.sourcingCostScenario.update({
      where: { id: scenario.id },
      data: update,
      include: { createdBy: { select: { name: true, email: true } } },
    });
    void invalidateAllServerCaches();
    return NextResponse.json(updated);
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const scenario = await scenarioForAdmin(user, (await params).id);
    await prisma.sourcingCostScenario.delete({ where: { id: scenario.id } });
    void invalidateAllServerCaches();
    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    return failure(error);
  }
}

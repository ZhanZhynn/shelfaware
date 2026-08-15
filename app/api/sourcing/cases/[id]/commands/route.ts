import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { runSourcingCommand } from "@/lib/sourcing/commands";
import { runVariantSourcingCommand } from "@/lib/sourcing/variant-workflow";
import { prisma } from "@/prisma/client";
import { SourcingAccessError } from "@/lib/sourcing/auth";
import { invalidateAllServerCaches } from "@/lib/cache";
import { sourcingCommandSchema } from "@/lib/validations/sourcing";
import { ZodError } from "zod";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await withRateLimit(
      request,
      defaultRateLimits.strict,
      user.id,
    );
    if (limited) return limited;
    const id = (await params).id;
    const command = sourcingCommandSchema.parse(await request.json());
    const variantCase = await prisma.sourcingCaseVariant.count({ where: { caseId: id } });
    const result = variantCase
      ? await runVariantSourcingCommand(user, id, command)
      : await runSourcingCommand(user, id, command as Parameters<typeof runSourcingCommand>[2]);
    void invalidateAllServerCaches();
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[Sourcing] Command failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Sourcing command failed",
      },
      {
        status:
          error instanceof SourcingAccessError
            ? error.status
            : error instanceof ZodError
              ? 400
              : 500,
      },
    );
  }
}

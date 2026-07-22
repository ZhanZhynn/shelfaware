import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/utils/auth";
import { runSourcingCommand } from "@/lib/sourcing/commands";
import { SourcingAccessError } from "@/lib/sourcing/auth";
import { invalidateAllServerCaches } from "@/lib/cache";
import { sourcingCommandSchema } from "@/lib/validations/sourcing";
import { ZodError } from "zod";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionFromRequest(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const limited = await withRateLimit(request, defaultRateLimits.strict, user.id);
    if (limited) return limited;
    const result = await runSourcingCommand(user, (await params).id, sourcingCommandSchema.parse(await request.json()));
    void invalidateAllServerCaches();
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sourcing command failed" }, { status: error instanceof SourcingAccessError ? error.status : error instanceof ZodError ? 400 : 500 }); }
}

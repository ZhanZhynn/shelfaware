import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/utils/auth";
import prisma from "@/prisma/client";
import { withRateLimit, defaultRateLimits } from "@/lib/api/rate-limit";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { reconcileLazadaPayoutStatements } from "@/lib/server/lazada-reconciliation";
import { logger } from "@/lib/logger";

const bodySchema = z.object({ sellerId: z.string().min(1) });

/** Explicit, authenticated server operation. It is intentionally not UI-wired. */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await withRateLimit(request, defaultRateLimits.strict);
    if (rateLimitResponse) return rateLimitResponse;
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });

    const ownerIds = await marketplaceOwnerIds(session);
    const shop = await prisma.lazadaShop.findFirst({ where: { sellerId: parsed.data.sellerId, userId: { in: ownerIds } }, select: { id: true, userId: true } });
    if (!shop) return NextResponse.json({ error: "Seller not found or you don't have access" }, { status: 403 });

    return NextResponse.json(await reconcileLazadaPayoutStatements({ userId: shop.userId, shopId: shop.id }));
  } catch (error) {
    logger.error("[Lazada Reconciliation] Error:", error);
    return NextResponse.json({ error: "Lazada reconciliation failed", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

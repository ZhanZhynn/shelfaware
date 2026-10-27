import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { createMarketplaceSyncRun, deliverMarketplaceSyncTaskOutbox } from "@/lib/marketplace/sync-runs";
import type { SlaPlatform } from "@/lib/marketplace/sla/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Schedule this endpoint every 15 minutes; durable workers perform provider reads. */
export async function GET(request: NextRequest) {
  const headers = { "cache-control": "no-store" };
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Server misconfigured" }, { status: 500, headers });
  const supplied = request.headers.get("authorization") ?? "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(supplied), hash(`Bearer ${secret}`))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  // Activate after deploying the generated Prisma client and additive SLA indexes.
  if (process.env.MARKETPLACE_SLA_CRON_ENABLED !== "true") return NextResponse.json({ skipped: true, reason: "sla_schedule_disabled" }, { headers });
  try {
    const [shopee, lazada, tiktok] = await Promise.all([
      prisma.shopeeShop.findMany({ orderBy: { id: "asc" }, take: 101, select: { id: true, userId: true } }),
      prisma.lazadaShop.findMany({ orderBy: { id: "asc" }, take: 101, select: { id: true, userId: true } }),
      prisma.tikTokShop.findMany({ orderBy: { id: "asc" }, take: 101, select: { id: true, userId: true } }),
    ]);
    const groups = [["shopee", shopee], ["lazada", lazada], ["tiktok", tiktok]] as const;
    const ownerIds = [...new Set(groups.flatMap(([, shops]) => shops.map((shop) => shop.userId)))];
    const active = new Set((await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, status: true } })).filter((user) => user.status !== "pending" && user.status !== "rejected").map((user) => user.id));
    const results: Array<{ platform: SlaPlatform; shopId: string; accepted: boolean; scheduled: boolean; runId?: string }> = [];
    const budgetEnd = Date.now() + 45000;
    let exhausted = false;
    for (const [platform, shops] of groups) {
      for (const shop of shops.slice(0, 100)) {
        if (!active.has(shop.userId)) continue;
        if (Date.now() > budgetEnd) { exhausted = true; break; }
        try {
          const existing = await prisma.marketplaceSyncRun.findFirst({ where: { platform, shopId: shop.id, requestedByUserId: shop.userId, syncType: "sla", executionMode: "queued", status: { in: ["pending", "running"] } }, include: { tasks: { orderBy: { sequence: "asc" } } } });
          const result = existing ? { run: existing, firstTaskId: existing.tasks[0]?.id } : await createMarketplaceSyncRun({ platform, shopId: shop.id, requestedByUserId: shop.userId, syncType: "sla", idempotencyKey: `sla-cron-${Math.floor(Date.now() / 900000)}-${shop.id}` });
          const delivery = result.firstTaskId ? await deliverMarketplaceSyncTaskOutbox(result.firstTaskId) : { scheduled: false };
          results.push({ platform, shopId: shop.id, accepted: true, scheduled: delivery.scheduled, runId: result.run.id });
        } catch {
          results.push({ platform, shopId: shop.id, accepted: false, scheduled: false });
        }
      }
    }
    return NextResponse.json({ accepted: results.filter((result) => result.accepted).length, scheduled: results.filter((result) => result.scheduled).length, executionComplete: false, partial: exhausted || groups.some(([, shops]) => shops.length > 100) || results.some((result) => !result.accepted), results }, { headers });
  } catch {
    return NextResponse.json({ error: "SLA scheduling failed" }, { status: 500, headers });
  }
}

/**
 * Shopee SLA Alert — Cron Job Endpoint
 * POST /api/shopee/alerts/sla
 * Called by Vercel cron scheduler every 4 hours.
 * Checks for orders near their ship-by deadline and sends Telegram alerts.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/prisma/client";
import { sendTelegramMessage, escapeMarkdownV2 } from "@/lib/notifications/telegram";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    // Reject immediately if CRON_SECRET is not configured
    if (!process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    // Timing-safe secret comparison
    const authHeader = request.headers.get("authorization");
    const expected = `Bearer ${process.env.CRON_SECRET}`;

    if (!authHeader || authHeader.length !== expected.length) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isValid = crypto.timingSafeEqual(
      Buffer.from(authHeader),
      Buffer.from(expected),
    );

    if (!isValid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check for near-SLA orders across all shops
    const now = new Date();
    const threshold24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const nearSlaOrders = await prisma.shopeeOrder.findMany({
      where: {
        orderStatus: { in: ["confirmed", "processing"] },
        shipByDate: { not: null, lte: threshold24h },
      },
      orderBy: { shipByDate: "asc" },
      select: {
        shopeeOrderId: true,
        orderStatus: true,
        shipByDate: true,
        totalAmount: true,
        buyerUsername: true,
        shopId: true,
      },
    });

    if (nearSlaOrders.length === 0) {
      logger.info("[SLA Alert] No near-SLA orders found");
      return NextResponse.json({ sent: false, reason: "no_orders" });
    }

    // Build Telegram message
    const critical: typeof nearSlaOrders = [];
    const high: typeof nearSlaOrders = [];
    const medium: typeof nearSlaOrders = [];

    for (const order of nearSlaOrders) {
      const msRemaining = (order.shipByDate?.getTime() ?? 0) - now.getTime();
      const hoursRemaining = msRemaining / (1000 * 60 * 60);
      if (hoursRemaining < 6) critical.push(order);
      else if (hoursRemaining < 12) high.push(order);
      else medium.push(order);
    }

    const lines: string[] = [
      `*${escapeMarkdownV2("⚠️ Shopee SLA Alert")}*`,
      "",
      `${escapeMarkdownV2(`${nearSlaOrders.length} order(s) approaching ship-by deadline`)}`,
      "",
    ];

    if (critical.length > 0) {
      lines.push(`🔴 *${escapeMarkdownV2(`Critical (< 6h): ${critical.length}`)}*`);
      for (const o of critical.slice(0, 5)) {
        const hrs = (
          ((o.shipByDate?.getTime() ?? 0) - now.getTime()) /
          (1000 * 60 * 60)
        ).toFixed(1);
        lines.push(
          `  ${escapeMarkdownV2(`• ${o.shopeeOrderId} — ${hrs}h — RM${o.totalAmount}`)}`,
        );
      }
      if (critical.length > 5)
        lines.push(
          `  ${escapeMarkdownV2(`... and ${critical.length - 5} more`)}`,
        );
      lines.push("");
    }

    if (high.length > 0) {
      lines.push(`🟠 *${escapeMarkdownV2(`High (< 12h): ${high.length}`)}*`);
      for (const o of high.slice(0, 3)) {
        const hrs = (
          ((o.shipByDate?.getTime() ?? 0) - now.getTime()) /
          (1000 * 60 * 60)
        ).toFixed(1);
        lines.push(
          `  ${escapeMarkdownV2(`• ${o.shopeeOrderId} — ${hrs}h — RM${o.totalAmount}`)}`,
        );
      }
      lines.push("");
    }

    if (medium.length > 0) {
      lines.push(
        `🟡 *${escapeMarkdownV2(`Medium (< 24h): ${medium.length}`)}*`,
      );
    }

    lines.push(
      "",
      escapeMarkdownV2("Sync orders to see latest SLA status"),
    );

    const message = lines.join("\n");
    const sent = await sendTelegramMessage(message, {
      parseMode: "MarkdownV2",
    });

    logger.info(
      `[SLA Alert] Processed ${nearSlaOrders.length} near-SLA orders (critical: ${critical.length}, high: ${high.length}, medium: ${medium.length}), telegram: ${sent}`,
    );

    return NextResponse.json({
      sent,
      total: nearSlaOrders.length,
      critical: critical.length,
      high: high.length,
      medium: medium.length,
    });
  } catch (error) {
    logger.error("[SLA Alert] Error:", error);
    return NextResponse.json(
      { error: "Failed to process SLA alerts" },
      { status: 500 },
    );
  }
}

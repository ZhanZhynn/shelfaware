/**
 * Shopee Daily/Weekly Digest — Cron Job Endpoint
 * POST /api/shopee/digest?period=daily|weekly
 * Called by Vercel cron scheduler.
 * Aggregates stats and sends an HTML summary via Telegram.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/prisma/client";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

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

    const { searchParams } = new URL(request.url);
    const period = (searchParams.get("period") || "daily") as "daily" | "weekly";

    const now = new Date();
    const periodDays = period === "weekly" ? 7 : 1;
    const since = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

    // Fetch all shops
    const shops = await prisma.shopeeShop.findMany({
      select: { id: true, shopName: true, lowStockThreshold: true },
    });

    if (shops.length === 0) {
      return NextResponse.json({ sent: false, reason: "no_shops" });
    }

    const shopIds = shops.map((s) => s.id);

    // Run all queries in parallel
    const [
      totalProducts,
      ordersByStatus,
      revenueAgg,
      topProductsRaw,
      lowStockProducts,
      outOfStockProducts,
      recentSyncLogs,
      nearSlaOrders,
    ] = await Promise.all([
      // Total products
      prisma.shopeeProduct.count({
        where: { shopId: { in: shopIds } },
      }),

      // Orders by status in period
      prisma.shopeeOrder.groupBy({
        by: ["orderStatus"],
        where: {
          shopId: { in: shopIds },
          shopeeCreatedAt: { gte: since },
        },
        _count: true,
        _sum: { totalAmount: true },
      }),

      // Total revenue in period
      prisma.shopeeOrder.aggregate({
        where: {
          shopId: { in: shopIds },
          shopeeCreatedAt: { gte: since },
          orderStatus: { not: "CANCELLED" },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),

      // Top 5 products by revenue in period
      prisma.shopeeOrderItem.groupBy({
        by: ["productName"],
        where: {
          order: {
            shopId: { in: shopIds },
            shopeeCreatedAt: { gte: since },
            orderStatus: { not: "CANCELLED" },
          },
        },
        _sum: { subtotal: true, quantity: true },
        orderBy: { _sum: { subtotal: "desc" } },
        take: 5,
      }),

      // Low stock products
      prisma.shopeeProduct.findMany({
        where: {
          shopId: { in: shopIds },
          stock: { gt: 0 },
          status: "NORMAL",
        },
        select: { id: true, itemName: true, stock: true, shopId: true },
      }).then((products) =>
        products.filter((p) => {
          const shop = shops.find((s) => s.id === p.shopId);
          return shop && p.stock < (shop.lowStockThreshold ?? 10);
        }),
      ),

      // Out of stock products
      prisma.shopeeProduct.count({
        where: {
          shopId: { in: shopIds },
          stock: 0,
          status: "NORMAL",
        },
      }),

      // Recent sync logs
      prisma.shopeeSyncLog.findMany({
        where: {
          shopId: { in: shopIds },
          startedAt: { gte: since },
        },
        orderBy: { startedAt: "desc" },
        take: 5,
        select: { status: true, syncType: true, startedAt: true },
      }),

      // Near-SLA orders (within 24h)
      prisma.shopeeOrder.count({
        where: {
          shopId: { in: shopIds },
          orderStatus: { in: ["confirmed", "processing"] },
          shipByDate: {
            not: null,
            lte: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const totalRevenue = Number(revenueAgg._sum.totalAmount || 0);
    const totalOrders = revenueAgg._count;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Build HTML message
    const periodLabel = period === "weekly" ? "Weekly" : "Daily";
    const lines: string[] = [
      `<b>📊 ${periodLabel} Shopee Digest</b>`,
      `<i>${since.toLocaleDateString("en-MY")} — ${now.toLocaleDateString("en-MY")}</i>`,
      "",
    ];

    // Summary section
    lines.push(`<b>💰 Revenue & Orders</b>`);
    lines.push(`• Orders: <b>${totalOrders}</b>`);
    lines.push(`• Revenue: <b>RM ${totalRevenue.toFixed(2)}</b>`);
    lines.push(`• Avg Order: <b>RM ${avgOrderValue.toFixed(2)}</b>`);
    lines.push("");

    // Order status breakdown
    const statusLines = ordersByStatus
      .filter((s) => s._count > 0)
      .sort((a, b) => b._count - a._count)
      .map((s) => `${s.orderStatus}: ${s._count}`)
      .join(", ");
    if (statusLines) {
      lines.push(`<b>📋 Status Breakdown</b>`);
      lines.push(`• ${statusLines}`);
      lines.push("");
    }

    // Top products
    if (topProductsRaw.length > 0) {
      lines.push(`<b>🏆 Top Products</b>`);
      for (const p of topProductsRaw) {
        const rev = Number(p._sum?.subtotal || 0);
        const qty = Number(p._sum?.quantity || 0);
        const name = p.productName.length > 40 ? p.productName.slice(0, 40) + "…" : p.productName;
        lines.push(`• ${name}`);
        lines.push(`  RM ${rev.toFixed(2)} / ${qty} sold`);
      }
      lines.push("");
    }

    // Alerts section
    const alerts: string[] = [];
    if (nearSlaOrders > 0) alerts.push(`⚠️ <b>${nearSlaOrders}</b> order(s) near SLA deadline`);
    if (outOfStockProducts > 0) alerts.push(`🔴 <b>${outOfStockProducts}</b> product(s) out of stock`);
    if (lowStockProducts.length > 0) alerts.push(`🟠 <b>${lowStockProducts.length}</b> product(s) low stock`);

    if (alerts.length > 0) {
      lines.push(`<b>🚨 Alerts</b>`);
      lines.push(...alerts);
      lines.push("");
    }

    // Sync health
    if (recentSyncLogs.length > 0) {
      const failed = recentSyncLogs.filter((l) => l.status === "failed").length;
      const succeeded = recentSyncLogs.filter((l) => l.status === "completed" || l.status === "completed_with_errors").length;
      lines.push(`<b>🔄 Sync Health</b>`);
      lines.push(`• ${succeeded} successful, ${failed} failed`);
      lines.push("");
    }

    lines.push(`<i>Products: ${totalProducts} total</i>`);

    // Telegram HTML limit is 4096 chars
    const message = lines.join("\n").slice(0, 4096);

    const sent = await sendTelegramMessage(message, { parseMode: "HTML" });

    logger.info(
      `[Digest] ${periodLabel} digest sent: ${totalOrders} orders, RM${totalRevenue.toFixed(2)} revenue, telegram: ${sent}`,
    );

    return NextResponse.json({
      sent,
      period,
      totalOrders,
      totalRevenue,
      alerts: {
        nearSla: nearSlaOrders,
        outOfStock: outOfStockProducts,
        lowStock: lowStockProducts.length,
      },
    });
  } catch (error) {
    logger.error("[Digest] Error:", error);
    return NextResponse.json(
      { error: "Failed to process digest" },
      { status: 500 },
    );
  }
}

/**
 * Shopee Low Stock Alert — Cron Job Endpoint
 * POST /api/shopee/alerts/low-stock
 * Called by Vercel cron scheduler every 6 hours.
 * Checks for products at or below their shop's low-stock threshold and sends Telegram alerts.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/prisma/client";
import { sendTelegramMessage, escapeMarkdownV2 } from "@/lib/notifications/telegram";
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

    // Fetch all shops with their low stock thresholds
    const shops = await prisma.shopeeShop.findMany({
      select: { id: true, shopName: true, lowStockThreshold: true },
    });

    if (shops.length === 0) {
      logger.info("[Low Stock Alert] No shops found");
      return NextResponse.json({ sent: false, reason: "no_shops" });
    }

    const shopMap = new Map(shops.map((s) => [s.id, s]));

    // Fetch all products for these shops
    const products = await prisma.shopeeProduct.findMany({
      where: {
        shopId: { in: shops.map((s) => s.id) },
        status: "NORMAL",
      },
      select: {
        id: true,
        shopId: true,
        itemName: true,
        stock: true,
        shopeeItemId: true,
      },
    });

    // Classify products by severity
    const outOfStock: Array<{ name: string; shopName: string; shopId: string }> = [];
    const critical: Array<{ name: string; stock: number; shopName: string; shopId: string }> = [];
    const low: Array<{ name: string; stock: number; threshold: number; shopName: string; shopId: string }> = [];

    for (const product of products) {
      const shop = shopMap.get(product.shopId);
      if (!shop) continue;

      const threshold = shop.lowStockThreshold ?? 10;

      if (product.stock === 0) {
        outOfStock.push({ name: product.itemName, shopName: shop.shopName, shopId: product.shopId });
      } else if (product.stock <= 3) {
        critical.push({ name: product.itemName, stock: product.stock, shopName: shop.shopName, shopId: product.shopId });
      } else if (product.stock < threshold) {
        low.push({ name: product.itemName, stock: product.stock, threshold, shopName: shop.shopName, shopId: product.shopId });
      }
    }

    const totalIssues = outOfStock.length + critical.length + low.length;

    if (totalIssues === 0) {
      logger.info("[Low Stock Alert] All products have sufficient stock");
      return NextResponse.json({ sent: false, reason: "all_stock_ok" });
    }

    // Build HTML message
    const lines: string[] = [
      "<b>📦 Low Stock Alert</b>",
      "",
      `${totalIssues} product(s) need attention`,
      "",
    ];

    if (outOfStock.length > 0) {
      lines.push(`<b>🔴 Out of Stock (${outOfStock.length})</b>`);
      for (const p of outOfStock.slice(0, 5)) {
        lines.push(`• ${p.name} — <i>${p.shopName}</i>`);
      }
      if (outOfStock.length > 5) lines.push(`  ...and ${outOfStock.length - 5} more`);
      lines.push("");
    }

    if (critical.length > 0) {
      lines.push(`<b>🟠 Critical ≤3 (${critical.length})</b>`);
      for (const p of critical.slice(0, 5)) {
        lines.push(`• ${p.name} — <b>${p.stock} left</b> <i>${p.shopName}</i>`);
      }
      if (critical.length > 5) lines.push(`  ...and ${critical.length - 5} more`);
      lines.push("");
    }

    if (low.length > 0) {
      lines.push(`<b>🟡 Low Stock (${low.length})</b>`);
      for (const p of low.slice(0, 5)) {
        lines.push(`• ${p.name} — <b>${p.stock}/${p.threshold}</b> <i>${p.shopName}</i>`);
      }
      if (low.length > 5) lines.push(`  ...and ${low.length - 5} more`);
      lines.push("");
    }

    lines.push(`<i>Check products page to update stock</i>`);

    // Telegram has a 4096 char limit
    const message = lines.join("\n").slice(0, 4096);

    const sent = await sendTelegramMessage(message, { parseMode: "HTML" });

    logger.info(
      `[Low Stock Alert] Processed ${totalIssues} low-stock products (OOS: ${outOfStock.length}, Critical: ${critical.length}, Low: ${low.length}), telegram: ${sent}`,
    );

    return NextResponse.json({
      sent,
      outOfStock: outOfStock.length,
      critical: critical.length,
      low: low.length,
      total: totalIssues,
    });
  } catch (error) {
    logger.error("[Low Stock Alert] Error:", error);
    return NextResponse.json(
      { error: "Failed to process low stock alerts" },
      { status: 500 },
    );
  }
}

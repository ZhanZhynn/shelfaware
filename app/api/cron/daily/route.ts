import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const expected = secret ? `Bearer ${secret}` : "";
  return !!authorization && authorization.length === expected.length && crypto.timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const paths = [
    "/api/shopee/sync/cron",
    "/api/shopee/alerts/sla",
    "/api/shopee/alerts/low-stock",
    "/api/shopee/digest?period=daily",
    "/api/lazada/sync/cron",
    "/api/tiktok/sync/cron",
    "/api/exchange-rates/refresh",
    "/api/sourcing/reminders/cron",
  ];
  if (new Date().getUTCDay() === 1) paths.push("/api/shopee/digest?period=weekly");

  const origin = new URL(request.url).origin;
  const authorization = `Bearer ${process.env.CRON_SECRET}`;
  const results = await Promise.all(paths.map(async (path) => {
    try {
      const response = await fetch(`${origin}${path}`, {
        method: path === "/api/exchange-rates/refresh" ? "GET" : "POST",
        headers: { authorization },
      });
      return { path, status: response.status, success: response.ok };
    } catch (error) {
      logger.error(`[Daily Cron] ${path} failed`, error);
      return { path, status: 0, success: false };
    }
  }));

  return NextResponse.json({
    success: results.every((result) => result.success),
    results,
  });
}

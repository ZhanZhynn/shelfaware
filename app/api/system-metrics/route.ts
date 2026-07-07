/**
 * System Metrics API Route
 * Provides system-level metrics including:
 * - Cache hit/miss rates
 * - Database performance statistics
 * - System resource usage (memory, CPU, uptime)
 * - Node.js process information
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSystemMetrics } from "@/lib/monitoring/system-metrics";
import { successResponse, errorResponse } from "@/lib/api/response-helpers";
import { logger } from "@/lib/logger";

/**
 * GET /api/system-metrics
 * Get comprehensive system metrics (requires CRON_SECRET auth)
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate via CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: "System metrics not configured" },
        { status: 500 },
      );
    }
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7);
    if (
      token.length !== cronSecret.length ||
      !crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(cronSecret),
      )
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const metrics = await getSystemMetrics();
    return successResponse(metrics);
  } catch (error) {
    logger.error("Failed to get system metrics", { error });
    return errorResponse(
      `Failed to get system metrics: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      500
    );
  }
}

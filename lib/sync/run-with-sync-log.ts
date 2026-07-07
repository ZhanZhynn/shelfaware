/**
 * Generic sync log lifecycle helper.
 * Extracted from Shopee sync pattern for cross-marketplace reuse.
 *
 * Wraps: create-running-log → try { op() } → update-log(completed|failed) → rethrow
 */

import prisma from "@/prisma/client";
import { logger } from "@/lib/logger";

interface SyncLogInput {
  shopId: string;       // ObjectId of the marketplace shop
  userId: string;
  channel: "shopee" | "lazada";
  syncType: string;     // "products" | "orders" | "all" | etc.
  triggeredBy?: "manual" | "cron" | "webhook";
}

interface SyncResult {
  synced?: number;
  created?: number;
  updated?: number;
  errors?: string[];
  [key: string]: unknown;
}

/**
 * Run a sync operation with automatic sync log lifecycle management.
 * Creates a SyncLog entry, runs the operation, and updates the log with
 * success/failure status. Errors are always rethrown after logging.
 */
export async function runWithSyncLog<T extends SyncResult>(
  input: SyncLogInput,
  op: () => Promise<T>,
): Promise<T> {
  const { shopId, userId, channel, syncType, triggeredBy = "manual" } = input;

  const logEntry = await prisma.syncLog.create({
    data: {
      shopId,
      userId,
      channel,
      syncType,
      status: "running",
      triggeredBy,
    },
  });

  try {
    const result = await op();

    const hasErrors = result.errors && result.errors.length > 0;
    await prisma.syncLog.update({
      where: { id: logEntry.id },
      data: {
        status: hasErrors ? "completed_with_errors" : "completed",
        itemsSynced: result.synced ?? 0,
        itemsCreated: result.created ?? 0,
        itemsUpdated: result.updated ?? 0,
        errors: hasErrors ? result.errors : undefined,
        completedAt: new Date(),
      },
    });

    return result;
  } catch (error) {
    await prisma.syncLog.update({
      where: { id: logEntry.id },
      data: {
        status: "failed",
        errors: [error instanceof Error ? error.message : String(error)],
        completedAt: new Date(),
      },
    }).catch((logErr) => {
      logger.error(`[${channel} Sync] Failed to update sync log:`, logErr);
    });

    throw error;
  }
}

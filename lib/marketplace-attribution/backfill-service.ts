import prisma from "@/prisma/client";
import { projectSourceLinesFromShopeeOrderItems } from "./source-line-projector";
import { projectFactsForSourceLines } from "./fact-projector";
import { canMutateSharedAttribution, type AttributionActor } from "./access";

const BATCH_SIZE = 200;

export type BackfillPreview = {
  estimatedSourceLines: number;
  estimatedFactLines: number;
  dateRange: { from: Date; to: Date };
};

export async function previewBackfill(input: {
  platform: "shopee";
  internalShopId?: string;
  dateFrom: Date;
  dateTo: Date;
}): Promise<BackfillPreview> {
  const where: Record<string, unknown> = {
    platform: input.platform,
    orderDate: { gte: input.dateFrom, lte: input.dateTo },
    orderEligibility: "eligible",
  };
  if (input.internalShopId) where.internalShopId = input.internalShopId;

  const count = await prisma.marketplaceSourceSalesLine.count({ where });

  return {
    estimatedSourceLines: count,
    estimatedFactLines: count * 2,
    dateRange: { from: input.dateFrom, to: input.dateTo },
  };
}

export async function commitBackfill(
  input: {
    platform: "shopee";
    internalShopId?: string;
    dateFrom: Date;
    dateTo: Date;
    calculationVersion?: string;
    initiatedById: string;
    idempotencyKey?: string;
  },
  actor: AttributionActor,
) {
  if (!canMutateSharedAttribution(actor)) {
    throw new Error("Only admins can run backfill operations.");
  }

  if (input.idempotencyKey) {
    const existing = await prisma.mappingBackfillRun.findFirst({
      where: {
        initiatedById: input.initiatedById,
        platform: input.platform,
        internalShopId: input.internalShopId ?? null,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (existing) return { runId: existing.id, status: existing.status as "running" | "completed" | "completed_with_errors" | "failed" | "cancelled", processedCount: existing.processedCount, factCount: existing.factCount, errorCount: existing.errorCount };
  }
  const run = await prisma.mappingBackfillRun.create({
    data: {
      initiatedById: input.initiatedById,
      platform: input.platform,
      internalShopId: input.internalShopId ?? null,
      effectiveDate: input.dateTo,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      calculationVersion: input.calculationVersion ?? "v1",
      idempotencyKey: input.idempotencyKey ?? null,
      status: "running",
      startedAt: new Date(),
    },
  });

  try {
    if (input.platform === "shopee" && input.internalShopId) {
      await projectSourceLinesFromShopeeOrderItems(
        input.internalShopId,
        input.dateFrom,
        input.dateTo,
      );
    }

    let processedCount = 0;
    let factCount = 0;
    let errorCount = 0;
    const errors: { sourceLineId: string; error: string }[] = [];
    let lastSourceLineId: string | null = null;

    const existingRun = await prisma.mappingBackfillRun.findUnique({ where: { id: run.id } });
    if (existingRun?.status === "cancelled") {
      return { runId: run.id, status: "cancelled" as const };
    }

    const checkpointOffset = existingRun?.checkpoint && typeof existingRun.checkpoint === "object"
      ? (existingRun.checkpoint as { lastSourceLineId?: string }).lastSourceLineId
      : null;
    const skipAfterId = checkpointOffset ?? null;

    const whereSource: Record<string, unknown> = {
      platform: input.platform,
      orderDate: { gte: input.dateFrom, lte: input.dateTo },
      orderEligibility: "eligible",
    };
    if (input.internalShopId) whereSource.internalShopId = input.internalShopId;

    const totalLines = await prisma.marketplaceSourceSalesLine.count({ where: whereSource });

    let skipPastCheckpoint = !!skipAfterId;

    for (let offset = 0; offset < totalLines; offset += BATCH_SIZE) {
      const batch = await prisma.marketplaceSourceSalesLine.findMany({
        where: whereSource,
        select: { id: true },
        orderBy: { orderDate: "asc" },
        skip: offset,
        take: BATCH_SIZE,
      });

      let ids = batch.map((b) => b.id);
      if (!ids.length) break;

      if (skipPastCheckpoint) {
        const checkpointIdx = ids.indexOf(skipAfterId!);
        if (checkpointIdx >= 0) {
          ids = ids.slice(checkpointIdx + 1);
          skipPastCheckpoint = false;
          if (!ids.length) continue;
        } else {
          continue;
        }
      }

      try {
        const result = await projectFactsForSourceLines(ids);
        processedCount += ids.length;
        factCount += result.offerFacts + result.salesSkuFacts + result.wmsFacts;
        lastSourceLineId = ids[ids.length - 1] ?? null;
      } catch (error) {
        errorCount += ids.length;
        for (const id of ids) {
          errors.push({ sourceLineId: id, error: error instanceof Error ? error.message : "unknown" });
        }
      }

      await prisma.mappingBackfillRun.update({
        where: { id: run.id },
        data: {
          checkpoint: { lastSourceLineId, lastProcessedDate: new Date() },
          processedCount,
          factCount,
          errorCount,
          errors: errors.length ? errors : undefined,
        },
      });
    }

    await prisma.mappingBackfillRun.update({
      where: { id: run.id },
      data: {
        status: errorCount > 0 ? "completed_with_errors" : "completed",
        completedAt: new Date(),
        processedCount,
        factCount,
        errorCount,
        errors: errors.length ? errors : undefined,
      },
    });

    return { runId: run.id, status: errorCount > 0 ? "completed_with_errors" as const : "completed" as const, processedCount, factCount, errorCount };
  } catch (error) {
    await prisma.mappingBackfillRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        errors: [{ sourceLineId: "system", error: error instanceof Error ? error.message : "unknown" }],
      },
    });
    throw error;
  }
}

export async function cancelBackfill(runId: string, actor: AttributionActor) {
  if (!canMutateSharedAttribution(actor)) {
    throw new Error("Only admins can cancel backfill operations.");
  }
  const run = await prisma.mappingBackfillRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("Backfill run not found.");
  if (run.status !== "running" && run.status !== "pending")
    throw new Error("Only running or pending backfills can be cancelled.");

  return prisma.mappingBackfillRun.update({
    where: { id: runId },
    data: { status: "cancelled", completedAt: new Date() },
  });
}

export async function getBackfillRun(runId: string) {
  return prisma.mappingBackfillRun.findUnique({ where: { id: runId } });
}

export async function listBackfillRuns(input?: { platform?: string; status?: string }) {
  const where: Record<string, unknown> = {};
  if (input?.platform) where.platform = input.platform;
  if (input?.status) where.status = input.status;

  return prisma.mappingBackfillRun.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

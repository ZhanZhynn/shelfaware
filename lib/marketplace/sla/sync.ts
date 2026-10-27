import { Prisma } from "@prisma/client";
import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { SlaError, type SlaPlatform, type SlaUnit } from "./domain";
import { createSlaProvider, slaOwnedShop, type SlaProviderPage } from "./providers";
import { slaCheckpoint, type SlaCheckpoint } from "./checkpoint";

const date = (value: string | null) => value ? new Date(value) : null;
function storage(unit: SlaUnit) {
  return { ...unit, deadlines: unit.deadlines as unknown as Prisma.InputJsonValue, deadlineAt: date(unit.deadlineAt), cancellationAt: date(unit.cancellationAt), providerUpdatedAt: date(unit.providerUpdatedAt) };
}

/** One bounded provider page per leased task invocation; never fetch financial data. */
export async function syncMarketplaceSlaPage(platform: SlaPlatform, shopId: string, actorId: string, input: unknown, checkpoint: unknown, sourceRunId: string, lease?: { taskId: string; workerId: string }) {
  if (input && typeof input === "object" && Object.keys(input).length) throw new SlaError("INVALID_SLA_OPTIONS", "SLA refresh scans open fulfillment queues; creation-date filters are not supported");
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, status: true } });
  if (!actor || ["pending", "rejected"].includes(actor.status ?? "")) throw new SlaError("SLA_ACTOR_UNAVAILABLE", "The requesting account is no longer available", 403);
  const owners = await marketplaceOwnerIds(actor);
  const shop = await slaOwnedShop(platform, shopId, owners);
  const state = slaCheckpoint(checkpoint);
  const key = { platform, shopId };
  const now = new Date();
  if (!state.pages) {
    const prior = await prisma.marketplaceSlaCollection.findUnique({ where: { platform_shopId: key } });
    if (prior?.state === "collecting" && prior.sourceRunId !== sourceRunId && now.getTime() - prior.observedAt.getTime() < 5 * 60 * 1000) throw new SlaError("SLA_COLLECTION_BUSY", "Another fulfillment refresh is still collecting", 409, true);
    const data = { userId: shop.userId, sourceRunId, state: "collecting", pagesObserved: 0, unitsObserved: 0, unresolvedUnits: 0, lastError: null, startedAt: now, observedAt: now, completedAt: null, scope: { discovery: "provider_available_open_fulfillment_queues", creationDateRestricted: false, ...(platform === "lazada" ? { providerRequiredCreatedAfter: "2000-01-01T00:00:00+00:00" } : {}), snapshotAtomic: false, historicalCompleteness: "not_certified" } };
    await prisma.marketplaceSlaCollection.upsert({ where: { platform_shopId: key }, create: { ...key, ...data }, update: data });
  }
  try {
    const provider = await createSlaProvider(platform, shopId, owners);
    if (state.pages >= 2000) throw new SlaError("SLA_PAGE_LIMIT", "Fulfillment collection exceeded its page bound", 422);
    let page: Omit<SlaProviderPage, "next" | "limited">;
    let nextCursor = state.cursor;
    let phase = state.phase;
    let done = false;
    let limited = state.limited;
    if (state.phase === "discover") {
      const discovered = await provider.discover(state.cursor!);
      page = discovered;
      nextCursor = discovered.next;
      limited ||= discovered.limited;
      if (!nextCursor) phase = "recheck";
    } else {
      const remaining = await prisma.marketplaceSlaUnit.findMany({ where: { ...key, stage: { not: "closed" }, fulfillmentType: { not: "platform" }, sourceRunId: { not: sourceRunId } }, orderBy: { id: "asc" }, take: 50, select: { orderExternalId: true, packageExternalId: true } });
      page = remaining.length ? await provider.recheck(remaining) : { units: [], completeOrderIds: [] };
      done = remaining.length === 0;
    }
    if (page.units.length > 2000) throw new SlaError("SLA_RESPONSE_LIMIT", "Provider returned too many fulfillment units in one page", 502);
    if (new Set(page.units.map((unit) => unit.unitKey)).size !== page.units.length) throw new SlaError("SLA_RESPONSE_INVALID", "Provider returned duplicate fulfillment units", 502);
    const observedAt = new Date();
    const progress: SlaCheckpoint = { v: 1, phase, cursor: nextCursor, pages: state.pages + 1, records: state.records + page.units.length, limited };
    await prisma.$transaction(async (tx) => {
      if (lease) {
        const held = await tx.marketplaceSyncTask.updateMany({ where: { id: lease.taskId, leaseOwner: lease.workerId, status: "running", leaseExpiresAt: { gt: observedAt } }, data: { leaseExpiresAt: new Date(observedAt.getTime() + 4 * 60 * 1000) } });
        if (held.count !== 1) throw new SlaError("SLA_LEASE_LOST", "Fulfillment task no longer owns its lease", 409, true);
      }
      // The collection write fences competing generations in the same Mongo transaction
      // as the unit writes. A displaced collector cannot publish a mixed snapshot.
      const fence = await tx.marketplaceSlaCollection.updateMany({ where: { ...key, sourceRunId, state: { in: ["collecting", "partial"] } }, data: { observedAt } });
      if (fence.count !== 1) throw new SlaError("SLA_COLLECTION_CONFLICT", "Fulfillment refresh ownership changed", 409, true);
      const existing = page.units.length ? await tx.marketplaceSlaUnit.findMany({ where: { ...key, unitKey: { in: page.units.map((unit) => unit.unitKey) } } }) : [];
      const byKey = new Map(existing.map((unit) => [unit.unitKey, unit]));
      for (let offset = 0; offset < page.units.length; offset += 10) {
        await Promise.all(page.units.slice(offset, offset + 10).map(async (unit) => {
          const previous = byKey.get(unit.unitKey);
          if (previous?.providerUpdatedAt && unit.providerUpdatedAt && previous.providerUpdatedAt.getTime() > Date.parse(unit.providerUpdatedAt)) throw new SlaError("SLA_PROVIDER_STALE", "Provider fulfillment evidence regressed", 502, true);
          const facts = storage(unit);
          const data = { ...facts, userId: provider.userId, sourceRunId, observedAt, lastKnownDeadlineAt: facts.deadlineAt ?? previous?.lastKnownDeadlineAt ?? previous?.deadlineAt ?? null, lastKnownDeadlineObservedAt: facts.deadlineAt ? observedAt : previous?.lastKnownDeadlineObservedAt ?? (previous?.deadlineAt ? previous.observedAt : null) };
          await tx.marketplaceSlaUnit.upsert({ where: { platform_shopId_unitKey: { ...key, unitKey: unit.unitKey } }, create: { ...key, ...data }, update: data });
        }));
      }
      for (const orderExternalId of page.completeOrderIds) {
        // A full order detail can replace an earlier order-level fallback or split
        // package identity. Search-page absence alone is never terminal evidence.
        await tx.marketplaceSlaUnit.updateMany({ where: { ...key, orderExternalId, unitKey: { notIn: page.units.filter((unit) => unit.orderExternalId === orderExternalId).map((unit) => unit.unitKey) }, observedAt: { lte: observedAt } }, data: { stage: "closed", providerStatus: "SUPERSEDED_BY_ORDER_DETAIL", sourceRunId, observedAt } });
      }
      const unresolved = done ? await tx.marketplaceSlaUnit.count({ where: { ...key, stage: { not: "closed" }, fulfillmentType: { not: "platform" }, sourceRunId: { not: sourceRunId } } }) : 0;
      await tx.marketplaceSlaCollection.updateMany({ where: { ...key, sourceRunId }, data: { state: done ? limited || unresolved ? "partial" : "observed" : "collecting", pagesObserved: progress.pages, unitsObserved: progress.records, unresolvedUnits: unresolved, lastError: done && limited ? "SLA_PROVIDER_LIMIT" : done && unresolved ? "SLA_UNRESOLVED_UNITS" : null, observedAt, completedAt: done ? observedAt : null } });
    }, { timeout: 60000 });
    return { done, checkpoint: progress, metrics: { pagesObserved: progress.pages, unitsObserved: progress.records, providerLimited: limited, phase, snapshotAtomic: false } };
  } catch (error) {
    const code = error instanceof SlaError ? error.code : "SLA_PROVIDER_REQUEST_FAILED";
    if (code !== "SLA_LEASE_LOST" && code !== "SLA_COLLECTION_CONFLICT") await prisma.marketplaceSlaCollection.updateMany({ where: { ...key, sourceRunId }, data: { state: "partial", lastError: code, observedAt: new Date() } });
    throw error;
  }
}

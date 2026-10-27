import { prisma } from "@/prisma/client";
import { marketplaceOwnerIds } from "@/lib/marketplace/access";
import { describeSlaBacklog, SlaError, type ObservedSlaUnit, type SlaPlatform, type SlaQuery, type SlaUnit } from "./domain";
import { createSlaProvider, slaOwnedShop, slaShopTimezone, type DiscoveryCursor } from "./providers";

const MAX_STORED_UNITS = 10000;
const MAX_LIVE_UNITS = 2000;

async function liveBacklog(platform: SlaPlatform, shopId: string, ownerIds: string[]) {
  const provider = await createSlaProvider(platform, shopId, ownerIds);
  let cursor: DiscoveryCursor | null = { queue: 0, cursor: "", seen: [] };
  const units = new Map<string, ObservedSlaUnit>();
  const startedAt = new Date();
  let pages = 0, limited = false;
  // A live request is bounded; the durable SLA refresh is the complete traversal path.
  while (cursor && pages < 12 && Date.now() - startedAt.getTime() < 20000) {
    const page = await provider.discover(cursor);
    const observedAt = new Date().toISOString();
    for (const unit of page.units) units.set(unit.unitKey, { ...unit, observedAt });
    pages++;
    limited ||= page.limited || units.size > MAX_LIVE_UNITS;
    cursor = page.next;
    if (limited) break;
  }
  return { units: [...units.values()].slice(0, MAX_LIVE_UNITS), state: cursor || limited ? "partial" : "observed", startedAt, observedAt: new Date(), completedAt: cursor || limited ? null : new Date(), pagesObserved: pages, lastError: cursor || limited ? "SLA_LIVE_BUDGET" : null, scope: { discovery: "provider_available_open_fulfillment_queues", creationDateRestricted: false, snapshotAtomic: false, historicalCompleteness: "not_certified", previouslyStoredUnitsRechecked: false } };
}

export async function getSlaReport(actor: Parameters<typeof marketplaceOwnerIds>[0], platform: SlaPlatform, query: SlaQuery, view: "orders" | "summary", now = new Date()) {
  const owners = await marketplaceOwnerIds(actor);
  const shop = await slaOwnedShop(platform, query.shopId, owners);
  const region = "countryCode" in shop ? shop.countryCode : "region" in shop ? shop.region : null;
  const timezone = query.timezone ?? slaShopTimezone(region);
  if (!timezone) throw new SlaError("TIMEZONE_REQUIRED", "Supply --timezone: the shop region does not identify one unambiguous reporting timezone");
  const rows = query.live ? null : await prisma.marketplaceSlaUnit.findMany({ where: { platform, shopId: query.shopId, stage: { not: "closed" } }, orderBy: [{ deadlineAt: "asc" }, { id: "asc" }], take: MAX_STORED_UNITS + 1 });
  const collection = query.live ? await liveBacklog(platform, query.shopId, owners) : await prisma.marketplaceSlaCollection.findUnique({ where: { platform_shopId: { platform, shopId: query.shopId } } });
  const units: ObservedSlaUnit[] = query.live ? (collection as Awaited<ReturnType<typeof liveBacklog>>).units : (rows ?? []).slice(0, MAX_STORED_UNITS).map((row) => ({ orderExternalId: row.orderExternalId, unitKey: row.unitKey, unitType: row.unitType as SlaUnit["unitType"], packageExternalId: row.packageExternalId, itemExternalId: row.itemExternalId, providerStatus: row.providerStatus, stage: row.stage as SlaUnit["stage"], fulfillmentType: row.fulfillmentType as SlaUnit["fulfillmentType"], blockedReason: row.blockedReason, deadlines: row.deadlines as unknown as SlaUnit["deadlines"], deadlineAt: row.deadlineAt?.toISOString() ?? null, deadlineKind: row.deadlineKind as SlaUnit["deadlineKind"], deadlineSource: row.deadlineSource, deadlineState: row.deadlineState as SlaUnit["deadlineState"], cancellationAt: row.cancellationAt?.toISOString() ?? null, providerUpdatedAt: row.providerUpdatedAt?.toISOString() ?? null, sourceVersion: row.sourceVersion, observedAt: row.observedAt.toISOString(), lastKnownDeadlineAt: row.lastKnownDeadlineAt?.toISOString() ?? null }));
  // Freeze one classification time after provider collection; durations are not stale before the live call finishes.
  const asOf = query.live ? new Date() : now;
  const described = describeSlaBacklog(units, query, timezone, asOf);
  const stale = !collection?.completedAt || asOf.getTime() - collection.completedAt.getTime() > query.maxAgeSeconds * 1000;
  const truncated = Boolean(rows && rows.length > MAX_STORED_UNITS);
  const unknown = described.summary.unknownDeadline.units > 0;
  const state = !collection ? "missing" : collection.state !== "observed" || truncated || unknown ? "partial" : stale || described.summary.stale.units > 0 ? "stale" : "observed";
  const warnings: string[] = [];
  if (!collection) warnings.push("No SLA backlog collection exists. An empty response does not establish zero outstanding orders; run a dedicated SLA refresh.");
  if (collection && collection.state !== "observed") warnings.push("Fulfillment evidence is incomplete. Counts may be incomplete or stale and are not confirmed totals.");
  if (stale && collection) warnings.push("Fulfillment observations are stale or the latest refresh has not completed. Refresh before relying on deadline counts.");
  if (unknown) warnings.push("Some outstanding units have missing/invalid deadlines, unknown fulfillment ownership or unknown stages; zero known due orders is not a confirmed zero.");
  if (truncated) warnings.push("The stored backlog exceeds the 10000-unit reporting limit. Counts are partial.");
  warnings.push("Overdue describes an outstanding provider deadline; it does not certify a platform penalty or late-dispatch-rate assessment. Counts for orders, packages and items are not interchangeable.");
  const offset = Number(query.cursor ?? 0);
  if (offset > MAX_STORED_UNITS) throw new SlaError("INVALID_QUERY", "SLA cursor exceeds the reporting bound");
  if (query.live && query.cursor) throw new SlaError("INVALID_QUERY", "Live SLA snapshots cannot be resumed with a stored-result cursor; use a durable SLA refresh");
  const totals = described.summary;
  const matchedOrders = new Set(described.data.map((unit) => unit.orderExternalId)).size;
  const data = view === "summary" ? { ...totals, pendingOrders: totals.pending.orders, arrangeShipmentOrders: totals.arrangeShipment.orders, awaitingCollectionOrders: totals.awaitingCollection.orders, overdueOrders: totals.overdue.orders, dueTodayOrders: totals.dueToday.orders, dueLaterTodayOrders: totals.dueLaterToday.orders, dueWithinOrders: totals.dueWithin.orders, unknownDeadlineOrders: totals.unknownDeadline.orders, blockedOrders: totals.blocked.orders, staleOrders: totals.stale.orders, matchedOrders, matched: { orders: matchedOrders, units: described.data.length } } : query.live ? described.data : described.data.slice(offset, offset + query.limit);
  return {
    filters: { platform, shopId: query.shopId, timezone, due: query.due, withinHours: query.withinHours ?? null, warningHorizonHours: query.withinHours ?? 6, includeOverdue: query.includeOverdue, includeUnknown: query.includeUnknown, stage: query.stage, maxAgeSeconds: query.maxAgeSeconds },
    data,
    ...(view === "orders" ? { summary: described.summary, page: { limit: query.live ? described.data.length : query.limit, nextCursor: !query.live && offset + query.limit < described.data.length ? String(offset + query.limit) : null, total: described.data.length } } : {}),
    coverage: { state, countsAreConfirmed: state === "observed", packageCountsComplete: units.filter((unit) => unit.stage !== "closed" && unit.fulfillmentType !== "platform").every((unit) => unit.packageExternalId !== null), unknownDeadlineUnits: described.summary.unknownDeadline.units, scope: collection?.scope ?? null, lastError: collection?.lastError ?? null },
    freshness: { source: query.live ? "live" : "local", asOf: asOf.toISOString(), startedAt: collection?.startedAt.toISOString() ?? null, latestObservedAt: collection?.observedAt.toISOString() ?? null, completedAt: collection?.completedAt?.toISOString() ?? null, snapshotAtomic: false },
    warnings,
  };
}

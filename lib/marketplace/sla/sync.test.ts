import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), count: vi.fn() });
  const db = { user: { findUnique: vi.fn() }, marketplaceSlaCollection: model(), marketplaceSlaUnit: model(), marketplaceSyncTask: { updateMany: vi.fn() }, $transaction: vi.fn() };
  return { db, owners: vi.fn(), shop: vi.fn(), factory: vi.fn(), discover: vi.fn(), recheck: vi.fn() };
});
vi.mock("@/prisma/client", () => ({ prisma: m.db }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: m.owners }));
vi.mock("./providers", () => ({ createSlaProvider: m.factory, slaOwnedShop: m.shop }));
import { syncMarketplaceSlaPage } from "./sync";
import { normalizeShopeeSla } from "./normalize";
import { SlaError } from "./domain";

const unit = () => normalizeShopeeSla({ order_sn: "ORDER", package_number: "PKG", fulfillment_status: "LOGISTICS_READY", is_shipment_arranged: false, ship_by_date: 1793095200 }, true);
beforeEach(() => {
  vi.resetAllMocks();
  m.db.user.findUnique.mockResolvedValue({ id: "actor", role: "admin", status: "approved" });
  m.owners.mockResolvedValue(["owner"]); m.shop.mockResolvedValue({ userId: "owner" });
  m.factory.mockResolvedValue({ userId: "owner", discover: m.discover, recheck: m.recheck });
  m.db.marketplaceSlaCollection.findUnique.mockResolvedValue(null);
  m.db.marketplaceSlaCollection.upsert.mockResolvedValue({});
  m.db.marketplaceSlaCollection.updateMany.mockResolvedValue({ count: 1 });
  m.db.marketplaceSlaUnit.findMany.mockResolvedValue([]);
  m.db.marketplaceSlaUnit.upsert.mockResolvedValue({});
  m.db.marketplaceSlaUnit.updateMany.mockResolvedValue({ count: 1 });
  m.db.marketplaceSlaUnit.count.mockResolvedValue(0);
  m.db.marketplaceSyncTask.updateMany.mockResolvedValue({ count: 1 });
  m.db.$transaction.mockImplementation(async (operation: (tx: typeof m.db) => Promise<unknown>) => operation(m.db));
  m.discover.mockResolvedValue({ units: [unit()], completeOrderIds: [], next: null, limited: false });
});

describe("durable fulfillment page persistence", () => {
  it("persists a bounded page with a generation fence and private checkpoint", async () => {
    const result = await syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, null, "run");
    expect(result).toMatchObject({ done: false, checkpoint: { phase: "recheck", pages: 1, records: 1 } });
    expect(m.db.marketplaceSlaUnit.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { platform_shopId_unitKey: { platform: "shopee", shopId: "shop", unitKey: "package:PKG" } }, create: expect.objectContaining({ userId: "owner", sourceRunId: "run", deadlineAt: new Date("2026-10-27T10:00:00Z") }) }));
    expect(m.db.marketplaceSlaCollection.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sourceRunId: "run", state: { in: ["collecting", "partial"] } }) }));
  });

  it("retains last-known evidence without presenting a missing current deadline as observed", async () => {
    const observedAt = new Date("2026-10-26T10:00:00Z");
    m.db.marketplaceSlaUnit.findMany.mockResolvedValue([{ unitKey: "package:PKG", deadlineAt: new Date("2026-10-27T10:00:00Z"), observedAt, providerUpdatedAt: null }]);
    m.discover.mockResolvedValue({ units: [{ ...unit(), deadlineAt: null, deadlineKind: null, deadlineSource: null, deadlineState: "missing", deadlines: [] }], completeOrderIds: [], next: null, limited: false });
    await syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, null, "run");
    expect(m.db.marketplaceSlaUnit.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ deadlineAt: null, deadlineState: "missing", lastKnownDeadlineAt: new Date("2026-10-27T10:00:00Z"), lastKnownDeadlineObservedAt: observedAt }) }));
  });

  it("rechecks a missing open package before finishing; absence is not a shipped observation", async () => {
    const checkpoint = { v: 1, phase: "recheck", cursor: null, pages: 6, records: 10, limited: false };
    m.db.marketplaceSlaUnit.findMany.mockResolvedValueOnce([{ orderExternalId: "ORDER", packageExternalId: "PKG" }]).mockResolvedValue([]);
    m.recheck.mockResolvedValue({ units: [{ ...unit(), stage: "closed", providerStatus: "LOGISTICS_PICKUP_DONE" }], completeOrderIds: [] });
    const first = await syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, checkpoint, "run");
    expect(m.recheck).toHaveBeenCalledWith([{ orderExternalId: "ORDER", packageExternalId: "PKG" }]);
    expect(first.done).toBe(false);
    const second = await syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, first.checkpoint, "run");
    expect(second.done).toBe(true);
    expect(m.db.marketplaceSlaCollection.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "observed", unresolvedUnits: 0, completedAt: expect.any(Date) }) }));
  });

  it("records failed refresh coverage without deleting prior units or leaking provider errors", async () => {
    m.discover.mockRejectedValue(new Error("SECRET_PROVIDER_RESPONSE"));
    await expect(syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, null, "run")).rejects.toThrow();
    expect(m.db.marketplaceSlaCollection.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "partial", lastError: "SLA_PROVIDER_REQUEST_FAILED" }) }));
    expect(JSON.stringify(m.db.marketplaceSlaCollection.updateMany.mock.calls)).not.toContain("SECRET_PROVIDER_RESPONSE");
    expect(m.db.marketplaceSlaUnit.upsert).not.toHaveBeenCalled(); expect(m.db.marketplaceSlaUnit.updateMany).not.toHaveBeenCalled();
  });

  it("refuses competing generations and lost collection fences", async () => {
    m.db.marketplaceSlaCollection.findUnique.mockResolvedValueOnce({ state: "collecting", sourceRunId: "other", observedAt: new Date() });
    await expect(syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, null, "run")).rejects.toMatchObject({ code: "SLA_COLLECTION_BUSY" });
    expect(m.discover).not.toHaveBeenCalled();
    m.db.marketplaceSlaCollection.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, null, "run")).rejects.toMatchObject({ code: "SLA_COLLECTION_CONFLICT" });
    expect(m.db.marketplaceSlaUnit.upsert).not.toHaveBeenCalled();
  });

  it("fences an expired worker's writes even if its retry has the same collection generation", async () => {
    m.db.marketplaceSyncTask.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, null, "run", { taskId: "task", workerId: "old-worker" })).rejects.toMatchObject({ code: "SLA_LEASE_LOST" });
    expect(m.db.marketplaceSlaUnit.upsert).not.toHaveBeenCalled();
    expect(m.db.marketplaceSyncTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "task", leaseOwner: "old-worker", leaseExpiresAt: { gt: expect.any(Date) } }) }));
  });

  it("revalidates actor/shop ownership and marks authentication failures as partial", async () => {
    m.db.user.findUnique.mockResolvedValueOnce({ id: "actor", status: "rejected" });
    await expect(syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, null, "run")).rejects.toMatchObject({ code: "SLA_ACTOR_UNAVAILABLE" });
    m.factory.mockRejectedValueOnce(new SlaError("SLA_PROVIDER_AUTH_REQUIRED", "Reconnect shop", 403));
    await expect(syncMarketplaceSlaPage("shopee", "shop", "actor", undefined, null, "run")).rejects.toMatchObject({ code: "SLA_PROVIDER_AUTH_REQUIRED" });
    expect(m.db.marketplaceSlaCollection.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "partial", lastError: "SLA_PROVIDER_AUTH_REQUIRED" }) }));
    await expect(syncMarketplaceSlaPage("shopee", "shop", "actor", { daysBack: 7 }, null, "run")).rejects.toMatchObject({ code: "INVALID_SLA_OPTIONS" });
  });
});

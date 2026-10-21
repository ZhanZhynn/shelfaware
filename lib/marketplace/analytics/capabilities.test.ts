import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ connection: { findUnique: vi.fn(), upsert: vi.fn() }, capability: { findMany: vi.fn(), upsert: vi.fn() }, readiness: { findMany: vi.fn(), upsert: vi.fn() }, reconciliation: { findMany: vi.fn() }, invalidate: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { marketplaceAnalyticsConnection: m.connection, marketplaceAnalyticsCapability: m.capability, marketplaceAnalyticsReadiness: m.readiness, marketplaceAnalyticsReconciliation: m.reconciliation } }));
vi.mock("@/lib/cache/cache-utils", () => ({ invalidateMarketplaceAnalytics: m.invalidate }));
import { capabilityNames, ensureMarketplaceAnalyticsConnection, getMarketplaceCapabilities, getMarketplaceFinancialReadiness, setMarketplaceCapability, setMarketplaceFinancialReadiness } from "./capabilities";

const input = { userId: "owner", platform: "shopee" as const, shopId: "shop" };
beforeEach(() => {
  vi.resetAllMocks();
  m.connection.findUnique.mockResolvedValue(null);
  m.connection.upsert.mockResolvedValue({ id: "connection" });
  m.capability.findMany.mockResolvedValue([]);
  m.readiness.findMany.mockResolvedValue([]);
  m.reconciliation.findMany.mockResolvedValue([]);
});

describe("persisted marketplace capability and readiness", () => {
  it("never transfers connection ownership through an upsert", async () => {
    await ensureMarketplaceAnalyticsConnection(input);
    expect(m.connection.upsert).toHaveBeenCalledWith({ where: { platform_shopId: { platform: "shopee", shopId: "shop" } }, create: input, update: {} });
    m.connection.findUnique.mockResolvedValue({ userId: "other-owner" });
    m.connection.upsert.mockClear();
    await expect(ensureMarketplaceAnalyticsConnection(input)).rejects.toThrow("owner mismatch");
    expect(m.connection.upsert).not.toHaveBeenCalled();
  });

  it("returns unknown rather than inferring capability for empty or missing shop evidence", async () => {
    expect(await getMarketplaceCapabilities("shopee", [])).toEqual(Object.fromEntries(capabilityNames.map((name) => [name, "unknown"])));
    expect(m.capability.findMany).not.toHaveBeenCalled();
    m.capability.findMany.mockResolvedValue([{ capability: "orders", state: "available" }]);
    expect(await getMarketplaceCapabilities("shopee", ["shop", "other"])).toMatchObject({ orders: "unknown" });
  });

  it.each([
    { states: ["available", "available"], expected: "available" }, { states: ["available", "pending"], expected: "pending" },
    { states: ["unavailable", "pending"], expected: "unavailable" }, { states: ["unauthorized", "unavailable"], expected: "unauthorized" },
    { states: ["failed", "unauthorized"], expected: "failed" }, { states: ["available", "future_state"], expected: "unknown" },
  ])("combines multi-shop evidence conservatively: $states -> $expected", async ({ states, expected }) => {
    m.capability.findMany.mockResolvedValue(states.map((state) => ({ capability: "orders", state })));
    expect(await getMarketplaceCapabilities("shopee", ["shop", "other"])).toMatchObject({ orders: expected });
  });

  it.each(["available", "failed", "unauthorized"] as const)("persists %s observations and invalidates cached analytics only after the write", async (state) => {
    await setMarketplaceCapability({ ...input, capability: "orders", state });
    expect(m.capability.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ connectionId: "connection", state, checkedAt: expect.any(Date), observedAt: state === "available" ? expect.any(Date) : null }), update: expect.objectContaining({ observedAt: state === "available" ? expect.any(Date) : undefined }) }));
    expect(m.capability.upsert.mock.invocationCallOrder[0]).toBeLessThan(m.invalidate.mock.invocationCallOrder[0]!);
  });

  it("requires both readiness and a current approval for every selected shop", async () => {
    expect(await getMarketplaceFinancialReadiness("shopee", [])).toBe(false);
    m.readiness.findMany.mockResolvedValue([{ shopId: "shop" }, { shopId: "other" }]);
    m.reconciliation.findMany.mockResolvedValue([{ shopId: "shop" }]);
    expect(await getMarketplaceFinancialReadiness("shopee", ["shop", "other"])).toBe(false);
    m.reconciliation.findMany.mockResolvedValue([{ shopId: "shop" }, { shopId: "other" }]);
    expect(await getMarketplaceFinancialReadiness("shopee", ["shop", "other"])).toBe(true);
    expect(m.reconciliation.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ decision: "approved", expiresAt: { gt: expect.any(Date) } }) }));
  });

  it.each([false, true])("persists explicit financial readiness=%s without reusing an old reconciliation", async (financeReady) => {
    await setMarketplaceFinancialReadiness({ ...input, financeReady });
    expect(m.readiness.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ financeReady, reconciledAt: financeReady ? expect.any(Date) : null, reconciliationId: null }) }));
    expect(m.invalidate).toHaveBeenCalledWith("shopee");
  });
});

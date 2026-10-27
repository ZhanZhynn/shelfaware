import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ owners: vi.fn(), shop: vi.fn(), rows: vi.fn(), collection: vi.fn(), provider: vi.fn(), discover: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { marketplaceSlaUnit: { findMany: m.rows }, marketplaceSlaCollection: { findUnique: m.collection } } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: m.owners }));
vi.mock("./providers", () => ({ slaOwnedShop: m.shop, createSlaProvider: m.provider, slaShopTimezone: (region: string) => region === "MY" ? "Asia/Kuala_Lumpur" : null }));
import { getSlaReport } from "./report";
import { parseSlaQuery, SlaError } from "./domain";
import { normalizeShopeeSla } from "./normalize";
const now = new Date("2026-10-27T10:00:00Z");
const q = (extra = "") => parseSlaQuery(new URLSearchParams(`shopId=${"a".repeat(24)}&${extra}`));
const unit = () => normalizeShopeeSla({ order_sn: "ORDER", package_number: "PKG", fulfillment_status: "LOGISTICS_READY", is_shipment_arranged: false, ship_by_date: 1793095200 }, true);
function stored() { const value = unit(); return { ...value, deadlineAt: new Date(value.deadlineAt!), deadlines: value.deadlines, cancellationAt: null, providerUpdatedAt: null, lastKnownDeadlineAt: new Date(value.deadlineAt!), observedAt: now }; }
beforeEach(() => {
  vi.resetAllMocks(); m.owners.mockResolvedValue(["owner"]); m.shop.mockResolvedValue({ id: "a".repeat(24), region: "MY" });
  m.rows.mockResolvedValue([]); m.collection.mockResolvedValue(null); m.provider.mockResolvedValue({ discover: m.discover });
});

describe("SLA counts and coverage", () => {
  it("does not certify zero orders when no backlog has ever been collected", async () => {
    const report = await getSlaReport({ id: "actor", role: null }, "shopee", q(), "summary", now);
    expect(report.coverage).toMatchObject({ state: "missing", countsAreConfirmed: false });
    expect(report.warnings.join(" ")).toContain("does not establish zero");
    expect(m.provider).not.toHaveBeenCalled();
  });

  it("certifies an observed empty backlog only after a complete fresh scan", async () => {
    m.collection.mockResolvedValue({ state: "observed", startedAt: now, observedAt: now, completedAt: now, scope: {} });
    const result = await getSlaReport({ id: "actor", role: null }, "lazada", q(), "summary", now);
    expect(result).toMatchObject({ data: { pendingOrders: 0, dueTodayOrders: 0 }, coverage: { state: "observed", countsAreConfirmed: true } });
    expect(m.shop).toHaveBeenCalledWith("lazada", "a".repeat(24), ["owner"]);
    expect(m.rows).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ platform: "lazada", shopId: "a".repeat(24) }) }));
  });

  it.each(["stale", "unknown", "collecting"])("does not certify %s evidence", async (kind) => {
    m.collection.mockResolvedValue({ state: kind === "collecting" ? "collecting" : "observed", startedAt: now, observedAt: now, completedAt: kind === "stale" ? new Date(now.getTime() - 901000) : now, scope: {} });
    m.rows.mockResolvedValue([{ ...stored(), ...(kind === "unknown" ? { deadlineAt: null, deadlineState: "missing" } : {}) }]);
    const result = await getSlaReport({ id: "actor", role: null }, "shopee", q(), "orders", now);
    expect(result.coverage.countsAreConfirmed).toBe(false);
    expect(result.coverage.state).toBe(kind === "stale" ? "stale" : "partial");
  });

  it("checks authorization and ambiguous timezone before reading data or calling providers", async () => {
    m.shop.mockRejectedValueOnce(new SlaError("NOT_FOUND", "Shop not found", 404));
    await expect(getSlaReport({ id: "actor", role: null }, "shopee", q(), "summary", now)).rejects.toMatchObject({ status: 404 });
    expect(m.rows).not.toHaveBeenCalled(); expect(m.provider).not.toHaveBeenCalled();
    m.shop.mockResolvedValueOnce({ region: "US" });
    await expect(getSlaReport({ id: "actor", role: null }, "tiktok", q(), "summary", now)).rejects.toMatchObject({ code: "TIMEZONE_REQUIRED" });
  });

  it("reports a live traversal budget as partial even when the current page is empty", async () => {
    m.discover.mockImplementation(async () => ({ units: [], next: { queue: 0, cursor: "next", seen: [] }, limited: false }));
    const result = await getSlaReport({ id: "actor", role: null }, "shopee", q("live=true"), "summary", now);
    expect(m.discover).toHaveBeenCalledTimes(12);
    expect(result.coverage).toMatchObject({ state: "partial", countsAreConfirmed: false, lastError: "SLA_LIVE_BUDGET" });
    expect(m.rows).not.toHaveBeenCalled(); expect(m.collection).not.toHaveBeenCalled();
  });

  it("does not truncate a collected live backlog to the stored page-size without warning", async () => {
    m.discover.mockResolvedValue({ units: Array.from({ length: 101 }, (_, index) => ({ ...unit(), unitKey: `package:${index}`, packageExternalId: `PKG${index}` })), next: null, limited: false });
    const result = await getSlaReport({ id: "actor", role: null }, "shopee", q("live=true&limit=1"), "orders", now);
    expect(Array.isArray(result.data) && result.data.length).toBe(101);
    expect(result.page).toMatchObject({ nextCursor: null, total: 101 });
  });
});

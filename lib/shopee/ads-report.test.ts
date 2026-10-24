import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ shop: vi.fn(), observations: vi.fn(), coverage: vi.fn(), owners: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: { findFirst: m.shop }, shopeeAdsObservation: { findMany: m.observations }, shopeeAdsCoverage: { findMany: m.coverage } } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: m.owners }));
import { getShopeeAdsReport } from "./ads-report";
import { normalizeAdsMetrics } from "./ads-metrics";

const actor = { id: "actor", role: "admin" };
const shopId = "6a48e5373d977c22b78e267c";
const query = (extra = "") => new URLSearchParams(`shopId=${shopId}&dateFrom=2026-09-01&dateTo=2026-09-02${extra}`);
const fact = (reportType: string, key: string, row: Record<string, number>, date = "2026-09-01") => ({ reportType, entityKey: key, campaignId: reportType === "shop_cpc" ? null : key, date: new Date(date), observedAt: new Date("2026-10-23"), dimensions: { campaignName: key }, metrics: normalizeAdsMetrics(row) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  m.owners.mockResolvedValue(["owner"]);
  m.shop.mockResolvedValue({ id: shopId, shopId: 265951653, region: "MY" });
  m.coverage.mockResolvedValue(["shop_cpc", "product_campaign", "shop_gmv_max"].map((reportType) => ({ reportType, dateFrom: new Date("2026-09-01"), dateTo: new Date("2026-09-02"), state: "observed", observedAt: new Date("2026-10-23") })));
  m.observations.mockResolvedValue([
    fact("shop_cpc", "shop", { impression: 500, clicks: 50, broad_gmv: 200, expense: 20, broad_order: 10, direct_order: 5 }),
    fact("product_campaign", "product:1", { impression: 100, clicks: 10, broad_gmv: 100, direct_gmv: 50, expense: 10, broad_order: 2, direct_order: 1 }),
    fact("shop_gmv_max", "gms:2", { impression: 200, clicks: 20, broad_gmv: 50, expense: 5, broad_order: 1, direct_order: 1 }),
    fact("other_grain", "not-a-campaign", { impression: 1000, clicks: 100, broad_gmv: 999, expense: 999 }),
  ]);
});
afterEach(() => vi.useRealTimers());

describe("stored Shopee ads reporting", () => {
  it("separates shop and campaign grains, preserves missing direct GMV, and uses owner scope", async () => {
    const report = await getShopeeAdsReport(actor, query(), "summary");
    expect(report.data).toMatchObject({ basis: "campaigns", gmv: 150, expense: 15, conversions: 3, directGmv: null, knownTotals: { directGmv: 50 }, shopTotals: { gmv: 200, expense: 20 }, campaignTotals: { gmv: 150, expense: 15 } });
    expect(report.coverage.state).toBe("observed");
    expect(report.warnings.some((warning) => warning.includes("Direct GMV"))).toBe(true);
    expect(m.shop).toHaveBeenCalledWith(expect.objectContaining({ where: { id: shopId, userId: { in: ["owner"] } } }));
    expect(m.observations).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ shopId, reportType: { in: ["shop_cpc", "product_campaign", "shop_gmv_max"] } }), take: 50_001 }));
    expect((await getShopeeAdsReport(actor, query("&basis=shop"), "summary")).data).toMatchObject({ gmv: 200, expense: 20 });
  });

  it("does not claim an empty database means zero activity or complete history", async () => {
    m.observations.mockResolvedValue([]); m.coverage.mockResolvedValue([]);
    const report = await getShopeeAdsReport(actor, query(), "summary");
    expect(report.data).toMatchObject({ gmv: null, expense: null });
    expect(report.coverage).toMatchObject({ state: "missing", historicalCompleteness: "not_certified" });
  });

  it("groups daily/campaign rows and does not average source rates", async () => {
    expect((await getShopeeAdsReport(actor, query(), "daily")).data).toEqual([expect.objectContaining({ date: "2026-09-01", gmv: 150, clicks: 30, conversions: 3, conversionRate: 10 })]);
    expect((await getShopeeAdsReport(actor, query(), "campaigns")).data).toHaveLength(2);
    m.observations.mockResolvedValue([fact("product_campaign", "zero", { impression: 0, clicks: 0, broad_gmv: 0, expense: 0, broad_order: 0, direct_order: 0 })]);
    expect((await getShopeeAdsReport(actor, query(), "campaigns")).data).toEqual([]);
  });

  it.each(["dateFrom=2026-02-30&dateTo=2026-03-01", "dateFrom=2026-09-02&dateTo=2026-09-01", "dateFrom=2026-09-01", "basis=combined"])("rejects invalid filters: %s", async (filters) => {
    await expect(getShopeeAdsReport(actor, new URLSearchParams(`shopId=${shopId}&${filters}`), "summary")).rejects.toThrow();
  });

  it("rejects missing shops and unavailable views before reading facts", async () => {
    m.shop.mockResolvedValue(null);
    await expect(getShopeeAdsReport(actor, query(), "summary")).rejects.toMatchObject({ status: 404 });
    await expect(getShopeeAdsReport(actor, query(), "keywords")).rejects.toMatchObject({ status: 404 });
    expect(m.observations).not.toHaveBeenCalled();
  });

  it("honors the newest coverage state and exposes unsupported report dimensions", async () => {
    m.coverage.mockResolvedValue([{ reportType: "product_campaign", dateFrom: new Date("2026-09-01"), dateTo: new Date("2026-09-02"), state: "partial" }]);
    const report = await getShopeeAdsReport(actor, query(), "status");
    expect(report.coverage.state).toBe("partial");
    expect(report.coverage.unavailableFields).toContain("keywordPerformance");
  });

  it("bounds expensive authenticated report reads", async () => {
    m.observations.mockResolvedValue(Array(50_001).fill({}));
    await expect(getShopeeAdsReport(actor, query(), "summary")).rejects.toMatchObject({ code: "REPORT_TOO_LARGE" });
  });
});

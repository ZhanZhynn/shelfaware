import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ bulk: vi.fn(), collection: vi.fn(), connect: vi.fn() }));
vi.mock("mongodb", async () => {
  const actual = await vi.importActual<typeof import("mongodb")>("mongodb");
  return { ...actual, MongoClient: class {
    connect() { return m.connect(); }
  } };
});
import { persistAdsRows, type StoredAdsRow } from "./ads-store";
import { normalizeAdsMetrics } from "./ads-metrics";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("DATABASE_URL", "mongodb://localhost:27017/test");
  m.connect.mockResolvedValue({ db: () => ({ collection: m.collection }) }); m.collection.mockReturnValue({ bulkWrite: m.bulk }); m.bulk.mockResolvedValue({});
});
const row = (metric: number | null = 0): StoredAdsRow => ({ observation: { shopId: "6a48e5373d977c22b78e267c", userId: "6a48e5373d977c22b78e267d", entityKey: "product_campaign:7", reportType: "product_campaign", date: new Date("2026-09-01"), campaignId: "7", metrics: normalizeAdsMetrics({ impression: metric, clicks: 0, broad_order: 0, direct_order: 0, broad_order_amount: 0, direct_order_amount: 0, broad_gmv: 0, direct_gmv: 0, expense: 0 }) }, legacy: { campaignId: "7", expense: 0 } });
describe("bounded ads persistence", () => {
  it("removes an explicitly revised zero with shop, entity and date scope", async () => {
    await persistAdsRows([row()]);
    const operations = m.bulk.mock.calls.flatMap(([batch]) => batch);
    expect(operations).toHaveLength(2);
    expect(operations[0].deleteOne.filter).toMatchObject({ entityKey: "product_campaign:7", date: new Date("2026-09-01") });
    expect(operations[0].deleteOne.filter.shopId.toHexString()).toBe("6a48e5373d977c22b78e267c");
  });
  it("never deletes unknown observations and converts owner IDs to BSON", async () => {
    await persistAdsRows([row(null)]);
    const operation = m.bulk.mock.calls[0]![0][0];
    expect(operation.updateOne.upsert).toBe(true);
    expect(operation.updateOne.update.$set.userId.toHexString()).toBe("6a48e5373d977c22b78e267d");
    expect(operation.updateOne.update.$set.metrics.impressions).toBeNull();
  });
  it("bounds each write batch and keeps GMS outside legacy product metrics", async () => {
    const input = Array.from({ length: 501 }, () => ({ ...row(1), legacy: null }));
    input[0]!.observation.reportType = "shop_gmv_max";
    await persistAdsRows(input);
    expect(m.bulk.mock.calls.map(([batch]) => batch.length)).toEqual([500, 1]);
    expect(m.collection).toHaveBeenCalledWith("ShopeeAdsObservation");
    expect(m.collection).not.toHaveBeenCalledWith("ShopeeAdsCampaignDailyPerformance");
    await persistAdsRows([]);
    expect(m.bulk).toHaveBeenCalledTimes(2);
  });
});

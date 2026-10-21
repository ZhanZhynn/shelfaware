import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knownGap } from "@/tests/helpers/known-gap";

const m = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() });
  const sdk = { product: { getItemList: vi.fn(), getItemBaseInfo: vi.fn(), getModelList: vi.fn() }, order: { getOrderList: vi.fn(), getOrdersDetail: vi.fn(), searchPackageList: vi.fn() }, payment: { getEscrowDetailBatch: vi.fn(), getPayoutInfo: vi.fn() }, returns: { getReturnList: vi.fn() }, ads: { getAllCpcAdsDailyPerformance: vi.fn(), getTotalBalance: vi.fn(), getProductLevelCampaignIdList: vi.fn(), getProductCampaignDailyPerformance: vi.fn() } };
  return { sdk, db: { shopeeShop: model(), shopeeSyncLog: model(), shopeeProduct: model(), shopeeProductVariant: model(), shopeeOrder: model(), shopeeOrderItem: model(), shopeeReturn: model(), marketplaceFinancialRecord: model(), shopeeAdsDailyPerformance: model(), shopeeAdsCampaignDailyPerformance: model() }, getSDK: vi.fn(), capability: vi.fn() };
});
vi.mock("@/prisma/client", () => ({ default: m.db, prisma: m.db }));
vi.mock("./server", () => ({ getShopeeSDK: m.getSDK }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability: m.capability }));
vi.mock("@/lib/marketplace-attribution/feature-flags", () => ({ isSharedSkuMappingAnalyticsEnabled: () => false }));
vi.mock("@/lib/marketplace-attribution/source-line-projector", () => ({ projectShopeeAttributionForOrderIds: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { isShopSyncing, syncShopeeAds, syncShopeeAll, syncShopeeOrders, syncShopeePayoutStatements, syncShopeeProducts, syncShopeeReturns } from "./sync";

const sourceProduct = (id = 1) => ({ item_id: id, item_name: "Box", item_sku: "BOX", item_status: "NORMAL", has_model: false, price_info: [{ current_price: 12.5, original_price: 15 }], stock_info_v2: { summary_info: { total_available_stock: 0 } }, image: { image_url_list: ["box.jpg"] } });
const sourceOrder = (id = "ORDER-1") => ({ order_sn: id, order_status: "SHIPPED", create_time: 1700000000, update_time: 1700000100, total_amount: 25, currency: "MYR", item_list: [{ item_id: 1, model_id: 2, item_name: "Box", model_sku: "BOX-RED", model_quantity_purchased: 2, model_original_price: 12.5, model_discounted_price: 10 }] });
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  m.getSDK.mockReturnValue(m.sdk);
  m.db.shopeeShop.findFirst.mockResolvedValue({ id: "shop-db", shopId: 123 });
  m.db.shopeeSyncLog.create.mockResolvedValue({ id: "log" });
  m.db.shopeeSyncLog.update.mockResolvedValue({});
  m.db.shopeeProduct.findFirst.mockResolvedValue(null);
  m.db.shopeeProduct.create.mockResolvedValue({ id: "product-db" });
  m.db.shopeeProduct.update.mockResolvedValue({ id: "product-db" });
  m.db.shopeeProductVariant.findMany.mockResolvedValue([{ id: "variant-db", shopeeItemId: 1, modelId: 2 }]);
  m.db.shopeeProductVariant.findFirst.mockResolvedValue(null);
  m.db.shopeeOrder.findFirst.mockResolvedValue({ id: "order-db" });
  m.db.shopeeOrder.create.mockResolvedValue({ id: "order-db" });
  m.db.shopeeOrder.update.mockResolvedValue({ id: "order-db" });
  m.db.shopeeReturn.findFirst.mockResolvedValue(null);
  m.db.marketplaceFinancialRecord.findUnique.mockResolvedValue(null);
  m.sdk.product.getItemList.mockResolvedValue({ response: { item: [], has_next_page: false } });
  m.sdk.product.getItemBaseInfo.mockResolvedValue({ response: { item_list: [] } });
  m.sdk.product.getModelList.mockResolvedValue({ response: { model: [] } });
  m.sdk.order.getOrderList.mockResolvedValue({ response: { order_list: [], more: false } });
  m.sdk.order.getOrdersDetail.mockResolvedValue({ response: { order_list: [] } });
  m.sdk.order.searchPackageList.mockResolvedValue({ response: { package_list: [], more: false } });
  m.sdk.payment.getEscrowDetailBatch.mockResolvedValue({ response: { order_income_list: [] } });
  m.sdk.payment.getPayoutInfo.mockResolvedValue({ response: { payout_list: [], more: false } });
  m.sdk.returns.getReturnList.mockResolvedValue({ response: { return: [], more: false } });
  m.sdk.ads.getAllCpcAdsDailyPerformance.mockResolvedValue({ response: [] });
  m.sdk.ads.getTotalBalance.mockResolvedValue({ response: {} });
  m.sdk.ads.getProductLevelCampaignIdList.mockResolvedValue({ response: { campaign_list: [], has_next_page: false } });
  m.sdk.ads.getProductCampaignDailyPerformance.mockResolvedValue({ response: { campaign_list: [] } });
});
afterEach(() => vi.useRealTimers());

describe("Shopee product and model ingestion", () => {
  it.each([false, true])("persists product details with shop ownership and actor attribution (existing=%s)", async (existing) => {
    m.sdk.product.getItemList.mockResolvedValue({ response: { item: [{ item_id: 1 }], has_next_page: false } });
    m.sdk.product.getItemBaseInfo.mockResolvedValue({ response: { item_list: [sourceProduct()] } });
    if (existing) m.db.shopeeProduct.findFirst.mockResolvedValue({ id: "product-db" });
    expect(await syncShopeeProducts(123, "owner", "actor")).toEqual({ synced: 1, created: existing ? 0 : 1, updated: existing ? 1 : 0, errors: [] });
    const write = existing ? m.db.shopeeProduct.update : m.db.shopeeProduct.create;
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shopId: "shop-db", userId: "owner", shopeeItemId: 1, itemName: "Box", itemSku: "BOX", price: 12.5, originalPrice: 15, stock: 0, updatedBy: "actor" }) }));
    expect(m.db.shopeeProductVariant.deleteMany).toHaveBeenCalledWith({ where: { productId: "product-db" } });
  });

  it("exhausts list offsets and limits detail batches to 50 IDs", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => i + 1);
    m.sdk.product.getItemList.mockResolvedValueOnce({ response: { item: ids.slice(0, 50).map((item_id) => ({ item_id })), has_next_page: true } }).mockResolvedValueOnce({ response: { item: [{ item_id: 51 }], has_next_page: false } });
    m.sdk.product.getItemBaseInfo.mockImplementation(async ({ item_id_list }: { item_id_list: number[] }) => ({ response: { item_list: item_id_list.slice().reverse().map((id) => sourceProduct(id)) } }));
    const result = await syncShopeeProducts(123, "owner");
    expect(result.synced).toBe(51);
    expect(m.sdk.product.getItemList.mock.calls[1]?.[0].offset).toBe(50);
    expect(m.sdk.product.getItemBaseInfo.mock.calls.map(([args]) => args.item_id_list.length)).toEqual([50, 1]);
    expect(m.db.shopeeProduct.create.mock.calls.map(([args]) => args.data.shopeeItemId)).toEqual(ids);
  });

  it.each([false, true])("uses model prices/stocks and upserts each model before pruning stale IDs (existing=%s)", async (existing) => {
    m.sdk.product.getItemList.mockResolvedValue({ response: { item: [{ item_id: 1 }] } });
    m.sdk.product.getItemBaseInfo.mockResolvedValue({ response: { item_list: [{ ...sourceProduct(), has_model: true, price_info: [] }] } });
    m.sdk.product.getModelList.mockResolvedValue({ response: { tier_variation: [{ name: "Color" }], model: [{ model_id: 2, model_sku: "BOX-RED", model_name: "Red", price_info: [{ current_price: 10, original_price: 12.5 }], stock_info_v2: { summary_info: { total_available_stock: 3 } } }, { model_id: 3, price_info: [{ original_price: 15 }], stock_info_v2: { summary_info: { total_available_stock: 4 } } }] } });
    if (existing) m.db.shopeeProductVariant.findFirst.mockResolvedValue({ id: "variant-db" });
    await syncShopeeProducts(123, "owner");
    expect(m.db.shopeeProduct.create).toHaveBeenCalledWith({ data: expect.objectContaining({ price: 10, stock: 7 }) });
    const write = existing ? m.db.shopeeProductVariant.update : m.db.shopeeProductVariant.create;
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ modelId: 2, modelSku: "BOX-RED", price: 10, stock: 3 }) }));
    expect(m.db.shopeeProductVariant.deleteMany).toHaveBeenCalledWith({ where: { productId: "product-db", modelId: { notIn: [2, 3] } } });
  });

  it("reports individual product persistence failures without dropping independent products", async () => {
    m.sdk.product.getItemList.mockResolvedValue({ response: { item: [{ item_id: 1 }, { item_id: 2 }] } });
    m.sdk.product.getItemBaseInfo.mockResolvedValue({ response: { item_list: [sourceProduct(1), sourceProduct(2)] } });
    m.db.shopeeProduct.create.mockRejectedValueOnce(new Error("write failed"));
    expect(await syncShopeeProducts(123, "owner")).toMatchObject({ synced: 1, errors: ["Failed to sync product 1: write failed"] });
  });

  knownGap("KNOWN GAP SHOPEE-PRODUCT-DETAILS: missing details cannot erase a known product", async () => {
    m.sdk.product.getItemList.mockResolvedValue({ response: { item: [{ item_id: 1 }] } });
    m.db.shopeeProduct.findFirst.mockResolvedValue({ id: "product-db" });
    const result = await syncShopeeProducts(123, "owner");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(m.db.shopeeProduct.update).not.toHaveBeenCalled();
  });

  knownGap("KNOWN GAP SHOPEE-ZERO-PRICE: an explicit zero price must not fall back to original price", async () => {
    m.sdk.product.getItemList.mockResolvedValue({ response: { item: [{ item_id: 1 }] } });
    m.sdk.product.getItemBaseInfo.mockResolvedValue({ response: { item_list: [{ ...sourceProduct(), price_info: [{ current_price: 0, original_price: 15 }] }] } });
    await syncShopeeProducts(123, "owner");
    expect(m.db.shopeeProduct.create).toHaveBeenCalledWith({ data: expect.objectContaining({ price: 0 }) });
  });
});

describe("Shopee complete order persistence", () => {
  it.each([false, true])("writes source dates, correct variant attribution and operational facts (existing=%s)", async (existing) => {
    m.sdk.order.getOrderList.mockResolvedValue({ response: { order_list: [{ order_sn: "ORDER-1" }] } });
    m.sdk.order.getOrdersDetail.mockResolvedValue({ response: { order_list: [sourceOrder()] } });
    m.sdk.order.searchPackageList.mockResolvedValue({ response: { package_list: [{ order_sn: "ORDER-1", package_number: "pkg", ship_by_date: 1700100000, days_to_ship: 2, fulfillment_status: "READY" }] } });
    if (!existing) m.db.shopeeOrder.findFirst.mockResolvedValue(null);
    expect(await syncShopeeOrders(123, "owner", 100, 200, "actor")).toEqual({ synced: 1, created: existing ? 0 : 1, updated: existing ? 1 : 0, errors: [] });
    const write = existing ? m.db.shopeeOrder.update : m.db.shopeeOrder.create;
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shopId: "shop-db", userId: "owner", shopeeOrderId: "ORDER-1", shopeeCreatedAt: new Date(1700000000000), totalAmount: 25, currency: "MYR", packageNumber: "pkg", daysToShip: 2, updatedBy: "actor" }) }));
    expect(m.db.shopeeOrderItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orderId: "order-db", variantId: "variant-db", shopeeItemId: 1, shopeeModelId: 2, sku: "BOX-RED", quantity: 2 }) });
  });

  it("fetches list cursors and detail batches without relying on provider response order", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `ORDER-${i}`);
    m.sdk.order.getOrderList.mockResolvedValueOnce({ response: { order_list: ids.slice(0, 50).map((order_sn) => ({ order_sn })), more: true, next_cursor: "next" } }).mockResolvedValueOnce({ response: { order_list: [{ order_sn: ids[50] }], more: false } });
    m.sdk.order.getOrdersDetail.mockImplementation(async ({ order_sn_list }: { order_sn_list: string[] }) => ({ response: { order_list: order_sn_list.slice().reverse().map(sourceOrder) } }));
    expect(await syncShopeeOrders(123, "owner", 100, 200)).toMatchObject({ synced: 51, errors: [] });
    expect(m.sdk.order.getOrderList.mock.calls[1]![0]).toMatchObject({ cursor: "next", time_from: 100, time_to: 200 });
    expect(m.sdk.order.getOrdersDetail.mock.calls.map(([args]) => args.order_sn_list.length)).toEqual([50, 1]);
  });

  it.each([0, undefined])("does not invent a variant for source model ID %s", async (model_id) => {
    m.sdk.order.getOrderList.mockResolvedValue({ response: { order_list: [{ order_sn: "ORDER-1" }] } });
    const detail = sourceOrder();
    m.sdk.order.getOrdersDetail.mockResolvedValue({ response: { order_list: [{ ...detail, item_list: [{ ...detail.item_list[0], model_id }] }] } });
    await syncShopeeOrders(123, "owner");
    expect(m.db.shopeeOrderItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ shopeeModelId: null, variantId: null }) });
  });

  it("reports order/item write failures and records incomplete sync status", async () => {
    m.sdk.order.getOrderList.mockResolvedValue({ response: { order_list: [{ order_sn: "ORDER-1" }] } });
    m.sdk.order.getOrdersDetail.mockResolvedValue({ response: { order_list: [sourceOrder()] } });
    m.db.shopeeOrderItem.create.mockRejectedValue(new Error("item write failed"));
    const result = await syncShopeeOrders(123, "owner");
    expect(result).toMatchObject({ synced: 0, errors: ["Failed to sync order ORDER-1: item write failed"] });
    expect(m.db.shopeeSyncLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed_with_errors" }) }));
  });

  knownGap("KNOWN GAP SHOPEE-ORDER-DETAILS: a missing detail must not overwrite a previously observed order", async () => {
    m.sdk.order.getOrderList.mockResolvedValue({ response: { order_list: [{ order_sn: "ORDER-1" }] } });
    const result = await syncShopeeOrders(123, "owner");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(m.db.shopeeOrder.update).not.toHaveBeenCalled();
  });
});

describe("Shopee returns, payouts and ads", () => {
  it.each([null, "invalid", "0.00", "12.50"])("retains unknown versus observed return amounts: %s", async (refund_amount) => {
    m.sdk.returns.getReturnList.mockResolvedValue({ response: { return: [{ return_sn: "RETURN-1", order_sn: "ORDER-1", refund_amount, currency: "MYR", create_time: 1700000000, return_solution: 0 }] } });
    expect(await syncShopeeReturns(123, "owner", 100, 200)).toMatchObject({ synced: 1, created: 1 });
    const amount = refund_amount === "0.00" ? 0 : refund_amount === "12.50" ? 12.5 : null;
    expect(m.db.shopeeReturn.create).toHaveBeenCalledWith({ data: expect.objectContaining({ refundAmount: amount, returnSolution: 0, sourceObservedAt: amount === null ? null : expect.any(Date) }) });
  });

  it("paginates returns and splits explicit intervals without overlapping seconds", async () => {
    m.sdk.returns.getReturnList.mockResolvedValueOnce({ response: { return: [{ return_sn: "r", refund_amount: 1 }], more: true } }).mockResolvedValue({ response: { return: [], more: false } });
    m.db.shopeeReturn.findFirst.mockResolvedValue({ id: "return-db" });
    const end = 100 + 15 * 86400;
    expect(await syncShopeeReturns(123, "owner", 100, end)).toMatchObject({ updated: 1 });
    expect(m.sdk.returns.getReturnList.mock.calls.map(([args]) => [args.create_time_from, args.create_time_to, args.page_no])).toEqual([[100, end - 1, 1], [100, end - 1, 2], [end, end, 1]]);
  });

  knownGap("KNOWN GAP SHOPEE-RETURNS: a failed return page must be represented as incomplete work", async () => {
    m.sdk.returns.getReturnList.mockRejectedValue(new Error("provider unavailable"));
    const result = await syncShopeeReturns(123, "owner", 100, 200);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("deduplicates payout IDs across pages/windows and reports missing continuation", async () => {
    const payout = { encrypted_payout_id: "payout/1", payout_time: 1700000000, payout_amount: 0, payout_currency: "myr", payee_id: "private" };
    m.sdk.payment.getPayoutInfo.mockResolvedValueOnce({ response: { payout_list: [payout], more: true, next_cursor: "next" } }).mockResolvedValueOnce({ response: { payout_list: [payout], more: true } });
    const result = await syncShopeePayoutStatements(123, "owner", { timeFrom: 100, timeTo: 200 });
    expect(result).toMatchObject({ synced: 1, created: 1, errors: [expect.stringContaining("without next_cursor")] });
    expect(m.db.marketplaceFinancialRecord.upsert).toHaveBeenCalledTimes(1);
    expect(m.db.marketplaceFinancialRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ externalId: "payout:payout%2F1", amount: null, amountMinor: null, currency: "MYR" }) }));
    expect(JSON.stringify(m.db.marketplaceFinancialRecord.upsert.mock.calls)).not.toContain("private");
  });

  it("reports payout network errors rather than emitting a successful empty collection", async () => {
    m.sdk.payment.getPayoutInfo.mockRejectedValue(new Error("provider unavailable"));
    expect(await syncShopeePayoutStatements(123, "owner", { timeFrom: 100, timeTo: 200 })).toMatchObject({ synced: 0, errors: [expect.stringContaining("provider unavailable")] });
    expect(m.capability).not.toHaveBeenCalled();
  });

  it("maps daily and campaign metrics using UTC dates and snapshots the balance", async () => {
    const metric = { date: "20-10-2026", impression: "10", clicks: "2", expense: "1.25", currency: "myr" };
    m.sdk.ads.getAllCpcAdsDailyPerformance.mockResolvedValue({ response: [metric] });
    m.sdk.ads.getTotalBalance.mockResolvedValue({ response: { total_balance: 0, currency: "myr" } });
    m.sdk.ads.getProductLevelCampaignIdList.mockResolvedValue({ response: { campaign_list: [{ campaign_id: 7 }], has_next_page: false } });
    m.sdk.ads.getProductCampaignDailyPerformance.mockResolvedValue({ response: { campaign_list: [{ campaign_id: 7, ad_name: "Boxes", daily_metrics: [metric] }] } });
    expect(await syncShopeeAds(123, "owner", 30)).toEqual({ synced: 2, campaigns: 2, errors: [] });
    expect(m.sdk.ads.getAllCpcAdsDailyPerformance.mock.calls.map(([args]) => args)).toEqual([{ start_date: "21-09-2026", end_date: "19-10-2026" }, { start_date: "19-10-2026", end_date: "21-10-2026" }]);
    expect(m.db.shopeeAdsCampaignDailyPerformance.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ campaignId: "7", date: new Date("2026-10-20T00:00:00Z"), impressions: 10, clicks: 2, expense: 1.25, currency: "MYR" }) }));
    expect(m.db.shopeeAdsDailyPerformance.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ totalBalance: 0 }) }));
  });

  it("retries throttled ads calls and reports independent balance/campaign failures", async () => {
    m.sdk.ads.getAllCpcAdsDailyPerformance.mockRejectedValueOnce(new Error("ads.rate_limit")).mockResolvedValue({ response: [] });
    m.sdk.ads.getTotalBalance.mockRejectedValue(new Error("balance unavailable"));
    m.sdk.ads.getProductLevelCampaignIdList.mockRejectedValue(new Error("campaign unavailable"));
    const result = syncShopeeAds(123, "owner", 1);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ errors: ["total_balance: balance unavailable", "campaign list (offset 0): campaign unavailable"] });
    expect(m.sdk.ads.getAllCpcAdsDailyPerformance).toHaveBeenCalledTimes(2);
  });
});

describe("Shopee owned-shop and full-sync lifecycle", () => {
  it("rejects concurrent full syncs before starting another provider traversal", async () => {
    let release!: (value: { response: { item: [] } }) => void;
    m.sdk.product.getItemList.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const running = syncShopeeAll(123, "owner");
    await vi.advanceTimersByTimeAsync(0);
    expect(isShopSyncing(123)).toBe(true);
    await expect(syncShopeeAll(123, "owner")).rejects.toThrow("already in progress");
    release({ response: { item: [] } });
    await running;
    expect(isShopSyncing(123)).toBe(false);
  });

  it.each([syncShopeeProducts, syncShopeeOrders, syncShopeeReturns, syncShopeePayoutStatements, syncShopeeAds])("rejects missing shop ownership before reading provider data", async (sync) => {
    m.db.shopeeShop.findFirst.mockResolvedValue(null);
    await expect(sync(123, "owner")).rejects.toThrow("not found");
    expect(m.sdk.product.getItemList).not.toHaveBeenCalled();
    expect(m.sdk.order.getOrderList).not.toHaveBeenCalled();
  });

  it("releases the full-sync lock after success or provider rejection", async () => {
    await expect(syncShopeeAll(123, "owner")).resolves.toMatchObject({ products: { errors: [] }, orders: { errors: [] }, ads: { errors: [] } });
    expect(isShopSyncing(123)).toBe(false);
    m.sdk.product.getItemList.mockRejectedValue(new Error("provider unavailable"));
    await expect(syncShopeeAll(123, "owner")).rejects.toThrow("provider unavailable");
    expect(isShopSyncing(123)).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  marketplaceOwnerIds: vi.fn(),
  accessibleMarketplaceShops: vi.fn(),
  shopeeOrderFindMany: vi.fn(),
  shopeeReturnFindMany: vi.fn(),
  lazadaOrderFindMany: vi.fn(),
  financialRecordFindMany: vi.fn(),
  reconciliationStatus: vi.fn(),
  getMarketplaceCapabilities: vi.fn(),
  getMarketplaceFinancialReadiness: vi.fn(),
  isFinancialAnalyticsEligible: vi.fn(),
  parseAnalyticsDateRange: vi.fn(),
}));

vi.mock("@/prisma/client", () => ({ prisma: { shopeeOrder: { findMany: mocks.shopeeOrderFindMany }, shopeeReturn: { findMany: mocks.shopeeReturnFindMany }, lazadaOrder: { findMany: mocks.lazadaOrderFindMany }, marketplaceFinancialRecord: { findMany: mocks.financialRecordFindMany } } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: mocks.marketplaceOwnerIds }));
vi.mock("@/lib/marketplace/shops", () => ({ accessibleMarketplaceShops: mocks.accessibleMarketplaceShops }));
vi.mock("./capabilities", () => ({
  getMarketplaceCapabilities: mocks.getMarketplaceCapabilities,
  getMarketplaceFinancialReadiness: mocks.getMarketplaceFinancialReadiness,
}));
vi.mock("./server", () => ({
  AnalyticsValidationError: class extends Error {},
  isFinancialAnalyticsEligible: mocks.isFinancialAnalyticsEligible,
  parseAnalyticsDateRange: mocks.parseAnalyticsDateRange,
}));
vi.mock("./reconciliation-status", () => ({ getMarketplaceReconciliationStatus: mocks.reconciliationStatus }));

import { getProfitDetail } from "./profit-detail";

const shop = { id: "shop-1", region: "MY" };
const order = (overrides: Record<string, unknown> = {}) => ({
  id: "order-1",
  shopeeOrderId: "shopee-order-1",
  shopId: shop.id,
  orderStatus: "COMPLETED",
  currency: "MYR",
  totalAmount: 100,
  commissionFee: 5,
  serviceFee: 2,
  sellerTxnFee: 1,
  shippingFee: 3,
  estimatedShippingFee: 3,
  sellerIncome: 89,
  financialQuality: "unknown",
  items: [],
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.marketplaceOwnerIds.mockResolvedValue(["owner-1"]);
  mocks.accessibleMarketplaceShops.mockResolvedValue([shop]);
  mocks.getMarketplaceCapabilities.mockResolvedValue({ finance: "unknown" });
  mocks.getMarketplaceFinancialReadiness.mockResolvedValue(false);
  mocks.isFinancialAnalyticsEligible.mockReturnValue(false);
  mocks.parseAnalyticsDateRange.mockReturnValue(undefined);
  mocks.shopeeReturnFindMany.mockResolvedValue([]);
  mocks.lazadaOrderFindMany.mockResolvedValue([]);
  mocks.financialRecordFindMany.mockResolvedValue([]);
});

describe("Lazada profit population boundaries", () => {
  it("selects all linked postings for an order-created cohort, including later-month credits", async () => {
    const range = { gte: new Date("2026-07-31T16:00:00Z"), lte: new Date("2026-08-31T15:59:59Z") };
    mocks.parseAnalyticsDateRange.mockReturnValue(range);
    mocks.lazadaOrderFindMany.mockResolvedValue([{ id: "o", shopId: "shop-1", lazadaOrderId: "external-1", orderStatus: "confirmed", currency: "MYR", items: [] }]);
    const result = await getProfitDetail("lazada", { user: { id: "owner-1" } } as never, new URLSearchParams({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }));
    expect(mocks.financialRecordFindMany).toHaveBeenCalledWith({ where: { platform: "lazada", OR: [{ shopId: "shop-1", orderExternalId: { in: ["external-1"] } }] } });
    expect(result.coverage.dateBasis.field).toContain("unlinked adjustments excluded");
    expect(result.summary.sellerIncome).toBeNull();
  });

  it("filters transaction-occurrence time independently from linked order creation dates", async () => {
    const range = { gte: new Date("2026-08-01T00:00:00Z") };
    mocks.parseAnalyticsDateRange.mockReturnValue(range);
    mocks.financialRecordFindMany.mockResolvedValue([{ shopId: "shop-1", orderExternalId: "older-order", itemExternalId: null, amountMinor: "-100", amountScale: 2, currency: "MYR", feeName: "Wrong Weight Adjustment", transactionType: "source" }]);
    const result = await getProfitDetail("lazada", { user: { id: "owner-1" } } as never, new URLSearchParams({ dateBasis: "occurred" }));
    expect(mocks.financialRecordFindMany).toHaveBeenCalledWith({ where: { platform: "lazada", shopId: { in: ["shop-1"] }, occurredAt: range } });
    expect(mocks.lazadaOrderFindMany).toHaveBeenCalledWith({ where: { OR: [{ shopId: "shop-1", lazadaOrderId: { in: ["older-order"] } }] }, include: { items: true } });
    expect(result.summary).toMatchObject({ observedLedgerNet: -1, unallocatedLedgerNet: -1 });
    expect(result.coverage.dateBasis.field).toContain("occurredAt");
  });

  it("bounds ledger postings independently for an order-created cohort", async () => {
    const sourceRange = { gte: new Date("2026-08-01"), lte: new Date("2026-08-31") };
    const ledgerRange = { gte: new Date("2026-08-01"), lte: new Date("2026-09-14") };
    mocks.parseAnalyticsDateRange.mockReturnValueOnce(sourceRange).mockReturnValueOnce(ledgerRange);
    mocks.lazadaOrderFindMany.mockResolvedValue([{ id: "o", shopId: "shop-1", lazadaOrderId: "external-1", orderStatus: "confirmed", currency: "MYR", items: [] }]);
    const result = await getProfitDetail("lazada", { user: { id: "owner-1" } } as never, new URLSearchParams({ ledgerDateFrom: "2026-08-01", ledgerDateTo: "2026-09-14" }));
    expect(mocks.financialRecordFindMany).toHaveBeenCalledWith({ where: { platform: "lazada", occurredAt: ledgerRange, OR: [{ shopId: "shop-1", orderExternalId: { in: ["external-1"] } }] } });
    expect(result.coverage.dateBasis).toMatchObject({ ledgerFrom: "2026-08-01", ledgerTo: "2026-09-14" });
  });

  it("rejects release-date reporting when the provider has no verified release-date field", async () => {
    await expect(getProfitDetail("lazada", { user: { id: "owner-1" } } as never, new URLSearchParams({ dateBasis: "released" }))).rejects.toThrow("release-date reporting is unavailable");
  });

  it("requires certification for the actual occurrence interval rather than a global shop approval", async () => {
    const range = { gte: new Date("2026-08-01"), lte: new Date("2026-08-31") };
    mocks.parseAnalyticsDateRange.mockReturnValue(range);
    mocks.isFinancialAnalyticsEligible.mockReturnValue(true);
    mocks.financialRecordFindMany.mockResolvedValue([{ shopId: "shop-1", orderExternalId: null, itemExternalId: null, amountMinor: "1000", amountScale: 2, currency: "MYR", feeName: "Item Price Credit", transactionType: "source", financialQuality: "verified" }]);
    mocks.reconciliationStatus.mockResolvedValue({ certifiedReconciliationCount: 0, financialCoverage: { state: "complete" } });
    const params = new URLSearchParams({ dateBasis: "occurred" });
    const provisional = await getProfitDetail("lazada", { user: { id: "owner-1" } } as never, params);
    expect(provisional.summary).toMatchObject({ sellerIncome: null, observedLedgerNet: 10 });
    expect(mocks.reconciliationStatus).toHaveBeenCalledWith("lazada", "shop-1", expect.any(Date), { dateBasis: "occurred", dateRange: range });
    mocks.reconciliationStatus.mockResolvedValue({ certifiedReconciliationCount: 1, financialCoverage: { state: "complete" } });
    const ready = await getProfitDetail("lazada", { user: { id: "owner-1" } } as never, params);
    expect(ready.coverage.state).toBe("ready");
    expect(ready.summary.sellerIncome).toBe(10);
  });
});

describe("Shopee profit detail financial coverage", () => {
  it("keeps an incomplete fee category and seller income unavailable instead of substituting zero or deriving a value", async () => {
    mocks.shopeeOrderFindMany.mockResolvedValue([order({ commissionFee: null, sellerIncome: null })]);

    const result = await getProfitDetail("shopee", { user: { id: "owner-1" } } as never, new URLSearchParams());

    expect(result.summary).toMatchObject({ totalRevenue: 100, totalFees: null, sellerIncome: null, avgFeePerOrder: null });
    expect(result.feeBreakdown.map((fee) => fee.name)).not.toContain("Commission Fee");
    expect(result.coverage).toMatchObject({ state: "provisional", provisional: true });
    expect(result.coverage.fieldCoverage.commissionFee).toEqual({ known: 0, missing: 1 });
    expect(result.coverage.missingCostCategories).toContain("Commission Fee");
  });

  it("marks an all-null monetary source unavailable rather than reporting zero financials", async () => {
    mocks.shopeeOrderFindMany.mockResolvedValue([order({
      totalAmount: null, commissionFee: null, serviceFee: null, sellerTxnFee: null,
      shippingFee: null, estimatedShippingFee: null, sellerIncome: null,
    })]);

    const result = await getProfitDetail("shopee", { user: { id: "owner-1" } } as never, new URLSearchParams());

    expect(result.summary).toMatchObject({ totalRevenue: null, totalFees: null, totalShipping: null, sellerIncome: null, overallMargin: null });
    expect(result.coverage).toMatchObject({ state: "unavailable", provisional: false });
    expect(result.coverage.unavailableReasons).toContain("no Shopee monetary fields were observed for included orders");
  });

  it("preserves explicit monetary zeroes as observed provisional values", async () => {
    mocks.shopeeOrderFindMany.mockResolvedValue([order({
      totalAmount: 0, commissionFee: 0, serviceFee: 0, sellerTxnFee: 0,
      shippingFee: 0, estimatedShippingFee: 0, sellerIncome: 0,
    })]);

    const result = await getProfitDetail("shopee", { user: { id: "owner-1" } } as never, new URLSearchParams());

    expect(result.summary).toMatchObject({ totalRevenue: 0, totalFees: 0, totalShipping: 0, sellerIncome: 0, overallMargin: null });
    expect(result.coverage).toMatchObject({ state: "provisional", provisional: true });
    expect(result.coverage.fieldCoverage.totalRevenue).toEqual({ known: 1, missing: 0 });
  });

  it("uses stable product identities and exposes item subtotals without claiming they are paid revenue or profit", async () => {
    mocks.shopeeOrderFindMany.mockResolvedValue([order({
      totalAmount: 155.84,
      financialQuality: "verified",
      items: [
        { id: "line-1", variantId: "variant-a", productId: "product-a", shopeeItemId: 10, shopeeModelId: 1, sku: "A", productName: "Same display name", subtotal: 100, quantity: 1 },
        { id: "line-2", variantId: "variant-b", productId: "product-b", shopeeItemId: 11, shopeeModelId: 1, sku: "B", productName: "Same display name", subtotal: 55, quantity: 1 },
      ],
    })]);
    const params = new URLSearchParams({ dateFrom: "2026-10-18T00:00:00+08:00", dateTo: "2026-10-18T23:59:59.999+08:00" });
    mocks.parseAnalyticsDateRange.mockReturnValue({ gte: new Date("2026-10-17T16:00:00.000Z"), lte: new Date("2026-10-18T15:59:59.999Z") });

    const result = await getProfitDetail("shopee", { user: { id: "owner-1" } } as never, params);

    expect(result.summary.totalRevenue).toBe(155.84);
    expect(result.coverage.state).toBe("provisional");
    expect(result.byProduct).toHaveLength(2);
    expect(result.byProduct.map((product) => product.sourceProductKey)).toEqual(expect.arrayContaining([
      "shop-1:variant:variant-a", "shop-1:variant:variant-b",
    ]));
    expect(result.byProduct).toEqual(expect.arrayContaining([
      expect.objectContaining({ revenue: null, revenueBasis: "item_source_subtotal", itemSourceSubtotal: 100, estimatedFees: null, estimatedProfit: null }),
      expect.objectContaining({ revenue: null, revenueBasis: "item_source_subtotal", itemSourceSubtotal: 55, estimatedFees: null, estimatedProfit: null }),
    ]));
    expect(result.coverage.dateBasis).toEqual({
      field: "shopeeCreatedAt (createdAt fallback)",
      from: "2026-10-18T00:00:00+08:00",
      to: "2026-10-18T23:59:59.999+08:00",
      appliedFrom: "2026-10-17T16:00:00.000Z",
      appliedTo: "2026-10-18T15:59:59.999Z",
    });
  });

  it("does not collapse unmapped provider variants into their shared internal parent product", async () => {
    mocks.shopeeOrderFindMany.mockResolvedValue([order({ items: [
      { id: "a", variantId: null, productId: "parent", shopeeItemId: 10, shopeeModelId: 1, sku: "a", productName: "Same", subtotal: 10, quantity: 1 },
      { id: "b", variantId: null, productId: "parent", shopeeItemId: 10, shopeeModelId: 2, sku: "b", productName: "Same", subtotal: 20, quantity: 1 },
    ] })]);
    const result = await getProfitDetail("shopee", { user: { id: "owner-1" } } as never, new URLSearchParams());
    expect(result.byProduct.map((product) => product.sourceProductKey)).toEqual(expect.arrayContaining(["shop-1:shopee-item:10:1", "shop-1:shopee-item:10:2"]));
    expect(result.refundEvidence).toMatchObject({ settledRefundAmount: null, historyCompleteness: "unknown" });
  });

  it("keeps an empty financial cohort unavailable rather than turning it into zero income", async () => {
    mocks.shopeeOrderFindMany.mockResolvedValue([]);
    const result = await getProfitDetail("shopee", { user: { id: "owner-1" } } as never, new URLSearchParams());
    expect(result.summary).toMatchObject({ totalOrders: 0, totalRevenue: null, totalFees: null, sellerIncome: null });
    expect(result.coverage.state).toBe("unavailable");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knownGap } from "@/tests/helpers/known-gap";
const configuration = vi.hoisted(() => ({ configured: true }));
vi.mock("@/lib/env", () => ({ getEnvVar: () => configuration.configured ? "fixture" : undefined }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { getAllOrdersCustom, getAllProductsCustom, getAllFinanceTransactionDetailsCustom, getAllLogisticsFeeDetailCustom, getFinanceTransactionDetailsCustom, getLogisticsFeeDetailCustom, getMultipleOrderItemsCustom, getOrdersCustom, getOrdersPageCustom, getPayoutStatusCustom, getProductsCustom, getShippingFeeCustom } from "./custom-api";
import { assertLazadaSuccess, lazadaIdentifier, lazadaResponseShape, lazadaSyncFailure, LazadaProviderError } from "./provider-error";
import type { LazadaShopContext } from "./server";

const context: LazadaShopContext = { shopId: "shop", sellerId: "seller", userId: "owner", countryCode: "my", accessToken: "fixture-token", refreshToken: "", tokenExpiry: null, refreshExpiry: null };
const fetchMock = vi.fn();
const envelope = (data: unknown, code: string | number = "0", status = 200) => ({ status, json: async () => ({ code, data, request_id: "provider-id" }) });
beforeEach(() => { vi.resetAllMocks(); configuration.configured = true; vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("Lazada actual order pagination", () => {
  it("retrieves 101 unique orders and carries all date filters into the second request", async () => {
    fetchMock.mockResolvedValueOnce(envelope({ countTotal: 101, orders: Array.from({ length: 100 }, (_, i) => ({ order_id: i + 1 })) })).mockResolvedValueOnce(envelope({ countTotal: 101, orders: [{ order_id: 101 }] }));
    const result = await getAllOrdersCustom(context, { update_after: "2026-10-01T00:00:00Z", update_before: "2026-10-02T00:00:00Z" });
    expect(result.map((row) => row.order_id)).toEqual(Array.from({ length: 101 }, (_, i) => String(i + 1)));
    const query = new URL(fetchMock.mock.calls[1]![0]).searchParams;
    expect(query.get("offset")).toBe("100");
    expect(query.get("update_after")).toBe("2026-10-01T00:00:00+0000");
    expect(query.get("update_before")).toBe("2026-10-02T00:00:00+0000");
  });

  it("rejects an actually repeated full page rather than double-counting orders", async () => {
    fetchMock.mockResolvedValue(envelope({ countTotal: 200, orders: Array.from({ length: 100 }, (_, i) => ({ order_id: i + 1 })) }));
    await expect(getAllOrdersCustom(context)).rejects.toThrow("duplicate order ID");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty continuation while the provider still advertises missing orders", async () => {
    fetchMock.mockResolvedValueOnce(envelope({ countTotal: 101, orders: Array.from({ length: 100 }, (_, i) => ({ order_id: i + 1 })) })).mockResolvedValueOnce(envelope({ countTotal: 101, orders: [] }));
    await expect(getAllOrdersCustom(context)).rejects.toThrow("incomplete order pagination");
  });

  it("rejects offset-cap truncation instead of returning a successful partial collection", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return envelope({ countTotal: 5001, orders: Array.from({ length: 100 }, (_, i) => ({ order_id: offset + i + 1 })) });
    });
    await expect(getAllOrdersCustom(context)).rejects.toThrow("offset cap");
    expect(fetchMock).toHaveBeenCalledTimes(50);
  });

  it.each([{}, { orders: null }, { orders: "invalid" }, { orders: [{ order_id: 1 }], countTotal: 0 }])("rejects a malformed or inconsistent order envelope: %j", async (data) => {
    fetchMock.mockResolvedValue(envelope(data));
    await expect(getOrdersPageCustom(context)).rejects.toBeInstanceOf(LazadaProviderError);
  });

  it("normalizes bulk item identities and never leaks credential values through errors", async () => {
    fetchMock.mockResolvedValue(envelope([{ order_id: 10, order_items: [{ order_item_id: 100 }] }]));
    expect(await getMultipleOrderItemsCustom(context, ["10"])).toEqual([{ order_id: "10", order_items: [{ order_item_id: "100" }] }]);
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get("order_ids")).toBe("[10]");
    fetchMock.mockResolvedValue(envelope([{ order_id: 10, order_items: null }]));
    await expect(getMultipleOrderItemsCustom(context, [10])).rejects.toMatchObject({ code: "MALFORMED_ORDER_ITEMS" });
  });

  knownGap("KNOWN GAP LAZADA-PRODUCT-PAGING: timestamp ties cannot silently establish complete catalog coverage", async () => {
    const first = Array.from({ length: 50 }, (_, i) => ({ item_id: i + 1, updated_time: "1792000000" }));
    fetchMock.mockResolvedValue(envelope({ products: first }));
    const result = await getAllProductsCustom(context);
    expect(new Set(result.map((row) => row.item_id)).size).toBe(result.length);
  });
});

describe("Lazada provider diagnostic boundaries", () => {
  it.each([1, "123", "900719925474099312345"])("preserves safe numeric/string identifiers: %s", (id) => {
    expect(lazadaIdentifier(id)).toBe(String(id));
  });
  it.each([null, undefined, 0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, "", "01", "private credential", {}, []])("rejects an invalid identifier: %j", (id) => {
    expect(() => lazadaIdentifier(id)).toThrow(LazadaProviderError);
  });
  it.each([{ status: 401, code: "error", retryable: false }, { status: 400, code: "error", retryable: false }, { status: 502, code: "MALFORMED_ORDERS", retryable: false }, { status: 429, code: "SellerCallLimit", retryable: true }, { status: 503, code: "Temporary", retryable: true }])("classifies HTTP $status/$code", ({ status, code, retryable }) => {
    expect(lazadaSyncFailure(new LazadaProviderError(code, status))).toMatchObject({ retryable });
  });
  it.each([[null, "NULL"], [undefined, "MISSING"], [[], "ARRAY"], [{}, "OBJECT"], ["private", "STRING"], [3, "OTHER"]])("reports only envelope shape: %j", (value, shape) => {
    expect(lazadaResponseShape(value)).toBe(shape);
  });
  it("accepts both numeric and string success codes but rejects HTTP failures and unsafe diagnostics", () => {
    expect(() => assertLazadaSuccess({ code: 0 })).not.toThrow();
    expect(() => assertLazadaSuccess({ code: "0" })).not.toThrow();
    expect(() => assertLazadaSuccess({ code: "0" }, 429)).toThrow(LazadaProviderError);
    const error = new LazadaProviderError("token=private", 400, "private token", ["amount", "private value"]);
    expect(error).toMatchObject({ code: "UNKNOWN", providerRequestId: null, fields: ["amount"] });
    expect(error.message).not.toContain("private");
  });
});

describe("Lazada catalog, finance, logistics and payout HTTP contracts", () => {
  const readers = [
    { name: "products", read: (ctx: LazadaShopContext) => getProductsCustom(ctx) },
    { name: "orders", read: (ctx: LazadaShopContext) => getOrdersPageCustom(ctx) },
    { name: "items", read: (ctx: LazadaShopContext) => getMultipleOrderItemsCustom(ctx, [1]) },
    { name: "finance", read: (ctx: LazadaShopContext) => getFinanceTransactionDetailsCustom(ctx, { start_time: "2026-10-01", end_time: "2026-10-02" }) },
    { name: "logistics", read: (ctx: LazadaShopContext) => getLogisticsFeeDetailCustom(ctx, {}) },
    { name: "shipping", read: (ctx: LazadaShopContext) => getShippingFeeCustom(ctx, "tracking") },
    { name: "payouts", read: (ctx: LazadaShopContext) => getPayoutStatusCustom(ctx, "2026-10-01") },
  ];
  it.each(readers)("rejects missing application credentials before $name network access", async ({ read }) => {
    configuration.configured = false;
    await expect(read(context)).rejects.toThrow("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(readers)("rejects a missing shop token before $name network access", async ({ read }) => {
    await expect(read({ ...context, accessToken: "" })).rejects.toThrow("token is missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serializes product filtering, SKU selection and supported request bounds", async () => {
    fetchMock.mockResolvedValue(envelope({ products: [] }));
    await getProductsCustom(context, { filter: "all", limit: 100, offset: 20000, create_after: "from", create_before: "to", update_after: "u-from", update_before: "u-to", options: 0, sku_seller_list: ["BOX&RED"] });
    expect(Object.fromEntries(new URL(fetchMock.mock.calls[0]![0]).searchParams)).toMatchObject({ filter: "all", limit: "50", offset: "10000", create_after: "from", create_before: "to", update_after: "u-from", update_before: "u-to", options: "0", sku_seller_list: '["BOX&RED"]' });
    fetchMock.mockResolvedValue(envelope({ products: null }));
    await expect(getProductsCustom(context)).rejects.toMatchObject({ code: "MALFORMED_PRODUCTS" });
  });

  it("follows advancing product update timestamps until the provider returns an empty page", async () => {
    fetchMock.mockResolvedValueOnce(envelope({ products: [{ item_id: "1", updated_time: "1792000000000" }] })).mockResolvedValueOnce(envelope({ products: [] }));
    expect(await getAllProductsCustom(context)).toMatchObject([{ item_id: "1" }]);
    expect(new URL(fetchMock.mock.calls[1]![0]).searchParams.get("update_after")).toMatch(/^2026-/);
  });

  it("retains all finance postings across 500-row pages with normalized identity and filters", async () => {
    fetchMock.mockResolvedValueOnce(envelope(Array.from({ length: 500 }, (_, i) => ({ transaction_number: String(i + 1), amount: "1.00" })))).mockResolvedValueOnce(envelope([{ transaction_number: "501", amount: "0.00" }]));
    expect(await getAllFinanceTransactionDetailsCustom(context, { start_time: "2026-10-01", end_time: "2026-10-02", trans_type: "Orders", trade_order_id: "10", trade_order_line_id: "100" })).toHaveLength(501);
    expect(Object.fromEntries(new URL(fetchMock.mock.calls[1]![0]).searchParams)).toMatchObject({ offset: "500", limit: "500", trans_type: "Orders", trade_order_id: "10", trade_order_line_id: "100" });
  });

  it("rejects a repeated full finance page instead of claiming traversal is complete", async () => {
    fetchMock.mockResolvedValue(envelope(Array.from({ length: 500 }, (_, i) => ({ transaction_number: String(i + 1), amount: "1.00" }))));
    await expect(getAllFinanceTransactionDetailsCustom(context, { start_time: "2026-10-01", end_time: "2026-10-02" })).rejects.toMatchObject({ code: "INCONSISTENT_FINANCE_PAGINATION" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("paginates logistics fee detail and retains the bill-time bounds on every page", async () => {
    fetchMock.mockResolvedValueOnce(envelope(Array.from({ length: 50 }, (_, i) => ({ trade_order_id: String(i + 1) })))).mockResolvedValueOnce(envelope([{ trade_order_id: "51" }]));
    expect(await getAllLogisticsFeeDetailCustom(context, { bill_start_time: 100, bill_end_time: 200, trade_order_id: "10", trade_order_line_id: "100", fee_type: "shipping", biz_flow_type: "forward" })).toHaveLength(51);
    expect(Object.fromEntries(new URL(fetchMock.mock.calls[1]![0]).searchParams)).toMatchObject({ seller_id: "seller", request_type: "OPEN_API", bill_start_time: "100", bill_end_time: "200", page_no: "2", page_size: "50", trade_order_id: "10", trade_order_line_id: "100", fee_type: "shipping", biz_flow_type: "forward" });
    fetchMock.mockResolvedValue(envelope([], "SellerCallLimit", 429));
    await expect(getLogisticsFeeDetailCustom(context, {})).rejects.toThrow("SellerCallLimit");
  });

  it("reads shipping fee source facts and explicitly returns null for a rejected package lookup", async () => {
    const fee = { estimatedShippingFee: "1.00", actualShippingFee: "1.25", currency: "MYR" };
    fetchMock.mockResolvedValueOnce(envelope(fee)).mockResolvedValueOnce(envelope({}, "NotFound", 404));
    expect(await getShippingFeeCustom(context, "tracking&1")).toEqual(fee);
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get("trackingNumber")).toBe("tracking&1");
    expect(await getShippingFeeCustom(context, "tracking&1")).toBeNull();
  });

  it("validates payout date and envelope while retaining the marketplace calendar", async () => {
    fetchMock.mockResolvedValue(envelope([{ statement_number: "statement", payout: "1.00" }]));
    expect(await getPayoutStatusCustom(context, "2026-10-01T23:00:00Z")).toHaveLength(1);
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get("created_after")).toBe("2026-10-02");
    await expect(getPayoutStatusCustom(context, "invalid")).rejects.toThrow("valid date");
    fetchMock.mockResolvedValue(envelope({ statements: [] }));
    await expect(getPayoutStatusCustom(context, "2026-10-01")).rejects.toMatchObject({ code: "MALFORMED_PAYOUTS" });
  });

  it("exposes the order-array compatibility reader without changing normalized IDs", async () => {
    fetchMock.mockResolvedValue(envelope({ countTotal: 1, orders: [{ order_id: 10 }] }));
    expect(await getOrdersCustom(context, { status: "shipped", sort_by: "updated_at", sort_direction: "ASC" })).toEqual([{ order_id: "10" }]);
  });
});

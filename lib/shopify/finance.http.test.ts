import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, visit } from "graphql";

const m = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  shop: vi.fn(), upsert: vi.fn(), find: vi.fn(), logCreate: vi.fn(), logUpdate: vi.fn(), capability: vi.fn(),
}));
vi.mock("@/prisma/client", () => ({ default: {
  shopifyShop: { findFirst: m.shop },
  marketplaceFinancialRecord: { findUnique: m.find, upsert: m.upsert },
  syncLog: { create: m.logCreate, update: m.logUpdate },
} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/marketplace/analytics/capabilities", () => ({ setMarketplaceCapability: m.capability }));
import { syncShopifyFinance } from "./sync";
import { fetchAllFinanceOrders } from "./graphql-client";
import { FINANCE_ORDERS_QUERY, SHOPIFY_API_VERSION } from "./server";

const date = "2026-10-01T00:00:00Z";
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "MYR" } });
const transaction = (id: string, amount: string, kind = "SALE") => ({
  id, amountSet: money(amount), kind, status: "SUCCESS", gateway: "test", createdAt: date, processedAt: null,
});
const sale = transaction("sale", "9007199254740993.010");
const refund = transaction("refund-tx", "-2.50", "REFUND");
const financeOrder = () => ({
  id: "order", updatedAt: date, transactions: [sale, refund],
  refunds: [{ id: "refund", createdAt: date, processedAt: date, totalRefundedSet: money("2.50"), transactions: { nodes: [refund] } }],
});
const page = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => ({ orders: { nodes, pageInfo: { hasNextPage, endCursor } } });
const response = (data: unknown) => new Response(JSON.stringify({ data }), { headers: { "x-request-id": "fixture-request" } });

beforeEach(() => {
  vi.resetAllMocks();
  m.records.clear();
  m.shop.mockResolvedValue({ id: "shop", shopDomain: "fixture.myshopify.com", accessToken: "synthetic-token" });
  m.logCreate.mockResolvedValue({ id: "log" });
  m.logUpdate.mockResolvedValue({});
  m.find.mockImplementation(async ({ where }) => m.records.get(where.platform_shopId_externalId.externalId) ?? null);
  m.upsert.mockImplementation(async ({ where, create, update }) => {
    const key = where.platform_shopId_externalId.externalId;
    m.records.set(key, m.records.has(key) ? { ...m.records.get(key)!, ...update } : create);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Shopify finance through the actual HTTP/query and ingestion boundaries", () => {
  it("sends the corrected query, traverses wire pages, deduplicates refunds and reingests exactly", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (!body.query.includes("GetFinanceOrders")) return response({ shop: { name: "fixture" } });
      return body.variables.after === null
        ? response(page([financeOrder()], true, "next"))
        : response(page([{ id: "empty", updatedAt: date, transactions: [], refunds: [{ ...financeOrder().refunds[0]!, transactions: { nodes: [] } }] }]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const scope = { from: date, to: "2026-10-02T00:00:00Z" };
    expect(await syncShopifyFinance("shop", "owner", scope)).toEqual({ synced: 2, created: 2, updated: 0, errors: [] });
    expect(await syncShopifyFinance("shop", "owner", scope)).toEqual({ synced: 2, created: 0, updated: 2, errors: [] });
    expect(m.records.size).toBe(2);
    expect(m.records.get("sale")).toMatchObject({ amountMinor: "9007199254740993010", amountScale: 3, amount: null, feeType: "order_transaction" });
    expect(m.records.get("refund-tx")).toMatchObject({ amountMinor: "-250", amountScale: 2, feeType: "refund_transaction" });
    expect(m.upsert).toHaveBeenCalledTimes(4);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe(`https://fixture.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`);
    expect(init.headers["X-Shopify-Access-Token"]).toBe("synthetic-token");
    expect(JSON.parse(init.body)).toEqual({ query: FINANCE_ORDERS_QUERY, variables: { first: 50, after: null, query: 'updated_at:>="2026-10-01T00:00:00.000Z" updated_at:<="2026-10-02T00:00:00.000Z"' } });
    const selections: string[][] = [];
    visit(parse(JSON.parse(init.body).query), { Field(node) {
      if (node.name.value === "transactions") selections.push(node.selectionSet!.selections.map((field) => "name" in field ? field.name.value : ""));
    } });
    expect(selections).toEqual([["id", "kind", "status", "gateway", "createdAt", "processedAt", "amountSet"], ["nodes"]]);
  });

  it.each([{ nodes: [] }, { nodes: [{ id: "empty", updatedAt: date, transactions: [], refunds: [] }] }])("accepts empty finance lists without inventing records", async ({ nodes }) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response(page(nodes))));
    expect(await fetchAllFinanceOrders("fixture.myshopify.com", "synthetic-token")).toEqual(nodes);
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { orders: null }, page([null]),
    page([{ ...financeOrder(), transactions: { nodes: [sale] } }]),
    page([{ ...financeOrder(), transactions: null }]),
    page([{ ...financeOrder(), refunds: null }]),
    page([{ ...financeOrder(), transactions: [{ ...sale, amountSet: null }] }]),
    page([{ ...financeOrder(), transactions: [{ ...sale, amountSet: money(1 as unknown as string) }] }]),
    page([{ ...financeOrder(), refunds: [{ ...financeOrder().refunds[0]!, transactions: [] }] }]),
    { orders: { nodes: [], pageInfo: { hasNextPage: "false", endCursor: null } } },
  ])("rejects malformed wire data before ingestion and retains safe correlation (%#)", async (data) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init) =>
      JSON.parse(init.body).query.includes("GetFinanceOrders") ? response(data) : response({ shop: { name: "fixture" } })));
    await expect(syncShopifyFinance("shop", "owner")).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", providerRequestId: "fixture-request", retryable: true });
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
    expect(m.capability).toHaveBeenCalledWith(expect.objectContaining({ state: "failed" }));
  });

  it.each([null, "same"])("rejects missing/repeated finance cursors within two requests (%s)", async (cursor) => {
    const fetchMock = vi.fn().mockImplementation(async () => response(page([], true, cursor)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAllFinanceOrders("fixture.myshopify.com", "synthetic-token")).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

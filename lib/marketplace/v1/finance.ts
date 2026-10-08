import { z } from "zod";
import { prisma } from "@/prisma/client";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import { getMarketplaceReconciliationStatus } from "@/lib/marketplace/analytics/reconciliation-status";
import { getProfitDetail } from "@/lib/marketplace/analytics/profit-detail";
import { AnalyticsValidationError, parseAnalyticsDateRange } from "@/lib/marketplace/analytics/server";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";

const objectId = /^[a-f\d]{24}$/i;

export class MarketplaceFinanceValidationError extends Error {}
export class MarketplaceFinanceNotFoundError extends Error {}

type FinanceResource = "financial-records" | "reconciliation-status" | "profit";
type FinancialRecordsQuery = { shopId: string; limit: number; cursor?: string };
type ReconciliationStatusQuery = { shopId: string };
type ProfitQuery = { shopId?: string; dateFrom?: string; dateTo?: string };

const shopId = z.string().regex(objectId, "shopId must be an internal shop ID");
const financialRecordsSchema = z.object({
  shopId,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(2048).optional(),
}).strict();
const reconciliationStatusSchema = z.object({ shopId }).strict();
const profitSchema = z.object({
  shopId: shopId.optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

function duplicateQueryKey(params: URLSearchParams) {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

export function parseMarketplaceFinanceQuery(params: URLSearchParams, resource: FinanceResource) {
  const duplicate = duplicateQueryKey(params);
  if (duplicate) throw new MarketplaceFinanceValidationError(`Duplicate query parameter: ${duplicate}`);
  const parsed = (resource === "financial-records" ? financialRecordsSchema : resource === "reconciliation-status" ? reconciliationStatusSchema : profitSchema).safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new MarketplaceFinanceValidationError("Invalid query parameters");
  if (resource === "profit") {
    try {
      parseAnalyticsDateRange(params);
    } catch (error) {
      if (error instanceof AnalyticsValidationError) throw new MarketplaceFinanceValidationError(error.message);
      throw error;
    }
  }
  return parsed.data as FinancialRecordsQuery | ReconciliationStatusQuery | ProfitQuery;
}

function financialRecordsFilter(platform: MarketplacePlatform, query: FinancialRecordsQuery) {
  return JSON.stringify({ platform, shopId: query.shopId });
}

function encodeFinancialRecordsCursor(platform: MarketplacePlatform, query: FinancialRecordsQuery, id: string) {
  return Buffer.from(JSON.stringify({ v: 1, platform, filter: financialRecordsFilter(platform, query), id })).toString("base64url");
}

function decodeFinancialRecordsCursor(platform: MarketplacePlatform, query: FinancialRecordsQuery) {
  if (!query.cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
    if (value?.v !== 1 || value.platform !== platform || value.filter !== financialRecordsFilter(platform, query) || typeof value.id !== "string" || !objectId.test(value.id)) throw new Error();
    return value.id;
  } catch {
    throw new MarketplaceFinanceValidationError("Invalid cursor");
  }
}

/** Accept only the internal IDs published by v1 shop discovery. */
export async function assertMarketplaceFinanceShop(platform: MarketplacePlatform, user: Parameters<typeof accessibleMarketplaceShops>[0], shopId: string) {
  const shops = await accessibleMarketplaceShops(user, platform);
  if (!shops.some((shop) => shop.id === shopId)) throw new MarketplaceFinanceNotFoundError("Shop not found");
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

export async function listMarketplaceFinancialRecords(platform: MarketplacePlatform, query: FinancialRecordsQuery) {
  const cursor = decodeFinancialRecordsCursor(platform, query);
  const rows = await prisma.marketplaceFinancialRecord.findMany({
    where: { platform, shopId: query.shopId },
    orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: query.limit + 1,
    select: {
      id: true, shopId: true, externalId: true, statementExternalId: true, orderExternalId: true, orderInternalId: true, orderLinkState: true, itemExternalId: true,
      transactionType: true, feeType: true, feeName: true, amountMinor: true, amountScale: true, amount: true, currency: true,
      occurredAt: true, sourceObservedAt: true, financialQuality: true, unknownReason: true, createdAt: true, updatedAt: true,
    },
  });
  const data = rows.slice(0, query.limit).map((row) => ({
    ...row,
    occurredAt: iso(row.occurredAt),
    sourceObservedAt: iso(row.sourceObservedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
  return {
    data,
    page: {
      limit: query.limit,
      nextCursor: rows.length > query.limit && data.length ? encodeFinancialRecordsCursor(platform, query, data[data.length - 1]!.id) : null,
    },
  };
}

export async function getMarketplaceFinanceResult(
  platform: MarketplacePlatform,
  user: Parameters<typeof accessibleMarketplaceShops>[0],
  resource: FinanceResource,
  query: FinancialRecordsQuery | ReconciliationStatusQuery | ProfitQuery,
) {
  if (resource === "financial-records") return listMarketplaceFinancialRecords(platform, query as FinancialRecordsQuery);
  if (resource === "reconciliation-status") return getMarketplaceReconciliationStatus(platform, (query as ReconciliationStatusQuery).shopId);
  return getProfitDetail(platform, user, new URLSearchParams(query as Record<string, string>));
}

export type { FinanceResource };

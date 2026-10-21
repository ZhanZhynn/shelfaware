import { z } from "zod";
import { prisma } from "@/prisma/client";
import { accessibleMarketplaceShops } from "@/lib/marketplace/shops";
import { getMarketplaceReconciliationStatus } from "@/lib/marketplace/analytics/reconciliation-status";
import { getProfitDetail } from "@/lib/marketplace/analytics/profit-detail";
import { AnalyticsValidationError, parseAnalyticsDateRange } from "@/lib/marketplace/analytics/server";
import type { MarketplacePlatform } from "@/lib/marketplace/analytics/types";
import { andFinancialRecordWhere, financialQualityFilters, financialRecordWhere, hasOnlyLegacyFinanceDefaults, linkStateFilters, normalizedFinanceFilters, type FinanceFilters } from "@/lib/marketplace/finance-filter";

const objectId = /^[a-f\d]{24}$/i;

export class MarketplaceFinanceValidationError extends Error {}
export class MarketplaceFinanceNotFoundError extends Error {}

type FinanceResource = "financial-records" | "reconciliation-status" | "profit";
type FinancialRecordsQuery = { shopId: string; limit: number; cursor?: string } & FinanceFilters;
type ReconciliationStatusQuery = { shopId: string } & FinanceFilters;
type ProfitQuery = { shopId?: string; dateFrom?: string; dateTo?: string; dateBasis?: "order-created" | "occurred" | "released"; ledgerDateFrom?: string; ledgerDateTo?: string };

const shopId = z.string().regex(objectId, "shopId must be an internal shop ID");
const financialRecordsSchema = z.object({
  shopId,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(2048).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  dateBasis: z.enum(["occurred", "observed"]).default("occurred"),
  transactionType: z.string().min(1).max(128).optional(),
  financialQuality: z.enum(financialQualityFilters).optional(),
  linkState: z.enum(linkStateFilters).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, "currency must be an ISO 4217 alpha-3 code").optional(),
}).strict();
const reconciliationStatusSchema = financialRecordsSchema.omit({ limit: true, cursor: true });
const profitSchema = z.object({
  shopId: shopId.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  dateBasis: z.enum(["order-created", "occurred", "released"]).optional(),
  ledgerDateFrom: z.string().optional(),
  ledgerDateTo: z.string().optional(),
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
  if (resource === "profit" || resource === "financial-records" || resource === "reconciliation-status") {
    try {
      const dateRange = parseAnalyticsDateRange(params);
      if (resource === "profit") {
        const ledgerFrom = params.get("ledgerDateFrom"), ledgerTo = params.get("ledgerDateTo");
        if (Boolean(ledgerFrom) !== Boolean(ledgerTo)) throw new MarketplaceFinanceValidationError("ledgerDateFrom and ledgerDateTo must be provided together");
        if (ledgerFrom && ledgerTo) parseAnalyticsDateRange(new URLSearchParams({ dateFrom: ledgerFrom, dateTo: ledgerTo }));
      }
      if (resource !== "profit") return { ...parsed.data, dateRange } as FinancialRecordsQuery | ReconciliationStatusQuery;
    } catch (error) {
      if (error instanceof AnalyticsValidationError) throw new MarketplaceFinanceValidationError(error.message);
      throw error;
    }
  }
  return parsed.data as FinancialRecordsQuery | ReconciliationStatusQuery | ProfitQuery;
}

function financialRecordsFilter(platform: MarketplacePlatform, query: FinancialRecordsQuery) {
  return JSON.stringify({ platform, shopId: query.shopId, ...normalizedFinanceFilters(query) });
}

function encodeFinancialRecordsCursor(platform: MarketplacePlatform, query: FinancialRecordsQuery, id: string) {
  return Buffer.from(JSON.stringify({ v: 2, platform, filter: financialRecordsFilter(platform, query), id })).toString("base64url");
}

function decodeFinancialRecordsCursor(platform: MarketplacePlatform, query: FinancialRecordsQuery) {
  if (!query.cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
    const legacyFilter = JSON.stringify({ platform, shopId: query.shopId });
    const validV2 = value?.v === 2 && value.filter === financialRecordsFilter(platform, query);
    const validLegacyV1 = value?.v === 1 && hasOnlyLegacyFinanceDefaults(query) && value.filter === legacyFilter;
    if ((!validV2 && !validLegacyV1) || value.platform !== platform || typeof value.id !== "string" || !objectId.test(value.id)) throw new Error();
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

export async function getMarketplaceFinancialCoverage(platform: MarketplacePlatform, shopId: string, filters: FinanceFilters = { dateBasis: "occurred" }) {
  const where = financialRecordWhere(platform, shopId, filters);
  const certifiedQuality = ["verified", "derived"];
  const [totalRecords, usableRecords, numericAmountRecords, verifiedRecords, latestObservedAt] = await Promise.all([
    prisma.marketplaceFinancialRecord.count({ where }),
    // Kept for existing clients: this is fixed-point-minor coverage only.
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(where, { amountMinor: { not: null } }) }),
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(where, { OR: [{ amountMinor: { not: null } }, { amount: { not: null } }] }) }),
    prisma.marketplaceFinancialRecord.count({ where: andFinancialRecordWhere(where, { financialQuality: { in: certifiedQuality } }) }),
    prisma.marketplaceFinancialRecord.aggregate({ where, _max: { sourceObservedAt: true } }),
  ]);
  const missingAmountRecords = totalRecords - numericAmountRecords;
  // Missing and unset quality values are unverified too, so derive this from the complete scope.
  const unverifiedRecords = totalRecords - verifiedRecords;
  const warnings = [
    ...(unverifiedRecords > 0 ? ["Some matching records are not verified financial values."] : []),
    ...(missingAmountRecords > 0 ? ["Some matching records have no numeric amount."] : []),
  ];
  return {
    state: numericAmountRecords > 0 ? (missingAmountRecords === 0 && unverifiedRecords === 0 ? "complete" : "partial") : "unavailable",
    totalRecords,
    usableRecords,
    verifiedRecords,
    excludedUnknownRecords: totalRecords - usableRecords,
    numericAmountRecords,
    missingAmountRecords,
    unverifiedRecords,
    latestObservedAt: iso(latestObservedAt._max.sourceObservedAt),
    reason: numericAmountRecords > 0 ? null : "No matching financial records contain a numeric amount.",
    warnings,
  };
}

export async function listMarketplaceFinancialRecords(platform: MarketplacePlatform, query: FinancialRecordsQuery) {
  const cursor = decodeFinancialRecordsCursor(platform, query);
  const rows = await prisma.marketplaceFinancialRecord.findMany({
    where: financialRecordWhere(platform, query.shopId, query),
    orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: query.limit + 1,
    select: {
      id: true, shopId: true, externalId: true, statementExternalId: true, orderExternalId: true, orderInternalId: true, orderLinkState: true, itemExternalId: true,
      transactionType: true, feeType: true, feeName: true, amountMinor: true, amountScale: true, amount: true, currency: true,
      occurredAt: true, sourceObservedAt: true, financialQuality: true, unknownReason: true, createdAt: true, updatedAt: true, rawPayload: true,
    },
  });
  const data = rows.slice(0, query.limit).map(({ rawPayload, ...row }) => {
    const source = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload) ? rawPayload as Record<string, unknown> : {};
    const paid = typeof source.paid_status === "string" ? source.paid_status.trim().toLowerCase() : "";
    const itemLinkBasis = typeof source.shelfaware_item_link_basis === "string" && ["provider_orderItem_no", "provider_reference", "provider_transaction_number", "unverified_provider_orderItem_no", "unavailable"].includes(source.shelfaware_item_link_basis)
      ? source.shelfaware_item_link_basis : row.itemExternalId ? "unverified_provider_orderItem_no" : "unavailable";
    const sourceTransactionNumber = typeof source.transaction_number === "string" ? source.transaction_number
      : typeof source.transaction_number === "number" && Number.isSafeInteger(source.transaction_number) ? String(source.transaction_number) : null;
    return {
      ...row,
      // Preserve the documented Yes/No fact without equating it to a verified
      // release-to-balance event or a bank withdrawal.
      ...(platform === "lazada" ? { sourceTransactionNumber, itemLinkBasis, providerPaidStatus: paid === "yes" ? "Yes" : paid === "no" ? "No" : null, releaseStatus: null, releasedAt: null, releaseDateState: "unavailable" } : {}),
      occurredAt: iso(row.occurredAt),
      sourceObservedAt: iso(row.sourceObservedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  return {
    data,
    page: {
      limit: query.limit,
      nextCursor: rows.length > query.limit && data.length ? encodeFinancialRecordsCursor(platform, query, data[data.length - 1]!.id) : null,
    },
    coverage: await getMarketplaceFinancialCoverage(platform, query.shopId, query),
  };
}

export async function getMarketplaceFinanceResult(
  platform: MarketplacePlatform,
  user: Parameters<typeof accessibleMarketplaceShops>[0],
  resource: FinanceResource,
  query: FinancialRecordsQuery | ReconciliationStatusQuery | ProfitQuery,
) {
  if (resource === "financial-records") return listMarketplaceFinancialRecords(platform, query as FinancialRecordsQuery);
  if (resource === "reconciliation-status") return getMarketplaceReconciliationStatus(platform, (query as ReconciliationStatusQuery).shopId, new Date(), query as ReconciliationStatusQuery);
  const profitQuery = query as ProfitQuery;
  if (profitQuery.dateBasis && platform !== "lazada") throw new MarketplaceFinanceValidationError("Profit dateBasis is currently supported only for Lazada");
  try {
    return await getProfitDetail(platform, user, new URLSearchParams(query as Record<string, string>));
  } catch (error) {
    if (error instanceof AnalyticsValidationError) throw new MarketplaceFinanceValidationError(error.message);
    throw error;
  }
}

export type { FinanceResource };

import type { MarketplacePlatform } from "./analytics/types";

export const financialQualityFilters = ["unknown", "verified", "derived", "legacy-unverified"] as const;
export const linkStateFilters = ["linked", "unmatched", "not_applicable", "unclassified"] as const;

export type FinancialQualityFilter = (typeof financialQualityFilters)[number];
export type LinkStateFilter = (typeof linkStateFilters)[number];
export type FinanceDateBasis = "occurred" | "observed";

export type FinanceFilters = {
  dateFrom?: string;
  dateTo?: string;
  dateBasis?: FinanceDateBasis;
  dateRange?: { gte?: Date; lte?: Date };
  transactionType?: string;
  financialQuality?: FinancialQualityFilter;
  linkState?: LinkStateFilter;
  currency?: string;
};

/** Builds the same persisted-record scope for list, coverage, and status responses. */
export function financialRecordWhere(platform: MarketplacePlatform, shopId: string, filters: FinanceFilters) {
  const dateField = filters.dateBasis === "observed" ? "sourceObservedAt" : "occurredAt";
  return {
    platform,
    shopId,
    ...(filters.dateRange ? { [dateField]: filters.dateRange } : {}),
    ...(filters.transactionType ? { transactionType: filters.transactionType } : {}),
    ...(filters.financialQuality ? { financialQuality: filters.financialQuality } : {}),
    ...(filters.currency ? { currency: filters.currency } : {}),
    ...(filters.linkState === "unclassified"
      ? { OR: [{ orderLinkState: null }, { orderLinkState: { isSet: false } }] }
      : filters.linkState === "linked"
        ? { orderLinkState: "linked", orderInternalId: { not: null, isSet: true } }
      : filters.linkState ? { orderLinkState: filters.linkState } : {}),
  };
}

export function normalizedFinanceFilters(filters: FinanceFilters) {
  return {
    dateBasis: filters.dateBasis ?? "occurred",
    dateFrom: filters.dateRange?.gte?.toISOString() ?? null,
    dateTo: filters.dateRange?.lte?.toISOString() ?? null,
    transactionType: filters.transactionType ?? null,
    financialQuality: filters.financialQuality ?? null,
    linkState: filters.linkState ?? null,
    currency: filters.currency ?? null,
  };
}

/** Keeps an additional condition from replacing an OR introduced by unclassified links. */
export function andFinancialRecordWhere(where: ReturnType<typeof financialRecordWhere>, condition: Record<string, unknown>) {
  return { AND: [where, condition] };
}

export function hasOnlyLegacyFinanceDefaults(filters: FinanceFilters) {
  return (filters.dateBasis ?? "occurred") === "occurred" && !filters.dateRange && !filters.transactionType && !filters.financialQuality && !filters.linkState && !filters.currency;
}

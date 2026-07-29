import prisma from "@/prisma/client";
import { DEFAULT_CURRENCY, convertMoney } from "@/lib/money";
import type { HistoricalRateSelection } from "@/lib/exchange-rates/service";
import type { AdminDataScope } from "@/lib/admin/data-scope";

export type FinancialCurrencyMetadata = {
  baseCurrency: string;
  policy: string;
  exchangeRates: Record<string, number>;
  excludedCurrencies: string[];
  historicalRateFallbacks: Record<string, HistoricalRateSelection>;
};

export type UnknownCurrencyRecord = {
  source: "Shopee order" | "Shopee return" | "Lazada order";
  recordId: string;
  reference: string;
  amount: number;
  occurredAt: string | null;
};

export type UnknownCurrencyReconciliation = {
  records: UnknownCurrencyRecord[];
  totalRecords: number;
  truncated: boolean;
};

const POLICY = "Amounts are reported in the workspace base currency. Legacy WMS amounts without a currency use the base currency. Marketplace amounts use the latest persisted rate on or before the record date; records before the earliest observation use that earliest later rate. Missing or unsupported currencies are excluded and listed here.";

function normalizeCurrency(currency: string | null | undefined): string | null {
  const normalized = currency?.trim().toUpperCase();
  return normalized || null;
}

function isSameUtcDay(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

export function hasUnknownCurrency(currency: string | null | undefined): boolean {
  return normalizeCurrency(currency) === null;
}

export function createFinancialCurrencyConverter(
  baseCurrency: string,
  rates: Iterable<{ baseCurrency: string; rate: number; rateDate?: Date }>,
) {
  const normalizedBaseCurrency = normalizeCurrency(baseCurrency) ?? DEFAULT_CURRENCY;
  const ratesByCurrency = new Map<string, { rate: number; rateDate: Date }[]>();
  for (const rate of rates) {
    const currency = normalizeCurrency(rate.baseCurrency);
    if (!currency) continue;
    const entries = ratesByCurrency.get(currency) ?? [];
    entries.push({ rate: rate.rate, rateDate: rate.rateDate ?? new Date(0) });
    ratesByCurrency.set(currency, entries);
  }
  for (const entries of ratesByCurrency.values()) {
    entries.sort((a, b) => a.rateDate.getTime() - b.rateDate.getTime());
  }
  const usedRates = new Map<string, number>();
  const excludedCurrencies = new Set<string>();
  const historicalRateFallbacks = new Map<string, HistoricalRateSelection>();

  function selectRate(currency: string, occurredAt?: Date | null) {
    const entries = ratesByCurrency.get(currency);
    if (!entries?.length) return null;
    if (!occurredAt) return { ...entries[entries.length - 1]!, selection: "prior" as const };
    const matching = entries.filter((entry) => entry.rateDate <= occurredAt);
    if (matching.length > 0) {
      const selected = matching[matching.length - 1]!;
      return {
        ...selected,
        selection: isSameUtcDay(selected.rateDate, occurredAt) ? "exact" as const : "prior" as const,
      };
    }
    return { ...entries[0]!, selection: "future" as const };
  }

  return {
    baseCurrency: normalizedBaseCurrency,
    convert(amount: number, currency: string | null | undefined, legacyBaseCurrency = false, occurredAt?: Date | null): number | null {
      const sourceCurrency = normalizeCurrency(currency) ?? (legacyBaseCurrency ? normalizedBaseCurrency : null);
      if (!sourceCurrency) {
        excludedCurrencies.add("UNKNOWN");
        return null;
      }
      if (sourceCurrency === normalizedBaseCurrency) return amount;
      const selected = selectRate(sourceCurrency, occurredAt);
      if (!selected) {
        excludedCurrencies.add(sourceCurrency);
        return null;
      }
      usedRates.set(sourceCurrency, selected.rate);
      historicalRateFallbacks.set(sourceCurrency, selected.selection);
      return convertMoney(amount, selected.rate);
    },
    metadata(): FinancialCurrencyMetadata {
      return {
        baseCurrency: normalizedBaseCurrency,
        policy: POLICY,
        exchangeRates: Object.fromEntries(usedRates),
        excludedCurrencies: [...excludedCurrencies].sort(),
        historicalRateFallbacks: Object.fromEntries(historicalRateFallbacks),
      };
    },
  };
}

export async function getFinancialCurrencyContext(userId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { ownerId: userId },
    select: { baseCurrency: true },
  }) ?? await prisma.workspace.findFirst({
    where: { members: { some: { userId } } },
    select: { baseCurrency: true },
  });
  const baseCurrency = normalizeCurrency(workspace?.baseCurrency) ?? DEFAULT_CURRENCY;
  const rates = await prisma.exchangeRate.findMany({
    where: { quoteCurrency: baseCurrency },
    select: { baseCurrency: true, rate: true, rateDate: true },
    orderBy: { rateDate: "asc" },
  });
  return createFinancialCurrencyConverter(baseCurrency, rates);
}

/** Records omitted from marketplace aggregates because the upstream currency was absent. */
export async function getUnknownCurrencyReconciliation(
  userId: string,
  limit = 100,
  dataScope?: Pick<AdminDataScope, "ownerIds">,
): Promise<UnknownCurrencyReconciliation> {
  const cappedLimit = Math.min(Math.max(limit, 1), 250);
  const unknownCurrency = { OR: [{ currency: null }, { currency: "" }] };
  const ownerScope = { in: dataScope?.ownerIds ?? [userId] };
  const [shopeeOrders, shopeeReturns, lazadaOrders, shopeeOrderCount, shopeeReturnCount, lazadaOrderCount] = await Promise.all([
    prisma.shopeeOrder.findMany({
      where: { userId: ownerScope, ...unknownCurrency },
      select: { id: true, shopeeOrderId: true, totalAmount: true, shopeeCreatedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: cappedLimit + 1,
    }),
    prisma.shopeeReturn.findMany({
      where: { userId: ownerScope, ...unknownCurrency },
      select: { id: true, returnSn: true, refundAmount: true, shopeeCreatedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: cappedLimit + 1,
    }),
    prisma.lazadaOrder.findMany({
      where: { userId: ownerScope, ...unknownCurrency },
      select: { id: true, lazadaOrderId: true, totalAmount: true, lazadaCreatedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: cappedLimit + 1,
    }),
    prisma.shopeeOrder.count({ where: { userId: ownerScope, ...unknownCurrency } }),
    prisma.shopeeReturn.count({ where: { userId: ownerScope, ...unknownCurrency } }),
    prisma.lazadaOrder.count({ where: { userId: ownerScope, ...unknownCurrency } }),
  ]);

  const records: UnknownCurrencyRecord[] = [
    ...shopeeOrders.map((record) => ({
      source: "Shopee order" as const,
      recordId: record.id,
      reference: record.shopeeOrderId,
      amount: record.totalAmount,
      occurredAt: (record.shopeeCreatedAt ?? record.createdAt).toISOString(),
    })),
    ...shopeeReturns.map((record) => ({
      source: "Shopee return" as const,
      recordId: record.id,
      reference: record.returnSn,
      amount: record.refundAmount,
      occurredAt: (record.shopeeCreatedAt ?? record.createdAt).toISOString(),
    })),
    ...lazadaOrders.map((record) => ({
      source: "Lazada order" as const,
      recordId: record.id,
      reference: record.lazadaOrderId,
      amount: record.totalAmount,
      occurredAt: (record.lazadaCreatedAt ?? record.createdAt).toISOString(),
    })),
  ].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));

  return {
    records: records.slice(0, cappedLimit),
    totalRecords: shopeeOrderCount + shopeeReturnCount + lazadaOrderCount,
    truncated: records.length > cappedLimit,
  };
}

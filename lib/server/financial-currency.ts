import prisma from "@/prisma/client";
import { DEFAULT_CURRENCY, convertMoney } from "@/lib/money";

export type FinancialCurrencyMetadata = {
  baseCurrency: string;
  policy: string;
  exchangeRates: Record<string, number>;
  excludedCurrencies: string[];
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

const POLICY = "Amounts are reported in the workspace base currency. Legacy WMS amounts without a currency use the base currency. Marketplace amounts are converted only when a persisted direct rate to the base currency exists; missing or unsupported currencies are excluded and listed here.";

function normalizeCurrency(currency: string | null | undefined): string | null {
  const normalized = currency?.trim().toUpperCase();
  return normalized || null;
}

export function hasUnknownCurrency(currency: string | null | undefined): boolean {
  return normalizeCurrency(currency) === null;
}

export function createFinancialCurrencyConverter(
  baseCurrency: string,
  rates: Iterable<{ baseCurrency: string; rate: number }>,
) {
  const normalizedBaseCurrency = normalizeCurrency(baseCurrency) ?? DEFAULT_CURRENCY;
  const rateByCurrency = new Map(
    [...rates].map((rate) => [normalizeCurrency(rate.baseCurrency)!, rate.rate]),
  );
  const usedRates = new Map<string, number>();
  const excludedCurrencies = new Set<string>();

  return {
    baseCurrency: normalizedBaseCurrency,
    convert(amount: number, currency: string | null | undefined, legacyBaseCurrency = false): number | null {
      const sourceCurrency = normalizeCurrency(currency) ?? (legacyBaseCurrency ? normalizedBaseCurrency : null);
      if (!sourceCurrency) {
        excludedCurrencies.add("UNKNOWN");
        return null;
      }
      if (sourceCurrency === normalizedBaseCurrency) return amount;
      const rate = rateByCurrency.get(sourceCurrency);
      if (!rate) {
        excludedCurrencies.add(sourceCurrency);
        return null;
      }
      usedRates.set(sourceCurrency, rate);
      return convertMoney(amount, rate);
    },
    metadata(): FinancialCurrencyMetadata {
      return {
        baseCurrency: normalizedBaseCurrency,
        policy: POLICY,
        exchangeRates: Object.fromEntries(usedRates),
        excludedCurrencies: [...excludedCurrencies].sort(),
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
    select: { baseCurrency: true, rate: true },
  });
  return createFinancialCurrencyConverter(baseCurrency, rates);
}

/** Records omitted from marketplace aggregates because the upstream currency was absent. */
export async function getUnknownCurrencyReconciliation(
  userId: string,
  limit = 100,
): Promise<UnknownCurrencyReconciliation> {
  const cappedLimit = Math.min(Math.max(limit, 1), 250);
  const unknownCurrency = { OR: [{ currency: null }, { currency: "" }] };
  const [shopeeOrders, shopeeReturns, lazadaOrders, shopeeOrderCount, shopeeReturnCount, lazadaOrderCount] = await Promise.all([
    prisma.shopeeOrder.findMany({
      where: { userId, ...unknownCurrency },
      select: { id: true, shopeeOrderId: true, totalAmount: true, shopeeCreatedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: cappedLimit + 1,
    }),
    prisma.shopeeReturn.findMany({
      where: { userId, ...unknownCurrency },
      select: { id: true, returnSn: true, refundAmount: true, shopeeCreatedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: cappedLimit + 1,
    }),
    prisma.lazadaOrder.findMany({
      where: { userId, ...unknownCurrency },
      select: { id: true, lazadaOrderId: true, totalAmount: true, lazadaCreatedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: cappedLimit + 1,
    }),
    prisma.shopeeOrder.count({ where: { userId, ...unknownCurrency } }),
    prisma.shopeeReturn.count({ where: { userId, ...unknownCurrency } }),
    prisma.lazadaOrder.count({ where: { userId, ...unknownCurrency } }),
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

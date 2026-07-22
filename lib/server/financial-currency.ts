import prisma from "@/prisma/client";
import { DEFAULT_CURRENCY, convertMoney } from "@/lib/money";

export type FinancialCurrencyMetadata = {
  baseCurrency: string;
  policy: string;
  exchangeRates: Record<string, number>;
  excludedCurrencies: string[];
};

const POLICY = "Amounts are reported in the workspace base currency. Legacy WMS amounts without a currency use the base currency. Marketplace amounts are converted only when a persisted direct rate to the base currency exists; missing or unsupported currencies are excluded and listed here.";

function normalizeCurrency(currency: string | null | undefined): string | null {
  const normalized = currency?.trim().toUpperCase();
  return normalized || null;
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

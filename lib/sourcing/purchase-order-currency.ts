import { convertMoney } from "@/lib/money";

type PurchaseOrderCurrencyInput = {
  currency?: string | null;
  totalAmount: number;
  convertedTotalMyr?: number | null;
  fxRate?: number | null;
  fxRateDate?: Date | string | null;
  fxProvider?: string | null;
};

type CurrentRate = {
  rate: number;
  rateDate: Date;
  provider: string;
} | null;

/** Adds a display-only MYR estimate without changing the supplier PO currency. */
export function sourcingPurchaseOrderEstimate(
  po: PurchaseOrderCurrencyInput,
  currentCnyMyrRate: CurrentRate,
) {
  const currency = po.currency || "MYR";
  if (currency === "MYR") return { currency };

  if (currency !== "CNY") return { currency };

  if (po.fxRate && po.convertedTotalMyr != null) {
    return {
      currency,
      myrEstimate: po.convertedTotalMyr,
      estimateKind: "locked" as const,
      estimateRate: po.fxRate,
      estimateRateDate: po.fxRateDate ?? null,
      estimateProvider: po.fxProvider ?? null,
    };
  }

  if (!currentCnyMyrRate) return { currency };
  return {
    currency,
    myrEstimate: convertMoney(po.totalAmount, currentCnyMyrRate.rate),
    estimateKind: "current" as const,
    estimateRate: currentCnyMyrRate.rate,
    estimateRateDate: currentCnyMyrRate.rateDate,
    estimateProvider: currentCnyMyrRate.provider,
  };
}

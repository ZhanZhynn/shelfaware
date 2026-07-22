export const DEFAULT_CURRENCY = "MYR";
export const DEFAULT_LOCALE = "en-MY";

const currencyLocales: Record<string, string> = {
  CNY: "zh-CN",
  MYR: DEFAULT_LOCALE,
  USD: "en-US",
};

/** Formats an amount with an explicit currency; amounts must never inherit a symbol. */
export function formatMoney(
  amount: number | null | undefined,
  currency = DEFAULT_CURRENCY,
  locale = currencyLocales[currency] ?? DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount ?? 0);
}

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function convertMoney(amount: number, rate: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("A positive exchange rate is required");
  }
  return roundMoney(amount * rate);
}

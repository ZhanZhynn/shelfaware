export const DEFAULT_CURRENCY = "MYR";
export const DEFAULT_LOCALE = "en-MY";
export const TRANSACTION_CURRENCIES = ["MYR", "USD", "CNY"] as const;
export type TransactionCurrency = (typeof TRANSACTION_CURRENCIES)[number];

const currencyLocales: Record<string, string> = {
  CNY: "zh-CN",
  MYR: DEFAULT_LOCALE,
  USD: "en-US",
};

const stripeCurrencyExponents: Record<TransactionCurrency, number> = {
  MYR: 2,
  USD: 2,
  CNY: 2,
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

/** Keeps legacy records without a currency in the MYR transaction currency. */
export function resolveTransactionCurrency(
  currency: string | null | undefined,
): TransactionCurrency {
  return TRANSACTION_CURRENCIES.includes(currency as TransactionCurrency)
    ? (currency as TransactionCurrency)
    : DEFAULT_CURRENCY;
}

/** Stripe amounts are integers in the currency's minor unit. */
export function toStripeMinorUnits(amount: number, currency: string): number {
  const normalizedCurrency = resolveTransactionCurrency(currency);
  const exponent = stripeCurrencyExponents[normalizedCurrency];
  const factor = 10 ** exponent;
  return Math.round((amount + Number.EPSILON) * factor);
}

export function fromStripeMinorUnits(amount: number, currency: string): number {
  const normalizedCurrency = resolveTransactionCurrency(currency);
  const exponent = stripeCurrencyExponents[normalizedCurrency];
  return amount / 10 ** exponent;
}

export function convertMoney(amount: number, rate: number, scale?: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("A positive exchange rate is required");
  }
  const s = scale ?? 2;
  const factor = 10 ** s;
  return Math.round((amount * rate + Number.EPSILON) * factor) / factor;
}

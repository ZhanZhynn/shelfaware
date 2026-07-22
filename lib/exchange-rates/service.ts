import { prisma } from "@/prisma/client";

const FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rate";
const MAX_RATE_AGE_MS = 48 * 60 * 60 * 1000;

export type ExchangeRate = {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  provider: string;
  rateDate: Date;
  fetchedAt: Date;
};

function asRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Exchange-rate provider returned an invalid rate");
  }
  return value;
}

export async function refreshExchangeRate(
  baseCurrency = "CNY",
  quoteCurrency = "MYR",
): Promise<ExchangeRate> {
  const response = await fetch(
    `${FRANKFURTER_URL}/${baseCurrency}/${quoteCurrency}`,
    { next: { revalidate: 0 }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`Exchange-rate refresh failed (${response.status})`);
  const payload = await response.json();
  const rate = asRate(payload.rate);
  const rateDate = payload.date ? new Date(payload.date) : new Date();
  if (Number.isNaN(rateDate.getTime())) throw new Error("Exchange-rate provider returned an invalid date");
  const fetchedAt = new Date();
  const saved = await prisma.exchangeRate.upsert({
    where: { baseCurrency_quoteCurrency: { baseCurrency, quoteCurrency } },
    create: { baseCurrency, quoteCurrency, rate, provider: "frankfurter", rateDate, fetchedAt },
    update: { rate, provider: "frankfurter", rateDate, fetchedAt },
  });
  return saved;
}

export async function getCurrentExchangeRate(
  baseCurrency = "CNY",
  quoteCurrency = "MYR",
): Promise<ExchangeRate | null> {
  const saved = await prisma.exchangeRate.findUnique({
    where: { baseCurrency_quoteCurrency: { baseCurrency, quoteCurrency } },
  });
  if (!saved) return null;
  return saved;
}

export function isExchangeRateFresh(rate: Pick<ExchangeRate, "fetchedAt">): boolean {
  return Date.now() - rate.fetchedAt.getTime() <= MAX_RATE_AGE_MS;
}

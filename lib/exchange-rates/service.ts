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

export type HistoricalRateSelection = "exact" | "prior" | "future";

export type SelectedExchangeRate = ExchangeRate & {
  selection: HistoricalRateSelection;
};

function isSameUtcDay(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

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
    where: { baseCurrency_quoteCurrency_rateDate: { baseCurrency, quoteCurrency, rateDate } },
    create: { baseCurrency, quoteCurrency, rate, provider: "frankfurter", rateDate, fetchedAt },
    update: { rate, provider: "frankfurter", rateDate, fetchedAt },
  });
  return saved;
}

export async function getCurrentExchangeRate(
  baseCurrency = "CNY",
  quoteCurrency = "MYR",
): Promise<ExchangeRate | null> {
  const saved = await prisma.exchangeRate.findFirst({
    where: { baseCurrency, quoteCurrency },
    orderBy: [{ rateDate: "desc" }, { fetchedAt: "desc" }],
  });
  if (!saved) return null;
  return saved;
}

/**
 * Selects the exact historical rate when available, otherwise the latest rate
 * known on or before the requested date. For dates before collection began,
 * use the earliest later observation rather than silently using today's rate.
 */
export async function getExchangeRateForDate(
  baseCurrency: string,
  quoteCurrency: string,
  date: Date,
): Promise<SelectedExchangeRate | null> {
  const prior = await prisma.exchangeRate.findFirst({
    where: { baseCurrency, quoteCurrency, rateDate: { lte: date } },
    orderBy: [{ rateDate: "desc" }, { fetchedAt: "desc" }],
  });
  if (prior) {
    return {
      ...prior,
      selection: isSameUtcDay(prior.rateDate, date) ? "exact" : "prior",
    };
  }

  const future = await prisma.exchangeRate.findFirst({
    where: { baseCurrency, quoteCurrency, rateDate: { gt: date } },
    orderBy: [{ rateDate: "asc" }, { fetchedAt: "asc" }],
  });
  return future ? { ...future, selection: "future" } : null;
}

export function isExchangeRateFresh(rate: Pick<ExchangeRate, "fetchedAt">): boolean {
  return Date.now() - rate.fetchedAt.getTime() <= MAX_RATE_AGE_MS;
}

export async function getOrRefreshExchangeRate(
  baseCurrency = "CNY",
  quoteCurrency = "MYR",
): Promise<ExchangeRate | null> {
  const saved = await getCurrentExchangeRate(baseCurrency, quoteCurrency);
  if (saved && isExchangeRateFresh(saved)) return saved;
  try {
    return await refreshExchangeRate(baseCurrency, quoteCurrency);
  } catch {
    return saved;
  }
}

export async function ensureExchangeRateForDate(
  baseCurrency: string,
  quoteCurrency: string,
  date: Date,
): Promise<SelectedExchangeRate | null> {
  const existing = await getExchangeRateForDate(baseCurrency, quoteCurrency, date);
  if (existing) return existing;
  try {
    await refreshExchangeRate(baseCurrency, quoteCurrency);
  } catch {
    // Refresh failed; no rate available.
  }
  return getExchangeRateForDate(baseCurrency, quoteCurrency, date);
}

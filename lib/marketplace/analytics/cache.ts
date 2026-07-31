import { createHash } from "crypto";
import type { MarketplacePlatform } from "./types";

export const ANALYTICS_API_VERSION = "2026-analytics-v1";

export function marketplaceAnalyticsCacheKey(input: {
  platform: MarketplacePlatform;
  accessScope: string;
  shopIds: string[];
  metric: string;
  dateFrom: string;
  dateTo: string;
  currency: string;
  granularity: string;
  cursor: string;
  limit: number;
}) {
  const shopSet = [...new Set(input.shopIds)].sort().join(",");
  const shopSetHash = createHash("sha256").update(shopSet).digest("hex").slice(0, 16);
  return ["marketplace-analytics", ANALYTICS_API_VERSION, "v3-provenance", input.platform, input.accessScope, shopSetHash, input.metric, input.dateFrom, input.dateTo, input.currency, input.granularity, input.cursor, input.limit].join(":");
}

import type { MarketplacePlatform } from "./analytics/types";
import type { MarketplaceSyncType } from "./sync-jobs";

type SyncTask = { stream: string; required: boolean };

export const shopeeAllTaskGraph = [
  { stream: "orders_and_escrow", required: true },
  { stream: "products", required: true },
  { stream: "ads", required: false },
  { stream: "reviews", required: false },
] as const;

const catalogTaskGraph = [
  { stream: "orders", required: true },
  { stream: "products", required: true },
  { stream: "finance", required: true },
] as const;

export const marketplaceSyncTypesByPlatform: Record<MarketplacePlatform, readonly MarketplaceSyncType[]> = {
  shopee: ["products", "orders", "finance", "returns", "ads", "payouts", "reviews", "all"],
  lazada: ["products", "orders", "finance", "payouts", "all"],
  tiktok: ["products", "orders", "finance", "payouts", "all"],
  shopify: ["products", "orders", "finance", "all"],
};

export function supportsMarketplaceSync(platform: MarketplacePlatform, syncType: string) {
  return marketplaceSyncTypesByPlatform[platform]?.some((stream) => stream === syncType) ?? false;
}

export function supportsMarketplaceSyncRange(platform: MarketplacePlatform, syncType: string) {
  return supportsMarketplaceSync(platform, syncType)
    && (["orders", "finance", "all"].includes(syncType) || (syncType === "ads" && platform === "shopee")
      || (syncType === "returns" && platform === "shopee")
      || (syncType === "payouts" && ["shopee", "lazada"].includes(platform)));
}

/** All platforms use the same durable task/lease/checkpoint/outbox machinery. */
export function marketplaceSyncTaskGraph(platform: MarketplacePlatform, syncType: string): readonly SyncTask[] {
  if (!supportsMarketplaceSync(platform, syncType)) return [];
  if (syncType === "all") {
    if (platform === "shopee") return shopeeAllTaskGraph;
    return catalogTaskGraph;
  }
  // TikTok finance is per-order: discover the requested order cohort first,
  // rather than treating an incomplete local order history as complete finance.
  if (platform === "tiktok" && syncType === "finance") return [{ stream: "orders", required: true }, { stream: "finance", required: true }];
  const stream = platform === "shopee" && ["orders", "finance"].includes(syncType) ? "orders_and_escrow" : syncType;
  return [{ stream, required: true }];
}

/**
 * Marketplace cross-cutting types.
 * Shared across Shopee, Lazada, and future marketplace integrations.
 */

/** Discriminated source for combined orders / business insights */
export type MarketSource = "wms" | "shopee" | "lazada" | "tiktok" | "shopify";

/** Channel identifier used in ProductChannelMapping and SyncLog */
export type MarketplaceChannel = "shopee" | "lazada" | "tiktok" | "shopify";

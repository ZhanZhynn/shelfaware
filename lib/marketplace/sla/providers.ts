import { prisma } from "@/prisma/client";
import { getTransientShopeeSDK } from "@/lib/shopee/server";
import { createLazadaShopContext } from "@/lib/lazada/server";
import { getMultipleOrderItemsCustom, getOrdersPageCustom } from "@/lib/lazada/custom-api";
import { getOrderDetail, searchOrders } from "@/lib/tiktok/custom-api";
import { SlaError, slaId, type SlaPlatform, type SlaUnit } from "./domain";
import { normalizeLazadaSla, normalizeShopeeSla, normalizeTikTokSla } from "./normalize";
import { getShopeeSlaPackages, searchShopeeSlaPackages } from "./shopee-contract";

export type DiscoveryCursor = { queue: number; cursor: string; seen: string[] };
export type SlaProviderPage = { units: SlaUnit[]; completeOrderIds: string[]; next: DiscoveryCursor | null; limited: boolean };
export type SlaRecheck = { orderExternalId: string; packageExternalId: string | null };
export type SlaProvider = {
  userId: string;
  timezone: string | null;
  discover(cursor: DiscoveryCursor): Promise<SlaProviderPage>;
  recheck(units: SlaRecheck[]): Promise<Omit<SlaProviderPage, "next" | "limited">>;
};

const regionZones: Record<string, string> = { MY: "Asia/Kuala_Lumpur", SG: "Asia/Singapore", PH: "Asia/Manila", TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh", TW: "Asia/Taipei", GB: "Europe/London" };
export const slaShopTimezone = (region: unknown) => typeof region === "string" ? regionZones[region.toUpperCase()] ?? null : null;
const lazadaStatuses = ["pending", "topack", "toship", "ready_to_ship", "shipping"];
const tiktokStatuses = ["ON_HOLD", "AWAITING_SHIPMENT", "PARTIALLY_SHIPPING", "AWAITING_COLLECTION"] as const;

function advance(current: DiscoveryCursor, more: boolean, token: string, queues: number): DiscoveryCursor | null {
  if (!more) return current.queue + 1 < queues ? { queue: current.queue + 1, cursor: "", seen: [] } : null;
  if (!token || token.length > 2048 || token === current.cursor || current.seen.includes(token) || current.seen.length >= 200) throw new SlaError("SLA_PAGINATION_STALLED", "Fulfillment pagination repeated or exceeded its bound", 502);
  return { queue: current.queue, cursor: token, seen: [...current.seen, current.cursor] };
}

export async function slaOwnedShop(platform: SlaPlatform, shopId: string, ownerIds: string[]) {
  const where = { id: shopId, userId: { in: ownerIds } };
  const shop = platform === "shopee" ? await prisma.shopeeShop.findFirst({ where }) : platform === "lazada" ? await prisma.lazadaShop.findFirst({ where }) : await prisma.tikTokShop.findFirst({ where });
  if (!shop) throw new SlaError("NOT_FOUND", "Shop not found", 404);
  return shop;
}

/** Credentials stay inside an explicitly authorized, per-shop provider closure. */
export async function createSlaProvider(platform: SlaPlatform, shopId: string, ownerIds: string[]): Promise<SlaProvider> {
  if (platform === "shopee") {
    const shop = await prisma.shopeeShop.findFirst({ where: { id: shopId, userId: { in: ownerIds } } });
    if (!shop) throw new SlaError("NOT_FOUND", "Shop not found", 404);
    if (shop.tokenExpiry && shop.tokenExpiry.getTime() <= Date.now()) throw new SlaError("SLA_PROVIDER_AUTH_REQUIRED", "Reconnect the Shopee shop before refreshing fulfillment data", 403);
    const sdk = getTransientShopeeSDK(shop.shopId, { access_token: shop.accessToken, refresh_token: shop.refreshToken, expire_in: shop.tokenExpiry ? Math.max(0, Math.floor((shop.tokenExpiry.getTime() - Date.now()) / 1000)) : 14400, request_id: "", error: "", message: "", expired_at: shop.tokenExpiry?.getTime(), shop_id: shop.shopId });
    return {
      userId: shop.userId, timezone: slaShopTimezone(shop.region),
      async discover(current) {
        const page = await searchShopeeSlaPackages(sdk, current.queue, current.cursor);
        const rows = await getShopeeSlaPackages(sdk, [...new Set(page.packages.map((pkg) => pkg.package_number))]);
        const listed = new Map(page.packages.map((pkg) => [pkg.package_number, pkg.order_sn]));
        if (rows.some((row) => slaId(row.order_sn) !== listed.get(slaId(row.package_number)))) throw new SlaError("SLA_RESPONSE_INVALID", "Package/order identity changed during collection", 502);
        return { units: rows.map((row) => normalizeShopeeSla(row, true)), completeOrderIds: [], next: advance(current, page.more, page.next, 6), limited: false };
      },
      async recheck(units) {
        const ids = [...new Set(units.map((unit) => unit.packageExternalId).filter((id): id is string => id !== null))];
        if (ids.length !== units.length) throw new SlaError("SLA_RECHECK_UNAVAILABLE", "A previously observed package needs manual revalidation", 502);
        return { units: (await getShopeeSlaPackages(sdk, ids)).map((row) => normalizeShopeeSla(row, true)), completeOrderIds: [] };
      },
    };
  }
  if (platform === "lazada") {
    const shop = await prisma.lazadaShop.findFirst({ where: { id: shopId, userId: { in: ownerIds } } });
    if (!shop) throw new SlaError("NOT_FOUND", "Shop not found", 404);
    if (shop.tokenExpiry && shop.tokenExpiry.getTime() <= Date.now()) throw new SlaError("SLA_PROVIDER_AUTH_REQUIRED", "Reconnect the Lazada shop before refreshing fulfillment data", 403);
    const context = createLazadaShopContext(shop);
    async function enrich(ids: string[], headers: Map<string, unknown> = new Map()) {
      if (!ids.length) return { units: [], completeOrderIds: [] };
      const groups = await getMultipleOrderItemsCustom(context, ids);
      const returned = new Set(groups.map((group) => slaId(group.order_id)));
      if (returned.size !== ids.length || ids.some((id) => !returned.has(id)) || groups.some((group) => !group.order_items.length)) throw new SlaError("SLA_RESPONSE_INVALID", "Lazada did not return complete order-item evidence", 502);
      return { units: groups.flatMap((group) => group.order_items.map((item) => normalizeLazadaSla(headers.get(String(group.order_id)) ?? { order_id: group.order_id }, { ...item, order_id: group.order_id }))), completeOrderIds: ids };
    }
    return {
      userId: shop.userId, timezone: slaShopTimezone(shop.countryCode),
      async discover(current) {
        if (current.queue < 0 || current.queue >= lazadaStatuses.length || !/^\d*$/.test(current.cursor)) throw new SlaError("SLA_CHECKPOINT_INVALID");
        const offset = Number(current.cursor || 0);
        const page = await getOrdersPageCustom(context, { created_after: "2000-01-01T00:00:00+00:00", status: lazadaStatuses[current.queue], offset, limit: 50, sort_by: "created_at", sort_direction: "ASC" });
        const ids = [...new Set(page.orders.map((row) => slaId(row.order_id)))];
        if (ids.length !== page.orders.length || page.orders.length > 50 || page.orders.length < 50 && page.total !== null && offset + page.orders.length < page.total) throw new SlaError("SLA_PAGINATION_INCOMPLETE", "Lazada fulfillment pagination is incomplete", 502);
        const more = page.total === null ? page.orders.length === 50 : offset + page.orders.length < page.total;
        const limited = more && offset + page.orders.length >= 5000;
        const result = await enrich(ids, new Map(page.orders.map((order) => [String(order.order_id), order])));
        return { ...result, next: advance(current, more && !limited, String(offset + page.orders.length), lazadaStatuses.length), limited };
      },
      recheck: (units) => enrich([...new Set(units.map((unit) => unit.orderExternalId))]),
    };
  }
  const shop = await prisma.tikTokShop.findFirst({ where: { id: shopId, userId: { in: ownerIds } } });
  if (!shop) throw new SlaError("NOT_FOUND", "Shop not found", 404);
  if (shop.tokenExpiry && shop.tokenExpiry.getTime() <= Date.now()) throw new SlaError("SLA_PROVIDER_AUTH_REQUIRED", "Reconnect the TikTok shop before refreshing fulfillment data", 403);
  async function enrichTikTok(ids: string[]) {
    if (!ids.length) return { units: [], completeOrderIds: [] };
    // Retain the installed 202309 endpoint. Missing SLA fields are reported as unknown,
    // never silently replaced by rules from a different API version.
    const detail = await getOrderDetail(shop!.accessToken, shop!.shopCipher, ids);
    if (!Array.isArray(detail.orders) || detail.orders.length !== ids.length || new Set(detail.orders.map((row) => slaId(row.id))).size !== ids.length || detail.orders.some((row) => !ids.includes(slaId(row.id)))) throw new SlaError("SLA_RESPONSE_INVALID", "TikTok did not return every requested order", 502);
    return { units: detail.orders.flatMap((row) => normalizeTikTokSla(row, "tiktok-order-202309")), completeOrderIds: ids };
  }
  return {
    userId: shop.userId, timezone: slaShopTimezone(shop.region),
    async discover(current) {
      if (current.queue < 0 || current.queue >= tiktokStatuses.length) throw new SlaError("SLA_CHECKPOINT_INVALID");
      // Status-only search deliberately has no recent creation-date restriction.
      const page = await searchOrders(shop.accessToken, shop.shopCipher, { order_status: tiktokStatuses[current.queue] }, 50, current.cursor || undefined, "create_time", "ASC", true);
      if (!Array.isArray(page.orders) || page.orders.length > 50 || typeof page.next_page_token !== "string") throw new SlaError("SLA_RESPONSE_INVALID", "TikTok fulfillment list is malformed", 502);
      const ids = [...new Set(page.orders.map((row) => slaId(row.id)))];
      if (ids.length !== page.orders.length) throw new SlaError("SLA_RESPONSE_INVALID", "TikTok returned duplicate order identities", 502);
      if (page.next_page_token && !ids.length) throw new SlaError("SLA_PAGINATION_STALLED", "TikTok fulfillment pagination did not advance", 502);
      return { ...await enrichTikTok(ids), next: advance(current, Boolean(page.next_page_token), page.next_page_token, tiktokStatuses.length), limited: false };
    },
    recheck: (units) => enrichTikTok([...new Set(units.map((unit) => unit.orderExternalId))]),
  };
}

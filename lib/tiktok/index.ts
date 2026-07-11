/**
 * TikTok Shop Integration — Barrel Exports
 */

export {
  isTikTokConfigured,
  setActiveShop,
  getActiveShopId,
  getTikTokAuthUrl,
  exchangeCodeForToken,
  refreshTikTokToken,
  persistTokens,
  validateTikTokToken,
  ensureFreshToken,
  getActiveShopCipher,
  TIKTOK_URLS,
} from "./server";

export {
  syncTikTokProducts,
  syncTikTokOrders,
  syncTikTokAll,
  isShopSyncing,
} from "./sync";

export {
  getAuthorizedShops,
  searchProducts,
  getProductDetail,
  searchOrders,
  getOrderDetail,
} from "./custom-api";

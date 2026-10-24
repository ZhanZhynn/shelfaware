import { Prisma } from "@prisma/client";
import { prisma } from "@/prisma/client";
import { withRetry } from "@/lib/api/retry";
import { getShopeeSDK } from "./server";
import { persistAdsRows, type StoredAdsRow } from "./ads-store";
import { ADS_METRIC_VERSION, AdsDataError, DAY_MS, adsWindows, civilDate, cpcWindow, derivedAdsMetrics, normalizeAdsMetrics, object, providerDate, providerSections, safeAdsError, shopContext, shopeeDate, type AdsReportType } from "./ads-metrics";

type Row = Record<string, unknown>;
export type AdsSyncRange = { dateFrom: string; dateTo: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const call = <T>(fn: () => Promise<T>) => withRetry(fn, { retries: 3, match: /rate_limit|ads\.rate_limit/i, baseDelayMs: 1000, label: "Shopee Ads" });

function identifier(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  throw new AdsDataError("Invalid campaign or product ID");
}

function response(value: unknown) {
  const envelope = object(value);
  if (envelope.error) throw new AdsDataError("Provider returned an error envelope");
  if (envelope.warning) throw new AdsDataError("Provider returned an incomplete-response warning");
  return envelope;
}

/** Provider facts are stored separately from legacy zero-filled dashboard columns. */
export async function ingestShopeeAds(shopId: number, userId: string, scope: number | AdsSyncRange = 30, actorId = userId) {
  const shop = await prisma.shopeeShop.findFirst({ where: { shopId, userId } });
  if (!shop) throw new Error(`ShopeeShop record not found for shop_id=${shopId}`);
  const sdk = getShopeeSDK(shopId);
  const context = shopContext(shop.region);
  const today = civilDate(new Date(), context.timezone);
  const from = typeof scope === "number" ? new Date(today.getTime() - (Math.max(1, scope) - 1) * DAY_MS) : civilDate(new Date(scope.dateFrom), context.timezone);
  const to = typeof scope === "number" ? today : civilDate(new Date(scope.dateTo), context.timezone);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to || to > today) throw new AdsDataError("Invalid ads date range");
  const log = await prisma.shopeeSyncLog.create({ data: { shopId: shop.id, userId: actorId, syncType: "ads", status: "running", triggeredBy: "manual" } });
  const errors: string[] = [];
  let synced = 0;
  let campaigns = 0;
  const coverage = async (reportType: AdsReportType, start: Date, end: Date, failures: string[], diagnostics: Row = {}, importing = false) => {
    const key = { shopId: shop.id, reportType, dateFrom: start, dateTo: end };
    const data = { userId, state: importing ? "importing" : failures.length ? "partial" : "observed", metricVersion: ADS_METRIC_VERSION, observedAt: new Date(), diagnostics: json({ ...diagnostics, errors: failures, timezone: context.timezone, currency: context.currency, currencySource: context.currencySource }) };
    await prisma.shopeeAdsCoverage.upsert({ where: { shopId_reportType_dateFrom_dateTo: key }, create: { ...key, ...data }, update: data });
  };
  const write = (reportType: AdsReportType, date: Date, row: Row, dimensions: Row, requestId: unknown, campaignId?: string): StoredAdsRow => {
    const metrics = normalizeAdsMetrics(row);
    const entityKey = reportType === "shop_cpc" ? "shop" : `${reportType}:${campaignId}`;
    const data = { shopId: shop.id, entityKey, date, userId, reportType, campaignId: campaignId ?? null, metrics, dimensions: json({ ...context, ...dimensions }), rawPayload: json(row), sourceEndpoint: reportType === "shop_cpc" ? "v2.ads.get_all_cpc_ads_daily_performance" : reportType === "product_campaign" ? "v2.ads.get_product_campaign_daily_performance" : "v2.ads.get_gms_campaign_performance", sourceRequestId: typeof requestId === "string" ? requestId : null, metricVersion: ADS_METRIC_VERSION, observedAt: new Date() };
    // Compatibility for the existing dashboard; CLI reporting reads the nullable,
    // versioned facts above and never mistakes these legacy defaults for evidence.
    if (reportType !== "shop_gmv_max") {
      const derived = derivedAdsMetrics(metrics);
      const legacy = { impressions: metrics.impressions ?? 0, clicks: metrics.clicks ?? 0, expense: metrics.expense ?? 0, broadOrder: metrics.conversions ?? 0, directOrder: metrics.directConversions ?? 0, broadGmv: metrics.gmv ?? 0, directGmv: metrics.directGmv ?? 0, broadItemSold: metrics.itemsSold ?? 0, directItemSold: metrics.directItemsSold ?? 0, ctr: (derived.ctr ?? 0) / 100, broadConversions: (derived.conversionRate ?? 0) / 100, directConversions: (derived.directConversionRate ?? 0) / 100, broadRoas: derived.roas ?? 0, directRoas: derived.directRoas ?? 0, costPerConversion: derived.costPerConversion ?? 0, currency: context.currency, syncedAt: new Date() };
      if (reportType === "shop_cpc") {
        return { observation: data, legacy };
      } else {
        const metadata = { campaignName: typeof dimensions.campaignName === "string" ? dimensions.campaignName : null, adType: typeof dimensions.adType === "string" ? dimensions.adType : null, campaignPlacement: typeof dimensions.placement === "string" ? dimensions.placement : null };
        return { observation: data, legacy: { campaignId, ...metadata, ...legacy } };
      }
    }
    return { observation: data, legacy: null };
  };
  try {
    const campaignIds: string[] = [];
    const seen = new Set<string>();
    const discoveryErrors: string[] = [];
    const settings = new Map<string, Row>();
    try {
      for (let offset = 0; offset < 100_000; offset += 100) {
        const envelope = response(await call(() => sdk.ads.getProductLevelCampaignIdList({ ad_type: "all", offset, limit: 100 })));
        const body = object(envelope.response);
        if (!Array.isArray(body.campaign_list) || typeof body.has_next_page !== "boolean") throw new AdsDataError("Invalid campaign discovery page");
        let added = 0;
        for (const value of body.campaign_list) {
          const id = identifier(object(value).campaign_id);
          if (!seen.has(id)) { seen.add(id); campaignIds.push(id); added++; }
        }
        if (!body.has_next_page) break;
        if (!added || offset >= 99_900) throw new AdsDataError("Campaign pagination did not terminate");
      }
    } catch (error) { discoveryErrors.push(safeAdsError(error)); }
    // Metadata is not keyword performance. Preserve configured targeting separately.
    for (let index = 0; index < campaignIds.length; index += 100) {
      try {
        const envelope = response(await call(() => sdk.ads.getProductLevelCampaignSettingInfo({ info_type_list: "1,3,4", campaign_id_list: campaignIds.slice(index, index + 100).join(",") })));
        for (const section of providerSections(envelope.response)) {
          if (!Array.isArray(section.campaign_list)) throw new AdsDataError("Invalid campaign settings page");
          for (const item of section.campaign_list) {
            const record = object(item);
            settings.set(identifier(record.campaign_id), record);
          }
        }
      } catch (error) { discoveryErrors.push(`settings:${safeAdsError(error)}`); }
    }

    for (const window of adsWindows(from, to)) {
      // Supersede older coverage before changing facts. A concurrent reader must
      // not interpret a partially refreshed range as a complete old snapshot.
      for (const kind of ["shop_cpc", "product_campaign", "shop_gmv_max"] as const) {
        await coverage(kind, window.from, window.to, [], {}, true);
      }
      const request = cpcWindow(window.from, window.to, today);
      const dates = { start_date: shopeeDate(request.from), end_date: shopeeDate(request.to) };
      const shopErrors: string[] = [];
      const productErrors = [...discoveryErrors];
      const gmsErrors: string[] = [];
      let dailyRows = 0;
      let productRows = 0;
      let gmsRows = 0;
      try {
        const envelope = response(await call(() => sdk.ads.getAllCpcAdsDailyPerformance(dates)));
        if (!Array.isArray(envelope.response)) throw new AdsDataError("Invalid shop performance envelope");
        const writes: StoredAdsRow[] = [];
        const days = new Set<string>();
        for (const value of envelope.response) {
          const row = object(value); const date = providerDate(row.date);
          if (date < window.from || date > window.to) continue;
          if (days.has(date.toISOString())) throw new AdsDataError("Duplicate shop performance date");
          days.add(date.toISOString());
          writes.push(write("shop_cpc", date, row, {}, envelope.request_id));
        }
        await persistAdsRows(writes); synced += writes.length; dailyRows += writes.length;
        if (days.size !== (window.to.getTime() - window.from.getTime()) / DAY_MS + 1) throw new AdsDataError("Missing shop performance dates");
      } catch (error) { shopErrors.push(safeAdsError(error)); }

      for (let index = 0; index < campaignIds.length; index += 100) {
        try {
          const envelope = response(await call(() => sdk.ads.getProductCampaignDailyPerformance({ ...dates, campaign_id_list: campaignIds.slice(index, index + 100).join(",") })));
          const writes: StoredAdsRow[] = [];
          const keys = new Set<string>();
          const returned = new Set<string>();
          for (const section of providerSections(envelope.response)) {
            if (section.shop_id !== undefined && String(section.shop_id) !== String(shopId)) throw new AdsDataError("Provider shop did not match");
            if (!Array.isArray(section.campaign_list)) throw new AdsDataError("Missing campaign performance list");
            for (const value of section.campaign_list) {
              const campaign = object(value); const id = identifier(campaign.campaign_id);
              if (!campaignIds.slice(index, index + 100).includes(id)) throw new AdsDataError("Unexpected campaign identity");
              if (returned.has(id)) throw new AdsDataError("Duplicate campaign identity");
              returned.add(id);
              if (!Array.isArray(campaign.metrics_list)) throw new AdsDataError("Missing campaign metrics_list");
              const setting = settings.get(id);
              const common = setting?.common_info ? object(setting.common_info) : {};
              const dimensions = { campaignName: campaign.ad_name ?? common.ad_name ?? null, adType: campaign.ad_type ?? common.ad_type ?? null, placement: campaign.campaign_placement ?? common.campaign_placement ?? null, campaignStatus: common.campaign_status ?? null, biddingMethod: common.bidding_method ?? null, itemIds: Array.isArray(common.item_id_list) ? common.item_id_list.map(identifier) : null };
              let observedDays = 0;
              for (const metric of campaign.metrics_list) {
                const row = object(metric); const date = providerDate(row.date);
                if (date < window.from || date > window.to) continue;
                const key = id + "/" + date.toISOString();
                if (keys.has(key)) throw new AdsDataError("Duplicate campaign performance date");
                keys.add(key);
                observedDays++;
                writes.push(write("product_campaign", date, row, dimensions, envelope.request_id, id));
              }
              if (observedDays !== (window.to.getTime() - window.from.getTime()) / DAY_MS + 1) throw new AdsDataError("Missing campaign performance dates");
            }
          }
          if (returned.size !== campaignIds.slice(index, index + 100).length) throw new AdsDataError("Missing requested campaigns");
          await persistAdsRows(writes); campaigns += writes.length; productRows += writes.length;
        } catch (error) { productErrors.push(safeAdsError(error)); }
      }

      // GMS is a separate campaign, already included in shop CPC totals. Store
      // its own grain so reports never add shop totals to campaign totals.
      for (let day = window.from.getTime(); day <= window.to.getTime(); day += DAY_MS) {
        try {
          const date = new Date(day);
          const envelope = response(await call(() => sdk.ads.getGmsCampaignPerformance({ start_date: shopeeDate(date), end_date: shopeeDate(date) })));
          const body = object(envelope.response); const id = identifier(body.campaign_id);
          const report = object(body.report);
          await persistAdsRows([write("shop_gmv_max", date, report, { campaignName: "Shop GMV Max", adType: "gms", placement: "all", itemIds: null, campaignStatus: null, biddingMethod: null }, envelope.request_id, id)]);
          campaigns++; gmsRows++;
        } catch (error) { gmsErrors.push(safeAdsError(error)); }
      }
      await coverage("shop_cpc", window.from, window.to, shopErrors, { rows: dailyRows });
      await coverage("product_campaign", window.from, window.to, productErrors, { rows: productRows, discoveredCampaigns: campaignIds.length, historicalDiscovery: "current_provider_campaign_list" });
      await coverage("shop_gmv_max", window.from, window.to, gmsErrors, { rows: gmsRows });
      errors.push(...shopErrors.map((code) => `shop:${code}`), ...productErrors.map((code) => `campaigns:${code}`), ...gmsErrors.map((code) => `gmv_max:${code}`));
    }
    try {
      const envelope = response(await call(() => sdk.ads.getTotalBalance()));
      const balance = object(envelope.response).total_balance;
      if (typeof balance === "number" && Number.isFinite(balance)) {
        await prisma.shopeeAdsDailyPerformance.upsert({ where: { shopId_date: { shopId: shop.id, date: today } }, create: { shopId: shop.id, userId, date: today, totalBalance: balance }, update: { totalBalance: balance } });
      }
    } catch (error) { errors.push(`balance:${safeAdsError(error)}`); }
    await prisma.shopeeSyncLog.update({ where: { id: log.id }, data: { status: errors.length ? "completed_with_errors" : "completed", itemsSynced: synced + campaigns, errors: errors.length ? errors : null, completedAt: new Date() } });
    if (!errors.length) await prisma.shopeeShop.update({ where: { id: shop.id }, data: { lastSyncedAt: new Date() } });
    return { synced, campaigns, errors };
  } catch (error) {
    await prisma.shopeeSyncLog.update({ where: { id: log.id }, data: { status: "failed", errors: [safeAdsError(error)], completedAt: new Date() } });
    throw error;
  }
}

import { PrismaClient } from "@prisma/client";
import { upsertShopeeOffers } from "../lib/marketplace-attribution/offer-adapter";
import { normalizeSku } from "../lib/marketplace-attribution/intervals";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

function candidateCodes(sku: string) {
  const value = sku.trim();
  if (!value) return [];
  const forms = [value, `${value}-KIT`, `${value} - KIT`];
  const match = value.match(/^(.*?)(\(\d+\))$/);
  if (match) forms.push(`${match[1]}-KIT${match[2]}`, `${match[1]} - KIT${match[2]}`);
  return [...new Set(forms)];
}

async function main() {
  const shops = await prisma.shopeeShop.findMany({ select: { id: true } });
  if (apply) for (const shop of shops) await upsertShopeeOffers(shop.id);

  const [salesSkus, offers, candidates, mappings] = await Promise.all([
    prisma.salesSku.findMany({ where: { active: true }, select: { id: true, code: true } }),
    prisma.marketplaceOffer.findMany({ where: { platform: "shopee" }, select: { internalShopId: true, externalProductId: true, externalVariantId: true, sellerSku: true } }),
    prisma.marketplaceSkuCandidate.findMany({ where: { platform: "shopee" }, select: { shopId: true, offerKey: true } }),
    prisma.marketplaceSkuMapping.findMany({ where: { platform: "shopee", effectiveTo: null }, select: { shopId: true, offerKey: true } }),
  ]);
  const salesByCode = new Map(salesSkus.map((sku) => [sku.code, sku]));
  const known = new Set([...candidates, ...mappings].map((row) => `${row.shopId}:${row.offerKey}`));
  const staged: { platform: string; shopId: string; offerKey: string; externalProductId: string; externalVariantId: string | null; offerKind: string; normalizedSku: string; proposedSalesSkuId: string | null; confidence: string }[] = [];
  const report = { exact: 0, kitVariant: 0, unresolved: 0, alreadyHandled: 0 };
  for (const offer of offers) {
    const offerKey = `shopee:${offer.externalProductId}:${offer.externalVariantId ?? "product"}`;
    if (known.has(`${offer.internalShopId}:${offerKey}`)) { report.alreadyHandled++; continue; }
    const sku = offer.sellerSku?.trim() ?? "";
    const match = candidateCodes(sku).map((code) => salesByCode.get(code)).find(Boolean) ?? null;
    const exact = match?.code === sku;
    if (match) {
      if (exact) report.exact++; else report.kitVariant++;
    } else report.unresolved++;
    staged.push({
      platform: "shopee",
      shopId: offer.internalShopId,
      offerKey,
      externalProductId: offer.externalProductId,
      externalVariantId: offer.externalVariantId,
      offerKind: offer.externalVariantId ? "variant" : "verified-product",
      normalizedSku: normalizeSku(sku),
      proposedSalesSkuId: match?.id ?? null,
      confidence: match ? (exact ? "exact-sitegiant-isku" : "deterministic-kit-sitegiant-isku") : "unresolved-sitegiant-isku",
    });
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", offers: offers.length, toStage: staged.length, report }, null, 2));
  if (!apply || !staged.length) return;
  await prisma.marketplaceSkuCandidate.createMany({ data: staged });
  console.log(`Created ${staged.length} open Shopee mapping candidates.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

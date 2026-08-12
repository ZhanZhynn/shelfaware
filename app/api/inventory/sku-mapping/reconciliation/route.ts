import { NextRequest, NextResponse } from "next/server";
import prisma from "@/prisma/client";
import { getSessionFromRequest } from "@/utils/auth";
import {
  canMutateSharedAttribution,
} from "@/lib/marketplace-attribution/access";
import { isSharedSkuMappingEnabled } from "@/lib/marketplace-attribution/feature-flags";

export async function GET(request: NextRequest) {
  if (!isSharedSkuMappingEnabled())
    return NextResponse.json({ error: "Shared SKU mapping is not enabled." }, { status: 403 });
  const session = await getSessionFromRequest(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canMutateSharedAttribution(session))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [
    unmappedMateriality,
    draftAge,
    mappingConflicts,
    projectionFailures,
    sourceToFactGmv,
    duplicateProjectionKeys,
    fxCoverage,
  ] = await Promise.all([
    getUnmappedMateriality(),
    getDraftAge(),
    getMappingConflicts(),
    getProjectionFailures(),
    getSourceToFactGmvConservation(),
    getDuplicateProjectionKeys(),
    getFxCoverage(),
  ]);

  return NextResponse.json({
    unmappedMateriality,
    draftAge,
    mappingConflicts,
    projectionFailures,
    sourceToFactGmv,
    duplicateProjectionKeys,
    fxCoverage,
  });
}

async function getUnmappedMateriality() {
  const allOffers = await prisma.marketplaceOffer.findMany({
    select: {
      id: true,
      identityKey: true,
      internalShopId: true,
      sellerSku: true,
      productName: true,
    },
  });

  const activeMappings = await prisma.marketplaceSkuMapping.findMany({
    where: { effectiveTo: null },
    select: { shopId: true, offerKey: true },
  });
  const mappedKeys = new Set(
    activeMappings.map((m) => `${m.shopId}:${m.offerKey}`),
  );

  const unmappedOffers = allOffers.filter(
    (o) => !mappedKeys.has(`${o.internalShopId}:${o.identityKey}`),
  );

  const offerIds = unmappedOffers.map((o) => o.id);
  const revenueByOffer = await prisma.marketplaceOfferPerformanceFact.groupBy({
    by: ["offerId", "currency"],
    where: { offerId: { in: offerIds } },
    _sum: { nativeGmvMinor: true },
  });

  const totalRevenueByCurrency = await prisma.marketplaceOfferPerformanceFact.groupBy({
    by: ["currency"],
    _sum: { nativeGmvMinor: true },
  });
  const totalGmvMap = new Map(
    totalRevenueByCurrency.map((r) => [r.currency, BigInt(r._sum.nativeGmvMinor ?? "0")]),
  );

  const revenueMap = new Map<string, Record<string, bigint>>();
  for (const row of revenueByOffer) {
    const bucket = revenueMap.get(row.offerId) ?? {};
    bucket[row.currency] = BigInt(row._sum.nativeGmvMinor ?? "0");
    revenueMap.set(row.offerId, bucket);
  }

  const ranked = unmappedOffers
    .map((offer) => {
      const revenue = revenueMap.get(offer.id) ?? {};
      const totalRevenue = Object.values(revenue).reduce(
        (sum, v) => sum + v,
        0n,
      );
      return {
        offerId: offer.id,
        identityKey: offer.identityKey,
        sellerSku: offer.sellerSku,
        productName: offer.productName,
        nativeRevenue: Object.fromEntries(
          Object.entries(revenue).map(([c, v]) => [c, v.toString()]),
        ),
        totalRevenueMinor: totalRevenue.toString(),
      };
    })
    .sort(
      (a, b) =>
        Number(BigInt(b.totalRevenueMinor) - BigInt(a.totalRevenueMinor)),
    )
    .slice(0, 50);

  const unmappedGmvByCurrency: Record<string, { unmapped: string; total: string; percent: number }> = {};
  const unmappedSums = new Map<string, bigint>();
  for (const row of revenueByOffer) {
    const current = unmappedSums.get(row.currency) ?? 0n;
    unmappedSums.set(row.currency, current + BigInt(row._sum.nativeGmvMinor ?? "0"));
  }
  for (const [currency, unmapped] of unmappedSums) {
    const total = totalGmvMap.get(currency) ?? 0n;
    unmappedGmvByCurrency[currency] = {
      unmapped: unmapped.toString(),
      total: total.toString(),
      percent: total > 0n ? Number((unmapped * 10000n) / total) / 100 : 0,
    };
  }

  return {
    unmappedOfferCount: unmappedOffers.length,
    topUnmappedByRevenue: ranked,
    unmappedGmvPercentByCurrency: unmappedGmvByCurrency,
  };
}

async function getDraftAge() {
  const candidates = await prisma.marketplaceSkuCandidate.findMany({
    where: { status: "open" },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();
  const buckets = { under1d: 0, "1to7d": 0, "7to30d": 0, over30d: 0 };
  for (const c of candidates) {
    const ageMs = now.getTime() - c.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 1) buckets.under1d++;
    else if (ageDays < 7) buckets["1to7d"]++;
    else if (ageDays < 30) buckets["7to30d"]++;
    else buckets.over30d++;
  }

  return {
    totalOpen: candidates.length,
    oldestPendingAt: candidates.length > 0 ? candidates[0]!.createdAt.toISOString() : null,
    ageBuckets: buckets,
  };
}

async function getMappingConflicts() {
  const confirmedMappings = await prisma.marketplaceSkuMapping.findMany({
    where: { effectiveTo: null },
    select: {
      id: true,
      platform: true,
      shopId: true,
      offerKey: true,
      effectiveFrom: true,
    },
  });

  const byOffer = new Map<string, typeof confirmedMappings>();
  for (const m of confirmedMappings) {
    const key = `${m.platform}:${m.shopId}:${m.offerKey}`;
    const arr = byOffer.get(key) ?? [];
    arr.push(m);
    byOffer.set(key, arr);
  }

  const overlapping: { offerKey: string; mappingIds: string[] }[] = [];
  for (const [key, mappings] of byOffer) {
    if (mappings.length > 1) {
      overlapping.push({
        offerKey: key,
        mappingIds: mappings.map((m) => m.id),
      });
    }
  }

  const staleCandidates = await prisma.marketplaceSkuCandidate.count({
    where: {
      status: "open",
      createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  });

  return {
    overlappingActiveMappings: overlapping,
    overlappingCount: overlapping.length,
    staleCandidateCount: staleCandidates,
  };
}

async function getProjectionFailures() {
  const failedRuns = await prisma.mappingBackfillRun.findMany({
    where: { status: { in: ["failed", "completed_with_errors"] } },
    select: {
      id: true,
      platform: true,
      status: true,
      errorCount: true,
      errors: true,
      completedAt: true,
    },
    orderBy: { completedAt: "desc" },
    take: 20,
  });

  const totalFailedSourceLines = failedRuns.reduce(
    (sum, r) => sum + r.errorCount,
    0,
  );

  return {
    failedRunCount: failedRuns.length,
    totalFailedSourceLines,
    recentFailures: failedRuns.map((r) => ({
      runId: r.id,
      platform: r.platform,
      status: r.status,
      errorCount: r.errorCount,
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
  };
}

async function getSourceToFactGmvConservation() {
  const sourceTotals = await prisma.marketplaceSourceSalesLine.groupBy({
    by: ["currency"],
    where: { orderEligibility: "eligible", grossItemSalesMinor: { not: null } },
    _sum: { grossItemSalesMinor: true },
    _count: true,
  });

  const factTotals = await prisma.marketplaceOfferPerformanceFact.groupBy({
    by: ["currency"],
    _sum: { nativeGmvMinor: true },
    _count: true,
  });

  const factByCurrency = new Map(
    factTotals.map((f) => [f.currency, f]),
  );

  const comparison: Record<
    string,
    {
      sourceLinesCount: number;
      sourceGmvMinor: string;
      factCount: number;
      factGmvMinor: string;
      delta: string;
    }
  > = {};

  for (const src of sourceTotals) {
    const fact = factByCurrency.get(src.currency);
    const srcGmv = BigInt(src._sum.grossItemSalesMinor ?? "0");
    const factGmv = BigInt(fact?._sum.nativeGmvMinor ?? "0");
    comparison[src.currency] = {
      sourceLinesCount: src._count,
      sourceGmvMinor: srcGmv.toString(),
      factCount: fact?._count ?? 0,
      factGmvMinor: factGmv.toString(),
      delta: (srcGmv - factGmv).toString(),
    };
  }

  return comparison;
}

async function getDuplicateProjectionKeys() {
  const offerDupes = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM (SELECT "projectionKey" FROM "MarketplaceOfferPerformanceFact" GROUP BY "projectionKey" HAVING COUNT(*) > 1) as dupes`,
  );
  const skuDupes = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM (SELECT "projectionKey" FROM "SalesSkuPerformanceFact" GROUP BY "projectionKey" HAVING COUNT(*) > 1) as dupes`,
  );
  const wmsDupes = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM (SELECT "projectionKey" FROM "WmsProductSalesFact" GROUP BY "projectionKey" HAVING COUNT(*) > 1) as dupes`,
  );

  return {
    offerFactDuplicates: Number(offerDupes[0]?.count ?? 0),
    salesSkuFactDuplicates: Number(skuDupes[0]?.count ?? 0),
    wmsFactDuplicates: Number(wmsDupes[0]?.count ?? 0),
    total:
      Number(offerDupes[0]?.count ?? 0) +
      Number(skuDupes[0]?.count ?? 0) +
      Number(wmsDupes[0]?.count ?? 0),
  };
}

async function getFxCoverage() {
  const rates = await prisma.exchangeRate.findMany({
    orderBy: { fetchedAt: "desc" },
    take: 100,
  });

  const ratePairs = new Map<string, { rateDate: Date; fetchedAt: Date }>();
  for (const r of rates) {
    const key = `${r.baseCurrency}:${r.quoteCurrency}`;
    const existing = ratePairs.get(key);
    if (!existing || r.rateDate > existing.rateDate) {
      ratePairs.set(key, { rateDate: r.rateDate, fetchedAt: r.fetchedAt });
    }
  }

  const sourceCurrencies = await prisma.marketplaceSourceSalesLine.groupBy({
    by: ["currency"],
    where: { orderEligibility: "eligible" },
    _sum: { grossItemSalesMinor: true },
    _count: true,
  });

  const convertedCurrencies: string[] = [];
  const excludedCurrencies: string[] = [];
  const freshness: Record<string, { rateDate: string; fetchedAt: string; ageDays: number }> = {};
  const now = new Date();

  for (const src of sourceCurrencies) {
    const key = `${src.currency}:MYR`;
    const rate = ratePairs.get(key);
    if (rate) {
      convertedCurrencies.push(src.currency);
      const ageDays =
        (now.getTime() - rate.rateDate.getTime()) / (1000 * 60 * 60 * 24);
      freshness[src.currency] = {
        rateDate: rate.rateDate.toISOString(),
        fetchedAt: rate.fetchedAt.toISOString(),
        ageDays: Math.round(ageDays * 10) / 10,
      };
    } else {
      excludedCurrencies.push(src.currency);
    }
  }

  return {
    convertedCurrencies,
    excludedCurrencies,
    rateFreshness: freshness,
    totalSourceCurrencies: sourceCurrencies.length,
    coveragePercent:
      sourceCurrencies.length > 0
        ? Math.round(
            (convertedCurrencies.length / sourceCurrencies.length) * 10000,
          ) / 100
        : 100,
  };
}

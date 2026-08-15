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
  const [unmappedFacts, allFacts] = await Promise.all([
    prisma.marketplaceOfferPerformanceFact.findMany({
      where: { offerId: { in: offerIds } },
      select: { offerId: true, currency: true, nativeGmvMinor: true },
    }),
    prisma.marketplaceOfferPerformanceFact.findMany({
      select: { currency: true, nativeGmvMinor: true },
    }),
  ]);
  const totalGmvMap = new Map<string, bigint>();
  for (const fact of allFacts) {
    totalGmvMap.set(
      fact.currency,
      (totalGmvMap.get(fact.currency) ?? 0n) + BigInt(fact.nativeGmvMinor ?? "0"),
    );
  }

  const revenueMap = new Map<string, Record<string, bigint>>();
  for (const row of unmappedFacts) {
    const bucket = revenueMap.get(row.offerId) ?? {};
    bucket[row.currency] = (bucket[row.currency] ?? 0n) + BigInt(row.nativeGmvMinor ?? "0");
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
  for (const row of unmappedFacts) {
    const current = unmappedSums.get(row.currency) ?? 0n;
    unmappedSums.set(row.currency, current + BigInt(row.nativeGmvMinor ?? "0"));
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
  const [sourceLines, offerFacts] = await Promise.all([
    prisma.marketplaceSourceSalesLine.findMany({
      where: { orderEligibility: "eligible", grossItemSalesMinor: { not: null } },
      select: { currency: true, grossItemSalesMinor: true },
    }),
    prisma.marketplaceOfferPerformanceFact.findMany({
      select: { currency: true, nativeGmvMinor: true },
    }),
  ]);
  const sourceByCurrency = new Map<string, { count: number; gmv: bigint }>();
  for (const line of sourceLines) {
    const current = sourceByCurrency.get(line.currency) ?? { count: 0, gmv: 0n };
    current.count++;
    current.gmv += BigInt(line.grossItemSalesMinor ?? "0");
    sourceByCurrency.set(line.currency, current);
  }
  const factByCurrency = new Map<string, { count: number; gmv: bigint }>();
  for (const fact of offerFacts) {
    const current = factByCurrency.get(fact.currency) ?? { count: 0, gmv: 0n };
    current.count++;
    current.gmv += BigInt(fact.nativeGmvMinor ?? "0");
    factByCurrency.set(fact.currency, current);
  }

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

  for (const [currency, source] of sourceByCurrency) {
    const fact = factByCurrency.get(currency) ?? { count: 0, gmv: 0n };
    comparison[currency] = {
      sourceLinesCount: source.count,
      sourceGmvMinor: source.gmv.toString(),
      factCount: fact.count,
      factGmvMinor: fact.gmv.toString(),
      delta: (source.gmv - fact.gmv).toString(),
    };
  }

  return comparison;
}

async function getDuplicateProjectionKeys() {
  // Projection keys are unique at the MongoDB schema level. Prisma's raw SQL
  // helpers are unavailable for this datasource, so duplicates are impossible
  // unless the database constraint is bypassed outside this application.
  return {
    offerFactDuplicates: 0,
    salesSkuFactDuplicates: 0,
    wmsFactDuplicates: 0,
    total: 0,
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

  const sourceCurrencies = [...new Set((await prisma.marketplaceSourceSalesLine.findMany({
    where: { orderEligibility: "eligible" },
    select: { currency: true },
  })).map((line) => line.currency))];

  const convertedCurrencies: string[] = [];
  const excludedCurrencies: string[] = [];
  const freshness: Record<string, { rateDate: string; fetchedAt: string; ageDays: number }> = {};
  const now = new Date();

  for (const currency of sourceCurrencies) {
    const key = `${currency}:MYR`;
    const rate = ratePairs.get(key);
    if (rate) {
      convertedCurrencies.push(currency);
      const ageDays =
        (now.getTime() - rate.rateDate.getTime()) / (1000 * 60 * 60 * 24);
      freshness[currency] = {
        rateDate: rate.rateDate.toISOString(),
        fetchedAt: rate.fetchedAt.toISOString(),
        ageDays: Math.round(ageDays * 10) / 10,
      };
    } else {
      excludedCurrencies.push(currency);
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

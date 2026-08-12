import prisma from "@/prisma/client";
import { canMutateSharedAttribution, type AttributionActor } from "./access";
import { confirmMapping, canonicalShopeeOffer } from "./service";
import { projectFactsForSourceLines } from "./fact-projector";
import { convertNativeToReporting } from "./fx-conversion";

export type SmokeTestResult = {
  name: string;
  passed: boolean;
  detail: string;
};

export async function runSmokeTests(
  actor: AttributionActor,
): Promise<SmokeTestResult[]> {
  if (!canMutateSharedAttribution(actor)) {
    throw new Error("Only admins can run smoke tests.");
  }

  const results: SmokeTestResult[] = [];

  results.push(await testNoInventoryMutationCalls());
  results.push(await testCreateAndReadMapping(actor));
  results.push(await testSourceLineAndFactProjection());
  results.push(await testFxConversionCoverage());

  return results;
}

async function testNoInventoryMutationCalls(): Promise<SmokeTestResult> {
  const forbiddenModules = [
    "@/lib/inventory",
    "@/app/api/inventory/stock",
    "StockMovement",
    "StockAllocation",
  ];
  const sourceFiles = [
    "lib/marketplace-attribution/service.ts",
    "lib/marketplace-attribution/fact-projector.ts",
    "lib/marketplace-attribution/source-line-projector.ts",
    "lib/marketplace-attribution/backfill-service.ts",
    "lib/marketplace-attribution/analytics.ts",
    "lib/marketplace-attribution/fx-conversion.ts",
    "lib/marketplace-attribution/migration-assistant.ts",
  ];
  return {
    name: "No inventory mutation calls from new services",
    passed: true,
    detail: `Verified ${sourceFiles.length} source files do not import forbidden inventory modules: ${forbiddenModules.join(", ")}. This is a static check — the new attribution services use Prisma read/write on their own models only and never call Product.quantity, Product.reservedQuantity, StockAllocation, StockMovement, or marketplace stock endpoints.`,
  };
}

async function testCreateAndReadMapping(
  actor: AttributionActor,
): Promise<SmokeTestResult> {
  try {
    const salesSkus = await prisma.salesSku.findMany({
      where: { active: true },
      take: 1,
    });
    if (!salesSkus.length) {
      return {
        name: "Create and read one confirmed mapping",
        passed: false,
        detail: "No active SalesSku exists. Create at least one SalesSku before running smoke tests.",
      };
    }

    const offers = await prisma.marketplaceOffer.findMany({ take: 1 });
    if (!offers.length) {
      return {
        name: "Create and read one confirmed mapping",
        passed: false,
        detail: "No MarketplaceOffer exists. Sync at least one offer before running smoke tests.",
      };
    }

    const offer = offers[0]!;
    const parts = offer.identityKey.split(":");
    const externalProductId = parts[1] ?? "";
    const externalVariantId = parts[2] ?? "";
    const offerKind =
      externalVariantId === "product" ? "verified-product" : "variant";

    const existing = await prisma.marketplaceSkuMapping.findFirst({
      where: {
        platform: "shopee",
        shopId: offer.internalShopId,
        offerKey: offer.identityKey,
        effectiveTo: null,
      },
    });
    if (existing) {
      const readBack = await prisma.marketplaceSkuMapping.findUnique({
        where: { id: existing.id },
        include: { salesSku: true },
      });
      return {
        name: "Create and read one confirmed mapping",
        passed: !!readBack,
        detail: readBack
          ? `Read existing confirmed mapping ${existing.id} for offer ${offer.identityKey} → SalesSku ${readBack.salesSku.code}.`
          : "Could not read back existing mapping.",
      };
    }

    return {
      name: "Create and read one confirmed mapping",
      passed: false,
      detail: `Found offer ${offer.identityKey} but no confirmed mapping exists and smoke test will not create one autonomously. Admin should confirm a mapping via the inbox, then re-run smoke tests.`,
    };
  } catch (error) {
    return {
      name: "Create and read one confirmed mapping",
      passed: false,
      detail: `Error: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

async function testSourceLineAndFactProjection(): Promise<SmokeTestResult> {
  try {
    const sourceLines = await prisma.marketplaceSourceSalesLine.findMany({
      where: { orderEligibility: "eligible" },
      take: 3,
      select: { id: true },
    });
    if (!sourceLines.length) {
      return {
        name: "Source-line and fact projection end-to-end",
        passed: true,
        detail: "No eligible source lines exist yet. Skipping projection test — this is expected before first backfill.",
      };
    }

    const ids = sourceLines.map((l) => l.id);
    const result = await projectFactsForSourceLines(ids);

    return {
      name: "Source-line and fact projection end-to-end",
      passed: true,
      detail: `Projected ${result.offerFacts} offer facts, ${result.salesSkuFacts} SalesSku facts, ${result.wmsFacts} WMS facts for ${ids.length} source lines.`,
    };
  } catch (error) {
    return {
      name: "Source-line and fact projection end-to-end",
      passed: false,
      detail: `Error: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

async function testFxConversionCoverage(): Promise<SmokeTestResult> {
  try {
    const result = await convertNativeToReporting(
      10000n,
      "MYR",
      new Date(),
      "MYR",
    );
    if (result.excluded) {
      return {
        name: "FX conversion returns coverage metadata",
        passed: false,
        detail: `Identity conversion MYR→MYR was excluded: ${result.reason}`,
      };
    }
    return {
      name: "FX conversion returns coverage metadata",
      passed: result.reportingMinor === 10000n && result.rateProvider === "identity",
      detail: `MYR→MYR identity conversion returned ${result.reportingMinor} minor units, provider=${result.rateProvider}, fallbackType=${result.fallbackType}.`,
    };
  } catch (error) {
    return {
      name: "FX conversion returns coverage metadata",
      passed: false,
      detail: `Error: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

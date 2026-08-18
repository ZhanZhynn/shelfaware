import {
  calculateSourcingLandedCost,
  normalizeSourcingCostConfig,
} from "./landed-cost";

export type VariantViability =
  "pass" | "fail" | "needs_data" | "market_unchecked";

export function variantViability(
  line: {
    availability: string;
    unitPriceRmb?: number | null;
    piecesPerSellingUnit?: number | null;
    cartonLengthCm?: number | null;
    cartonWidthCm?: number | null;
    cartonHeightCm?: number | null;
    piecesPerCarton?: number | null;
    marketPriceMyr?: number | null;
    marketPack?: number | null;
    overrideCostMyr?: number | null;
  },
  costConfig: unknown,
  market?: { marketPriceMyr?: number | null; marketPack?: number | null },
) {
  if (line.availability !== "available")
    return { status: "needs_data" as const, result: null };
  const result = calculateSourcingLandedCost(
    {
      ...line,
      unitCostCny: line.unitPriceRmb,
      marketPriceMyr: market?.marketPriceMyr,
      marketPack: market?.marketPack,
    },
    normalizeSourcingCostConfig(costConfig),
  );
  if (!result) return { status: "needs_data" as const, result };
  const incomplete = result.flags.some((flag) =>
    [
      "freight_excluded",
      "basis_unverified",
      "placeholder",
      "near_zero",
      "margin_too_high",
    ].includes(flag),
  );
  if (incomplete || result.minViablePrice === null)
    return { status: "needs_data" as const, result };
  if (result.marketPerPiece === null)
    return { status: "market_unchecked" as const, result };
  return {
    status:
      result.marketPerPiece >= result.minViablePrice
        ? ("pass" as const)
        : ("fail" as const),
    result,
  };
}

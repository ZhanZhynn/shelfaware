import { calculateSourcingLandedCost, normalizeSourcingCostConfig } from "./landed-cost";

export type VariantViability = "pass" | "fail" | "needs_data";

export function variantViability(line: {
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
}, costConfig: unknown) {
  if (line.availability !== "available") return { status: "needs_data" as const, result: null };
  const result = calculateSourcingLandedCost({
    ...line,
    unitCostCny: line.unitPriceRmb,
  }, normalizeSourcingCostConfig(costConfig));
  if (!result) return { status: "needs_data" as const, result };
  const incomplete = result.flags.some((flag) => ["freight_excluded", "no_market_price", "basis_unverified", "placeholder", "near_zero", "margin_too_high"].includes(flag));
  if (incomplete || result.marketPerPiece === null || result.minViablePrice === null)
    return { status: "needs_data" as const, result };
  return { status: result.marketPerPiece >= result.minViablePrice ? "pass" as const : "fail" as const, result };
}

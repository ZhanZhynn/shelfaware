export type LandedCostInput = {
  quantity: number;
  unitPriceCny: number;
  fxRate: number;
  freightMyr?: number;
  dutyRate?: number;
  taxRate?: number;
  insuranceMyr?: number;
  localDeliveryMyr?: number;
  otherCostMyr?: number;
};

export type SourcingCostConfig = {
  fxCnyMyr: number;
  productCostMultiplier: number;
  shippingRateMyrPerM3: number;
  shopeeFeePercent: number;
  fulfilmentFeePercent: number;
  goldMarkup: number;
  tier2Markup: number;
  razorMarkup: number;
};

export const defaultSourcingCostConfig: SourcingCostConfig = {
  fxCnyMyr: 0.61,
  productCostMultiplier: 1.07,
  shippingRateMyrPerM3: 410,
  shopeeFeePercent: 25,
  fulfilmentFeePercent: 8,
  goldMarkup: 1.8,
  tier2Markup: 1.6,
  razorMarkup: 1.9,
};

export type SourcingLandedCostInput = {
  unitCostCny?: number | null;
  piecesPerSellingUnit?: number | null;
  cartonLengthCm?: number | null;
  cartonWidthCm?: number | null;
  cartonHeightCm?: number | null;
  piecesPerCarton?: number | null;
  marketPriceMyr?: number | null;
  marketPack?: number | null;
  overrideCostMyr?: number | null;
  shippingOverrideMyrPerPiece?: number | null;
};

export type SourcingLandedCostFlag =
  | "freight_excluded"
  | "shipping_overridden"
  | "no_market_price"
  | "placeholder"
  | "near_zero"
  | "margin_too_high"
  | "basis_unverified";

export type SourcingLandedCostResult = {
  cartonM3: number;
  productCostPerPiece: number;
  freightPerPiece: number;
  shippingOverrideMyrPerPiece: number | null;
  landed: number;
  keepRate: number;
  marketPerPiece: number | null;
  netRevenue: number | null;
  profitPerPiece: number | null;
  roi: number | null;
  marginPercent: number | null;
  minViablePrice: number | null;
  rspGold: number;
  rspTier2: number;
  rspRazor: number;
  flags: SourcingLandedCostFlag[];
};

const finiteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/** Safely reads a workspace cost configuration and fills missing legacy fields. */
export function normalizeSourcingCostConfig(
  value: unknown,
): SourcingCostConfig {
  const input =
    value && typeof value === "object"
      ? (value as Partial<SourcingCostConfig>)
      : {};
  const configuredNumber = (key: keyof SourcingCostConfig) => {
    const candidate = input[key];
    return typeof candidate === "number" && Number.isFinite(candidate)
      ? candidate
      : null;
  };
  const positive = (key: keyof SourcingCostConfig) => {
    const candidate = configuredNumber(key);
    return candidate !== null && candidate > 0
      ? candidate
      : defaultSourcingCostConfig[key];
  };
  const percentage = (key: "shopeeFeePercent" | "fulfilmentFeePercent") => {
    const candidate = configuredNumber(key);
    return candidate !== null && candidate >= 0 && candidate < 100
      ? candidate
      : defaultSourcingCostConfig[key];
  };
  const shopeeFeePercent = percentage("shopeeFeePercent");
  const fulfilmentFeePercent = percentage("fulfilmentFeePercent");
  const feesAreViable = shopeeFeePercent + fulfilmentFeePercent < 100;
  return {
    fxCnyMyr: positive("fxCnyMyr"),
    productCostMultiplier: positive("productCostMultiplier"),
    shippingRateMyrPerM3: positive("shippingRateMyrPerM3"),
    shopeeFeePercent: feesAreViable
      ? shopeeFeePercent
      : defaultSourcingCostConfig.shopeeFeePercent,
    fulfilmentFeePercent: feesAreViable
      ? fulfilmentFeePercent
      : defaultSourcingCostConfig.fulfilmentFeePercent,
    goldMarkup: positive("goldMarkup"),
    tier2Markup: positive("tier2Markup"),
    razorMarkup: positive("razorMarkup"),
  };
}

/**
 * Canonical D-Day model: calculates an RM landed cost for one customer-facing piece.
 * Freight is volumetric and all supplier/market packs are normalized before pricing.
 */
export function calculateSourcingLandedCost(
  input: SourcingLandedCostInput,
  costConfig?: Partial<SourcingCostConfig> | null,
): SourcingLandedCostResult | null {
  const config = normalizeSourcingCostConfig(costConfig);
  const flags: SourcingLandedCostFlag[] = [];
  const unitCostCny = finiteNumber(input.unitCostCny);
  const overrideCostMyr = finiteNumber(input.overrideCostMyr);
  if (unitCostCny <= 0 && overrideCostMyr <= 0) return null;

  const suppliedPiecesPerSellingUnit = finiteNumber(input.piecesPerSellingUnit);
  const piecesPerSellingUnit = Math.max(1, suppliedPiecesPerSellingUnit || 1);
  const perSellingUnitMyr =
    overrideCostMyr > 0
      ? overrideCostMyr
      : unitCostCny * config.fxCnyMyr * config.productCostMultiplier;
  const productCostPerPiece = perSellingUnitMyr / piecesPerSellingUnit;

  const length = finiteNumber(input.cartonLengthCm);
  const width = finiteNumber(input.cartonWidthCm);
  const height = finiteNumber(input.cartonHeightCm);
  const piecesPerCarton = finiteNumber(input.piecesPerCarton);
  const cartonM3 =
    length > 0 && width > 0 && height > 0
      ? (length * width * height) / 1_000_000
      : 0;
  const calculatedFreightPerPiece =
    cartonM3 > 0 && piecesPerCarton > 0
      ? (cartonM3 * config.shippingRateMyrPerM3) / piecesPerCarton
      : 0;
  const shippingOverrideMyrPerPiece =
    input.shippingOverrideMyrPerPiece === null ||
    input.shippingOverrideMyrPerPiece === undefined
      ? null
      : Math.max(0, finiteNumber(input.shippingOverrideMyrPerPiece));
  const freightPerPiece =
    shippingOverrideMyrPerPiece ?? calculatedFreightPerPiece;
  if (shippingOverrideMyrPerPiece !== null) flags.push("shipping_overridden");
  else if (calculatedFreightPerPiece === 0) flags.push("freight_excluded");

  const landed = productCostPerPiece + freightPerPiece;
  const keepRate =
    1 - (config.shopeeFeePercent + config.fulfilmentFeePercent) / 100;
  const suppliedMarketPack = finiteNumber(input.marketPack);
  const marketListingPrice = finiteNumber(input.marketPriceMyr);
  const marketPerPiece =
    marketListingPrice > 0
      ? marketListingPrice / Math.max(1, suppliedMarketPack || 1)
      : null;
  if (marketPerPiece === null) flags.push("no_market_price");
  if (
    suppliedPiecesPerSellingUnit <= 0 ||
    (marketListingPrice > 0 && suppliedMarketPack <= 0)
  ) {
    flags.push("basis_unverified");
  }
  if (landed >= 9999 || unitCostCny >= 9999) flags.push("placeholder");
  if (unitCostCny > 0 && unitCostCny < 0.05) flags.push("near_zero");
  if (marketPerPiece && landed > 0 && marketPerPiece / landed > 30)
    flags.push("margin_too_high");

  const netRevenue = marketPerPiece === null ? null : marketPerPiece * keepRate;
  const profitPerPiece = netRevenue === null ? null : netRevenue - landed;
  return {
    cartonM3,
    productCostPerPiece,
    freightPerPiece,
    shippingOverrideMyrPerPiece,
    landed,
    keepRate,
    marketPerPiece,
    netRevenue,
    profitPerPiece,
    roi:
      profitPerPiece === null || landed <= 0 ? null : profitPerPiece / landed,
    marginPercent:
      profitPerPiece === null || marketPerPiece === null
        ? null
        : (100 * profitPerPiece) / marketPerPiece,
    minViablePrice: keepRate > 0 ? landed / keepRate : null,
    rspGold: landed * config.goldMarkup,
    rspTier2: landed * config.tier2Markup,
    rspRazor: landed * config.razorMarkup,
    flags,
  };
}

/** Calculates an estimate only; it never changes the approved quote or PO snapshot. */
export function estimateLandedCost(input: LandedCostInput) {
  const goodsMyr = input.quantity * input.unitPriceCny * input.fxRate;
  const freightMyr = input.freightMyr ?? 0;
  const dutyMyr = ((goodsMyr + freightMyr) * (input.dutyRate ?? 0)) / 100;
  const taxMyr =
    ((goodsMyr + freightMyr + dutyMyr) * (input.taxRate ?? 0)) / 100;
  const insuranceMyr = input.insuranceMyr ?? 0;
  const localDeliveryMyr = input.localDeliveryMyr ?? 0;
  const otherCostMyr = input.otherCostMyr ?? 0;
  const totalMyr =
    goodsMyr +
    freightMyr +
    dutyMyr +
    taxMyr +
    insuranceMyr +
    localDeliveryMyr +
    otherCostMyr;
  return {
    goodsMyr,
    freightMyr,
    dutyMyr,
    taxMyr,
    insuranceMyr,
    localDeliveryMyr,
    otherCostMyr,
    totalMyr,
    unitLandedMyr: input.quantity ? totalMyr / input.quantity : 0,
  };
}

/** Splits actual shipment charges across accepted receipt units, preserving the total to cents. */
export function allocateLandedCost(totalMyr: number, quantities: number[]) {
  const totalQuantity = quantities.reduce((sum, quantity) => sum + quantity, 0);
  if (!totalQuantity || !totalMyr) return quantities.map(() => 0);
  let remaining = Math.round(totalMyr * 100);
  return quantities.map((quantity, index) => {
    const allocation =
      index === quantities.length - 1
        ? remaining
        : Math.round((Math.round(totalMyr * 100) * quantity) / totalQuantity);
    remaining -= allocation;
    return allocation / 100;
  });
}

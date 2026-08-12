export type RecipeComponent = { productId: string; quantity: number };

export function safelyNormalizedUnits(offerUnits: number, components?: RecipeComponent[]) {
  if (!components?.length) return { units: null, mixed: false, covered: false };
  if (components.length !== 1) return { units: null, mixed: true, covered: false };
  return { units: offerUnits * components[0]!.quantity, mixed: false, covered: true };
}

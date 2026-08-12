export type AttributionActor = { id: string; role: string | null };

export function canViewSharedAttribution(actor: AttributionActor) {
  return ["admin", "user", "supplier", "client", "retailer"].includes(actor.role ?? "");
}

export function canMutateSharedAttribution(actor: AttributionActor) {
  return actor.role === "admin";
}

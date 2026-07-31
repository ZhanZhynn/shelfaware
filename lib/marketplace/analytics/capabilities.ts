import { prisma } from "@/prisma/client";
import { invalidateMarketplaceAnalytics } from "@/lib/cache/cache-utils";
import type { MarketplacePlatform } from "./types";

export const capabilityNames = ["orders", "finance", "refunds", "settlements", "buyerIdentity"] as const;
export const capabilityStates = ["unknown", "pending", "available", "unavailable", "unauthorized", "failed"] as const;
export type CapabilityName = typeof capabilityNames[number];
export type CapabilityState = typeof capabilityStates[number];

export type CapabilityRecord = { capability: CapabilityName; state: CapabilityState; detail: string | null; checkedAt: Date; observedAt: Date | null; endpointVersion: string | null; retryAt: Date | null };

export async function ensureMarketplaceAnalyticsConnection(input: { userId: string; platform: MarketplacePlatform; shopId: string }) {
  const existing = await prisma.marketplaceAnalyticsConnection.findUnique({ where: { platform_shopId: { platform: input.platform, shopId: input.shopId } } });
  if (existing && existing.userId !== input.userId) throw new Error("Marketplace analytics connection owner mismatch");
  return prisma.marketplaceAnalyticsConnection.upsert({
    where: { platform_shopId: { platform: input.platform, shopId: input.shopId } },
    create: input,
    // Owner mismatch is rejected above; this never transfers ownership.
    update: {},
  });
}

function isCapabilityState(value: string): value is CapabilityState {
  return (capabilityStates as readonly string[]).includes(value);
}

/** Missing records are deliberately represented as unknown, never inferred from OAuth scopes. */
export async function getMarketplaceCapabilities(platform: MarketplacePlatform, shopIds: string[]): Promise<Record<CapabilityName, CapabilityState>> {
  const records = shopIds.length ? await prisma.marketplaceAnalyticsCapability.findMany({ where: { platform, shopId: { in: shopIds } } }) : [];
  return Object.fromEntries(capabilityNames.map((capability) => {
    const values = records.filter((record) => record.capability === capability).map((record) => isCapabilityState(record.state) ? record.state : "unknown");
    // A multi-shop response is only available when every selected connection is available.
    const state = shopIds.length === 0 || values.length !== shopIds.length ? "unknown" : values.includes("failed") ? "failed" : values.includes("unauthorized") ? "unauthorized" : values.includes("unavailable") ? "unavailable" : values.includes("pending") ? "pending" : values.every((value) => value === "available") ? "available" : "unknown";
    return [capability, state];
  })) as Record<CapabilityName, CapabilityState>;
}

export async function setMarketplaceCapability(input: { userId: string; platform: MarketplacePlatform; shopId: string; capability: CapabilityName; state: CapabilityState; detail?: string; endpointVersion?: string; observedFields?: string[]; retryAt?: Date | null; errorCode?: string }) {
  const now = new Date();
  const connection = await ensureMarketplaceAnalyticsConnection(input);
  const result = await prisma.marketplaceAnalyticsCapability.upsert({
    where: { platform_shopId_capability: { platform: input.platform, shopId: input.shopId, capability: input.capability } },
    create: { ...input, connectionId: connection.id, detail: input.detail, endpointVersion: input.endpointVersion, observedFields: input.observedFields ?? [], errorCode: input.errorCode, retryAt: input.retryAt, checkedAt: now, observedAt: input.state === "available" ? now : null },
    update: { connectionId: connection.id, state: input.state, detail: input.detail, endpointVersion: input.endpointVersion, observedFields: input.observedFields ?? [], errorCode: input.errorCode, retryAt: input.retryAt, checkedAt: now, observedAt: input.state === "available" ? now : undefined },
  });
  await invalidateMarketplaceAnalytics(input.platform);
  return result;
}

export async function getMarketplaceFinancialReadiness(platform: MarketplacePlatform, shopIds: string[]) {
  const now = new Date();
  const [readiness, records] = shopIds.length ? await Promise.all([
    prisma.marketplaceAnalyticsReadiness.findMany({ where: { platform, shopId: { in: shopIds }, financeReady: true }, select: { shopId: true } }),
    prisma.marketplaceAnalyticsReconciliation.findMany({ where: { platform, shopId: { in: shopIds }, decision: "approved", expiresAt: { gt: now } }, select: { shopId: true } }),
  ]) : [[], []];
  return shopIds.length > 0 && shopIds.every((shopId) => readiness.some((record) => record.shopId === shopId) && records.some((record) => record.shopId === shopId));
}

export async function setMarketplaceFinancialReadiness(input: { userId: string; platform: MarketplacePlatform; shopId: string; financeReady: boolean; reconciledAt?: Date | null; reconciliationId?: string; detail?: string }) {
  const connection = await ensureMarketplaceAnalyticsConnection(input);
  const reconciledAt = input.financeReady ? input.reconciledAt ?? new Date() : null;
  const result = await prisma.marketplaceAnalyticsReadiness.upsert({
    where: { platform_shopId: { platform: input.platform, shopId: input.shopId } },
    create: { ...input, connectionId: connection.id, reconciledAt },
    update: { connectionId: connection.id, financeReady: input.financeReady, reconciledAt, reconciliationId: input.reconciliationId, detail: input.detail },
  });
  await invalidateMarketplaceAnalytics(input.platform);
  return result;
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  marketplaceOwnerIds: vi.fn(),
  marketplaceSyncJob: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() },
  shopeeShop: { findFirst: vi.fn() },
  lazadaShop: { findFirst: vi.fn() },
  tikTokShop: { findFirst: vi.fn() },
  shopifyShop: { findFirst: vi.fn() },
}));

vi.mock("@/prisma/client", () => ({
  prisma: {
    marketplaceSyncJob: mocks.marketplaceSyncJob,
    shopeeShop: mocks.shopeeShop,
    lazadaShop: mocks.lazadaShop,
    tikTokShop: mocks.tikTokShop,
    shopifyShop: mocks.shopifyShop,
  },
}));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: mocks.marketplaceOwnerIds }));

import {
  MAX_MARKETPLACE_SYNC_ATTEMPTS,
  claimMarketplaceSyncJob,
  completeMarketplaceSyncJob,
  createMarketplaceSyncJob,
  failMarketplaceSyncJob,
  getMarketplaceSyncJob,
  marketplaceSyncErrorCode,
  retryMarketplaceSyncJob,
} from "./sync-jobs";

const now = new Date("2026-09-26T12:00:00.000Z");
const job = (overrides: Record<string, unknown> = {}) => ({
  id: "a".repeat(24),
  platform: "shopee",
  shopId: "b".repeat(24),
  syncType: "orders",
  requestedByUserId: "c".repeat(24),
  idempotencyKey: "request_1",
  input: { daysBack: 30 },
  status: "pending",
  leaseOwner: null,
  leaseExpiresAt: null,
  attempts: 0,
  lastError: null,
  errors: null,
  nextAttemptAt: null,
  startedAt: null,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.marketplaceOwnerIds.mockResolvedValue(["c".repeat(24)]);
});

describe("MarketplaceSyncJob", () => {
  it("creates once and coalesces a duplicate platform/shop/sync-type request", async () => {
    mocks.marketplaceSyncJob.findUnique.mockResolvedValueOnce(null);
    mocks.marketplaceSyncJob.create.mockResolvedValue(job());
    const created = await createMarketplaceSyncJob({
      platform: "shopee",
      shopId: "b".repeat(24),
      syncType: "orders",
      requestedByUserId: "c".repeat(24),
      idempotencyKey: "request_1",
      input: { daysBack: 30 },
    });
    mocks.marketplaceSyncJob.findUnique.mockResolvedValueOnce(job());
    const coalesced = await createMarketplaceSyncJob({
      platform: "shopee",
      shopId: "b".repeat(24),
      syncType: "orders",
      requestedByUserId: "c".repeat(24),
    });

    expect(created.coalesced).toBe(false);
    expect(coalesced.coalesced).toBe(true);
    expect(mocks.marketplaceSyncJob.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idempotencyKey: "request_1", input: { daysBack: 30 } }),
    }));
  });

  it("resolves a unique-index race to the durable existing job", async () => {
    mocks.marketplaceSyncJob.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(job());
    mocks.marketplaceSyncJob.create.mockRejectedValue({ code: "P2002" });

    const result = await createMarketplaceSyncJob({ platform: "shopee", shopId: "b".repeat(24), syncType: "orders", requestedByUserId: "c".repeat(24) });

    expect(result).toMatchObject({ coalesced: true, job: { id: "a".repeat(24) } });
  });

  it("atomically claims only an eligible expired-or-unleased job", async () => {
    mocks.marketplaceSyncJob.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

    await expect(claimMarketplaceSyncJob("a".repeat(24), "worker-a", now, 30_000)).resolves.toBe(true);

    expect(mocks.marketplaceSyncJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["pending", "retrying", "running"] }, attempts: { lt: MAX_MARKETPLACE_SYNC_ATTEMPTS } }),
      data: expect.objectContaining({ status: "running", attempts: { increment: 1 }, leaseOwner: "worker-a", leaseExpiresAt: new Date(now.getTime() + 30_000) }),
    }));
  });

  it("will not complete after its lease has been lost", async () => {
    mocks.marketplaceSyncJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(completeMarketplaceSyncJob("a".repeat(24), "worker-a", now)).resolves.toBe(false);
    expect(mocks.marketplaceSyncJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ leaseOwner: "worker-a", leaseExpiresAt: { gt: now } }),
    }));
  });

  it("records only stable error codes and retries with bounded exponential delay", async () => {
    mocks.marketplaceSyncJob.findFirst.mockResolvedValue(job({ status: "running", leaseOwner: "worker-a", leaseExpiresAt: new Date(now.getTime() + 60_000), attempts: 1, errors: [] }));
    mocks.marketplaceSyncJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(retryMarketplaceSyncJob("a".repeat(24), "worker-a", "provider leaked a secret", now)).resolves.toBe(true);

    expect(marketplaceSyncErrorCode("provider leaked a secret")).toBe("SYNC_ATTEMPT_FAILED");
    const update = mocks.marketplaceSyncJob.updateMany.mock.calls[0]?.[0];
    expect(update.data).toMatchObject({ status: "retrying", lastError: "SYNC_ATTEMPT_FAILED" });
    expect(update.data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + 22_500);
    expect(update.data.nextAttemptAt.getTime()).toBeLessThanOrEqual(now.getTime() + 37_500);
  });

  it("marks deterministic worker failures without retaining unsafe details", async () => {
    mocks.marketplaceSyncJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(failMarketplaceSyncJob("a".repeat(24), "worker-a", "provider token=secret", now)).resolves.toBe(true);

    const update = mocks.marketplaceSyncJob.updateMany.mock.calls[0]?.[0];
    expect(update.data).toMatchObject({ status: "failed", lastError: "SYNC_ATTEMPT_FAILED", leaseOwner: null });
    expect(JSON.stringify(update.data.errors)).not.toContain("secret");
  });

  it("scopes status reads to both the requesting owner and the current shop owner", async () => {
    mocks.marketplaceSyncJob.findFirst.mockResolvedValue(job());
    mocks.shopeeShop.findFirst.mockResolvedValue({ id: "b".repeat(24) });

    await expect(getMarketplaceSyncJob("shopee", "a".repeat(24), { id: "c".repeat(24), role: "admin" } as never)).resolves.toMatchObject({ id: "a".repeat(24) });
    expect(mocks.marketplaceSyncJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestedByUserId: { in: ["c".repeat(24)] } }),
    }));
    expect(mocks.shopeeShop.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "b".repeat(24), userId: { in: ["c".repeat(24)] } },
    }));
  });
});

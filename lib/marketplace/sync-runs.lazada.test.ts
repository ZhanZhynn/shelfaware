import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findRun: vi.fn(), transaction: vi.fn(), createRun: vi.fn(), createTask: vi.fn(), outbox: vi.fn(), findShop: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { marketplaceSyncRun: { findFirst: mocks.findRun }, $transaction: mocks.transaction, lazadaShop: { findFirst: mocks.findShop }, tikTokShop: { findFirst: mocks.findShop }, shopifyShop: { findFirst: mocks.findShop } } }));
vi.mock("@/lib/marketplace/access", () => ({ marketplaceOwnerIds: vi.fn(async () => ["owner"]) }));
import { createLazadaBoundedSyncRun, createMarketplaceSyncRun, getMarketplaceSyncRun } from "./sync-runs";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findRun.mockResolvedValue(null);
  mocks.createRun.mockResolvedValue({ id: "run" });
  mocks.createTask.mockImplementation(async ({ data }) => ({ id: `task-${data.sequence}`, ...data }));
  mocks.transaction.mockImplementation((work) => work({ marketplaceSyncRun: { create: mocks.createRun }, marketplaceSyncTask: { create: mocks.createTask }, marketplaceSyncDeliveryOutbox: { create: mocks.outbox } }));
});
afterEach(() => vi.useRealTimers());

describe("shared marketplace task graph creation", () => {
  it.each(["lazada", "tiktok", "shopify"] as const)("creates %s all streams and the initial delivery atomically", async (platform) => {
    const input = { dateFrom: "2026-08-01T00:00:00+08:00", dateTo: "2026-08-31T23:59:59+08:00" };
    const result = await createMarketplaceSyncRun({ platform, shopId: "shop", requestedByUserId: "actor", syncType: "all", input });
    expect(mocks.createRun).toHaveBeenCalledWith({ data: { platform, shopId: "shop", requestedByUserId: "actor", syncType: "all", input, idempotencyKey: null } });
    expect(result.run.tasks.map(({ stream }) => stream)).toEqual(["orders", "products", "finance"]);
    expect(result.run.tasks.every(({ required }) => required)).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.outbox).toHaveBeenCalledWith({ data: { taskId: "task-0", dedupeKey: "initial" } });
  });

  it("discovers the complete TikTok order cohort before running standalone finance", async () => {
    const result = await createMarketplaceSyncRun({ platform: "tiktok", shopId: "shop", requestedByUserId: "actor", syncType: "finance" });
    expect(result.run.tasks.map(({ stream }) => stream)).toEqual(["orders", "finance"]);
  });

  it.each(["lazada", "tiktok", "shopify"] as const)("freezes %s's default window once for all deliveries", async (platform) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T11:00:00Z"));
    const result = await createMarketplaceSyncRun({ platform, shopId: "shop", requestedByUserId: "actor", syncType: "all" });
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ input: { dateFrom: "2026-10-06T11:00:00.000Z", dateTo: "2026-10-21T11:00:00.000Z" } }) }));
    expect(result.run.tasks.map(({ stream }) => stream)).toEqual(["orders", "products", "finance"]);
  });

  it.each(["lazada", "tiktok", "shopify"] as const)("coalesces owned idempotent %s requests without recreating tasks", async (platform) => {
    mocks.findRun.mockResolvedValue({ id: "run", tasks: [{ id: "first" }] });
    expect(await createMarketplaceSyncRun({ platform, shopId: "shop", requestedByUserId: "actor", syncType: "all", idempotencyKey: "request" })).toMatchObject({ coalesced: true, firstTaskId: "first" });
    expect(mocks.findRun).toHaveBeenCalledWith(expect.objectContaining({ where: { platform, shopId: "shop", requestedByUserId: "actor", idempotencyKey: "request" } }));
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["lazada", "tiktok", "shopify"] as const)("scopes %s polling to both requester and current shop ownership", async (platform) => {
    mocks.findRun.mockResolvedValue({ id: "run", shopId: "shop", tasks: [] });
    mocks.findShop.mockResolvedValue({ id: "shop" });
    await expect(getMarketplaceSyncRun(platform, "run", { id: "actor", role: "admin" })).resolves.toMatchObject({ id: "run" });
    expect(mocks.findRun).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run", platform, requestedByUserId: { in: ["owner"] } } }));
    expect(mocks.findShop).toHaveBeenCalledWith({ where: { id: "shop", userId: { in: ["owner"] } }, select: { id: true } });
    mocks.findShop.mockResolvedValue(null);
    await expect(getMarketplaceSyncRun(platform, "run", { id: "actor", role: "admin" })).rejects.toThrow("Sync run not found");
  });
});
describe("Lazada historical run creation", () => {
  it("includes products in historical all syncs and creates the first durable delivery", async () => {
    const input = { dateFrom: "2026-08-01T00:00:00+08:00", dateTo: "2026-08-31T23:59:59+08:00" };
    const result = await createLazadaBoundedSyncRun({ shopId: "shop", requestedByUserId: "owner", syncType: "all", input });
    expect(mocks.createRun).toHaveBeenCalledWith({ data: { platform: "lazada", shopId: "shop", requestedByUserId: "owner", syncType: "all", input, idempotencyKey: null } });
    expect(result.run.tasks.map((task) => task.stream)).toEqual(["orders", "products", "finance"]);
    expect(mocks.outbox).toHaveBeenCalledWith({ data: { taskId: "task-0", dedupeKey: "initial" } });
  });
  it("reuses the same owned idempotent run without duplicating tasks", async () => {
    mocks.findRun.mockResolvedValue({ id: "run", tasks: [{ id: "task" }] });
    expect(await createLazadaBoundedSyncRun({ shopId: "shop", requestedByUserId: "owner", syncType: "finance", input: {}, idempotencyKey: "request" })).toMatchObject({ coalesced: true, firstTaskId: "task" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

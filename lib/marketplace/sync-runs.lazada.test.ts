import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findRun: vi.fn(), transaction: vi.fn(), createRun: vi.fn(), createTask: vi.fn(), outbox: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { marketplaceSyncRun: { findFirst: mocks.findRun }, $transaction: mocks.transaction } }));
import { createLazadaBoundedSyncRun } from "./sync-runs";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findRun.mockResolvedValue(null);
  mocks.createRun.mockResolvedValue({ id: "run" });
  mocks.createTask.mockImplementation(async ({ data }) => ({ id: `task-${data.sequence}`, ...data }));
  mocks.transaction.mockImplementation((work) => work({ marketplaceSyncRun: { create: mocks.createRun }, marketplaceSyncTask: { create: mocks.createTask }, marketplaceSyncDeliveryOutbox: { create: mocks.outbox } }));
});
describe("Lazada historical run creation", () => {
  it("atomically creates required order/finance tasks and the first durable delivery", async () => {
    const input = { dateFrom: "2026-08-01T00:00:00+08:00", dateTo: "2026-08-31T23:59:59+08:00" };
    const result = await createLazadaBoundedSyncRun({ shopId: "shop", requestedByUserId: "owner", syncType: "all", input });
    expect(mocks.createRun).toHaveBeenCalledWith({ data: { platform: "lazada", shopId: "shop", requestedByUserId: "owner", syncType: "all", input, idempotencyKey: null } });
    expect(result.run.tasks.map((task) => task.stream)).toEqual(["orders", "finance"]);
    expect(mocks.outbox).toHaveBeenCalledWith({ data: { taskId: "task-0", dedupeKey: "initial" } });
  });
  it("reuses the same owned idempotent run without duplicating tasks", async () => {
    mocks.findRun.mockResolvedValue({ id: "run", tasks: [{ id: "task" }] });
    expect(await createLazadaBoundedSyncRun({ shopId: "shop", requestedByUserId: "owner", syncType: "finance", input: {}, idempotencyKey: "request" })).toMatchObject({ coalesced: true, firstTaskId: "task" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), error: vi.fn() }));
vi.mock("@/prisma/client", () => ({ default: { syncLog: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.error } }));
import { runWithSyncLog } from "./run-with-sync-log";

const input = { shopId: "shop", userId: "actor", channel: "tiktok" as const, syncType: "orders" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({ id: "log" });
  mocks.update.mockResolvedValue({});
});

describe("runWithSyncLog", () => {
  it.each([
    { result: { synced: 2, created: 1, updated: 1, errors: [] }, status: "completed" },
    { result: { synced: 1, created: 0, updated: 1, errors: ["order failed"] }, status: "completed_with_errors" },
    { result: {}, status: "completed" },
  ])("records $status without dropping the returned result", async ({ result, status }) => {
    const operation = vi.fn().mockResolvedValue(result);
    await expect(runWithSyncLog(input, operation)).resolves.toBe(result);
    expect(mocks.create).toHaveBeenCalledWith({ data: { ...input, status: "running", triggeredBy: "manual" } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "log" }, data: expect.objectContaining({ status, itemsSynced: "synced" in result ? result.synced : 0, completedAt: expect.any(Date) }) });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each([new Error("provider unavailable"), "transport failed"])("records and rethrows the original operation failure: %s", async (error) => {
    await expect(runWithSyncLog({ ...input, triggeredBy: "webhook" }, async () => { throw error; })).rejects.toBe(error);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "log" }, data: expect.objectContaining({ status: "failed", errors: [error instanceof Error ? error.message : error] }) });
  });

  it("does not mask an operation failure when updating the failure log also fails", async () => {
    const original = new Error("write failed");
    mocks.update.mockRejectedValue(new Error("log unavailable"));
    await expect(runWithSyncLog(input, async () => { throw original; })).rejects.toBe(original);
    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it("does not execute the provider operation when a running log cannot be created", async () => {
    const original = new Error("database unavailable");
    mocks.create.mockRejectedValue(original);
    const operation = vi.fn();
    await expect(runWithSyncLog(input, operation)).rejects.toBe(original);
    expect(operation).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

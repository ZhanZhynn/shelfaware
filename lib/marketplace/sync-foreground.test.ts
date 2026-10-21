import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getRun: vi.fn(), dispatch: vi.fn() }));
vi.mock("./sync-runs", () => ({ getMarketplaceSyncRun: mocks.getRun }));
vi.mock("./sync-task-dispatch", () => ({ dispatchMarketplaceSyncTask: mocks.dispatch }));

import { executeMarketplaceSyncForeground } from "./sync-foreground";

const target = "http://localhost:3000";
const actor = { id: "actor", role: "admin" };
const now = new Date("2026-10-21T12:00:00Z");
const task = (overrides = {}) => ({ id: "orders", status: "pending", nextAttemptAt: null, leaseExpiresAt: null, ...overrides });
const run = (overrides = {}) => ({ id: "run", status: "running", executionMode: "foreground", executionTarget: target, tasks: [task(), task({ id: "products" })], ...overrides });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.getRun.mockResolvedValue(run());
  mocks.dispatch.mockResolvedValue({ status: "checkpointed", nextTaskId: "orders" });
});
afterEach(() => vi.useRealTimers());

describe("executeMarketplaceSyncForeground", () => {
  it("runs one scoped task/window with the foreground origin context", async () => {
    await expect(executeMarketplaceSyncForeground("lazada", "run", actor, target)).resolves.toMatchObject({ outcome: "checkpointed", retryAfterSeconds: 0 });
    expect(mocks.getRun).toHaveBeenCalledWith("lazada", "run", actor);
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith("orders", expect.any(String), now, { mode: "foreground", target });
  });

  it("resumes the first unfinished stream and does not restart completed orders", async () => {
    mocks.getRun.mockResolvedValue(run({ tasks: [task({ status: "completed" }), task({ id: "products" })] }));
    await executeMarketplaceSyncForeground("lazada", "run", actor, target);
    expect(mocks.dispatch).toHaveBeenCalledWith("products", expect.any(String), now, expect.anything());
  });

  it.each([
    { nextAttemptAt: new Date(now.getTime() + 30_000), status: "retrying" },
    { leaseExpiresAt: new Date(now.getTime() + 30_000), status: "running" },
  ])("waits for $status work instead of retrying early or stealing its lease", async (fields) => {
    mocks.getRun.mockResolvedValue(run({ tasks: [task(fields), task({ id: "products" })] }));
    await expect(executeMarketplaceSyncForeground("lazada", "run", actor, target)).resolves.toMatchObject({ outcome: "waiting", retryAfterSeconds: 30 });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    { executionMode: "queued" },
    { executionTarget: "https://production.example.test" },
  ])("rejects the wrong execution owner before calling a provider", async (fields) => {
    mocks.getRun.mockResolvedValue(run(fields));
    await expect(executeMarketplaceSyncForeground("lazada", "run", actor, target)).rejects.toThrow("created on this API origin");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each(["completed", "completed_with_warnings", "failed", "cancelled"])("leaves a %s run terminal", async (status) => {
    mocks.getRun.mockResolvedValue(run({ status }));
    await expect(executeMarketplaceSyncForeground("lazada", "run", actor, target)).resolves.toMatchObject({ outcome: "terminal", retryAfterSeconds: 0 });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("does not execute when requestor/shop ownership resolution fails", async () => {
    mocks.getRun.mockRejectedValue(new Error("Sync run not found"));
    await expect(executeMarketplaceSyncForeground("lazada", "run", actor, target)).rejects.toThrow("not found");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("returns fresh persisted progress after the last window completes", async () => {
    mocks.getRun.mockResolvedValueOnce(run()).mockResolvedValueOnce(run({ status: "completed", tasks: [task({ status: "completed" })] }));
    mocks.dispatch.mockResolvedValue({ status: "completed" });
    await expect(executeMarketplaceSyncForeground("lazada", "run", actor, target)).resolves.toMatchObject({ outcome: "completed", run: { status: "completed" }, retryAfterSeconds: 0 });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  dispatchMarketplaceSyncJob: vi.fn(),
  dispatchMarketplaceSyncTask: vi.fn(),
  enqueueMarketplaceSyncJob: vi.fn(),
  deliverMarketplaceSyncTaskOutbox: vi.fn(),
  getMarketplaceSyncTaskRecoveryDelivery: vi.fn(),
  isQStashConfigured: vi.fn(),
  verifyQStashWebhook: vi.fn(),
}));

vi.mock("@/lib/marketplace/sync-dispatch", () => ({ dispatchMarketplaceSyncJob: mocks.dispatchMarketplaceSyncJob }));
vi.mock("@/lib/marketplace/sync-task-dispatch", () => ({ dispatchMarketplaceSyncTask: mocks.dispatchMarketplaceSyncTask }));
vi.mock("@/lib/marketplace/sync-enqueue", () => ({ enqueueMarketplaceSyncJob: mocks.enqueueMarketplaceSyncJob }));
vi.mock("@/lib/marketplace/sync-runs", () => ({ deliverMarketplaceSyncTaskOutbox: mocks.deliverMarketplaceSyncTaskOutbox, getMarketplaceSyncTaskRecoveryDelivery: mocks.getMarketplaceSyncTaskRecoveryDelivery }));
vi.mock("@/lib/queue/qstash", () => ({ isQStashConfigured: mocks.isQStashConfigured }));
vi.mock("@/lib/queue/qstash-webhook", () => ({ verifyQStashWebhook: mocks.verifyQStashWebhook }));

import { POST } from "./route";

const jobId = "a".repeat(24);
const request = (headers: Record<string, string> = {}, body = JSON.stringify({ jobId })) => new NextRequest("http://localhost/api/marketplace/sync-jobs/worker", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body,
});

beforeEach(() => {
  vi.resetAllMocks();
  process.env.MARKETPLACE_SYNC_WORKER_SECRET = "worker-secret";
  mocks.isQStashConfigured.mockReturnValue(false);
  mocks.dispatchMarketplaceSyncJob.mockResolvedValue({ status: "completed" });
  mocks.dispatchMarketplaceSyncTask.mockResolvedValue({ status: "completed", nextTaskId: "b".repeat(24) });
  mocks.enqueueMarketplaceSyncJob.mockResolvedValue({ scheduled: true });
  mocks.deliverMarketplaceSyncTaskOutbox.mockResolvedValue({ scheduled: true });
  mocks.getMarketplaceSyncTaskRecoveryDelivery.mockResolvedValue(null);
});

describe("marketplace sync worker route", () => {
  it("accepts the configured timing-safe Bearer fallback and dispatches the requested job", async () => {
    const response = await POST(request({ authorization: "Bearer worker-secret" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed" });
    expect(mocks.dispatchMarketplaceSyncJob).toHaveBeenCalledWith(jobId, expect.any(String));
    expect(mocks.verifyQStashWebhook).not.toHaveBeenCalled();
  });

  it("rejects missing or incorrect worker credentials without dispatching", async () => {
    const missing = await POST(request());
    const wrong = await POST(request({ authorization: "Bearer worker-secrex" }));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(mocks.dispatchMarketplaceSyncJob).not.toHaveBeenCalled();
  });

  it("accepts a verified QStash callback without requiring the fallback secret", async () => {
    delete process.env.MARKETPLACE_SYNC_WORKER_SECRET;
    mocks.isQStashConfigured.mockReturnValue(true);
    mocks.verifyQStashWebhook.mockResolvedValue(true);
    const raw = JSON.stringify({ jobId });

    const response = await POST(request({ "upstash-signature": "signed", "upstash-message-id": "qstash-message" }, raw));

    expect(response.status).toBe(200);
    expect(mocks.verifyQStashWebhook).toHaveBeenCalledWith(expect.objectContaining({ signature: "signed", body: raw }));
    expect(mocks.dispatchMarketplaceSyncJob).toHaveBeenCalledWith(jobId, "qstash-message");
  });

  it("requires a configured authentication method and validates job payloads before dispatching", async () => {
    delete process.env.MARKETPLACE_SYNC_WORKER_SECRET;
    const unavailable = await POST(request());
    process.env.MARKETPLACE_SYNC_WORKER_SECRET = "worker-secret";
    const invalid = await POST(request({ authorization: "Bearer worker-secret" }, "{}"));

    expect(unavailable.status).toBe(503);
    expect(invalid.status).toBe(400);
    expect(mocks.dispatchMarketplaceSyncJob).not.toHaveBeenCalled();
  });

  it("schedules durable retries at their persisted retry time without returning provider details", async () => {
    const nextAttemptAt = new Date("2026-10-06T12:01:00.000Z");
    mocks.isQStashConfigured.mockReturnValue(true);
    mocks.verifyQStashWebhook.mockResolvedValue(true);
    mocks.dispatchMarketplaceSyncJob.mockResolvedValue({ status: "retrying", nextAttemptAt });

    const response = await POST(request({ "upstash-signature": "signed" }));

    expect(response.status).toBe(200);
    expect(mocks.enqueueMarketplaceSyncJob).toHaveBeenCalledWith(jobId, { notBefore: nextAttemptAt });
    expect(await response.json()).toMatchObject({ status: "retrying", nextAttemptAt: nextAttemptAt.toISOString() });
  });

  it("accepts a task delivery and wakes the next bounded task only after it settles", async () => {
    const taskId = "c".repeat(24);
    const response = await POST(request({ authorization: "Bearer worker-secret" }, JSON.stringify({ taskId })));

    expect(response.status).toBe(200);
    expect(mocks.dispatchMarketplaceSyncTask).toHaveBeenCalledWith(taskId, expect.any(String));
    expect(mocks.deliverMarketplaceSyncTaskOutbox).toHaveBeenCalledWith("b".repeat(24));
    expect(mocks.dispatchMarketplaceSyncJob).not.toHaveBeenCalled();
  });

  it("delivers reviews after an optional ads failure instead of stranding the run", async () => {
    const nextTaskId = "d".repeat(24);
    mocks.dispatchMarketplaceSyncTask.mockResolvedValue({ status: "failed", nextTaskId });
    const response = await POST(request({ authorization: "Bearer worker-secret" }, JSON.stringify({ taskId: "c".repeat(24) })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "failed" });
    expect(mocks.deliverMarketplaceSyncTaskOutbox).toHaveBeenCalledWith(nextTaskId);
  });
});

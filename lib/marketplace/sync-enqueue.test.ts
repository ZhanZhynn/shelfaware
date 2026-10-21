import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ configured: vi.fn(), client: vi.fn(), publish: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/queue/qstash", () => ({ isQStashConfigured: m.configured, getQStash: m.client }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error } }));
import { enqueueMarketplaceSyncJob, enqueueMarketplaceSyncTask } from "./sync-enqueue";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://console.example.test");
  m.configured.mockReturnValue(true);
  m.client.mockReturnValue({ publishJSON: m.publish });
});
afterEach(() => vi.unstubAllEnvs());

describe.each([{ enqueue: enqueueMarketplaceSyncJob, key: "jobId" }, { enqueue: enqueueMarketplaceSyncTask, key: "taskId" }])("durable queue delivery for $key", ({ enqueue, key }) => {
  it("keeps queue delivery pending when QStash is not configured", async () => {
    m.configured.mockReturnValue(false);
    await expect(enqueue("id")).resolves.toEqual({ scheduled: false });
    expect(m.client).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });
  it("preserves the configured API target and rounds a not-before deadline up to seconds", async () => {
    const notBefore = new Date("2026-10-21T12:00:00.001Z");
    expect(await enqueue("id", { notBefore })).toEqual({ scheduled: true, notBefore });
    expect(m.publish).toHaveBeenCalledWith({ url: "http://localhost:3000/api/marketplace/sync-jobs/worker", body: { [key]: "id" }, notBefore: 1792584001, retries: 3 });
  });
  it("uses the app URL only when an API URL is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
    await enqueue("id");
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ url: "https://console.example.test/api/marketplace/sync-jobs/worker", notBefore: undefined }));
  });
  it.each([undefined, "not a URL"])("does not publish with an unavailable target: %s", async (url) => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", url);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(await enqueue("id")).toEqual({ scheduled: false });
    expect(m.publish).not.toHaveBeenCalled();
  });
  it("does not expose queue credentials on a delivery failure", async () => {
    m.publish.mockRejectedValue(new Error("private queue credential"));
    expect(await enqueue("id")).toEqual({ scheduled: false });
    expect(JSON.stringify(m.error.mock.calls)).not.toContain("private");
  });
});

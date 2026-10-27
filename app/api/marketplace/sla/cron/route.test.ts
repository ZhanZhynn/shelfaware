import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ shopee: vi.fn(), lazada: vi.fn(), tiktok: vi.fn(), users: vi.fn(), create: vi.fn(), deliver: vi.fn(), active: vi.fn() }));
vi.mock("@/prisma/client", () => ({ prisma: { shopeeShop: { findMany: m.shopee }, lazadaShop: { findMany: m.lazada }, tikTokShop: { findMany: m.tiktok }, user: { findMany: m.users }, marketplaceSyncRun: { findFirst: m.active } } }));
vi.mock("@/lib/marketplace/sync-runs", () => ({ createMarketplaceSyncRun: m.create, deliverMarketplaceSyncTaskOutbox: m.deliver }));
import { GET } from "./route";
const request = (auth = "Bearer cron-fixture") => new NextRequest("http://localhost/api/marketplace/sla/cron", { headers: { authorization: auth } });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("CRON_SECRET", "cron-fixture"); vi.stubEnv("MARKETPLACE_SLA_CRON_ENABLED", "true");
  m.shopee.mockResolvedValue([{ id: "shopee", userId: "owner" }]); m.lazada.mockResolvedValue([{ id: "lazada", userId: "owner" }]); m.tiktok.mockResolvedValue([]);
  m.users.mockResolvedValue([{ id: "owner", status: "approved" }]); m.create.mockResolvedValue({ firstTaskId: "task", run: { id: "run" } }); m.deliver.mockResolvedValue({ scheduled: false });
  m.active.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
describe("operational SLA scheduler", () => {
  it("rejects invalid/absent secrets before enumerating shops", async () => {
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect((await GET(request("Bearer é"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", ""); expect((await GET(request())).status).toBe(500);
    expect(m.shopee).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("remains disabled until SLA storage is deployed and explicitly enabled", async () => {
    vi.stubEnv("MARKETPLACE_SLA_CRON_ENABLED", "false");
    expect(await (await GET(request())).json()).toEqual({ skipped: true, reason: "sla_schedule_disabled" });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("queues isolated per-shop SLA runs and never claims completed provider execution", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: 2, scheduled: 0, executionComplete: false, partial: false });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ platform: "shopee", shopId: "shopee", requestedByUserId: "owner", syncType: "sla", idempotencyKey: expect.stringContaining("sla-cron-") }));
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ platform: "lazada", shopId: "lazada", requestedByUserId: "owner", syncType: "sla" }));
    expect(m.deliver).toHaveBeenCalledTimes(2);
  });
  it("redelivers existing active runs instead of accumulating a new backlog each interval", async () => {
    m.active.mockResolvedValue({ id: "existing", tasks: [{ id: "existing-task" }] });
    expect(await (await GET(request())).json()).toMatchObject({ accepted: 2 });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.deliver).toHaveBeenCalledWith("existing-task");
  });
  it("skips rejected owners and reports scheduling failures safely", async () => {
    m.users.mockResolvedValueOnce([{ id: "owner", status: "rejected" }]);
    expect(await (await GET(request())).json()).toMatchObject({ accepted: 0 });
    expect(m.create).not.toHaveBeenCalled();
    m.create.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_TOKEN"));
    const response = await GET(request()); const body = await response.json();
    expect(body).toMatchObject({ partial: true }); expect(JSON.stringify(body)).not.toContain("PRIVATE_PROVIDER_TOKEN");
  });
});

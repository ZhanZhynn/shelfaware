import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env", () => ({ getEnvVar: () => "fixture-value" }));
import { getAllOrdersCustom, getOrdersPageCustom, validateFinanceDateRange } from "./custom-api";
import { LazadaProviderError } from "./provider-error";
import { lazadaSourceDate } from "./time";
import { lazadaOrderStatus, lazadaPaymentStatus } from "./status";
import type { LazadaShopContext } from "./server";
const context: LazadaShopContext = { shopId: "shop", sellerId: "seller", userId: "owner", countryCode: "my", accessToken: "fixture-token", refreshToken: "", tokenExpiry: null, refreshExpiry: null };

beforeEach(() => { vi.restoreAllMocks(); });
describe("Lazada bounded provider reads", () => {
  it("accepts numeric success codes and serializes date offsets without changing the instant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: 0, data: { countTotal: "1", orders: [{ order_id: 1 }] } }) }));
    const result = await getOrdersPageCustom(context, { created_after: "2026-08-01T00:00:00+08:00" });
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]![0]));
    expect(url.searchParams.get("created_after")).toBe("2026-07-31T16:00:00+0000");
    expect(result).toMatchObject({ total: 1, orders: [{ order_id: "1" }] });
  });
  it("preserves safe provider diagnostics without propagating raw messages or credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: "IllegalAccessToken", request_id: "provider-request-1", message: "access_token=secret", data: {} }) }));
    const error = await getOrdersPageCustom(context).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(LazadaProviderError);
    expect(error).toMatchObject({ code: "IllegalAccessToken", providerRequestId: "provider-request-1" });
    expect(String(error)).not.toContain("secret");
  });
  it("rejects short or repeated pages when they cannot establish complete coverage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: "0", data: { countTotal: "2", orders: [{ order_id: 1 }] } }) }));
    await expect(getAllOrdersCustom(context)).rejects.toThrow("incomplete order pagination");
  });
  it("uses the marketplace calendar for date-only finance endpoints", () => {
    expect(validateFinanceDateRange("2026-08-01T00:00:00+08:00", "2026-08-31T23:59:59+08:00")).toEqual({ startTime: "2026-08-01", endTime: "2026-08-31" });
    expect(lazadaSourceDate("2026-08-01 09:29:00", "my")).toEqual(new Date("2026-08-01T01:29:00Z"));
  });
  it("keeps mixed and unknown lifecycle states and does not manufacture settled refunds", () => {
    expect(lazadaOrderStatus(["Package Returned"])).toBe("returned");
    expect(lazadaOrderStatus(["delivered", "canceled"])).toBe("mixed");
    expect(lazadaOrderStatus(["new_provider_status"])).toBe("unknown");
    expect(lazadaPaymentStatus("returned")).toBe("unknown");
  });
});

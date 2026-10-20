import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env", () => ({ getEnvVar: () => "fixture-value" }));
import { getAllOrdersCustom, getOrdersPageCustom, getFinanceTransactionDetailsCustom, getAllFinanceTransactionDetailsCustom, validateFinanceDateRange } from "./custom-api";
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
    expect(lazadaOrderStatus(["shipped_back_success"])).toBe("returned");
    expect(lazadaOrderStatus(["delivered", "canceled"])).toBe("mixed");
    expect(lazadaOrderStatus(["new_provider_status"])).toBe("unknown");
    expect(lazadaPaymentStatus("returned")).toBe("unknown");
  });
  it.each([[null, "NULL"], ["private provider contents", "STRING"], [{ private: "contents" }, "OBJECT"]])("reports a safe finance envelope shape without converting unsupported data into zero rows", async (data, shape) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: "0", data, request_id: "fixture-request" }) }));
    const error = await getFinanceTransactionDetailsCustom(context, { start_time: "2026-08-01", end_time: "2026-08-01" }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: `MALFORMED_FINANCE_${shape}`, providerRequestId: "fixture-request" });
    expect(String(error)).not.toContain("private");
  });
  it("deduplicates identical finance observations but rejects conflicting values under one source ID", async () => {
    const first = { transaction_number: "source-1", amount: "7.93", fee_name: "Reversal Commission" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: "0", data: [first, { ...first }] }) }));
    expect(await getAllFinanceTransactionDetailsCustom(context, { start_time: "2026-08-01", end_time: "2026-08-01" })).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValue({ status: 200, json: async () => ({ code: "0", data: [{ ...first, paid_status: "No" }, { ...first, paid_status: "Yes" }] }) } as Response);
    expect(await getAllFinanceTransactionDetailsCustom(context, { start_time: "2026-08-01", end_time: "2026-08-01" })).toMatchObject([{ paid_status: "Yes" }]);
    vi.mocked(fetch).mockResolvedValue({ status: 200, json: async () => ({ code: "0", data: [first, { ...first, amount: "8.00" }] }) } as Response);
    await expect(getAllFinanceTransactionDetailsCustom(context, { start_time: "2026-08-01", end_time: "2026-08-01" })).rejects.toMatchObject({ code: "INCONSISTENT_FINANCE_TRANSACTION_ID", fields: ["amount"] });
  });
  it("normalizes numeric finance IDs and reports missing identities without logging source values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: "0", data: [{ transaction_number: 123, amount: "1.00" }] }) }));
    expect((await getFinanceTransactionDetailsCustom(context, { start_time: "2026-08-01", end_time: "2026-08-01" }))[0]?.transaction_number).toBe("123");
    vi.mocked(fetch).mockResolvedValue({ status: 200, json: async () => ({ code: "0", request_id: "fixture-request", data: [{ amount: "1.00", private_field: "private-value" }] }) } as Response);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(getFinanceTransactionDetailsCustom(context, { start_time: "2026-08-01", end_time: "2026-08-01" })).rejects.toMatchObject({ code: "MISSING_FINANCE_TRANSACTION_ID" });
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private-value");
    } finally { warning.mockRestore(); }
  });
  it("retains different source fee types under the same commercial transaction number", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: "0", data: [
      { transaction_number: "shared-source", fee_type: "13", fee_name: "Item Price Credit", amount: "20.00" },
      { transaction_number: "shared-source", fee_type: "14", fee_name: "Commission", amount: "-2.00" },
    ] }) }));
    expect(await getAllFinanceTransactionDetailsCustom(context, { start_time: "2026-08-01", end_time: "2026-08-01" })).toHaveLength(2);
  });
  it("treats numeric and string representations of component identifiers as the same observation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ code: "0", data: [
      { transaction_number: "source", fee_type: 13, order_no: 10, orderItem_no: 11, amount: "20.00" },
      { transaction_number: "source", fee_type: "13", order_no: "10", orderItem_no: "11", amount: "20.00" },
    ] }) }));
    expect(await getAllFinanceTransactionDetailsCustom(context, { start_time: "2026-08-01", end_time: "2026-08-01" })).toHaveLength(1);
  });
});

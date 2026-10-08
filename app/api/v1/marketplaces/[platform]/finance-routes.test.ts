import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ financeMarketplaceGet: vi.fn() }));
vi.mock("@/lib/marketplace/v1/finance-route", () => ({ financeMarketplaceGet: mocks.financeMarketplaceGet }));

import { GET as financialRecords } from "./financial-records/route";
import { GET as reconciliationStatus } from "./reconciliation-status/route";
import { GET as profit } from "./profit/route";

describe("v1 marketplace finance endpoint bindings", () => {
  it.each([
    ["financial-records", financialRecords],
    ["reconciliation-status", reconciliationStatus],
    ["profit", profit],
  ] as const)("binds %s to the finance handler", async (resource, handler) => {
    mocks.financeMarketplaceGet.mockResolvedValueOnce(NextResponse.json({ ok: true }));
    const request = new NextRequest("http://localhost/api/v1/marketplaces/shopee");
    await handler(request, { params: Promise.resolve({ platform: "shopee" }) });
    expect(mocks.financeMarketplaceGet).toHaveBeenLastCalledWith(resource, request, expect.anything());
  });
});

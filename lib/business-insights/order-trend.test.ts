import { describe, expect, it } from "vitest";
import { buildOrderTrendByMonth } from "./order-trend";

describe("buildOrderTrendByMonth", () => {
  it("keeps missing marketplace totals unavailable while preserving explicit zero", () => {
    const trend = buildOrderTrendByMonth([
      { id: "wms", source: "wms", total: 0, status: "paid", createdAt: "2026-01-02T00:00:00.000Z", items: [] },
      { id: "lazada", source: "lazada", total: null, status: "shipped", createdAt: "2026-01-03T00:00:00.000Z", items: [] },
    ]);
    expect(trend[0]).toMatchObject({ totalValue: null, wmsValue: 0, lazadaValue: null, wmsCount: 1, lazadaCount: 1 });
    expect(trend[1]).toMatchObject({ totalValue: 0, wmsValue: 0, lazadaValue: 0 });
  });
});

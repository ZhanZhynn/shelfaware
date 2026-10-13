import { describe, expect, it } from "vitest";
import { marketplaceSyncRunStatus, shopeeAllTaskGraph } from "./sync-runs";

describe("Shopee all sync run graph", () => {
  it("defines orders-and-escrow, products, then ads", () => {
    expect(shopeeAllTaskGraph.map((task) => task.stream)).toEqual(["orders_and_escrow", "products", "ads"]);
  });

  it("waits for every task before settling the parent and preserves optional ads as a warning", () => {
    expect(marketplaceSyncRunStatus([
      { required: true, status: "completed" },
      { required: true, status: "completed" },
      { required: false, status: "pending" },
    ])).toBeNull();
    expect(marketplaceSyncRunStatus([
      { required: true, status: "completed" },
      { required: true, status: "completed" },
      { required: false, status: "failed" },
    ])).toBe("completed_with_warnings");
  });
});

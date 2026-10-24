import { describe, expect, it } from "vitest";
import { marketplaceSyncRunResponse, marketplaceSyncRunStatus, shopeeAllTaskGraph } from "./sync-runs";

describe("Shopee all sync run graph", () => {
  it("defines orders-and-escrow, products, ads, then reviews", () => {
    expect(shopeeAllTaskGraph.map((task) => task.stream)).toEqual(["orders_and_escrow", "products", "ads", "reviews"]);
  });

  it("returns review counters without exposing provider cursors or collected review IDs", () => {
    const run = {
      id: "run", createdAt: new Date(), updatedAt: new Date(),
      tasks: [{ id: "task", stream: "reviews", checkpoint: { v: 1, cursor: "private-provider-cursor", pages: 1, records: 2, ids: ["12345678901234567890", "2"] } }],
    } as unknown as Parameters<typeof marketplaceSyncRunResponse>[0];
    const response = marketplaceSyncRunResponse(run);
    expect(response.tasks[0]!.checkpoint).toEqual({ version: 1, pagesObserved: 1, recordsObserved: 2, uniqueReviewsObserved: 2, cursorPresent: true });
    expect(JSON.stringify(response)).not.toContain("private-provider-cursor");
    expect(JSON.stringify(response)).not.toContain("12345678901234567890");
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

import { describe, expect, it } from "vitest";
import { parseSourcingImport } from "./import";

describe("parseSourcingImport", () => {
  it("returns valid rows and row-specific validation errors", async () => {
    const file = new File(["title,quantity\nWidget,10\n,2"], "cases.csv", { type: "text/csv" });
    const result = await parseSourcingImport(file, "workspace-1");
    expect(result.rows).toHaveLength(1); expect(result.rows[0]?.requestedQuantity).toBe(10); expect(result.errors).toEqual([{ row: 3, message: "Product/request name is required" }]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolCall } from "@/lib/ai/types";
import {
  getToolDefinitions,
  dispatchTool,
  parseToolCallArgs,
} from "./registry";
import type { ToolSession } from "./types";

const session: ToolSession = {
  id: "user-1",
  role: "ADMIN" as never,
  name: "Admin",
  email: "admin@example.com",
};

describe("getToolDefinitions", () => {
  it("returns one definition per registered tool", () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      expect(d.type).toBe("function");
      expect(typeof d.function.name).toBe("string");
      expect(typeof d.function.description).toBe("string");
      expect(d.function.parameters).toBeTypeOf("object");
    }
  });

  it("exposes all 8 inventory + 6 shopee tools", () => {
    const names = getToolDefinitions().map((d) => d.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "listProducts",
        "getProductBySku",
        "getLowStockProducts",
        "getInventorySummary",
        "listCategories",
        "listSuppliers",
        "listWarehouses",
        "getRecentOrders",
        "getShopeeSummary",
        "getShopeeNearSlaOrders",
        "getShopeeRecentOrders",
        "getShopeeProducts",
        "listShopeeShops",
        "getShopeeSyncStatus",
      ]),
    );
    expect(names).toHaveLength(14);
  });
});

describe("parseToolCallArgs", () => {
  const baseCall: ToolCall = {
    id: "call_1",
    type: "function",
    function: { name: "listProducts", arguments: "" },
  };

  it("parses valid JSON arguments", () => {
    const args = parseToolCallArgs({
      ...baseCall,
      function: { name: "listProducts", arguments: '{"limit":5}' },
    });
    expect(args).toEqual({ limit: 5 });
  });

  it("returns empty object when arguments is empty string", () => {
    expect(parseToolCallArgs(baseCall)).toEqual({});
  });

  it("returns empty object on invalid JSON", () => {
    const args = parseToolCallArgs({
      ...baseCall,
      function: { name: "listProducts", arguments: "{not json" },
    });
    expect(args).toEqual({});
  });

  it("returns empty object when parsed value is not an object", () => {
    const args = parseToolCallArgs({
      ...baseCall,
      function: { name: "listProducts", arguments: "42" },
    });
    expect(args).toEqual({});
  });
});

// dispatchTool is exercised end-to-end via the inventory/shopee test suites
// (real handlers + mocked Prisma) — those suites double as dispatch coverage.
describe("dispatchTool — unknown tool", () => {
  it("returns error for unknown tool", async () => {
    const result = await dispatchTool("doesNotExist", {}, session);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });
});
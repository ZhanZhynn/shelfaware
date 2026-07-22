import { describe, expect, it } from "vitest";
import { normalizeSourcingListCase } from "./contracts";

describe("sourcing list case contract", () => {
  it("provides empty relations for a newly created case", () => {
    expect(normalizeSourcingListCase({ id: "case-1" })).toMatchObject({ id: "case-1", quotes: [], orders: [] });
  });
});

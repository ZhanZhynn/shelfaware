import { describe, expect, it } from "vitest";
import { recordsAreProvisional } from "./reconciliation-status";

describe("marketplace reconciliation status", () => {
  it("keeps imported ledger records provisional until a current certification exists", () => {
    expect(recordsAreProvisional(3, 0)).toBe(true);
    expect(recordsAreProvisional(3, 1)).toBe(false);
  });

  it("does not mark an empty ledger as provisional", () => {
    expect(recordsAreProvisional(0, 0)).toBe(false);
  });
});

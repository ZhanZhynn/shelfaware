import { describe, expect, it } from "vitest";
import {
  isProductArchived,
  mergeProductListWhere,
  productNotDeletedWhere,
} from "./product-query";

describe("productNotDeletedWhere", () => {
  it("matches null and unset deletedAt (MongoDB legacy rows)", () => {
    expect(productNotDeletedWhere).toEqual({
      OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
    });
  });
});

describe("mergeProductListWhere", () => {
  it("ANDs catalog filter with caller where", () => {
    expect(mergeProductListWhere({ userId: "u1" })).toEqual({
      AND: [productNotDeletedWhere, { userId: "u1" }],
    });
  });
});

describe("isProductArchived", () => {
  it("false when deletedAt missing or null", () => {
    expect(isProductArchived({})).toBe(false);
    expect(isProductArchived({ deletedAt: null })).toBe(false);
  });

  it("true when deletedAt is set", () => {
    expect(isProductArchived({ deletedAt: new Date() })).toBe(true);
  });
});

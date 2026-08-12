import { describe, expect, it } from "vitest";
import { resolveShopeeProductId } from "./shopee-identity";

describe("legacy Shopee identity resolution", () => {
  it("uses a unique catalog SKU but never a display-name guess", () => {
    expect(resolveShopeeProductId({ shopeeItemId: null, sku: "SKU-10" }, [{ shopeeItemId: 10, itemSku: "SKU-10" }])).toBe(10);
    expect(resolveShopeeProductId({ shopeeItemId: null, sku: "SKU-10" }, [{ shopeeItemId: 10, itemSku: "SKU-10" }, { shopeeItemId: 11, itemSku: "SKU-10" }])).toBeNull();
    expect(resolveShopeeProductId({ shopeeItemId: null, sku: null }, [{ shopeeItemId: 10, itemSku: null }])).toBeNull();
  });
});

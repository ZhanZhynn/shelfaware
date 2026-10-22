import { describe, expect, it } from "vitest";
import { shopeeOrderItemAmounts } from "./order-item";

describe("Shopee sales price selection", () => {
  it.each([
    { discount: 10, price: 10, basis: "discounted_unit_price" },
    { discount: "9.50", price: 9.5, basis: "discounted_unit_price" },
    { discount: 0, price: 0, basis: "discounted_unit_price" },
    { discount: "0.00", price: 0, basis: "discounted_unit_price" },
    { discount: undefined, price: 12.5, basis: "original_unit_price" },
    { discount: null, price: 12.5, basis: "original_unit_price" },
    { discount: "", price: 12.5, basis: "original_unit_price" },
    { discount: "   ", price: 12.5, basis: "original_unit_price" },
    { discount: "invalid", price: 12.5, basis: "original_unit_price" },
    { discount: false, price: 12.5, basis: "original_unit_price" },
    { discount: -1, price: 12.5, basis: "original_unit_price" },
  ])("selects $discount as $basis, preserving zero", ({ discount, price, basis }) => {
    expect(shopeeOrderItemAmounts({ model_quantity_purchased: "2", model_original_price: 12.5, model_discounted_price: discount }))
      .toEqual({ quantity: 2, originalUnitPrice: 12.5, unitPrice: price, unitPriceBasis: basis, subtotal: price * 2 });
  });

  it("keeps unknown amounts and quantities unavailable instead of inventing zero sales", () => {
    expect(shopeeOrderItemAmounts({})).toMatchObject({ quantity: null, unitPrice: null, subtotal: null, unitPriceBasis: "unavailable" });
    expect(shopeeOrderItemAmounts({ model_quantity_purchased: 1.5, model_discounted_price: 10 })).toMatchObject({ quantity: null, subtotal: null });
    expect(shopeeOrderItemAmounts({ model_quantity_purchased: 2, model_original_price: Infinity })).toMatchObject({ unitPrice: null, subtotal: null });
    expect(shopeeOrderItemAmounts({ model_quantity_purchased: 0, quantity: 2, model_discounted_price: 10 })).toMatchObject({ quantity: 0, subtotal: 0 });
  });
});

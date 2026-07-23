import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkoutCreate: vi.fn(),
  constructEvent: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdate: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  productUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  rateLimit: vi.fn(),
  session: vi.fn(),
  invalidateAll: vi.fn(),
  invalidateOrder: vi.fn(),
  ensureInvoice: vi.fn(),
}));

vi.mock("@/utils/auth", () => ({ getSessionFromRequest: mocks.session }));
vi.mock("@/lib/api/rate-limit", () => ({
  defaultRateLimits: { standard: {}, strict: {} },
  withRateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: { sessions: { create: mocks.checkoutCreate } },
    webhooks: { constructEvent: mocks.constructEvent },
  }),
  getWebhookSecret: () => "whsec_test",
  isStripeConfigured: () => true,
  Stripe: {},
}));
vi.mock("@/prisma/client", () => ({
  prisma: {
    order: { findUnique: mocks.orderFindUnique, update: mocks.orderUpdate },
    invoice: { findUnique: mocks.invoiceFindUnique, update: mocks.invoiceUpdate },
    product: { update: mocks.productUpdate },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock("@/prisma/invoice", () => ({ ensureInvoiceForPaidOrder: mocks.ensureInvoice }));
vi.mock("@/lib/cache", () => ({
  invalidateAllServerCaches: mocks.invalidateAll,
  invalidateOnOrderChange: mocks.invalidateOrder,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST as checkout } from "./checkout/route";
import { POST as webhook } from "./webhook/route";

const paidOrder = {
  id: "order-1",
  userId: "user-1",
  clientId: "user-1",
  orderNumber: "SO-100",
  currency: "MYR",
  total: 12.5,
  subtotal: 12.5,
  tax: 0,
  shipping: 0,
  discount: 0,
  paymentStatus: "pending",
  status: "pending",
  items: [{ productId: "product-1", productName: "Storage box", sku: "BOX", price: 12.5, quantity: 1 }],
};

function checkoutRequest() {
  return new NextRequest("http://localhost/api/payments/checkout", {
    method: "POST",
    body: JSON.stringify({ type: "order", id: "order-1" }),
    headers: { "content-type": "application/json" },
  });
}

function completedCheckout(currency = "myr", amount = 1250) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_myr",
        currency,
        amount_total: amount,
        payment_intent: "pi_myr",
        metadata: { type: "order", referenceId: "order-1", orderId: "order-1", currency: "MYR", amountMinor: "1250" },
      },
    },
  };
}

describe("MYR payment integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ id: "user-1", role: "client" });
    mocks.rateLimit.mockResolvedValue(null);
    mocks.orderFindUnique.mockResolvedValue({ ...paidOrder });
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.checkoutCreate.mockResolvedValue({ id: "cs_myr", url: "https://checkout.stripe.test/cs_myr" });
    mocks.orderUpdate.mockResolvedValue({});
    mocks.ensureInvoice.mockResolvedValue({});
    mocks.invalidateAll.mockResolvedValue(undefined);
    mocks.invalidateOrder.mockResolvedValue(undefined);
  });

  it("creates a MYR Checkout session using MYR minor units and immutable settlement metadata", async () => {
    const response = await checkout(checkoutRequest());

    expect(response.status).toBe(200);
    expect(mocks.checkoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [expect.objectContaining({ price_data: expect.objectContaining({ currency: "myr", unit_amount: 1250 }) })],
      metadata: expect.objectContaining({ currency: "MYR", amountMinor: "1250", orderId: "order-1" }),
      payment_intent_data: expect.objectContaining({ metadata: expect.objectContaining({ currency: "MYR", amountMinor: "1250" }) }),
    }));
  });

  it("rejects a completed checkout whose currency does not match the MYR order", async () => {
    mocks.constructEvent.mockReturnValue(completedCheckout("usd", 1250));

    const response = await webhook(new NextRequest("http://localhost/api/payments/webhook", {
      method: "POST", body: "signed-payload", headers: { "stripe-signature": "sig" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.productUpdate).not.toHaveBeenCalled();
  });

  it("rejects a completed checkout whose MYR amount does not match the order", async () => {
    mocks.constructEvent.mockReturnValue(completedCheckout("myr", 1251));

    await webhook(new NextRequest("http://localhost/api/payments/webhook", {
      method: "POST", body: "signed-payload", headers: { "stripe-signature": "sig" },
    }));

    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.productUpdate).not.toHaveBeenCalled();
  });

  it("settles only the matching MYR checkout and is idempotent after payment", async () => {
    mocks.constructEvent.mockReturnValue(completedCheckout());

    await webhook(new NextRequest("http://localhost/api/payments/webhook", {
      method: "POST", body: "signed-payload", headers: { "stripe-signature": "sig" },
    }));
    expect(mocks.orderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentStatus: "paid", stripePaymentIntentId: "pi_myr" }) }));
    expect(mocks.productUpdate).toHaveBeenCalledTimes(1);

    mocks.orderFindUnique.mockResolvedValue({ ...paidOrder, paymentStatus: "paid", status: "confirmed" });
    await webhook(new NextRequest("http://localhost/api/payments/webhook", {
      method: "POST", body: "signed-payload", headers: { "stripe-signature": "sig" },
    }));
    expect(mocks.orderUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.productUpdate).toHaveBeenCalledTimes(1);
  });
});

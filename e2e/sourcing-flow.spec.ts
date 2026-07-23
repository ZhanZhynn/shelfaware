import { expect, test } from "@playwright/test";

const caseId = process.env.E2E_SOURCING_CASE_ID;
const workspaceId = process.env.E2E_SOURCING_WORKSPACE_ID;
const warehouseId = process.env.E2E_RECEIVING_WAREHOUSE_ID;
const productId = process.env.E2E_RECEIVING_PRODUCT_ID;
const poItemId = process.env.E2E_RECEIVING_PO_ITEM_ID;
const configured = Boolean(
  process.env.E2E_BASE_URL &&
    process.env.E2E_STORAGE_STATE &&
    caseId &&
    workspaceId &&
    warehouseId &&
    productId &&
    poItemId,
);

test.describe("critical sourcing flow", () => {
  test.skip(!configured, "Set the documented E2E sourcing environment to run against an isolated seeded workspace.");

  test("creates a sourcing request", async ({ page }) => {
    const title = `Playwright sourcing request ${Date.now()}`;
    await page.goto(`/sourcing/new?workspaceId=${workspaceId}`);
    await page.getByLabel("Product/request name").fill(title);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/sourcing\/[a-f\d]{24}$/i);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });

  test("compares offers, approves, creates and ships a PO, then records its receipt", async ({ page }) => {
    await page.goto(`/sourcing/${caseId}`);
    await expect(page.getByRole("heading", { name: "Supplier offer comparison" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve selected offer" })).toBeEnabled();

    await page.getByRole("button", { name: "Approve selected offer" }).click();
    await expect(page.getByText("approved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create purchase order" }).click();
    await expect(page.getByText("ordered", { exact: true })).toBeVisible();

    const poLink = page.getByRole("link", { name: /^PO-/ });
    await expect(poLink).toBeVisible();
    const purchaseOrderId = (await poLink.getAttribute("href"))?.split("/").pop();
    expect(purchaseOrderId).toBeTruthy();

    await page.getByRole("button", { name: "Mark as Shipped" }).click();
    await page.getByRole("button", { name: "Mark as Shipped", exact: true }).click();
    await expect(page.getByText("shipped", { exact: true })).toBeVisible();

    const response = await page.request.post("/api/receiving", {
      data: {
        warehouseId,
        poId: purchaseOrderId,
        items: [{ productId, poItemId, acceptedQuantity: 1 }],
      },
    });
    expect(response.status()).toBe(201);

    await page.reload();
    await expect(page.getByText("received", { exact: true })).toBeVisible();
  });
});

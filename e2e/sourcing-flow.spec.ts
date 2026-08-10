import { expect, test } from "@playwright/test";

const caseId = process.env.E2E_SOURCING_CASE_ID;
const workspaceId = process.env.E2E_SOURCING_WORKSPACE_ID;
const warehouseId = process.env.E2E_RECEIVING_WAREHOUSE_ID;
const configured = Boolean(
  process.env.E2E_BASE_URL &&
  process.env.E2E_STORAGE_STATE &&
  caseId &&
  workspaceId &&
  warehouseId,
);

test.describe("critical sourcing flow", () => {
  test.skip(
    !configured,
    "Set the documented E2E sourcing environment to run against an isolated seeded workspace.",
  );

  test("creates a sourcing request", async ({ page }) => {
    const title = `Playwright sourcing request ${Date.now()}`;
    await page.goto(`/sourcing/new?workspaceId=${workspaceId}`);
    await page.getByLabel("What product do you need?").fill(title);
    await page.getByRole("button", { name: "Save for later" }).click();
    await expect(page).toHaveURL(/\/sourcing\/[a-f\d]{24}$/i);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });

  test("compares offers, approves, creates and ships a PO, then records its receipt", async ({
    page,
  }) => {
    await page.goto(`/admin/sourcing/${caseId}`);
    await expect(
      page.getByRole("heading", { name: "Choose a supplier" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Choose this supplier" }).first().click();
    await expect(
      page.getByRole("button", { name: "Approve and create order" }),
    ).toBeEnabled();

    await page.getByRole("button", { name: "Approve and create order" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve and create order" }).click();
    await expect(page.getByText("Order created", { exact: true })).toBeVisible();

    const poLink = page.getByRole("link", { name: /^PO-/ });
    await expect(poLink).toBeVisible();
    const purchaseOrderId = (await poLink.getAttribute("href"))
      ?.split("/")
      .pop();
    expect(purchaseOrderId).toBeTruthy();

    // Global admins retain recovery permission even though the manager UI keeps shipment read-only.
    const shipmentResponse = await page.request.post(
      `/api/purchase-orders/${purchaseOrderId}/ship`,
      { data: {} },
    );
    expect(shipmentResponse.ok()).toBe(true);

    await page.goto(`/receiving?poId=${purchaseOrderId}&warehouseId=${warehouseId}`);
    await expect(page.getByText("PO-linked receiving:")).toBeVisible();
    const [receiveResponse] = await Promise.all([
      page.waitForResponse(
        (response) => response.url().endsWith("/api/receiving") && response.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Receive All" }).click(),
    ]);
    expect(receiveResponse.status()).toBe(201);

    await page.goto(`/admin/sourcing/${caseId}`);
    await expect(page.getByText("Received", { exact: true })).toBeVisible();
  });
});

import { expect, test } from "@playwright/test";
import {
  datetimeLocal,
  recipientPage,
  sourcingCollaborationConfigured,
  sourcingCollaborationEnvironment,
} from "./sourcing-collaboration.helpers";

const { caseId, cronSecret, recipientName } = sourcingCollaborationEnvironment;

test.describe("sourcing collaboration", () => {
  test.skip(!sourcingCollaborationConfigured, "Set the documented E2E sourcing collaboration environment to run against an isolated seeded workspace.");

  test("posts a mentioned comment, uploads an attachment, and delivers comment and SLA notifications", async ({ browser, page }) => {
    const suffix = Date.now();
    const commentBody = `Playwright collaboration comment ${suffix}`;
    const attachmentName = `playwright-attachment-${suffix}.csv`;

    await page.goto(`/admin/sourcing/${caseId}`);
    await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible();

    const recipient = page.locator("label").filter({ hasText: recipientName! }).getByRole("checkbox");
    await expect(recipient).toBeVisible();
    await recipient.check();
    await page.getByPlaceholder("Add a comment for the sourcing team").fill(commentBody);
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.getByText(commentBody, { exact: true })).toBeVisible();
    await expect(page.getByText(`Notified: ${recipientName}`, { exact: true })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: attachmentName,
      mimeType: "text/csv",
      buffer: Buffer.from("sku,quantity\nplaywright,1\n"),
    });
    await expect(page.getByRole("link", { name: attachmentName })).toBeVisible();

    const overdueAt = datetimeLocal(1);
    await page.getByLabel("Next action", { exact: true }).fill("Verify SLA reminder delivery");
    await page.getByLabel("Next action at", { exact: true }).fill(overdueAt);
    await page.getByLabel("SLA due at", { exact: true }).fill(overdueAt);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Next action updated")).toBeVisible();

    const reminderResponse = await page.request.post("/api/sourcing/reminders/cron", {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    expect(reminderResponse.status()).toBe(200);
    expect((await reminderResponse.json()).sent).toBeGreaterThan(0);

    const recipientSession = await recipientPage(browser);
    try {
      await recipientSession.page.goto(`/sourcing/${caseId}`);
      await recipientSession.page.getByLabel("Notifications").click();
      await expect(recipientSession.page.getByText(`New comment on`, { exact: false })).toBeVisible();
      await expect(recipientSession.page.getByText(/Sourcing SLA (due|escalation)/)).toBeVisible();
    } finally {
      await recipientSession.context.close();
    }
  });
});

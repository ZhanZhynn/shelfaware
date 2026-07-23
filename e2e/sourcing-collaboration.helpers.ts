import type { Browser, BrowserContext, Page } from "@playwright/test";

const requiredEnvironment = [
  "E2E_BASE_URL",
  "E2E_STORAGE_STATE",
  "E2E_SOURCING_COLLABORATION_CASE_ID",
  "E2E_SOURCING_RECIPIENT_STORAGE_STATE",
  "E2E_SOURCING_RECIPIENT_NAME",
  "E2E_CRON_SECRET",
] as const;

export const sourcingCollaborationEnvironment = {
  baseUrl: process.env.E2E_BASE_URL,
  caseId: process.env.E2E_SOURCING_COLLABORATION_CASE_ID,
  cronSecret: process.env.E2E_CRON_SECRET,
  recipientName: process.env.E2E_SOURCING_RECIPIENT_NAME,
  recipientStorageState: process.env.E2E_SOURCING_RECIPIENT_STORAGE_STATE,
};

export const sourcingCollaborationConfigured = requiredEnvironment.every((name) => Boolean(process.env[name]));

export async function recipientPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: sourcingCollaborationEnvironment.baseUrl,
    storageState: sourcingCollaborationEnvironment.recipientStorageState,
  });
  return { context, page: await context.newPage() };
}

export function datetimeLocal(minutesAgo: number) {
  const date = new Date(Date.now() - minutesAgo * 60_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

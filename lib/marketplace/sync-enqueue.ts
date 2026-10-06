import { logger } from "@/lib/logger";
import { getQStash, isQStashConfigured } from "@/lib/queue/qstash";

const workerPath = "/api/marketplace/sync-jobs/worker";

function workerUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) return null;
  try {
    return new URL(workerPath, baseUrl).toString();
  } catch {
    return null;
  }
}

export type MarketplaceSyncEnqueueResult = { scheduled: boolean; notBefore?: Date };

/**
 * Queue one durable job for the authenticated worker. This is intentionally a
 * no-op when QStash is absent: API requests must never run provider work inline.
 */
export async function enqueueMarketplaceSyncJob(id: string, options: { notBefore?: Date } = {}): Promise<MarketplaceSyncEnqueueResult> {
  if (!isQStashConfigured()) return { scheduled: false };

  const qstash = getQStash();
  const url = workerUrl();
  if (!qstash || !url) {
    logger.error("Marketplace sync queue is configured but worker delivery is unavailable");
    return { scheduled: false };
  }

  try {
    await qstash.publishJSON({
      url,
      body: { jobId: id },
      notBefore: options.notBefore ? Math.ceil(options.notBefore.getTime() / 1000) : undefined,
      retries: 3,
    });
    return { scheduled: true, notBefore: options.notBefore };
  } catch {
    // QStash failures are operational details; callers surface only pending work.
    logger.error("Failed to enqueue marketplace sync job");
    return { scheduled: false };
  }
}

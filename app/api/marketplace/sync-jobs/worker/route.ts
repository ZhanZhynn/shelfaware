import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { dispatchMarketplaceSyncJob } from "@/lib/marketplace/sync-dispatch";
import { enqueueMarketplaceSyncJob } from "@/lib/marketplace/sync-enqueue";
import { isQStashConfigured } from "@/lib/queue/qstash";
import { verifyQStashWebhook } from "@/lib/queue/qstash-webhook";

export const runtime = "nodejs";
export const maxDuration = 300;

const objectId = /^[a-f\d]{24}$/i;

function hasWorkerBearer(request: NextRequest) {
  const secret = process.env.MARKETPLACE_SYNC_WORKER_SECRET;
  const authorization = request.headers.get("authorization");
  const expected = secret ? `Bearer ${secret}` : "";
  return !!authorization
    && !!secret
    && authorization.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

async function isAuthorized(request: NextRequest, rawBody: string) {
  if (isQStashConfigured()) {
    const verified = await verifyQStashWebhook({
      signature: request.headers.get("upstash-signature"),
      body: rawBody,
      url: request.url,
      upstashRegion: request.headers.get("upstash-region"),
    });
    if (verified) return true;
  }
  return hasWorkerBearer(request);
}

/**
 * Authenticated durable sync worker. QStash signatures are preferred whenever
 * configured; self-hosted schedulers may POST { jobId } with the worker secret.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!(await isAuthorized(request, rawBody))) {
    const configured = isQStashConfigured() || !!process.env.MARKETPLACE_SYNC_WORKER_SECRET;
    return NextResponse.json({ error: configured ? "Unauthorized" : "Worker authentication is not configured" }, { status: configured ? 401 : 503 });
  }

  let jobId: unknown;
  try {
    jobId = (JSON.parse(rawBody) as { jobId?: unknown }).jobId;
  } catch {
    return NextResponse.json({ error: "Invalid job payload" }, { status: 400 });
  }
  if (typeof jobId !== "string" || !objectId.test(jobId)) {
    return NextResponse.json({ error: "Invalid job payload" }, { status: 400 });
  }

  try {
    const workerId = request.headers.get("upstash-message-id") ?? crypto.randomUUID();
    const result = await dispatchMarketplaceSyncJob(jobId, workerId);
    if (result.status === "retrying") {
      const queued = result.nextAttemptAt
        ? await enqueueMarketplaceSyncJob(jobId, { notBefore: result.nextAttemptAt })
        : { scheduled: false };
      if (!queued.scheduled && isQStashConfigured()) {
        // Make QStash retry delivery if it was temporarily unable to schedule the
        // durable retry. The response contains no provider details.
        return NextResponse.json({ error: "Retry scheduling failed" }, { status: 500 });
      }
    }

    return NextResponse.json({ status: result.status, nextAttemptAt: result.status === "retrying" ? result.nextAttemptAt?.toISOString() ?? null : undefined });
  } catch {
    return NextResponse.json({ error: "Marketplace sync worker failed" }, { status: 500 });
  }
}

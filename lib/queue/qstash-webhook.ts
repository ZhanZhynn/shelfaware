/**
 * QStash webhook verification and payload parsing.
 * Request bodies are single-use streams — read once as text, verify, then JSON.parse.
 */

import { Receiver, SignatureError } from "@upstash/qstash";
import { logger } from "@/lib/logger";
import { getEnvVar } from "@/lib/env";
import type { EmailQueueJob } from "@/lib/email/queue";
import { isQStashConfigured } from "@/lib/queue/qstash";

/** Cached Receiver (signing keys are stable at runtime). */
let qstashReceiver: Receiver | null = null;

/**
 * Lazily build Upstash Receiver from env signing keys.
 */
function getQStashReceiver(): Receiver | null {
  if (!isQStashConfigured()) {
    return null;
  }

  if (!qstashReceiver) {
    try {
      const currentSigningKey = getEnvVar("QSTASH_CURRENT_SIGNING_KEY");
      if (!currentSigningKey) {
        return null;
      }
      const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
      qstashReceiver = new Receiver({
        currentSigningKey,
        nextSigningKey: nextSigningKey || undefined,
      });
    } catch (error) {
      logger.error("Failed to create QStash Receiver", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  return qstashReceiver;
}

export type QStashWebhookVerifyInput = {
  /** Raw `upstash-signature` header value. */
  signature: string | null;
  /** Raw request body (same string used for JSON.parse). */
  body: string;
  /** Full destination URL QStash called (optional but recommended). */
  url?: string;
  /** `upstash-region` header for multi-region key rotation. */
  upstashRegion?: string | null;
};

/**
 * Verify a QStash callback using the official Receiver (current + next signing keys).
 */
export async function verifyQStashWebhook(
  input: QStashWebhookVerifyInput,
): Promise<boolean> {
  if (!isQStashConfigured()) {
    return false;
  }

  const receiver = getQStashReceiver();
  if (!receiver) {
    return false;
  }

  if (!input.signature) {
    logger.warn("QStash webhook missing signature");
    return false;
  }

  try {
    await receiver.verify({
      signature: input.signature,
      body: input.body,
      url: input.url,
      upstashRegion: input.upstashRegion ?? undefined,
    });
    return true;
  } catch (error) {
    if (error instanceof SignatureError) {
      logger.warn("QStash webhook signature invalid", {
        message: error.message,
      });
    } else {
      logger.error("QStash webhook verification failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
    return false;
  }
}

/**
 * Parse and validate an email queue job from the raw webhook body.
 * @throws SyntaxError when JSON is invalid
 * @throws Error when required job fields are missing
 */
export function parseEmailQueueJob(rawBody: string): EmailQueueJob {
  const parsed = JSON.parse(rawBody) as EmailQueueJob;

  if (!parsed?.type || !parsed?.data || !parsed?.recipientEmail) {
    throw new Error("Invalid job payload");
  }

  return parsed;
}

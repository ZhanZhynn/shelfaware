/**
 * Next.js instrumentation: Sentry (node + edge) and app services (Redis, QStash).
 */

import * as Sentry from "@sentry/nextjs";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { assertSecureRuntimeSecrets } from "@/lib/security/runtime-secrets";

export async function register() {
  // Fail before Sentry or optional services can capture unsafe configuration.
  // Next's build workers may use Docker's build-only signing placeholder.
  if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
    assertSecureRuntimeSecrets();
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      await import("./sentry.server.config");
    } catch {
      // Sentry optional when DSN missing
    }

    try {
      const { initializeRedis } = await import("@/lib/cache/redis");
      initializeRedis();

      const { getRedis, isRedisConfigured } = await import("@/lib/cache/redis");
      if (isRedisConfigured()) {
        const redis = getRedis();
        if (redis) {
          redis
            .exists("app:start_time")
            .then((exists) => {
              if (!exists) {
                redis
                  .set("app:start_time", new Date().toISOString())
                  .catch(() => {});
              }
            })
            .catch(() => {});
        }
      }
    } catch {
      // Redis optional
    }

    try {
      const { initializeQStash } = await import("@/lib/queue/qstash");
      initializeQStash();
    } catch {
      // QStash optional
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    try {
      await import("./sentry.edge.config");
    } catch {
      // Sentry optional when DSN missing
    }
  }
}

/** App Router: report unhandled request errors to Sentry */
export const onRequestError = Sentry.captureRequestError;

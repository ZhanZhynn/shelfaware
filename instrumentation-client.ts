/**
 * Sentry browser initialization (Next.js instrumentation-client hook).
 * Uses /api/monitoring tunnel so ad blockers do not block ingest.de.sentry.io.
 */

import * as Sentry from "@sentry/nextjs";
import {
  getClientSentryInitOptions,
  getReplayPrivacyOptions,
  isSentryEnabled,
} from "@/lib/monitoring/sentry-config";

if (isSentryEnabled()) {
  Sentry.init({
    ...getClientSentryInitOptions(),
    integrations: [
      Sentry.replayIntegration(getReplayPrivacyOptions()),
      Sentry.browserTracingIntegration(),
      Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    ],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

import { afterEach, expect, it } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { getServerSentryInitOptions } from "./sentry-config";

afterEach(async () => { await Sentry.close(2_000); });

it("sends sanitized error/transaction/log envelopes through the real SDK transport boundary", async () => {
  const envelopes: unknown[] = [];
  Sentry.init({
    ...getServerSentryInitOptions(),
    dsn: "https://public@o1.ingest.sentry.io/1",
    defaultIntegrations: [],
    integrations: [],
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 1,
    transport: () => ({
      send: async (envelope: unknown) => { envelopes.push(envelope); return { statusCode: 200 }; },
      flush: async () => true,
    }),
  });

  Sentry.captureEvent({
    message: "provider request failed",
    exception: { values: [{ type: "Error", value: "refresh_token=PRIVATE_A" }] },
    request: { url: "https://auth.example.test/token?app_secret=PRIVATE_B", headers: { Authorization: "PRIVATE_C", Cookie: "session_id=PRIVATE_D" }, data: "PRIVATE_UNLABELLED_BODY" },
    extra: { config: { payload: "PRIVATE_F" }, requestId: "req-keep" },
    breadcrumbs: [{ category: "http", data: { url: "https://api.example.test/products?access_token=PRIVATE_G" } }],
  });
  Sentry.captureEvent({
    type: "transaction", transaction: "GET /provider", start_timestamp: 1, timestamp: 2,
    contexts: { trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16), op: "http.server" } },
    spans: [{ trace_id: "a".repeat(32), span_id: "c".repeat(16), start_timestamp: 1, timestamp: 2, description: "https://api.example.test/orders?access_token=PRIVATE_H", data: { app_secret: "PRIVATE_I" } }],
  });
  Sentry.logger.error("refresh_token=PRIVATE_J", { app_secret: "PRIVATE_K", requestId: "req-keep" });
  await Sentry.flush(2_000);

  const serialized = JSON.stringify(envelopes);
  expect(envelopes.length).toBeGreaterThanOrEqual(3);
  expect(serialized).toContain("req-keep");
  expect(serialized).toContain("provider request failed");
  expect(serialized).not.toContain("PRIVATE_");
});

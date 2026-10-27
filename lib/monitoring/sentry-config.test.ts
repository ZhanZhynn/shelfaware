import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import {
  isBrowserTranslationRemoveChildError,
  scrubSentryEvent,
  getClientSentryInitOptions,
  getServerSentryInitOptions,
  getReplayPrivacyOptions,
} from "./sentry-config";

function removeChildEvent(
  extra?: Partial<ErrorEvent>,
): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: "NotFoundError",
          value:
            "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        },
      ],
    },
    ...extra,
  } as ErrorEvent;
}

describe("isBrowserTranslationRemoveChildError", () => {
  it("returns false for unrelated errors", () => {
    const event = {
      exception: { values: [{ type: "TypeError", value: "x" }] },
    } as ErrorEvent;
    expect(isBrowserTranslationRemoveChildError(event)).toBe(false);
  });

  it("returns true when breadcrumbs mention translated-ltr", () => {
    const event = removeChildEvent({
      breadcrumbs: [{ message: "UI Click → html.translated-ltr.dark" }],
    });
    expect(isBrowserTranslationRemoveChildError(event)).toBe(true);
    expect(scrubSentryEvent(event)).toBeNull();
  });

  it("returns false for removeChild without translation signals", () => {
    const event = removeChildEvent();
    expect(isBrowserTranslationRemoveChildError(event)).toBe(false);
    expect(scrubSentryEvent(event)).not.toBeNull();
  });
});

it("protects separately transmitted replay recordings", () => {
  const options = getReplayPrivacyOptions();
  expect(options).toMatchObject({ maskAllText: true, maskAllInputs: true, blockAllMedia: true, networkCaptureBodies: false, networkDetailAllowUrls: [] });
  expect(options.maskAttributes).toEqual(expect.arrayContaining(["title", "placeholder", "aria-label", "href", "src", "value", "action"]));
  const recording = options.beforeAddRecordingEvent({ data: { url: "https://api.example.test?access_token=PRIVATE_A", requestId: "keep-me" } });
  expect(JSON.stringify(recording)).not.toContain("PRIVATE_A");
  expect(JSON.stringify(recording)).toContain("keep-me");
});

describe.each([
  ["server", getServerSentryInitOptions],
  ["browser", getClientSentryInitOptions],
] as const)("%s telemetry boundaries", (_name, optionsFactory) => {
  it("redacts errors, breadcrumbs, transactions, spans, logs and metrics", () => {
    const options = optionsFactory();
    const fixtures = {
      beforeSend: { exception: { values: [{ type: "Error", value: "refresh_token=PRIVATE_A" }] }, request: { headers: { Authorization: "PRIVATE_B", Cookie: "PRIVATE_C" }, url: "https://auth.example.test/token?app_secret=PRIVATE_D" }, contexts: { custom: { access_token: "PRIVATE_E", requestId: "keep-request-id" } } },
      beforeBreadcrumb: { category: "http", data: { url: "https://api.example.test/orders?access_token=PRIVATE_A", requestId: "keep-request-id" } },
      beforeSendTransaction: { type: "transaction", spans: [{ description: "GET https://api.example.test/products?access_token=PRIVATE_A", data: { refresh_token: "PRIVATE_B", requestId: "keep-request-id" } }] },
      beforeSendSpan: { description: "GET /orders", data: { "http.request.header.x-api-key": "PRIVATE_A", requestId: "keep-request-id" } },
      beforeSendLog: { level: "error", message: "refresh_token=PRIVATE_A", attributes: { app_secret: "PRIVATE_B", requestId: "keep-request-id" } },
      beforeSendMetric: { name: "provider.failure", attributes: { apiKey: "PRIVATE_A", requestId: "keep-request-id" } },
    };
    for (const [name, payload] of Object.entries(fixtures)) {
      const hook = options[name as keyof typeof options] as (value: unknown) => unknown;
      const safe = hook(payload);
      expect(JSON.stringify(safe)).not.toContain("PRIVATE_");
      expect(JSON.stringify(safe)).toContain("keep-request-id");
    }
  });

  it("disables automatic request/body/query collection", () => {
    expect(optionsFactory().dataCollection).toMatchObject({
      cookies: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false,
      stackFrameVariables: false, graphQL: { variables: false }, genAI: { inputs: false, outputs: false },
    });
  });
});

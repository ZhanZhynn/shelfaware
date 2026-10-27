import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@sentry/nextjs", () => m);
import { captureException, captureMessage, addBreadcrumb } from "./sentry";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://public@o1.ingest.sentry.io/1");
});
afterEach(() => vi.unstubAllEnvs());

it("never passes a raw provider exception/config to the SDK", () => {
  const original = new Error("refresh_token=PRIVATE_A");
  Object.assign(original, { config: { url: "PRIVATE_B" } });
  captureException(original, { app_secret: "PRIVATE_C", requestId: "keep-me" });
  const [safe, context] = m.captureException.mock.calls[0]!;
  expect(safe).not.toBe(original);
  expect(safe.message).not.toContain("PRIVATE_");
  expect(safe.config).toBe("[REDACTED]");
  expect(JSON.stringify(context)).not.toContain("PRIVATE_");
  expect(JSON.stringify(context)).toContain("keep-me");
});

it("scrubs explicit messages and breadcrumbs before handing them to Sentry", () => {
  captureMessage("app_secret=PRIVATE_A", "error", { token: "PRIVATE_B" });
  addBreadcrumb("provider call", "http", "error", { url: "https://api.example.test/orders?access_token=PRIVATE_C" });
  expect(JSON.stringify([...m.captureMessage.mock.calls, ...m.addBreadcrumb.mock.calls])).not.toContain("PRIVATE_");
});

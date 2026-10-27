import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const m = vi.hoisted(() => ({ redis: vi.fn(), qstash: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureRequestError: vi.fn() }));
vi.mock("./sentry.server.config", () => ({}));
vi.mock("./sentry.edge.config", () => ({}));
vi.mock("@/lib/cache/redis", () => ({ initializeRedis: m.redis, getRedis: () => null, isRedisConfigured: () => false }));
vi.mock("@/lib/queue/qstash", () => ({ initializeQStash: m.qstash }));
import { register } from "./instrumentation";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", undefined);
  vi.stubEnv("CRON_SECRET", undefined);
  vi.stubEnv("INTERNAL_API_KEY", undefined);
  vi.stubEnv("MARKETPLACE_SYNC_WORKER_SECRET", undefined);
});
afterEach(() => vi.unstubAllEnvs());

it("rejects unsafe credentials before optional services initialize", async () => {
  vi.stubEnv("JWT_SECRET", "placeholder");
  await expect(register()).rejects.toThrow("Unsafe runtime credential");
  expect(m.redis).not.toHaveBeenCalled();
  expect(m.qstash).not.toHaveBeenCalled();
});

it("permits the real Next production-build phase with build-only placeholders", async () => {
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  vi.stubEnv("JWT_SECRET", "placeholder");
  await expect(register()).resolves.toBeUndefined();
});

it("does not permit a runtime placeholder outside the build phase", async () => {
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  vi.stubEnv("JWT_SECRET", "placeholder");
  await expect(register()).rejects.toThrow("JWT_SECRET");
});

it("starts optional services with independent production credentials", async () => {
  vi.stubEnv("JWT_SECRET", randomBytes(32).toString("hex"));
  await expect(register()).resolves.toBeUndefined();
  expect(m.redis).toHaveBeenCalledOnce();
  expect(m.qstash).toHaveBeenCalledOnce();
});

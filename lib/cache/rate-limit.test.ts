import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getRedis: vi.fn() }));

vi.mock("./redis", () => ({ getRedis: mocks.getRedis }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { checkRateLimit, resetStrictRateLimitFallbackForTests } from "./rate-limit";

afterEach(() => {
  mocks.getRedis.mockReset();
  resetStrictRateLimitFallbackForTests();
});

describe("strict rate limit fallback", () => {
  it("returns a standard limit result when Redis is unavailable", async () => {
    mocks.getRedis.mockReturnValue(null);
    const config = { identifier: "user:1", limit: 2, window: 60, strict: true };

    expect((await checkRateLimit(config)).allowed).toBe(true);
    expect((await checkRateLimit(config)).allowed).toBe(true);
    const limited = await checkRateLimit(config);

    expect(limited).toMatchObject({ allowed: false, current: 2, limit: 2 });
    expect(limited.reset).toBeGreaterThan(0);
  });

  it("continues to fail open for non-strict endpoints without Redis", async () => {
    mocks.getRedis.mockReturnValue(null);
    await expect(checkRateLimit({ identifier: "user:1", limit: 1, window: 60 })).resolves.toMatchObject({ allowed: true });
    await expect(checkRateLimit({ identifier: "user:1", limit: 1, window: 60 })).resolves.toMatchObject({ allowed: true });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getRedis: vi.fn() }));

vi.mock("./redis", () => ({ getRedis: mocks.getRedis }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { checkRateLimit, resetStrictRateLimitFallbackForTests } from "./rate-limit";

afterEach(() => {
  mocks.getRedis.mockReset();
  resetStrictRateLimitFallbackForTests();
  vi.useRealTimers();
});

describe("atomic distributed limiting", () => {
  it("uses one EVAL per request with opaque, policy-scoped keys", async () => {
    let count = 0;
    const evalMock = vi.fn(async () => count < 2 ? [1, ++count, 60] : [0, count, 60]);
    mocks.getRedis.mockReturnValue({ eval: evalMock });
    const config = { identifier: "account:private@example.test", limit: 2, window: 60, strict: true };
    const results = await Promise.all(Array.from({ length: 50 }, () => checkRateLimit(config)));
    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(evalMock).toHaveBeenCalledTimes(50);
    expect(evalMock.mock.calls[0]).toBeDefined();
    const calls = evalMock.mock.calls as unknown as Array<[string, string[], unknown[]]>;
    expect(calls[0]![1][0]).not.toContain("private@example.test");
    await checkRateLimit({ ...config, window: 120 });
    expect(calls[0]![1][0]).not.toBe((evalMock.mock.calls as unknown as typeof calls)[50]![1][0]);
  });

  it("does not reset a strict budget when Redis fails after a successful request", async () => {
    const evalMock = vi.fn().mockResolvedValueOnce([1, 1, 60]).mockRejectedValue(new Error("offline"));
    mocks.getRedis.mockReturnValue({ eval: evalMock });
    const config = { identifier: "account", limit: 2, window: 60, strict: true };
    expect((await checkRateLimit(config)).allowed).toBe(true);
    expect((await checkRateLimit(config)).allowed).toBe(true);
    expect((await checkRateLimit(config)).allowed).toBe(false);
  });

  it("bounds an unresponsive Redis call and still enforces the local budget", async () => {
    vi.useFakeTimers();
    mocks.getRedis.mockReturnValue({ eval: () => new Promise(() => {}) });
    const config = { identifier: "timeout", limit: 1, window: 60, strict: true };
    const first = checkRateLimit(config); await vi.advanceTimersByTimeAsync(1_001);
    expect((await first).allowed).toBe(true);
    const second = checkRateLimit(config); await vi.advanceTimersByTimeAsync(1_001);
    expect((await second).allowed).toBe(false);
  });

  it("never evicts an active blocked identity during fallback capacity pressure", async () => {
    mocks.getRedis.mockReturnValue(null);
    const config = { identifier: "blocked", limit: 1, window: 60, strict: true };
    await checkRateLimit(config);
    for (let i = 0; i < 10_001; i++) await checkRateLimit({ ...config, identifier: `new-${i}` });
    expect((await checkRateLimit(config)).allowed).toBe(false);
    expect((await checkRateLimit({ ...config, identifier: "overflow" })).allowed).toBe(false);
  });

  it("restores an expired local budget without permitting extra concurrent attempts", async () => {
    vi.useFakeTimers(); mocks.getRedis.mockReturnValue(null);
    const config = { identifier: "expired", limit: 2, window: 60, strict: true };
    expect((await Promise.all(Array.from({ length: 20 }, () => checkRateLimit(config)))).filter((result) => result.allowed)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_001);
    expect((await checkRateLimit(config)).allowed).toBe(true);
  });
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

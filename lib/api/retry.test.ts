import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("withRetry", () => {
  it("returns the first successful value without scheduling a retry", async () => {
    const operation = vi.fn(async () => ({ records: 3 }));
    await expect(withRetry(operation)).resolves.toEqual({ records: 3 });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("backs off exponentially and stops as soon as the operation succeeds", async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error("429")).mockRejectedValueOnce(new Error("rate_limit")).mockResolvedValue("ok");
    const result = withRetry(operation, { retries: 3, baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(99);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(operation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rethrows the final original error after exactly retries + 1 attempts", async () => {
    const error = new Error("too_many_requests");
    const operation = vi.fn().mockRejectedValue(error);
    const assertion = expect(withRetry(operation, { retries: 2, baseDelayMs: 10 })).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await assertion;
    expect(operation).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([new Error("unauthorized"), new Error("malformed response"), "429"])('does not retry a nonmatching failure: %s', async (error) => {
    const operation = vi.fn().mockRejectedValue(error);
    await expect(withRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("supports an endpoint-specific retry classifier and zero retries", async () => {
    const error = new Error("SellerCallLimit");
    const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(0);
    const result = withRetry(operation, { match: /SellerCallLimit/, baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe(0);
    const neverRetry = vi.fn().mockRejectedValue(error);
    await expect(withRetry(neverRetry, { match: /SellerCallLimit/, retries: 0 })).rejects.toBe(error);
    expect(neverRetry).toHaveBeenCalledTimes(1);
  });
});

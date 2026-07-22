import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock("@/lib/cache", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { defaultRateLimits, withRateLimit } from "./rate-limit";

describe("withRateLimit", () => {
  it("returns the standard 429 response for an authenticated user", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, current: 31, reset: 42 });
    const response = await withRateLimit(
      new NextRequest("http://localhost/api/sourcing/cases"),
      defaultRateLimits.strict,
      "user-1",
    );

    expect(response?.status).toBe(429);
    expect(response?.headers.get("X-RateLimit-Limit")).toBe("30");
    await expect(response?.json()).resolves.toMatchObject({ error: "Rate limit exceeded", retryAfter: 42 });
  });
});

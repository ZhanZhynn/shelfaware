import { describe, expect, it, vi } from "vitest";

vi.mock("@/prisma/client", () => ({ default: {}, prisma: {} }));
vi.mock("@/lib/env", () => ({
  getEnvVar: (key: string) => ({
    JWT_SECRET: "test-jwt-secret",
    TIKTOK_APP_KEY: "test-app-key",
    TIKTOK_APP_SECRET: "test-app-secret",
  })[key],
}));

import {
  createTikTokOAuthState,
  getTikTokAuthUrl,
  getTikTokOAuthStateUserId,
} from "./server";

describe("TikTok OAuth state", () => {
  it("binds the callback to the initiating user", () => {
    const state = createTikTokOAuthState("user-1");

    expect(getTikTokOAuthStateUserId(state)).toBe("user-1");
  });

  it("rejects a tampered state", () => {
    const state = createTikTokOAuthState("user-1");
    const tamperedState = `${state.slice(0, -1)}x`;

    expect(getTikTokOAuthStateUserId(tamperedState)).toBeNull();
  });

  it("includes state in the authorization URL", () => {
    const authUrl = getTikTokAuthUrl("https://console.shelfaware.my/api/tiktok/callback", "state-value");

    expect(new URL(authUrl!).searchParams.get("state")).toBe("state-value");
  });
});

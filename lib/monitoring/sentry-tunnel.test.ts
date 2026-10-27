import type { IncomingMessage } from "node:http";
import type { NextConfig } from "next";
import { expect, it } from "vitest";
import { withSentryConfig } from "@sentry/nextjs/config";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas } from "next/dist/shared/lib/router/utils/prepare-destination";
import { SENTRY_TUNNEL_PATH } from "./sentry-config";

it("the patched SDK forwards qualified tunnel requests without matching application subpaths", async () => {
  const config = withSentryConfig({} as NextConfig, { silent: true, tunnelRoute: SENTRY_TUNNEL_PATH });
  if (!config.rewrites) throw new Error("Expected the SDK to configure its tunnel rewrites");
  const rewrites = await config.rewrites();
  const routes = Array.isArray(rewrites) ? rewrites : [...rewrites.beforeFiles ?? [], ...rewrites.afterFiles ?? [], ...rewrites.fallback ?? []];
  const request = { headers: { host: "app.example.test" } } as IncomingMessage;
  expect(routes.length).toBeGreaterThan(0);
  for (const route of routes) {
    const matchesPath = getPathMatch(route.source);
    expect(matchesPath(SENTRY_TUNNEL_PATH)).not.toBe(false);
    expect(matchesPath(`${SENTRY_TUNNEL_PATH}/`)).not.toBe(false);
    expect(matchesPath(`${SENTRY_TUNNEL_PATH}/private-route`)).toBe(false);
    expect(matchHas(request, { o: "1", p: "1", r: "us" }, route.has)).not.toBe(false);
    expect(matchHas(request, {}, route.has)).toBe(false);
    expect(matchHas(request, { o: "not-numeric", p: "1", r: "us" }, route.has)).toBe(false);
    expect(route.destination).toContain("/envelope/");
  }
});

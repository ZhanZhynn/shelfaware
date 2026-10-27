import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { SENTRY_TUNNEL_PATH } from "./lib/monitoring/sentry-config";
import { buildNextProductionHeaderRules } from "./lib/vercel/production-headers";
import { buildImageOptimizationConfig } from "./lib/image-optimization";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["100.72.140.36", "100.78.46.77", "192.168.50.101", "100.69.249.84"],
  reactStrictMode: true,
  serverExternalPackages: ["lazada-api-client"],

  images: buildImageOptimizationConfig(
    process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT || process.env.IMAGEKIT_URL_ENDPOINT,
  ),

  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },

  poweredByHeader: false,

  experimental: {
    optimizePackageImports: ["@/components", "@/lib"],
  },

  // Security + /_next/static immutable cache — see lib/vercel/production-headers.ts
  async headers() {
    return buildNextProductionHeaderRules();
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "arnob-mahmuds-org",
  project: process.env.SENTRY_PROJECT ?? "stock-inventory",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // First-party tunnel — must match `tunnel` in instrumentation-client.ts (SENTRY_TUNNEL_PATH)
  tunnelRoute: SENTRY_TUNNEL_PATH,
  webpack: {
    automaticVercelMonitors: true,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});

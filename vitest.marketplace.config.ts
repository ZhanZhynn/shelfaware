import { defineConfig } from "vitest/config";
import base from "./vitest.config";

const syncThresholds = { statements: 85, branches: 70, functions: 90, lines: 90 };

/** Offline reliability suite: provider HTTP and database boundaries are mocked. */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      "lib/{shopee,lazada,tiktok,shopify}/**/*.test.ts",
      "lib/marketplace/**/*.test.ts",
      "app/api/v1/marketplaces/**/*.test.ts",
      "lib/api/retry.test.ts",
      "lib/sync/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage/marketplace",
      reporter: ["text", "json", "json-summary", "html"],
      include: [
        "lib/{shopee,lazada,tiktok,shopify}/{sync,custom-api,graphql-client,order-line-facts,order-facts,money,time,status,provider-error,search,signing}.ts",
        "lib/shopee/ads-*.ts",
        "lib/lazada/{finance-*,financial-report}.ts",
        "lib/marketplace/{sync-*,finance-filter,json,shops}.ts",
        "lib/marketplace/{v1,analytics}/**/*.ts",
        "lib/api/retry.ts",
        "lib/sync/run-with-sync-log.ts",
      ],
      exclude: ["**/*.test.ts", "**/types.ts"],
      // Gate each high-risk implementation independently: one provider cannot
      // hide another provider's untested sync code in an aggregate percentage.
      thresholds: {
        "lib/shopee/sync.ts": syncThresholds,
        "lib/lazada/sync.ts": syncThresholds,
        "lib/tiktok/sync.ts": syncThresholds,
        "lib/shopify/sync.ts": syncThresholds,
        "lib/shopify/graphql-client.ts": { statements: 95, branches: 80, functions: 100, lines: 100 },
        "lib/tiktok/custom-api.ts": { statements: 95, branches: 80, functions: 100, lines: 95 },
        "lib/lazada/custom-api.ts": { statements: 85, branches: 70, functions: 90, lines: 90 },
        "lib/marketplace/v1/live.ts": { statements: 95, branches: 75, functions: 95, lines: 95 },
        "lib/marketplace/v1/local-catalog.ts": { statements: 90, branches: 75, functions: 95, lines: 95 },
        "lib/marketplace/analytics/server.ts": { statements: 90, branches: 75, functions: 90, lines: 90 },
        "lib/marketplace/sync-runs.ts": { statements: 90, branches: 85, functions: 90, lines: 95 },
        "lib/api/retry.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },
        "lib/sync/run-with-sync-log.ts": { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});

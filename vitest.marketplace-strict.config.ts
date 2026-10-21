import { defineConfig } from "vitest/config";
import marketplace from "./vitest.marketplace.config";

export default defineConfig({
  ...marketplace,
  test: {
    ...marketplace.test,
    env: { ...marketplace.test?.env, MARKETPLACE_STRICT_REGRESSIONS: "1" },
  },
});

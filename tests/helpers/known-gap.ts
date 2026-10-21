import { it } from "vitest";

/**
 * Execute every known defect. Normal mode expects its assertion to fail, and
 * fails on an unexpected pass. Strict mode exposes the same tests as red
 * regressions so a green unit suite cannot be mistaken for a clean defect list.
 */
export const knownGap = process.env.MARKETPLACE_STRICT_REGRESSIONS === "1" ? it : it.fails;

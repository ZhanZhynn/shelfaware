import { describe, expect, it } from "vitest";
import { backfillRetryAt, nextBackfillState } from "./backfill";

describe("backfill state machine", () => {
  it("permits resumable checkpoints and terminal transitions only from a lease", () => {
    expect(nextBackfillState("pending", "claim")).toBe("running");
    expect(nextBackfillState("running", "checkpoint")).toBe("running");
    expect(nextBackfillState("running", "retry")).toBe("retrying");
    expect(nextBackfillState("retrying", "claim")).toBe("running");
    expect(nextBackfillState("running", "complete")).toBe("completed");
    expect(() => nextBackfillState("completed", "claim")).toThrow("Invalid backfill transition");
  });

  it("uses bounded, jittered exponential retry metadata", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(backfillRetryAt(1, now, () => 0).toISOString()).toBe("2026-01-01T00:00:23.000Z");
    expect(backfillRetryAt(100, now, () => 1).getTime() - now.getTime()).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});

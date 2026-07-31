import { describe, expect, it } from "vitest";
import { addFixedPoint, known, unknown } from "./fixed-point";

describe("fixed point known/unknown primitives", () => {
  it("propagates an unknown rather than treating it as zero", () => {
    expect(addFixedPoint([known(4n), unknown("missing evidence")])).toEqual(unknown("missing evidence"));
    expect(addFixedPoint([known(4n), known(6n)])).toEqual(known(10n));
  });
});

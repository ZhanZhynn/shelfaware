import { describe, it, expect } from "vitest";
import { normalizeUsernameBase } from "./unique-username";

describe("normalizeUsernameBase", () => {
  it("lowercases and strips invalid characters", () => {
    expect(normalizeUsernameBase("Jack.Doe+1")).toBe("jack.doe1");
  });

  it("falls back to user when empty after normalize", () => {
    expect(normalizeUsernameBase("!!!")).toBe("user");
  });
});

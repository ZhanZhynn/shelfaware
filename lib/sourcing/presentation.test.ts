import { describe, expect, it } from "vitest";
import {
  getSourcingGroup,
  getSourcingStatusMessage,
  getSourcingTimelineIndex,
} from "./presentation";

describe("sourcing presentation", () => {
  it("separates admin work from sourcer work", () => {
    expect(getSourcingGroup("sourcing", "admin")).toBe("waiting");
    expect(getSourcingGroup("sourcing", "sourcer")).toBe("needs_action");
    expect(getSourcingGroup("quoted", "admin")).toBe("needs_action");
    expect(getSourcingGroup("quoted", "sourcer")).toBe("waiting");
    expect(getSourcingGroup("changes_requested", "admin")).toBe(
      "changes_requested",
    );
    expect(getSourcingGroup("changes_requested", "sourcer")).toBe(
      "needs_action",
    );
    expect(getSourcingGroup("ordered", "admin")).toBe("shipped");
    expect(getSourcingGroup("ordered", "sourcer")).toBe("needs_action");
  });

  it("preserves the shipment and receipt handoff", () => {
    expect(getSourcingGroup("shipping", "admin")).toBe("shipped");
    expect(getSourcingGroup("shipping", "sourcer")).toBe("shipped");
    expect(getSourcingGroup("received", "admin")).toBe("completed");
    expect(getSourcingGroup("received", "sourcer")).toBe("completed");
  });

  it("makes ownership explicit in row messages", () => {
    expect(getSourcingStatusMessage("sourcing", "admin", "Yap")).toBe(
      "Waiting on Yap to submit offers",
    );
    expect(getSourcingStatusMessage("ordered", "sourcer")).toBe(
      "Your action: arrange shipment",
    );
    expect(getSourcingStatusMessage("quoted", "sourcer")).toContain(
      "add or withdraw offers",
    );
  });

  it("maps role-specific timelines through receipt", () => {
    expect(getSourcingTimelineIndex("approved", "admin")).toBe(3);
    expect(getSourcingTimelineIndex("approved", "sourcer")).toBe(2);
    expect(getSourcingTimelineIndex("received", "admin")).toBe(6);
    expect(getSourcingTimelineIndex("received", "sourcer")).toBe(5);
  });
});

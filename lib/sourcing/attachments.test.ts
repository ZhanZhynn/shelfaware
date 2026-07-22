import { describe, expect, it } from "vitest";
import { MAX_SOURCING_ATTACHMENT_SIZE, validateSourcingAttachment } from "./attachments";

describe("sourcing attachment validation", () => {
  it("accepts supported image, PDF, and spreadsheet files", () => {
    expect(validateSourcingAttachment({ name: "sample.png", type: "image/png", size: 1 })).toBeNull();
    expect(validateSourcingAttachment({ name: "quote.pdf", type: "application/pdf", size: 1 })).toBeNull();
    expect(validateSourcingAttachment({ name: "costs.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 1 })).toBeNull();
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(validateSourcingAttachment({ name: "script.exe", type: "application/octet-stream", size: 1 })).toMatch(/Only images/);
    expect(validateSourcingAttachment({ name: "empty.pdf", type: "application/pdf", size: 0 })).toBe("File is empty");
    expect(validateSourcingAttachment({ name: "large.pdf", type: "application/pdf", size: MAX_SOURCING_ATTACHMENT_SIZE + 1 })).toMatch(/10MB/);
  });
});

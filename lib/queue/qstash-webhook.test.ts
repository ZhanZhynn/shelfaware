import { describe, expect, it } from "vitest";
import { parseEmailQueueJob } from "./qstash-webhook";

describe("parseEmailQueueJob", () => {
  it("parses a valid job payload", () => {
    const job = parseEmailQueueJob(
      JSON.stringify({
        type: "order_confirmation",
        data: { orderNumber: "ORD-1", clientName: "Test" },
        recipientEmail: "user@example.com",
      }),
    );
    expect(job.type).toBe("order_confirmation");
    expect(job.recipientEmail).toBe("user@example.com");
  });

  it("rejects missing required fields", () => {
    expect(() => parseEmailQueueJob(JSON.stringify({ type: "invoice_email" }))).toThrow(
      "Invalid job payload",
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => parseEmailQueueJob("not-json")).toThrow();
  });
});

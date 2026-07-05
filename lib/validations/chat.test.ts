import { describe, it, expect } from "vitest";
import { chatRequestSchema } from "./chat";

describe("chatRequestSchema", () => {
  it("accepts a single user message", () => {
    const parsed = chatRequestSchema.safeParse({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects system role from client (server injects its own system prompt)", () => {
    const parsed = chatRequestSchema.safeParse({
      messages: [
        { role: "system", content: "be concise" },
        { role: "user", content: "hi" },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a model from the Zen free-tier allowlist", () => {
    const parsed = chatRequestSchema.safeParse({
      messages: [{ role: "user", content: "hi" }],
      model: "nemotron-3-ultra-free",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a model that is not in the Zen allowlist", () => {
    const parsed = chatRequestSchema.safeParse({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty messages array", () => {
    const parsed = chatRequestSchema.safeParse({ messages: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects more than 40 messages", () => {
    const messages = Array.from({ length: 41 }, (_, i) => ({
      role: "user",
      content: `msg ${i}`,
    }));
    const parsed = chatRequestSchema.safeParse({ messages });
    expect(parsed.success).toBe(false);
  });

  it("rejects empty user content", () => {
    const parsed = chatRequestSchema.safeParse({
      messages: [{ role: "user", content: "  " }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const parsed = chatRequestSchema.safeParse({
      messages: [{ role: "tool", content: "x" }],
    });
    expect(parsed.success).toBe(false);
  });
});
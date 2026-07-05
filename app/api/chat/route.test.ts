/**
 * Tests for POST /api/chat tool-calling loop.
 *
 * All external collaborators (auth, AI provider, tools, rate limiter) are
 * mocked so the test focuses purely on the route's orchestration logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getSessionFromRequest, createChatCompletion, isLlmConfigured, withRateLimit, dispatchTool, parseToolCallArgs, getToolDefinitions } = vi.hoisted(() => ({
  getSessionFromRequest: vi.fn(),
  createChatCompletion: vi.fn(),
  isLlmConfigured: vi.fn(),
  withRateLimit: vi.fn(),
  dispatchTool: vi.fn(),
  parseToolCallArgs: vi.fn(),
  getToolDefinitions: vi.fn(),
}));

vi.mock("@/utils/auth", () => ({ getSessionFromRequest }));
vi.mock("@/lib/ai", () => ({ createChatCompletion, isLlmConfigured }));
vi.mock("@/lib/ai/tools", () => ({
  getToolDefinitions,
  dispatchTool,
  parseToolCallArgs,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  withRateLimit,
  defaultRateLimits: { strict: { limit: 10, window: 60 } },
}));

import { POST } from "./route";

const ADMIN = {
  id: "user-1",
  role: "ADMIN",
  name: "Admin",
  email: "admin@example.com",
};

function buildRequest(body: unknown) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  withRateLimit.mockReset();
  getSessionFromRequest.mockReset();
  createChatCompletion.mockReset();
  isLlmConfigured.mockReset();
  dispatchTool.mockReset();
  parseToolCallArgs.mockReset();
  getToolDefinitions.mockReset();
  withRateLimit.mockResolvedValue(null);
  isLlmConfigured.mockReturnValue(true);
  getSessionFromRequest.mockResolvedValue(ADMIN);
  getToolDefinitions.mockReturnValue([
    {
      type: "function",
      function: { name: "listProducts", description: "list", parameters: { type: "object" } },
    },
  ]);
  parseToolCallArgs.mockImplementation((call: { function: { arguments: string } }) =>
    JSON.parse(call.function.arguments || "{}"),
  );
});

async function readJson(res: Response) {
  return JSON.parse(await res.text());
}

describe("POST /api/chat — auth and config gates", () => {
  it("returns 401 when unauthenticated", async () => {
    getSessionFromRequest.mockResolvedValue(null);
    const res = await POST(buildRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(401);
  });

  it("returns 503 (LLM_NOT_CONFIGURED) when no AI key is set", async () => {
    isLlmConfigured.mockReturnValue(false);
    const res = await POST(buildRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect(body.details?.code ?? body.error).toMatch(/not configured|LLM_NOT_CONFIGURED/);
  });

  it("rejects an invalid body with 400", async () => {
    const res = await POST(buildRequest({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown model id with 400", async () => {
    const res = await POST(
      buildRequest({
        messages: [{ role: "user", content: "hi" }],
        model: "gpt-4",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/chat — tool-calling loop", () => {
  it("returns the assistant text when no tool calls are emitted", async () => {
    createChatCompletion.mockResolvedValue({
      ok: true,
      provider: "opencode-zen",
      data: {
        id: "r1",
        choices: [
          { message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" },
        ],
      },
    });
    const res = await POST(buildRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({ text: "Hello!", provider: "opencode-zen", hops: 1 });
    expect(dispatchTool).not.toHaveBeenCalled();
  });

  it("dispatches tool calls then returns the final text on the next hop", async () => {
    createChatCompletion
      .mockResolvedValueOnce({
        ok: true,
        provider: "opencode-zen",
        data: {
          id: "r1",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "listProducts", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        provider: "opencode-zen",
        data: {
          id: "r2",
          choices: [
            { message: { role: "assistant", content: "Found 2 items." }, finish_reason: "stop" },
          ],
        },
      });
    dispatchTool.mockResolvedValue({ ok: true, data: { count: 2 } });
    const res = await POST(buildRequest({ messages: [{ role: "user", content: "show products" }] }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data).toMatchObject({ text: "Found 2 items.", hops: 2 });
    expect(dispatchTool).toHaveBeenCalledTimes(1);
    expect(parseToolCallArgs).toHaveBeenCalledTimes(1);
  });

  it("maps a billing failure to a 503 LLM_BILLING response", async () => {
    createChatCompletion.mockResolvedValue({
      ok: false,
      kind: "billing",
      provider: "opencode-zen",
      status: 402,
    });
    const res = await POST(buildRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(503);
  });

  it("maps a not_configured failure to 503 LLM_NOT_CONFIGURED", async () => {
    createChatCompletion.mockResolvedValue({
      ok: false,
      kind: "not_configured",
    });
    const res = await POST(buildRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(503);
  });

  it("maps a rate-limit failure to 503 LLM_RATE_LIMIT", async () => {
    createChatCompletion.mockResolvedValue({
      ok: false,
      kind: "rate_limit",
      provider: "groq",
      status: 429,
    });
    const res = await POST(buildRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(503);
  });

  it("maps an upstream failure to 502", async () => {
    createChatCompletion.mockResolvedValue({
      ok: false,
      kind: "upstream",
      provider: "opencode-zen",
      status: 500,
    });
    const res = await POST(buildRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(502);
  });
});
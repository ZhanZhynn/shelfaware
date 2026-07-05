import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/axiosInstance", () => ({
  default: { post: vi.fn() },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const axiosInstance = (await import("@/utils/axiosInstance")).default;

async function callChat(messages: { role: string; content: string }[], model?: string) {
  const response = await axiosInstance.post(
    "/chat",
    { messages, ...(model ? { model } : {}) },
    { timeout: 60000 },
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.error ?? body.message ?? "Chat failed.");
  }
  return body.data;
}

describe("chat mutation envelope unwrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unwraps success envelope and returns inner data", async () => {
    (axiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        success: true,
        data: { text: "Hello from AI", provider: "opencode-zen", hops: 1 },
      },
    });

    const result = await callChat([{ role: "user", content: "hi" }]);

    expect(result).toEqual({ text: "Hello from AI", provider: "opencode-zen", hops: 1 });
  });

  it("throws on success:false envelope", async () => {
    (axiosInstance.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        success: false,
        error: "Rate limit exceeded",
      },
    });

    await expect(callChat([{ role: "user", content: "hi" }])).rejects.toThrow(
      "Rate limit exceeded",
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const captureException = vi.fn();
const captureMessage = vi.fn();

vi.mock("@/lib/monitoring/sentry", () => ({
  captureException,
  captureMessage,
}));

describe("logger production 4xx guard", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    captureException.mockClear();
    captureMessage.mockClear();
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
  });

  it("skips Sentry for 400 Axios errors", async () => {
    const { logger } = await import("@/lib/logger");
    const axiosError = {
      isAxiosError: true,
      response: { status: 400, data: { error: "Missing required fields" } },
    };
    logger.error("Product operation error:", axiosError);
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("reports 500 errors to Sentry", async () => {
    const { logger } = await import("@/lib/logger");
    const serverError = new Error("Internal server error");
    logger.error("Product operation error:", serverError);
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "Internal server error" }), {
      label: "Product operation error:",
    });
    expect(captureException.mock.calls[0]?.[0]).not.toBe(serverError);
  });

  it("skips Sentry for ApiError 409 (api client interceptor path)", async () => {
    const { logger } = await import("@/lib/logger");
    const conflict = new ApiError("Invoice already exists", 409);
    logger.error("Invoice creation error:", conflict);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("sanitizes exception details before passing them to a monitoring helper", async () => {
    const { logger } = await import("@/lib/logger");
    const error = new Error("Refresh failed: refresh_token=PRIVATE_A");
    Object.assign(error, { config: { data: "PRIVATE_B" } });
    logger.error("provider failed app_secret=PRIVATE_C", error);
    const [safe, context] = captureException.mock.calls[0]!;
    expect(safe.message).not.toContain("PRIVATE_");
    expect(safe.config).toBe("[REDACTED]");
    expect(JSON.stringify(context)).not.toContain("PRIVATE_");
  });

  it("sanitizes warning contexts", async () => {
    const { logger } = await import("@/lib/logger");
    logger.warn("Provider failure", { authorization: "PRIVATE_A", requestId: "keep-me" });
    expect(captureMessage).toHaveBeenCalledWith("Provider failure", "warning", { authorization: "[REDACTED]", requestId: "keep-me" });
  });
});

describe("development logger", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("does not print raw SDK credentials to the console", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = await import("@/lib/logger");
    logger.error("GET https://auth.example.test/token?app_secret=PRIVATE_A", { access_token: "PRIVATE_B" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("PRIVATE_");
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

describe("feature flags", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  it("defaults all flags to true in development", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SHARED_SKU_MAPPING_ENABLED;
    delete process.env.SHARED_SKU_MAPPING_MUTATIONS_ENABLED;
    delete process.env.SHARED_SKU_MAPPING_ANALYTICS_ENABLED;

    const {
      isSharedSkuMappingEnabled,
      isSharedSkuMappingMutationsEnabled,
      isSharedSkuMappingAnalyticsEnabled,
    } = await import("./feature-flags");

    expect(isSharedSkuMappingEnabled()).toBe(true);
    expect(isSharedSkuMappingMutationsEnabled()).toBe(true);
    expect(isSharedSkuMappingAnalyticsEnabled()).toBe(true);
  });

  it("defaults all flags to false in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SHARED_SKU_MAPPING_ENABLED;
    delete process.env.SHARED_SKU_MAPPING_MUTATIONS_ENABLED;
    delete process.env.SHARED_SKU_MAPPING_ANALYTICS_ENABLED;

    const {
      isSharedSkuMappingEnabled,
      isSharedSkuMappingMutationsEnabled,
      isSharedSkuMappingAnalyticsEnabled,
    } = await import("./feature-flags");

    expect(isSharedSkuMappingEnabled()).toBe(false);
    expect(isSharedSkuMappingMutationsEnabled()).toBe(false);
    expect(isSharedSkuMappingAnalyticsEnabled()).toBe(false);
  });

  it("respects explicit SHARED_SKU_MAPPING_ENABLED=true in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHARED_SKU_MAPPING_ENABLED = "true";
    delete process.env.SHARED_SKU_MAPPING_MUTATIONS_ENABLED;
    delete process.env.SHARED_SKU_MAPPING_ANALYTICS_ENABLED;

    const { isSharedSkuMappingEnabled } = await import("./feature-flags");
    expect(isSharedSkuMappingEnabled()).toBe(true);
  });

  it("respects explicit SHARED_SKU_MAPPING_ENABLED=false in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.SHARED_SKU_MAPPING_ENABLED = "false";

    const { isSharedSkuMappingEnabled } = await import("./feature-flags");
    expect(isSharedSkuMappingEnabled()).toBe(false);
  });

  it("respects SHARED_SKU_MAPPING_MUTATIONS_ENABLED=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHARED_SKU_MAPPING_MUTATIONS_ENABLED = "1";

    const { isSharedSkuMappingMutationsEnabled } = await import("./feature-flags");
    expect(isSharedSkuMappingMutationsEnabled()).toBe(true);
  });

  it("respects SHARED_SKU_MAPPING_ANALYTICS_ENABLED=1", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHARED_SKU_MAPPING_ANALYTICS_ENABLED = "1";

    const { isSharedSkuMappingAnalyticsEnabled } = await import("./feature-flags");
    expect(isSharedSkuMappingAnalyticsEnabled()).toBe(true);
  });

  it("treats empty string as default", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHARED_SKU_MAPPING_ENABLED = "";

    const { isSharedSkuMappingEnabled } = await import("./feature-flags");
    expect(isSharedSkuMappingEnabled()).toBe(false);
  });
});

const isDevelopment = process.env.NODE_ENV !== "production";

function envBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "1" || raw.toLowerCase() === "true";
}

export function isSharedSkuMappingEnabled(): boolean {
  return envBoolean("SHARED_SKU_MAPPING_ENABLED", isDevelopment);
}

export function isSharedSkuMappingMutationsEnabled(): boolean {
  return envBoolean("SHARED_SKU_MAPPING_MUTATIONS_ENABLED", isDevelopment);
}

export function isSharedSkuMappingAnalyticsEnabled(): boolean {
  return envBoolean("SHARED_SKU_MAPPING_ANALYTICS_ENABLED", isDevelopment);
}

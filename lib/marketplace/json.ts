import type { Prisma } from "@prisma/client";

/** Convert untrusted API payloads into Prisma's JSON input type without casts. */
export function toInputJson(value: unknown): Prisma.InputJsonValue {
  // JSON serialization drops unsupported values and rejects circular payloads.
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

const sensitiveKey = /(?:buyer|customer|recipient|contact|address|name|email|phone|mobile|token|secret|authorization|cookie|signature|password|session|ip(?:_address)?|(?:^|[_-])user[_-]?id$|(?:^|[_-])user(?:[_-]?(?:uuid|identifier|identity))?$)/i;

/**
 * Retains bounded, non-identifying provider diagnostics only. Raw marketplace
 * responses are untrusted and must never become a secondary PII/token store.
 */
export function sanitizeMarketplaceRawPayload(value: unknown): Prisma.InputJsonValue {
  const visit = (current: unknown, depth = 0): unknown => {
    if (depth > 8 || current === null || current === undefined) return null;
    if (typeof current === "string") return current.slice(0, 512);
    if (typeof current === "number" || typeof current === "boolean") return current;
    if (Array.isArray(current)) return current.slice(0, 100).map((entry) => visit(entry, depth + 1));
    if (typeof current !== "object") return null;
    return Object.fromEntries(Object.entries(current as Record<string, unknown>)
      .filter(([key]) => !sensitiveKey.test(key))
      .map(([key, entry]) => [key, visit(entry, depth + 1)]));
  };
  return toInputJson(visit(value));
}

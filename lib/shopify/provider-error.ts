export type ShopifyProviderErrorCode =
  | "SCHEMA_INVALID" | "ACCESS_DENIED" | "THROTTLED" | "TEMPORARY"
  | "HTTP_REJECTED" | "GRAPHQL_REJECTED" | "MALFORMED_RESPONSE";

/** Never retain provider messages, bodies, queries, credentials, or fetch causes. */
export class ShopifyProviderError extends Error {
  readonly providerRequestId: string | null;
  readonly retryable: boolean;

  constructor(readonly code: ShopifyProviderErrorCode, readonly status: number, requestId?: unknown) {
    super(`Shopify provider failure: ${code} (HTTP ${status})`);
    this.name = "ShopifyProviderError";
    this.providerRequestId = typeof requestId === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(requestId) ? requestId : null;
    this.retryable = ["THROTTLED", "TEMPORARY", "MALFORMED_RESPONSE"].includes(code);
  }
}

/** Inspect text only for classification; all externally visible codes are fixed. */
export function shopifyGraphQLErrorCode(errors: Array<{ message?: unknown; extensions?: { code?: unknown } }>): ShopifyProviderErrorCode {
  const has = (codes: string[], pattern: RegExp) => errors.some((error) =>
    codes.includes(String(error.extensions?.code)) || (typeof error.message === "string" && pattern.test(error.message)));
  // A permanent error in a mixed envelope must not be hidden by a retryable one.
  if (has(["ACCESS_DENIED", "UNAUTHORIZED", "FORBIDDEN"], /access denied|unauthori[sz]ed|forbidden|permission|invalid.*(?:token|api key)/i)) return "ACCESS_DENIED";
  if (has(["GRAPHQL_VALIDATION_FAILED", "GRAPHQL_PARSE_FAILED", "undefinedField", "argumentNotAccepted", "missingRequiredArguments", "variableMismatch", "selectionMismatch"], /doesn't exist on type|cannot query field|unknown argument|doesn't accept argument|syntax error|was provided invalid value/i)) return "SCHEMA_INVALID";
  if (has(["THROTTLED"], /throttl|rate.?limit|too many requests/i)) return "THROTTLED";
  if (has(["INTERNAL_SERVER_ERROR", "INTERNAL_ERROR", "SERVICE_UNAVAILABLE"], /internal (?:server )?error|temporarily unavailable/i)) return "TEMPORARY";
  return "GRAPHQL_REJECTED";
}

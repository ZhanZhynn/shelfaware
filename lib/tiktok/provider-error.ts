export type TikTokProviderErrorKind = "auth" | "rate_limit" | "invalid_query" | "unsupported" | "temporary";

function failureKind(status: number, code: string, message: unknown): TikTokProviderErrorKind {
  // Interpret provider messages without retaining them: they may contain
  // credentials or other sensitive response data.
  const text = typeof message === "string" ? message : "";
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|permission|token.*(?:expired|invalid)|(?:expired|invalid).*token/i.test(text)) return "auth";
  if (status === 429 || /rate.?limit|too[_ ]many[_ ]requests|throttl/i.test(text)) return "rate_limit";
  if (status === 404 || /not supported|unsupported/i.test(text)) return "unsupported";
  if (status === 400 || status === 422 || code === "36009004") return "invalid_query";
  return "temporary";
}

/** Only safe provider identifiers and a normalized failure kind leave the client. */
export class TikTokProviderError extends Error {
  readonly code: string;
  readonly providerRequestId: string | null;
  readonly kind: TikTokProviderErrorKind;

  constructor(code: unknown, readonly status: number, requestId?: unknown, message?: unknown) {
    const safe = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : null;
    const sourceCode = typeof code === "string" || typeof code === "number" ? safe(String(code)) : null;
    const kind = failureKind(status, sourceCode ?? "UNKNOWN", message);
    // Keep rate_limit in the safe message for the existing sync retry wrapper.
    super(`TikTok provider failure: ${sourceCode ?? "UNKNOWN"} (HTTP ${status}; ${kind})`);
    this.name = "TikTokProviderError";
    this.code = sourceCode ?? "UNKNOWN";
    this.providerRequestId = safe(requestId);
    this.kind = kind;
  }
}

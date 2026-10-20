export class LazadaProviderError extends Error {
  readonly code: string;
  readonly providerRequestId: string | null;
  constructor(code: unknown, readonly status: number, requestId?: unknown) {
    const safe = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : null;
    const sourceCode = typeof code === "string" || typeof code === "number" ? safe(String(code)) : null;
    super(`Lazada provider failure: ${sourceCode ?? "UNKNOWN"}`);
    this.code = sourceCode ?? "UNKNOWN";
    this.providerRequestId = safe(requestId);
  }
}

export function assertLazadaSuccess(response: { code?: unknown; request_id?: unknown }, status = 200) {
  if (String(response.code) !== "0" || status >= 400) throw new LazadaProviderError(response.code, status, response.request_id);
}

/** Lazada documents numeric identifiers but also returns them as JSON strings. */
export function lazadaIdentifier(value: unknown): string {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) throw new LazadaProviderError("INVALID_IDENTIFIER", 502);
  if (typeof value !== "number" && typeof value !== "string") throw new LazadaProviderError("INVALID_IDENTIFIER", 502);
  const id = String(value);
  if (!/^[1-9]\d{0,24}$/.test(id)) throw new LazadaProviderError("INVALID_IDENTIFIER", 502);
  return id;
}

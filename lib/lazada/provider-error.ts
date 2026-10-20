export class LazadaProviderError extends Error {
  readonly code: string;
  readonly providerRequestId: string | null;
  readonly fields: string[];
  constructor(code: unknown, readonly status: number, requestId?: unknown, fields: readonly string[] = []) {
    const safe = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : null;
    const sourceCode = typeof code === "string" || typeof code === "number" ? safe(String(code)) : null;
    super(`Lazada provider failure: ${sourceCode ?? "UNKNOWN"}`);
    this.code = sourceCode ?? "UNKNOWN";
    this.providerRequestId = safe(requestId);
    this.fields = fields.filter((field) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field)).slice(0, 40);
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

export function lazadaSyncFailure(error: LazadaProviderError) {
  const code = `LAZADA_${error.code.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`.slice(0, 64);
  const permanent = [400, 401, 403, 404].includes(error.status)
    || /^(MALFORMED_|MISSING_|INVALID_|INCONSISTENT_)/.test(error.code)
    || /IllegalAccessToken|InvalidAccessToken|Unauthorized|AccessDenied|Permission|Parameter|^100001[24]$/i.test(error.code);
  return { code, retryable: !permanent };
}

/** Only the envelope's shape is diagnostic; its contents can be sensitive. */
export function lazadaResponseShape(value: unknown): string {
  return value === null ? "NULL" : value === undefined ? "MISSING" : Array.isArray(value) ? "ARRAY" : typeof value === "object" ? "OBJECT" : typeof value === "string" ? "STRING" : "OTHER";
}

/** Dependency-free so the same policy can run in Node, Edge and the browser. */
export const REDACTED = "[REDACTED]";
const OMITTED = "[OMITTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = 10;
const MAX_NODES = 2_000;
const MAX_ENTRIES = 100;
const MAX_STRING = 16_384;
const nativeErrorStackGetter = Object.getOwnPropertyDescriptor(new Error(), "stack")?.get;

function normalizedKey(key: string): string {
  let decoded = key;
  for (let i = 0; i < 2; i++) {
    try { decoded = decodeURIComponent(decoded); } catch { break; }
  }
  return decoded.toLowerCase().replace(/[^a-z\d]/g, "");
}

function sensitiveKey(key: string): boolean {
  const name = normalizedKey(key);
  return /password|passwd|secret|credential|authentication|authorization|cookie|privatekey|apikey|partnerkey|signingkey|sessionid|(?:access|refresh|id|api|auth|bearer|csrf|session)token/.test(name) ||
    ["token", "auth", "signature", "hmac", "sign", "oauthstate", "authcode", "authorizationcode"].includes(name);
}

function sensitiveQueryKey(key: string): boolean {
  return sensitiveKey(key) || ["code", "state", "vercelshare", "vercelprotectionbypass"].includes(normalizedKey(key));
}

function rawPayloadKey(key: string): boolean {
  return ["config", "body", "requestbody", "requestdata", "responsedata", "postdata", "rawbody", "rawpayload", "rawfinancialpayload", "formdata"].includes(normalizedKey(key)) ||
    /(?:request|response)body$/.test(normalizedKey(key)) || /^sentrymessageparameter\d+$/.test(normalizedKey(key));
}

/** Strip URL credentials, auth headers, recognizable bearer keys and key/value secrets. */
export function redactText(value: string): string {
  let text = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}${TRUNCATED}` : value;
  // Decode encoded URL fragments before applying the same policy. Never recurse
  // without a bound; arbitrary non-URL text keeps its original encoding.
  for (let i = 0; i < 2; i++) {
    text = text.replace(/\bhttps?%(?:25)?3a[^\s"'<>]*/gi, (encoded) => {
      try { return decodeURIComponent(encoded); } catch { return OMITTED; }
    });
  }
  text = text.replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^\s/?#]*@/gi, `$1${REDACTED}@`);
  text = text.replace(/\b(Bearer|Basic)\s+[a-z\d._~+/=-]+/gi, `$1 ${REDACTED}`);
  text = text.replace(/\beyJ[a-z\d_-]+\.[a-z\d_-]+\.[a-z\d_-]+\b/gi, REDACTED);
  text = text.replace(/\b(?:swa_[a-z\d_-]{32,}|shpat_[a-z\d]+|shpss_[a-z\d]+|sk_(?:live|test)_[a-z\d]+|gsk_[a-z\d]+|xkeysib-[a-z\d-]+)\b/gi, REDACTED);
  text = text.replace(/([?&;])([^?&=;\s"'<>]+)=([^&;\s"'<>]*)/g, (match, separator: string, key: string) =>
    sensitiveQueryKey(key) ? `${separator}${key}=${REDACTED}` : match,
  );
  text = text.replace(/\b((?:proxy-)?authorization|(?:set-)?cookie)\s*:\s*[^\r\n]*/gi, `$1: ${REDACTED}`);
  text = text.replace(/\b((?:access[_ -]?|refresh[_ -]?)?token|secret|api[_ -]?key|password)\s+(?:is\s+)?[a-z\d_+/.=-]{16,}/gi, `$1 ${REDACTED}`);
  return redactAssignments(text, 0);
}

function redactAssignments(text: string, depth: number): string {
  if (depth >= 4) return OMITTED;
  return text.replace(/(["']?)\b([a-z\d_.%-]{1,128})\1(\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:Bearer|Basic)\s+[^\s,;&}]+|\[REDACTED\]|[^\s,;&}"']+)/gi,
    (match, quote: string, key: string, separator: string, raw: string) => {
      // A benign label such as "failed: refresh_token=..." must not swallow
      // the nested credential assignment as an unprocessed regex match.
      if (!sensitiveKey(key)) return `${quote}${key}${quote}${separator}${redactAssignments(raw, depth + 1)}`;
      const valueQuote = raw.startsWith('"') ? '"' : raw.startsWith("'") ? "'" : "";
      return `${quote}${key}${quote}${separator}${valueQuote}${REDACTED}${valueQuote}`;
    },
  );
}

function dataProperty(object: object, key: string): unknown {
  let current: object | null = object;
  for (let i = 0; current && i < 4; i++, current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if ("value" in descriptor) return descriptor.value;
      // Node's built-in lazy stack accessor is shared between Error instances.
      // Read that exact native accessor only; user-defined getters stay omitted.
      if (key === "stack" && descriptor.get && descriptor.get === nativeErrorStackGetter) return descriptor.get.call(object);
      return OMITTED;
    }
  }
  return undefined;
}

/**
 * Produce a bounded, detached telemetry snapshot. No getters, toJSON methods,
 * request/config bodies, binary data or arbitrary class instances are serialized.
 * Generic callers use this with telemetry records; Error values become records.
 */
export function redactTelemetry<T>(input: T): T {
  let nodes = 0;
  const seen = new WeakSet<object>();

  function visit(value: unknown, depth: number, container = ""): unknown {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return TRUNCATED;
    if (typeof value === "string") return redactText(value);
    if (value === null || value === undefined || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : OMITTED;
    if (typeof value !== "object") return OMITTED;
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);

    try {
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return OMITTED;
      if (value instanceof Date) return Date.prototype.toISOString.call(value);
      if (value instanceof URL) return redactText(URL.prototype.toString.call(value));
      if (typeof Headers !== "undefined" && value instanceof Headers) {
        const result: Record<string, unknown> = {};
        let count = 0;
        for (const [key, entry] of Headers.prototype.entries.call(value)) {
          if (++count > MAX_ENTRIES) break;
          Object.defineProperty(result, key, { enumerable: true, value: sensitiveKey(key) ? REDACTED : visit(entry, depth + 1) });
        }
        return result;
      }
      if (value instanceof URLSearchParams) {
        const result: Record<string, unknown> = {};
        let count = 0;
        for (const [key, entry] of URLSearchParams.prototype.entries.call(value)) {
          if (++count > MAX_ENTRIES) break;
          Object.defineProperty(result, key, { enumerable: true, configurable: true, value: sensitiveQueryKey(key) ? REDACTED : visit(entry, depth + 1) });
        }
        return result;
      }
      if (Array.isArray(value)) {
        if (value.length === 2 && typeof dataProperty(value, "0") === "string" && sensitiveKey(dataProperty(value, "0") as string)) {
          return [redactText(dataProperty(value, "0") as string), REDACTED];
        }
        const result = [];
        for (let i = 0; i < Math.min(value.length, MAX_ENTRIES); i++) result.push(visit(dataProperty(value, String(i)), depth + 1));
        if (value.length > MAX_ENTRIES) result.push(TRUNCATED);
        return result;
      }

      const error = value instanceof Error;
      if (!error && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return OMITTED;
      const result: Record<string, unknown> = {};
      if (error) {
        for (const key of ["name", "message", "stack", "cause"]) {
          const entry = dataProperty(value, key);
          if (entry !== undefined) result[key] = visit(entry, depth + 1);
        }
      }
      let count = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key) || ["__proto__", "constructor", "prototype", "toJSON"].includes(key)) continue;
        if (error && ["name", "message", "stack", "cause"].includes(key)) continue;
        if (++count > MAX_ENTRIES || nodes > MAX_NODES) { result.truncated = TRUNCATED; break; }
        const safeKey = redactText(key).slice(0, 256);
        const requestData = normalizedKey(key) === "data" && ["request", "response"].includes(normalizedKey(container));
        result[safeKey] = sensitiveKey(key) || rawPayloadKey(key) || requestData ? REDACTED : visit(dataProperty(value, key), depth + 1, key);
      }
      return result;
    } catch {
      return OMITTED;
    }
  }

  return visit(input, 0) as T;
}

/** Preserve an exception's safe message/stack for grouping, never its raw SDK object. */
export function redactError(error: Error): Error {
  const safe = redactTelemetry(error) as unknown as Record<string, unknown>;
  const result = new Error(typeof safe.message === "string" ? safe.message : "Error details omitted");
  Object.defineProperty(result, "name", { value: typeof safe.name === "string" ? safe.name : "Error", configurable: true, writable: true });
  if (typeof safe.stack === "string") result.stack = safe.stack;
  for (const [key, value] of Object.entries(safe)) {
    if (!["name", "message", "stack"].includes(key)) Object.defineProperty(result, key, { value, enumerable: true });
  }
  return result;
}

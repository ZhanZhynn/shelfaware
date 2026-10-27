import { createHash, randomUUID } from "node:crypto";
import { getRedis } from "./redis";
import { logger } from "@/lib/logger";

interface RateLimitConfig { limit: number; window: number; identifier: string; strict?: boolean }
export interface RateLimitResult { allowed: boolean; current: number; limit: number; reset: number }

/** Server time, prune/count/add/expire in one atomic operation. */
export const RATE_LIMIT_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[2]) * 1000
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
local allowed = 0
if count < tonumber(ARGV[1]) then
  allowed = 1
  if ARGV[4] == '1' then
    redis.call('ZADD', KEYS[1], now, ARGV[3])
    redis.call('PEXPIRE', KEYS[1], window)
    count = count + 1
  end
end
local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local reset = window
if #first > 0 then reset = math.max(1, tonumber(first[2]) + window - now) end
return {allowed, count, math.ceil(reset / 1000)}
`;

const MAX_IDENTIFIERS = 10_000;
const fallbackRequests = new Map<string, { events: number[]; expires: number }>();

function keyFor(config: RateLimitConfig) {
  if (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > 1_000 || !Number.isInteger(config.window) || config.window < 1 || config.window > 86_400 || config.identifier.length > 1_024) throw new Error("Invalid rate limit configuration");
  return `rate-limit:v2:${config.limit}:${config.window}:${createHash("sha256").update(config.identifier).digest("hex")}`;
}

function fallback(config: RateLimitConfig, key: string, consume: boolean): RateLimitResult {
  const now = Date.now();
  const windowMs = config.window * 1000;
  const events = (fallbackRequests.get(key)?.events ?? []).filter((time) => time > now - windowMs);
  if (!fallbackRequests.has(key) && fallbackRequests.size >= MAX_IDENTIFIERS) {
    for (const [id, entry] of fallbackRequests) if (entry.expires <= now) fallbackRequests.delete(id);
    // Never evict an active blocked identity to make room for attacker-chosen IDs.
    if (fallbackRequests.size >= MAX_IDENTIFIERS) return { allowed: false, current: config.limit, limit: config.limit, reset: config.window };
  }
  const allowed = events.length < config.limit;
  if (allowed && consume) events.push(now);
  if (consume || fallbackRequests.has(key)) fallbackRequests.set(key, { events, expires: (events[events.length - 1] ?? now) + windowMs });
  return { allowed, current: events.length, limit: config.limit, reset: Math.max(1, Math.ceil(((events[0] ?? now) + windowMs - now) / 1000)) };
}

export function resetStrictRateLimitFallbackForTests() { fallbackRequests.clear(); }

async function evaluate(config: RateLimitConfig, consume: boolean): Promise<RateLimitResult> {
  const key = keyFor(config);
  // Mirror strict requests locally so an outage does not start a fresh budget.
  const local = config.strict ? fallback(config, key, consume) : null;
  const open = { allowed: true, current: 0, limit: config.limit, reset: config.window };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const redis = getRedis();
    if (!redis) return local ?? open;
    const result = await Promise.race([
      redis.eval<[number, number, string, string], number[]>(RATE_LIMIT_SCRIPT, [key], [config.limit, config.window, randomUUID(), consume ? "1" : "0"]),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Rate limiter timed out")), 1_000); }),
    ]);
    if (!Array.isArray(result) || result.length !== 3 || result.some((value) => !Number.isInteger(value)) || ![0, 1].includes(result[0]!) || result[1]! < 0 || result[1]! > config.limit || result[2]! < 0 || result[2]! > config.window) throw new Error("Invalid rate limiter result");
    return { allowed: result[0] === 1, current: result[1]!, limit: config.limit, reset: Math.max(1, result[2]!) };
  } catch {
    logger.warn("Distributed rate limiter unavailable; applying configured fallback");
    return local ?? open;
  } finally { if (timer) clearTimeout(timer); }
}

export const checkRateLimit = (config: RateLimitConfig) => evaluate(config, true);
export const getRateLimitStatus = (identifier: string, limit: number, window: number) => evaluate({ identifier, limit, window }, false);

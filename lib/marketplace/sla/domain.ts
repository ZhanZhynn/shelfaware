import { z } from "zod";

export const slaPlatforms = ["shopee", "lazada", "tiktok"] as const;
export type SlaPlatform = typeof slaPlatforms[number];
export const slaStages = ["arrange-shipment", "awaiting-collection", "blocked", "unknown", "closed"] as const;
export type SlaStage = typeof slaStages[number];
export const legacyShopeeOutstandingStatuses = ["READY_TO_SHIP", "PROCESSED", "RETRY_SHIP", "confirmed", "processing"];
export type DeadlineKind = "ship-by" | "arrange-by" | "collect-by" | "pickup-cutoff" | "auto-cancel" | "auto-cancel-arrange" | "auto-cancel-collect" | "preparation";
export type DeadlineFact = { kind: DeadlineKind; at: string; sourceField: string };
export type SlaUnit = {
  orderExternalId: string;
  unitKey: string;
  unitType: "order" | "package" | "item";
  packageExternalId: string | null;
  itemExternalId: string | null;
  providerStatus: string;
  stage: SlaStage;
  fulfillmentType: "seller" | "platform" | "unknown";
  blockedReason: string | null;
  deadlines: DeadlineFact[];
  deadlineAt: string | null;
  deadlineKind: DeadlineKind | null;
  deadlineSource: string | null;
  cancellationAt: string | null;
  providerUpdatedAt: string | null;
  sourceVersion: string;
  deadlineState: "observed" | "missing" | "invalid";
};

export class SlaError extends Error {
  constructor(readonly code: string, message = "SLA reporting could not be completed", readonly status = 422, readonly retryable = false) { super(message); }
}

export const slaObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function slaId(value: unknown): string {
  const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) throw new SlaError("SLA_RESPONSE_INVALID", "Provider returned an invalid fulfillment identity", 502);
  return id;
}

/** Provider seconds and explicit-offset strings only: never guess a local zone or unit. */
export function slaTimestamp(value: unknown, format: "seconds" | "offset"): string | null {
  if (value === null || value === undefined || value === "" || value === 0 || value === "0") return null;
  if (format === "seconds") {
    const seconds = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(seconds) || seconds < 946684800 || seconds > 32_503_680_000) return null;
    return new Date(seconds * 1000).toISOString();
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !z.string().datetime({ offset: true }).safeParse(value).success) return null;
  return new Date(value).toISOString();
}

export function deadlineFacts(value: Record<string, unknown>, fields: Array<[string, DeadlineKind]>, format: "seconds" | "offset") {
  const facts: DeadlineFact[] = [];
  let invalid = false;
  for (const [sourceField, kind] of fields) {
    const raw = value[sourceField];
    const at = slaTimestamp(raw, format);
    if (at) facts.push({ kind, at, sourceField });
    else if (raw !== undefined && raw !== null && raw !== "" && raw !== 0 && raw !== "0") invalid = true;
  }
  return { facts, invalid };
}

export function finishSlaUnit(unit: Omit<SlaUnit, "deadlineAt" | "deadlineKind" | "deadlineSource" | "cancellationAt" | "deadlineState">, invalid = false): SlaUnit {
  const closed = unit.stage === "closed" || unit.fulfillmentType === "platform";
  const outstanding = unit.deadlines.filter(({ kind }) => !closed && !kind.startsWith("auto-cancel") && kind !== "preparation" && !(unit.stage === "awaiting-collection" && kind === "arrange-by"));
  outstanding.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind));
  const cancellations = unit.deadlines.filter(({ kind }) => !closed && kind.startsWith("auto-cancel") && !(unit.stage === "awaiting-collection" && kind === "auto-cancel-arrange"));
  const specificCancellations = cancellations.filter(({ kind }) => kind !== "auto-cancel");
  const cancellation = (specificCancellations.length ? specificCancellations : cancellations).sort((a, b) => a.at.localeCompare(b.at))[0];
  const first = outstanding[0];
  return { ...unit, deadlineAt: first?.at ?? null, deadlineKind: first?.kind ?? null, deadlineSource: first?.sourceField ?? null, cancellationAt: cancellation?.at ?? null, deadlineState: invalid ? "invalid" : first ? "observed" : "missing" };
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
export function localSlaDate(value: Date | string, timezone: string) {
  let formatter = dateFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    if (dateFormatters.size >= 32) dateFormatters.clear();
    dateFormatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(new Date(value));
  const get = (name: string) => parts.find((part) => part.type === name)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const timezoneSchema = z.string().max(80).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } });
export const slaQuerySchema = z.object({
  shopId: z.string().regex(/^[a-f\d]{24}$/i),
  timezone: timezoneSchema.optional(),
  due: z.string().default("any").refine((value) => ["any", "today", "overdue"].includes(value) || /^\d{4}-\d{2}-\d{2}$/.test(value) && z.string().date().safeParse(value).success),
  withinHours: z.coerce.number().min(0.016666).max(168).optional(),
  includeOverdue: z.enum(["true", "false"]).transform((value) => value === "true").default("false"),
  includeUnknown: z.enum(["true", "false"]).transform((value) => value === "true").default("true"),
  stage: z.enum(["any", ...slaStages.filter((stage) => stage !== "closed") as ["arrange-shipment", "awaiting-collection", "blocked", "unknown"]]).default("any"),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: z.string().regex(/^\d{1,6}$/).optional(),
  maxAgeSeconds: z.coerce.number().int().min(60).max(86400).default(900),
  live: z.enum(["true", "false"]).transform((value) => value === "true").default("false"),
}).strict();
export type SlaQuery = z.infer<typeof slaQuerySchema>;

export function parseSlaQuery(params: URLSearchParams): SlaQuery {
  if (new Set(params.keys()).size !== [...params.keys()].length) throw new SlaError("INVALID_QUERY", "Duplicate query parameters");
  const parsed = slaQuerySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new SlaError("INVALID_QUERY", "Invalid SLA filters");
  if (parsed.data.live && parsed.data.cursor) throw new SlaError("INVALID_QUERY", "Live SLA snapshots do not accept stored-result cursors");
  return parsed.data;
}

export type ObservedSlaUnit = SlaUnit & { observedAt: string; lastKnownDeadlineAt?: string | null };

/** Summaries always cover the entire observed backlog, not just a page of matching rows. */
export function describeSlaBacklog(units: ObservedSlaUnit[], query: SlaQuery, timezone: string, now: Date) {
  const display = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const today = localSlaDate(now, timezone);
  const pending = units.filter((unit) => unit.stage !== "closed" && unit.fulfillmentType !== "platform");
  const actionable = pending.filter((unit) => unit.stage !== "blocked" && unit.stage !== "unknown" && unit.fulfillmentType === "seller");
  // A hold blocks the action, not necessarily the provider's deadline clock.
  const deadlinePending = pending.filter((unit) => unit.stage !== "unknown" && unit.fulfillmentType === "seller");
  const unknown = pending.filter((unit) => unit.deadlineState !== "observed" || unit.stage === "unknown" || unit.fulfillmentType === "unknown");
  const overdue = (unit: SlaUnit) => unit.deadlineAt !== null && Date.parse(unit.deadlineAt) < now.getTime();
  const dueToday = (unit: SlaUnit) => unit.deadlineAt !== null && localSlaDate(unit.deadlineAt, timezone) === today;
  const count = (rows: ObservedSlaUnit[]) => ({ orders: new Set(rows.map((unit) => unit.orderExternalId)).size, units: rows.length, packages: new Set(rows.filter((unit) => unit.packageExternalId).map((unit) => unit.packageExternalId)).size, items: rows.filter((unit) => unit.unitType === "item").length });
  const summary = {
    pending: count(pending), actionable: count(actionable),
    arrangeShipment: count(actionable.filter((unit) => unit.stage === "arrange-shipment")),
    awaitingCollection: count(actionable.filter((unit) => unit.stage === "awaiting-collection")),
    overdue: count(deadlinePending.filter(overdue)), dueToday: count(deadlinePending.filter(dueToday)),
    dueLaterToday: count(deadlinePending.filter((unit) => dueToday(unit) && !overdue(unit))),
    dueWithin: count(deadlinePending.filter((unit) => unit.deadlineAt && !overdue(unit) && Date.parse(unit.deadlineAt) <= now.getTime() + (query.withinHours ?? 6) * 3600000)),
    unknownDeadline: count(unknown), blocked: count(pending.filter((unit) => unit.stage === "blocked")),
    stale: count(pending.filter((unit) => now.getTime() - Date.parse(unit.observedAt) > query.maxAgeSeconds * 1000)),
    cancellationWithin: count(pending.filter((unit) => unit.cancellationAt && Date.parse(unit.cancellationAt) <= now.getTime() + (query.withinHours ?? 6) * 3600000)),
    excludedPlatformFulfilled: count(units.filter((unit) => unit.fulfillmentType === "platform")),
    countSemantics: "Distinct orders, packages and items are separate. Deadline/action counters overlap and must not be added together.",
  };
  const matching = pending.filter((unit) => {
    if (query.stage !== "any" && unit.stage !== query.stage) return false;
    if (!unit.deadlineAt) return query.includeUnknown;
    if (query.includeOverdue && overdue(unit)) return true;
    if (query.due === "overdue" && !overdue(unit)) return false;
    if (query.due === "today" && !dueToday(unit)) return false;
    if (!["any", "today", "overdue"].includes(query.due) && localSlaDate(unit.deadlineAt, timezone) !== query.due) return false;
    if (query.withinHours !== undefined && (overdue(unit) || Date.parse(unit.deadlineAt) > now.getTime() + query.withinHours * 3600000)) return false;
    return true;
  }).sort((a, b) => (a.deadlineAt ?? "9999").localeCompare(b.deadlineAt ?? "9999") || a.orderExternalId.localeCompare(b.orderExternalId) || a.unitKey.localeCompare(b.unitKey));
  const data = matching.map((unit) => ({ ...unit, hoursRemaining: unit.deadlineAt ? Math.round((Date.parse(unit.deadlineAt) - now.getTime()) / 36000) / 100 : null, deadlineLocal: unit.deadlineAt ? display.format(new Date(unit.deadlineAt)) : null, risk: !unit.deadlineAt ? "unknown" : overdue(unit) ? "overdue" : dueToday(unit) ? "due-today" : "upcoming" }));
  return { summary, data };
}

import { describe, expect, it } from "vitest";
import { describeSlaBacklog, localSlaDate, parseSlaQuery, slaTimestamp, type ObservedSlaUnit } from "./domain";
import { normalizeLazadaSla, normalizeShopeeSla, normalizeTikTokSla } from "./normalize";
import { publicSlaCheckpoint, slaCheckpoint } from "./checkpoint";

const now = new Date("2026-10-27T10:00:00Z"); // 18:00 Malaysia
const seconds = (date: string) => Date.parse(date) / 1000;
const query = (params = "") => parseSlaQuery(new URLSearchParams(`shopId=${"a".repeat(24)}&${params}`));
const observed = (unit: ReturnType<typeof normalizeShopeeSla>): ObservedSlaUnit => ({ ...unit, observedAt: now.toISOString() });

describe("provider deadline contracts", () => {
  it("accepts seconds and explicit-offset timestamps without accepting milliseconds or timezone-less text", () => {
    expect(slaTimestamp(1793095200, "seconds")).toBe("2026-10-27T10:00:00.000Z");
    expect(slaTimestamp(1793095200000, "seconds")).toBeNull();
    for (const raw of [null, undefined, "", 0, "0", -1, true, {}, "tomorrow"]) expect(slaTimestamp(raw, "seconds")).toBeNull();
    expect(slaTimestamp("2026-10-27T23:59:59+08:00", "offset")).toBe("2026-10-27T15:59:59.000Z");
    for (const raw of ["2026-10-27 23:59:59", "2026-02-30T23:59:59Z", "NEXT_DAY"]) expect(slaTimestamp(raw, "offset")).toBeNull();
  });

  it("does not confuse an arranged Shopee label with carrier collection", () => {
    const source = { order_sn: "ORDER", package_number: "PKG", fulfillment_status: "LOGISTICS_READY", ship_by_date: seconds("2026-10-27T15:59:59Z") };
    expect(normalizeShopeeSla({ ...source, is_shipment_arranged: false }, true).stage).toBe("arrange-shipment");
    expect(normalizeShopeeSla({ ...source, is_shipment_arranged: true }, true).stage).toBe("awaiting-collection");
    expect(normalizeShopeeSla(source, true).stage).toBe("unknown");
    expect(normalizeShopeeSla({ ...source, pickup_done_time: seconds("2026-10-27T09:00:00Z") }, true).stage).toBe("closed");
    expect(normalizeShopeeSla({ ...source, pending_terms: ["SYSTEM_PENDING"] }, true)).toMatchObject({ stage: "blocked", blockedReason: "SYSTEM_PENDING" });
  });

  it("keeps Shopee default order deadlines but never invents one from days_to_ship", () => {
    expect(normalizeShopeeSla({ order_sn: "ORDER", order_status: "READY_TO_SHIP", fulfillment_flag: "fulfilled_by_local_seller", days_to_ship: 2, create_time: seconds("2026-10-26T01:00:00Z") })).toMatchObject({ unitType: "order", stage: "arrange-shipment", deadlineAt: null });
    expect(normalizeShopeeSla({ order_sn: "ORDER", order_status: "READY_TO_SHIP", fulfillment_flag: "fulfilled_by_shopee", ship_by_date: seconds("2026-10-27T15:59:59Z") })).toMatchObject({ fulfillmentType: "platform", deadlineAt: null });
  });

  it("uses Lazada item SLA rather than promised time or NEXT_DAY", () => {
    const item = { order_item_id: "12345678901234567890", status: "ready_to_ship", is_fbl: "0", sla_time_stamp: "2026-10-27T23:59:59+08:00", promised_shipping_time: "2026-10-26T23:59:59+08:00", fulfillment_sla: "NEXT_DAY", package_id: "PACKAGE" };
    expect(normalizeLazadaSla({ order_id: "ORDER" }, item)).toMatchObject({ unitType: "item", itemExternalId: "12345678901234567890", packageExternalId: "PACKAGE", stage: "awaiting-collection", deadlineSource: "sla_time_stamp", deadlineAt: "2026-10-27T15:59:59.000Z" });
    expect(normalizeLazadaSla({ order_id: "ORDER" }, { ...item, sla_time_stamp: null })).toMatchObject({ deadlineAt: null, deadlineState: "missing" });
    expect(normalizeLazadaSla({ order_id: "ORDER" }, { ...item, is_cancel_pending: "true" }).stage).toBe("blocked");
    expect(normalizeLazadaSla({ order_id: "ORDER" }, { ...item, is_fbl: "1" }).deadlineAt).toBeNull();
  });

  it("keeps TikTok arrange, handover and cancellation clocks separate", () => {
    const order = { id: "ORDER", status: "AWAITING_SHIPMENT", fulfillment_type: "FULFILLMENT_BY_SELLER", rts_sla_time: seconds("2026-10-27T12:00:00Z"), tts_sla_time: seconds("2026-10-28T10:00:00Z"), shipping_due_time: seconds("2026-10-29T10:00:00Z"), collection_due_time: seconds("2026-10-30T10:00:00Z") };
    expect(normalizeTikTokSla(order)[0]).toMatchObject({ deadlineKind: "arrange-by", deadlineAt: "2026-10-27T12:00:00.000Z", cancellationAt: "2026-10-29T10:00:00.000Z" });
    expect(normalizeTikTokSla({ ...order, status: "AWAITING_COLLECTION" })[0]).toMatchObject({ stage: "awaiting-collection", deadlineKind: "collect-by", deadlineAt: "2026-10-28T10:00:00.000Z", cancellationAt: "2026-10-30T10:00:00.000Z" });
    expect(normalizeTikTokSla({ ...order, rts_sla_time: undefined, tts_sla_time: undefined })[0]).toMatchObject({ deadlineAt: null, deadlineState: "missing" });
    expect(normalizeTikTokSla({ ...order, status: "ON_HOLD" })[0]!.stage).toBe("blocked");
  });

  it("only closes the collected TikTok package in a partially shipped order", () => {
    const result = normalizeTikTokSla({ id: "ORDER", status: "PARTIALLY_SHIPPING", fulfillment_type: "FULFILLMENT_BY_SELLER", line_items: [{ package_id: "A", package_status: "FULFILLING" }, { package_id: "B", package_status: "TO_FULFILL" }], rts_sla_time: seconds("2026-10-27T12:00:00Z") });
    expect(result.map((unit) => [unit.packageExternalId, unit.stage])).toEqual([["A", "closed"], ["B", "arrange-shipment"]]);
    expect(normalizeTikTokSla({ id: "ORDER", status: "PARTIALLY_SHIPPING" })[0]!.stage).toBe("unknown");
  });
});

describe("SLA reporting and calendar boundaries", () => {
  const make = (id: string, at: string | null) => observed(normalizeShopeeSla({ order_sn: "ORDER", package_number: id, fulfillment_status: "LOGISTICS_READY", is_shipment_arranged: false, ship_by_date: at ? seconds(at) : undefined }, true));
  it("counts one order with multiple packages once and retains an unknown deadline", () => {
    const result = describeSlaBacklog([make("A", "2026-10-27T09:59:59Z"), make("B", "2026-10-27T15:59:59Z"), make("C", null)], query("due=today"), "Asia/Kuala_Lumpur", now);
    expect(result.summary.pending).toEqual({ orders: 1, units: 3, packages: 3, items: 0 });
    expect(result.summary.overdue.orders).toBe(1);
    expect(result.summary.dueToday.units).toBe(2);
    expect(result.summary.dueLaterToday.units).toBe(1);
    expect(result.summary.unknownDeadline.units).toBe(1);
    expect(result.data.map((row) => row.risk)).toEqual(["overdue", "due-today", "unknown"]);
  });

  it("uses local deadline date rather than UTC or order creation date", () => {
    const result = describeSlaBacklog([make("TODAY", "2026-10-27T15:59:59Z"), make("TOMORROW", "2026-10-27T16:00:00Z")], query("due=today"), "Asia/Kuala_Lumpur", now);
    expect(result.data.map((row) => row.packageExternalId)).toEqual(["TODAY"]);
    expect(localSlaDate("2026-11-01T05:30:00Z", "America/New_York")).toBe("2026-11-01");
    expect(localSlaDate("2026-11-01T06:30:00Z", "America/New_York")).toBe("2026-11-01");
  });

  it("keeps an overdue deadline separate from an upcoming horizon unless requested", () => {
    const rows = [make("OLD", "2026-10-26T15:00:00Z"), make("SOON", "2026-10-27T11:00:00Z"), make("LATE", "2026-10-28T11:00:00Z")];
    expect(describeSlaBacklog(rows, query("withinHours=6"), "Asia/Kuala_Lumpur", now).data.map((row) => row.packageExternalId)).toEqual(["SOON"]);
    expect(describeSlaBacklog(rows, query("withinHours=6&includeOverdue=true"), "Asia/Kuala_Lumpur", now).data.map((row) => row.packageExternalId)).toEqual(["OLD", "SOON"]);
  });

  it("does not assume a provider hold pauses the shipping deadline", () => {
    const row = { ...make("HELD", "2026-10-27T09:00:00Z"), stage: "blocked" as const, blockedReason: "SYSTEM_PENDING" };
    const result = describeSlaBacklog([row], query(), "Asia/Kuala_Lumpur", now);
    expect(result.summary.actionable.orders).toBe(0);
    expect(result.summary.blocked.orders).toBe(1);
    expect(result.summary.overdue.orders).toBe(1);
    expect(result.summary.dueToday.orders).toBe(1);
  });

  it.each(["shopId=invalid", `shopId=${"a".repeat(24)}&due=2026-02-30`, `shopId=${"a".repeat(24)}&timezone=Not/AZone`, `shopId=${"a".repeat(24)}&stage=shipped`, `shopId=${"a".repeat(24)}&limit=0`, `shopId=${"a".repeat(24)}&withinHours=999`, `shopId=${"a".repeat(24)}&due=today&due=any`])("rejects invalid operational filters: %s", (params) => {
    expect(() => parseSlaQuery(new URLSearchParams(params))).toThrow();
  });

  it("validates private checkpoints and redacts provider cursors from public progress", () => {
    expect(slaCheckpoint(null).phase).toBe("discover");
    const value = { v: 1, phase: "discover", cursor: { queue: 1, cursor: "PRIVATE", seen: ["PRIVATE_PREVIOUS"] }, pages: 2, records: 10, limited: false };
    expect(publicSlaCheckpoint(value)).toEqual({ phase: "discover", pages: 2, unitsObserved: 10, limited: false });
    expect(() => slaCheckpoint({ ...value, cursor: null })).toThrow();
    expect(publicSlaCheckpoint({ bogus: true })).toBeNull();
  });
});

import { deadlineFacts, finishSlaUnit, slaId, slaObject, slaTimestamp, type SlaStage, type SlaUnit } from "./domain";

const flag = (value: unknown) => value === true || value === 1 || value === "1" || value === "true" || value === "True";
const status = (value: unknown) => typeof value === "string" && /^[A-Za-z_ -]{1,80}$/.test(value) ? value.trim().toUpperCase().replace(/[- ]/g, "_") : "UNKNOWN";
const terms = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((term): term is string => typeof term === "string" && /^[A-Z_]{1,80}$/.test(term)))].slice(0, 20) : [];

export function normalizeShopeeSla(value: unknown, sellerFiltered = false): SlaUnit {
  const row = slaObject(value);
  const orderExternalId = slaId(row.order_sn);
  const packageExternalId = row.package_number ? slaId(row.package_number) : null;
  const providerStatus = status(row.fulfillment_status ?? row.logistics_status ?? row.order_status);
  const pending = terms(row.pending_terms);
  const hasPending = Array.isArray(row.pending_terms) && row.pending_terms.length > 0;
  const fulfillment = row.fulfillment_flag;
  const fulfillmentType = fulfillment === "fulfilled_by_shopee" || flag(row.advance_package) ? "platform" : sellerFiltered || ["fulfilled_by_local_seller", "fulfilled_by_cb_seller"].includes(String(fulfillment)) ? "seller" : "unknown";
  let stage: SlaStage = "unknown";
  if (slaTimestamp(row.pickup_done_time, "seconds") || /^(SHIPPED|COMPLETED|CANCELLED|TO_RETURN|TO_CONFIRM_RECEIVE|LOGISTICS_PICKUP_DONE|LOGISTICS_DELIVERY_DONE|LOGISTICS_DELIVERY_FAILED|LOGISTICS_REQUEST_CANCELED)$/.test(providerStatus)) stage = "closed";
  else if (hasPending || /^(PENDING|INVOICE_PENDING|IN_CANCEL|LOGISTICS_INVALID)$/.test(providerStatus)) stage = "blocked";
  else if (providerStatus === "LOGISTICS_READY") stage = row.is_shipment_arranged === true ? "awaiting-collection" : row.is_shipment_arranged === false ? "arrange-shipment" : "unknown";
  else if (/^(PROCESSED|LOGISTICS_REQUEST_CREATED|LOGISTICS_PICKUP_PENDING|LOGISTICS_PICKUP_RETRY)$/.test(providerStatus)) stage = "awaiting-collection";
  else if (/^(READY_TO_SHIP|RETRY_SHIP)$/.test(providerStatus)) stage = "arrange-shipment";
  else if (providerStatus === "UNPAID") stage = "closed";
  const parsed = deadlineFacts(row, [["ship_by_date", "ship-by"], ["preparation_end_time", "preparation"]], "seconds");
  return finishSlaUnit({ orderExternalId, unitKey: packageExternalId ? `package:${packageExternalId}` : `order:${orderExternalId}`, unitType: packageExternalId ? "package" : "order", packageExternalId, itemExternalId: null, providerStatus, stage, fulfillmentType, blockedReason: pending.join(",") || (hasPending ? "PROVIDER_PENDING_TERMS" : stage === "blocked" ? providerStatus : null), deadlines: parsed.facts, providerUpdatedAt: slaTimestamp(row.update_time, "seconds"), sourceVersion: packageExternalId ? "shopee-v2.get_package_detail" : "shopee-v2.get_order_detail" }, parsed.invalid);
}

export function normalizeLazadaSla(order: unknown, value: unknown): SlaUnit {
  const header = slaObject(order), row = slaObject(value);
  const orderExternalId = slaId(row.order_id ?? header.order_id);
  const itemExternalId = slaId(row.order_item_id);
  const packageExternalId = row.package_id ? slaId(row.package_id) : null;
  const providerStatus = status(row.status);
  const fulfillmentType = flag(row.is_fbl) ? "platform" : row.is_fbl === false || row.is_fbl === "0" || row.is_fbl === 0 || String(row.shipping_type).toLowerCase() === "dropshipping" ? "seller" : "unknown";
  let stage: SlaStage = "unknown";
  if (flag(row.is_digital) || /^(UNPAID|CANCELED|CANCELLED|SHIPPED|DELIVERED|RETURNED|FAILED|LOST)$/.test(providerStatus)) stage = "closed";
  else if (flag(row.need_cancel_confirm) || flag(row.is_cancel_pending) || ["unpaid", "unpaid final payment"].includes(String(row.stage_pay_status).toLowerCase())) stage = "blocked";
  else if (/^(PENDING|TOPACK|PACKED)$/.test(providerStatus)) stage = "arrange-shipment";
  else if (/^(READY_TO_SHIP|TOSHIP|SHIPPING)$/.test(providerStatus)) stage = "awaiting-collection";
  const parsed = deadlineFacts(row, [["sla_time_stamp", "ship-by"]], "offset");
  // promised_shipping_time(s), fulfillment_sla and cancel_trigger_time are not interchangeable shipping SLAs.
  return finishSlaUnit({ orderExternalId, unitKey: `item:${itemExternalId}`, unitType: "item", packageExternalId, itemExternalId, providerStatus, stage, fulfillmentType, blockedReason: stage === "blocked" ? "PROVIDER_CANCELLATION_OR_PAYMENT_PENDING" : null, deadlines: parsed.facts, providerUpdatedAt: slaTimestamp(row.updated_at, "offset"), sourceVersion: "lazada.order.items.get" }, parsed.invalid);
}

/** Interpret known fields only when returned; sourceVersion records the endpoint actually used. */
export function normalizeTikTokSla(value: unknown, sourceVersion = "tiktok-order-202309"): SlaUnit[] {
  const row = slaObject(value);
  const orderExternalId = slaId(row.id);
  const providerStatus = status(row.status);
  const fulfillmentType = row.fulfillment_type === "FULFILLMENT_BY_SELLER" ? "seller" : ["FULFILLMENT_BY_TIKTOK", "FULFILLMENT_BY_DILAYANI_TOKOPEDIA"].includes(String(row.fulfillment_type)) ? "platform" : "unknown";
  const parsed = deadlineFacts(row, [["rts_sla_time", "arrange-by"], ["tts_sla_time", "collect-by"], ["pick_up_cut_off_time", "pickup-cutoff"], ["cancel_order_sla_time", "auto-cancel"], ["shipping_due_time", "auto-cancel-arrange"], ["collection_due_time", "auto-cancel-collect"]], "seconds");
  const items = Array.isArray(row.line_items) ? row.line_items.map(slaObject) : [];
  const packageIds = [...new Set([...items.map((item) => item.package_id), ...(Array.isArray(row.packages) ? row.packages.map((pkg) => slaObject(pkg).id) : [])].filter((id) => id !== undefined && id !== null && id !== "").map(slaId))];
  const keys: Array<string | null> = packageIds.length ? packageIds : [null];
  return keys.map((packageExternalId) => {
    const packageItems = items.filter((item) => packageExternalId ? String(item.package_id) === packageExternalId : true);
    const packageStatuses = new Set(packageItems.map((item) => status(item.package_status)));
    let stage: SlaStage = "unknown";
    if (/^(UNPAID|CANCELLED|COMPLETED|DELIVERED|IN_TRANSIT)$/.test(providerStatus) || row.shipping_type === "TIKTOK_DIGITAL" || slaTimestamp(row.collection_time, "seconds")) stage = "closed";
    else if (providerStatus === "ON_HOLD" || flag(row.is_buyer_request_cancel)) stage = "blocked";
    else if (packageStatuses.size === 1 && packageStatuses.has("TO_FULFILL")) stage = "arrange-shipment";
    else if (packageStatuses.size === 1 && packageStatuses.has("PROCESSING")) stage = "awaiting-collection";
    else if (packageStatuses.size > 0 && [...packageStatuses].every((state) => ["FULFILLING", "COMPLETED", "CANCELLED"].includes(state))) stage = "closed";
    else if (providerStatus === "AWAITING_SHIPMENT") stage = "arrange-shipment";
    else if (providerStatus === "AWAITING_COLLECTION") stage = "awaiting-collection";
    // A partially shipped order without package evidence cannot establish which units remain outstanding.
    return finishSlaUnit({ orderExternalId, unitKey: packageExternalId ? `package:${packageExternalId}` : `order:${orderExternalId}`, unitType: packageExternalId ? "package" : "order", packageExternalId, itemExternalId: null, providerStatus: packageStatuses.size === 1 ? [...packageStatuses][0]! : providerStatus, stage, fulfillmentType, blockedReason: stage === "blocked" ? providerStatus === "ON_HOLD" ? "ON_HOLD" : "BUYER_REQUESTED_CANCELLATION" : null, deadlines: parsed.facts, providerUpdatedAt: slaTimestamp(row.update_time, "seconds"), sourceVersion }, parsed.invalid);
  });
}

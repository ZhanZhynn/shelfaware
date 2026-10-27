import type { getShopeeSDK } from "@/lib/shopee/server";
import { SlaError, slaId, slaObject } from "./domain";

type SDK = ReturnType<typeof getShopeeSDK>;

function response(value: unknown) {
  const envelope = slaObject(value);
  if (envelope.error) {
    const auth = /auth|token|permission|shop/i.test(String(envelope.error));
    throw new SlaError(auth ? "SLA_PROVIDER_AUTH_REQUIRED" : "SLA_PROVIDER_REQUEST_FAILED", "Shopee fulfillment request failed", auth ? 403 : 502, !auth);
  }
  if (envelope.warning) throw new SlaError("SLA_PROVIDER_WARNING", "Shopee returned partial fulfillment evidence", 502, true);
  if (!envelope.response || typeof envelope.response !== "object" || Array.isArray(envelope.response)) throw new SlaError("SLA_RESPONSE_INVALID", "Shopee returned an invalid fulfillment response", 502);
  return slaObject(envelope.response);
}

/** The installed SDK only passes through this body; its package-search declarations are outdated. */
export async function searchShopeeSlaPackages(sdk: SDK, queue: number, cursor = "") {
  if (!Number.isInteger(queue) || queue < 0 || queue >= 6) throw new SlaError("SLA_CHECKPOINT_INVALID");
  const body = {
    filter: { package_status: [1, 2, 3][queue % 3], fulfillment_type: 2, invoice_pending: queue >= 3 },
    pagination: { page_size: 50, cursor },
    sort: { sort_type: 1, ascending: true },
  };
  const raw = response(await sdk.order.searchPackageList(body as unknown as Parameters<SDK["order"]["searchPackageList"]>[0]));
  const pagination = slaObject(raw.pagination);
  if (!Array.isArray(raw.packages_list) || raw.packages_list.length > 50 || typeof pagination.more !== "boolean") throw new SlaError("SLA_RESPONSE_INVALID", "Shopee package-search contract did not match", 502);
  const packages = raw.packages_list.map((item) => { const row = slaObject(item); return { order_sn: slaId(row.order_sn), package_number: slaId(row.package_number) }; });
  const next = pagination.more ? typeof pagination.next_cursor === "string" ? pagination.next_cursor : "" : "";
  if (pagination.more && (!packages.length || !next || next === cursor || next.length > 2048)) throw new SlaError("SLA_PAGINATION_STALLED", "Shopee fulfillment pagination did not advance", 502);
  return { packages, more: pagination.more, next };
}

export async function getShopeeSlaPackages(sdk: SDK, ids: string[]) {
  if (!ids.length) return [];
  if (ids.length > 50 || new Set(ids).size !== ids.length) throw new SlaError("SLA_RESPONSE_INVALID", "Invalid package batch", 502);
  const raw = response(await sdk.order.getPackageDetail({ package_number_list: ids }));
  if (!Array.isArray(raw.package_list) || raw.package_list.length !== ids.length) throw new SlaError("SLA_RESPONSE_INVALID", "Shopee did not return every requested package", 502);
  const result = raw.package_list.map(slaObject);
  const returned = result.map((row) => slaId(row.package_number));
  if (new Set(returned).size !== ids.length || returned.some((id) => !ids.includes(id))) throw new SlaError("SLA_RESPONSE_INVALID", "Shopee package identities did not match the request", 502);
  return result;
}

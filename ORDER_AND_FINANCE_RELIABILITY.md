# Order And Finance Reliability

## Goal

Make marketplace data safe to use for operational reporting: live reads are
fresh and explicitly partial where necessary, while local financial reporting
never represents missing or unverified data as zero revenue or profit.

## Data Contract

- Every live response identifies its `source`, `asOf`, and provider state.
- Live Shopee order responses include gross order amounts when supplied by the
  provider. Settlement values remain distinct because they become available
  only through escrow details after the provider makes them available.
- Financial reports include coverage and freshness metadata. A requested range
  with no usable financial evidence is unavailable, not zero.
- Unknown or unverified ledger values stay visible in records but are excluded
  from calculated net financial totals.

## Delivery

1. Add provider-aware live error diagnostics, including retryability and
   remediation, without leaking raw provider responses.
2. Return normalized Shopee live financial fields and settlement availability.
3. Expose finance coverage, last-observed data, and missing-data reasons.
4. Return required API token scopes with finance authorization failures and
   display profile/API context in the CLI.
5. Add opt-in cursor traversal through `--all` for reporting exports.
6. Add regression tests for pagination, finance authorization, coverage, and
   live-order financial mapping.

## Source Semantics

`live` data is provider-read, non-persistent, and may be incomplete for a
provider's settlement lifecycle. `local` data is persisted and can be audited;
its response coverage describes whether it is recent and sufficiently complete
for the requested financial calculation.

## CLI And v1 Order Reliability

Local order lists retain ingestion-time filtering by default. Set
`dateBasis=source` to filter the provider creation timestamp, falling back to
ingestion only when the source timestamp is null. `dateBasis=ingested` makes
the legacy behavior explicit. Source filtering does not change existing list
ordering or the meaning of the returned `createdAt`; `sourceCreatedAt` remains
separate. Cursors are bound to the selected filter basis.

Analytics accepts inclusive `YYYY-MM-DD` UTC dates or exact RFC3339 boundaries
with an explicit offset. For a Malaysia-local day, for example, use
`dateFrom=2026-10-18T00:00:00+08:00` and
`dateTo=2026-10-18T23:59:59.999+08:00` (URL-encode the plus sign when building
URLs). Daily/weekly/monthly trend buckets remain UTC; timestamp boundaries do
not imply local-time buckets. Finance endpoints retain their own date contract.

Analytics responses expose `freshness`:

- `source` is `local`, never a silent live-provider fallback.
- `computedAt` is when the result was built and remains unchanged on cache hits.
- `latestMatchingOrderObservedAt` is the newest recorded source observation
  among orders matching the filters, or null if there is no such evidence.
- `shops[].lastShopSyncAt` is the general shop synchronization timestamp, not an
  order-specific successful-sync timestamp.
- `historyCompleteness` remains `unknown`. Neither timestamp proves complete
  ingestion of the requested order window.

No-data responses explicitly describe missing local observations rather than
claiming zero live orders. Missing shop synchronization times produce an
additional warning. The response cache uses a new namespace so pre-freshness
payloads cannot masquerade as the updated contract.

Persisted Shopee order lists/details expose recorded `shipByDate`,
`packageNumber`, `daysToShip`, and fulfillment status. Live orders expose carrier
and package facts from the existing detail read, without requesting escrow or
creating shipments. Missing facts stay null/empty. A package array is not an
order count, and a stored singular package number does not establish that an
order has only one package.

The 2026-10-18 export reconciliation matched all 36 exported order IDs and
Grand Total values. That does not make Grand Total seller payout. Detailed
escrow/fee reporting remains separate and finance-scoped; the live endpoint
explicitly says that it does not request escrow details.

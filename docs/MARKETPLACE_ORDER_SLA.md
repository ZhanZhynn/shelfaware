# Marketplace order SLA implementation

Supports Shopee, Lazada and TikTok. Reporting reads the canonical operational
projection; it never reads deadlines from finance JSON or calculates an
authoritative deadline from order age plus handling days.

## Setup and deployment

```sh
npx prisma generate
# Run against the intended database only after reviewing its environment.
node --env-file=.env --import tsx scripts/create-marketplace-sla-indexes.ts
```

The script adds indexes only to `MarketplaceSlaUnit` and
`MarketplaceSlaCollection`. It does not reset or migrate existing collections.
Deploy the generated Prisma client and backend source before using the new CLI.
Initial reports have `coverage.state=missing` until a dedicated SLA refresh runs.

## API

```text
GET /api/v1/marketplaces/{platform}/sla/orders
GET /api/v1/marketplaces/{platform}/sla/summary
```

Require an owned internal `shopId` and `marketplace:read`. `live=true` additionally
requires `marketplace:live`. Refresh uses the existing sync/foreground routes and
`marketplace:sync`. Ownership is revalidated both when reading and on every worker
page. A rejected or unavailable requesting account cannot continue a refresh.
Raw provider responses, credentials and buyer PII are not returned or persisted
in these operational models.

Filters: `due=any|today|overdue|YYYY-MM-DD`, `withinHours`, `includeOverdue`,
`includeUnknown`, `stage`, `timezone`, `maxAgeSeconds`, `limit`, and stored-result
`cursor`. Duplicates and unknown filters are rejected. Date filters apply to
deadlines, never to the creation date of pending orders. Summary counters cover
the whole observed backlog; `matched` describes the requested filter subset.
Counts for distinct orders, packages and items are separate and overlapping.

Only `observed` coverage confirms fresh known counts from the available provider
queues. Missing, partial or stale results must not establish zero due orders.
Package-identity completeness is independent of order-level deadline coverage.
`overdue` means an outstanding observed provider deadline has elapsed; it does
not certify an official LDR/penalty decision. Multi-page snapshots are not atomic.

The stored read cap is 10,000 units per shop and stored pages have at most 100
rows. Exceeding the cap marks coverage partial. Live requests have a 12-page,
20-second inter-page, 2,000-unit budget; individual provider calls may take longer.
Live snapshots do not write the projection, do not resume through stored cursors,
and do not revalidate previously stored open units. Use durable refresh for the
complete available traversal plus persisted-backlog revalidation.

## Ingestion and durable refresh

`syncType=sla` is supported only for Shopee/Lazada/TikTok, accepts no input/date
range, and always uses the checkpointed task engine. Each invocation processes
one bounded provider page or known-open recheck batch. Provider cursors remain
private in task storage; public progress exposes only phase and counts.

Each persistence transaction fences both the worker lease and collection
generation. Provider errors do not delete previous facts. Missing current
deadlines retain a separate last-known value without labelling it current.
Older provider update timestamps cannot regress newer stored evidence.
Known open units absent from discovery are explicitly re-fetched; full order
detail can supersede order-level fallback/split identities, but search-page
absence alone cannot close an order/package.

All-runs add an optional SLA task after orders. Order-range input is not applied
to that task. Shopify graphs are unchanged. A standalone SLA failure fails its
run; optional all-run failures remain visible as completed-with-warnings.
Collection completion establishes traversal, not that every deadline is usable:
reports still mark missing fields, unknown stages/ownership and stale rows partial.

### Provider contracts

- Shopee: package search uses documented `packages_list`, nested `pagination`,
  and `sort_type`/`ascending`. The installed SDK's declarations drift from this
  shape, so the narrow adapter validates actual responses instead of trusting a
  type cast. Search returns package identities; `get_package_detail` provides
  deadlines. Batches are at most 50. Pending/ToProcess/Processed and invoice-pending
  queues are scanned separately for seller fulfillment. `is_shipment_arranged`
  distinguishes an arranged label from an unarranged `LOGISTICS_READY` package.
  The ordinary order sync also maps default order-detail deadlines and no longer
  clears old deadlines when best-effort package enrichment is unavailable.
- Lazada: open-status order pages are enriched through multiple-order items,
  at most 50 order IDs per call. `sla_time_stamp` must include an explicit offset.
  Header/item promised times and `fulfillment_sla=NEXT_DAY` do not replace it.
  Discovery uses required `created_after=2000-01-01T00:00:00+00:00`; scope metadata
  declares this bound. Reaching the 5,000-order offset cap marks the refresh
  limited rather than complete. Fulfilled-by-Lazada/digital units are excluded.
- TikTok: status-only discovery has no recent creation filter, then detail is
  enriched in batches of 50. The adapter retains the existing `/order/202309`
  version; it does not globally migrate the application to the checked-in
  `/order/202507` detail documentation. Missing version/region-specific fields
  remain unknown. RTS, collection, SEA pickup cutoff and automatic-cancellation
  timestamps have separate kinds. Arranged units no longer use a completed RTS
  deadline. Package evidence is necessary to resolve partially shipped orders.

Unix timestamps are validated as seconds, not milliseconds. Lazada SLA strings
without offsets are unknown. Provider deadlines remain authoritative for business
days, public holidays, preorders and extensions; this feature does not implement
an invented calendar engine. Region-specific LDR assessment is not inferred from
the minimum of unrelated automatic-cancellation timestamps.

## Scheduling

`GET /api/marketplace/sla/cron` uses the independent `CRON_SECRET` and is disabled
unless `MARKETPLACE_SLA_CRON_ENABLED=true`. Enable it after storage/index deployment
and queue verification. `vercel.json` schedules it every 15 minutes at UTC 00–11,
which is 08:00–19:45 Malaysia time. Use a scheduler capable of that cadence;
the NAS can alternatively drive scoped foreground SLA runs.

The endpoint only creates/redelivers durable work. `accepted` and `scheduled`
are not execution completion. Existing active queued SLA runs are reused to avoid
accumulating a backlog when delivery is unavailable. Same-slot scheduling is
idempotent. At most 100 shops per platform and 45 seconds of enqueueing are
attempted per invocation; caps/failures are reported as partial. Rejected/pending
owners are excluded. The standard authenticated worker, leases and delivery outbox
remain the execution boundary; no new unsigned worker endpoint exists.

## Legacy Shopee UI/API

Legacy near-SLA filters now recognize actual uppercase Shopee statuses while
retaining old aliases. That order-level view explicitly reports unverified
coverage; its widget cannot show "All Clear" for an unverified zero. The legacy
Telegram alert reads only recently synchronized native orders and does not claim
complete SLA coverage. Use the canonical v1 report for freshness/coverage-aware
operational decisions.

## Sources and verification

- Shopee order detail: https://open.shopee.com/documents/v2/v2.order.get_order_detail?module=94&type=1
- Shopee package search: https://open.shopee.com/documents/v2/v2.order.search_package_list?module=94&type=1
- Shopee package detail: https://open.shopee.com/documents/v2/v2.order.get_package_detail?module=94&type=1
- Shopee readiness: https://open.shopee.com/faq/727
- Lazada items: https://open.lazada.com/apps/doc/api?path=%2Forder%2Fitems%2Fget
- Lazada orders: https://open.lazada.com/apps/doc/api?path=%2Forders%2Fget
- TikTok service-specific guidance: https://partner.tiktokshop.com/docv2/page/m5p1u1fo
- TikTok snapshots: `docs/marketplace_api/tiktok/order/`; full public detail pages
  did not render during research. Verify actual authorized endpoint capabilities
  against Seller Centre before relying on a rollout's deadline coverage.

Offline fixtures test provider contract drift, split units, missing/invalid
deadlines, timezone/DST boundaries, expired ownership/authorization, bounded
pagination, failure preservation, stale coverage, generation/lease loss, and
service scheduler deduplication. These tests do not establish live provider
permission availability or Seller Centre parity for a deployed environment.

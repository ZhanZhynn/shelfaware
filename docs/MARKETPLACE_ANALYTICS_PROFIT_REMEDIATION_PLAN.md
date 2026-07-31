# Marketplace Analytics and Profit Remediation Plan

## Purpose

Remediate the current marketplace analytics implementation before it is treated
as a financial reporting feature. The existing shared server and UI are useful
scaffolding, but they currently aggregate fabricated zeroes, incomplete order
totals, inconsistent statuses, and legacy route results. This plan replaces
those assumptions with source-provenanced, currency-safe, capability-aware
analytics for Shopee, Lazada, TikTok Shop, and Shopify.

This document supersedes the implementation sequence in
`docs/MARKETPLACE_ANALYTICS_PROFIT_PLAN.md` where the current implementation has
already diverged from that plan.

## Goals

- Make revenue, refunds, fees, shipping, buyer, product, and profit values
  traceable to verified source fields.
- Preserve unknown values as unknown through storage, calculation, API, CSV,
  and UI.
- Restore the complete Shopee analytics experience in reusable components and
  provide the same truthful feature set to other platforms when supported.
- Use one authenticated, versioned contract for all six endpoint families:
  summary, revenue trend, products, buyers, CLV, and profit.
- Implement persisted capability checks and resumable, idempotent 12-month
  backfills with honest history and financial coverage.
- Safely identify and replace historical records populated by zero-default
  ingestion without rewriting legitimate source zeroes.
- Reconcile aggregates to marketplace statements or Admin reports before
  enabling profit per shop.

## Non-Goals

- COGS, advertising spend, payroll, overhead, or fully loaded accounting profit.
- Foreign-exchange conversion until an approved, dated rate source and rounding
  policy are implemented.
- Inventing undocumented API endpoints, scopes, field meanings, fee categories,
  quantity rules, refund rules, or shipping signs.
- Treating a successful order sync as proof that finance, refunds, settlements,
  customer identity, or 12 months of history are available.
- Bank-deposit reconciliation outside marketplace payout APIs.
- Preserving known-defective legacy response semantics indefinitely.

## Guiding Correctness Rules

1. **Unknown is not zero.** A numeric zero is known only when the source
   explicitly supplied zero or a verified formula produced it from fully known
   operands. Missing, inaccessible, legacy-defaulted, and unparsed values are
   `null` with a reason.
2. **Never sum mixed currencies.** A request covering more than one source
   currency returns a typed `MIXED_CURRENCY` error unless a verified conversion
   service converted every row at an identified rate and date. `currency=native`
   is not permission to combine currencies.
3. **Use stable identity.** Order, item, buyer, product, and variant identity is
   `(platform, internalShopId, externalId)`. Names, email display text, SKU text,
   and product titles are labels or fallbacks, never cross-shop join keys.
4. **Capabilities and coverage are truthful.** `unsupported`, `unauthorized`,
   `available`, `degraded`, and `error` are distinct. Coverage is based on rows
   and dates actually returned, not requested history or model presence.
5. **Do not invent external fields.** A documented field still requires a
   captured fixture from an authorized shop and verification of units, signs,
   tax inclusion, currency, lifecycle, regional behavior, and pagination before
   it enters financial calculations.
6. **Statuses do not erase money.** Cancelled unpaid orders are excluded. Returns,
   refunds, partial refunds, chargebacks, and post-settlement adjustments are
   represented explicitly; they are not reduced to cancellation regexes.
7. **Every aggregate reconciles.** Product allocations reconcile to their order
   at the currency minor-unit precision, and endpoint partitions reconcile to
   the common summary for the same filters and calculation version.
8. **Known-only estimates are labelled partial.** Missing costs are not silently
   subtracted as zero. Profit is unavailable when required revenue operands are
   unknown; when optional costs are missing, `knownCostProfit` may be returned
   with a partial basis and missing-category list, never labelled complete.

## Current-State Problem Matrix

| Priority | Finding | Exact affected files | Impact | Target behavior |
| --- | --- | --- | --- | --- |
| Critical | TikTok quantity, subtotal, tax, and refund are hardcoded/defaulted | `lib/tiktok/sync.ts:534-540`; `prisma/schema.prisma` (`TikTokOrderItem` defaults); `lib/marketplace/analytics/server.ts:63-67`; `app/api/tiktok/stats/route.ts` | Fabricated zero revenue/refunds/tax and unit quantity become apparently complete analytics | Quarantine legacy rows, map only verified fields, retain raw provenance, and expose unknown/partial until re-synced |
| High | Lazada quantity is hardcoded to one | `lib/lazada/sync.ts:431-449`; `lib/lazada/custom-api.ts`; `prisma/schema.prisma` (`LazadaOrderItem`) | Quantity, product velocity, item gross sales, and allocation can be wrong | Prove whether each row is one unit or has a quantity field; otherwise store quantity as unknown and suppress quantity metrics |
| High | Shopee missing escrow values become zero and shipping meaning/sign is unresolved | `lib/shopee/sync.ts:660-710`; `prisma/schema.prisma` (`ShopeeOrder` fee fields); `lib/marketplace/analytics/server.ts:53-57` | Missing escrow appears as no fee/no shipping cost; estimated and final shipping may be conflated | Presence-aware escrow parsing; verified fee/shipping field map; raw snapshot; settled basis only from final eligible escrow/adjustment data |
| High | Shopify uses gross totals without current/refund totals | `lib/shopify/server.ts:427-475`; `lib/shopify/sync.ts:271-349`; `prisma/schema.prisma` (`ShopifyOrder`, `ShopifyOrderItem`); `lib/marketplace/analytics/server.ts:68-72` | Refunded/cancelled quantities and current sales are misreported | Ingest current totals, discounts, refunds/refund lines, successful transactions, stable customer/product/variant IDs, and use post-refund values |
| High | Static product and revenue-trend routes shadow the shared dynamic handler | `app/api/[platform]/stats/[metric]/route.ts`; `app/api/{shopee,lazada,tiktok,shopify}/stats/products/route.ts`; `app/api/{shopee,lazada,tiktok,shopify}/stats/revenue-trend/route.ts` | Legacy shapes, cache keys, owner scope, product-name grouping, cancellation rules, and date behavior vary by route | One route factory/handler and one response envelope for every platform/metric; remove shadowing files after compatibility window |
| High | Base stats endpoints retain legacy semantics | `app/api/{shopee,lazada,tiktok,shopify}/stats/route.ts` | The sixth endpoint family disagrees with shared metrics and may aggregate defective totals | Migrate summary to the same normalized query, access scope, filters, status rules, currency check, and versioned contract |
| High | Shopee UI functionality regressed; profit is incomplete | `app/admin/shopee/analytics/content.tsx`; `app/admin/shopee/profit/content.tsx`; `components/marketplace/analytics/MarketplaceAnalyticsDashboard.tsx`; `components/marketplace/profit/MarketplaceProfitDashboard.tsx`; displaced behavior in `components/shopee/ShopeeBuyerAnalytics.tsx`, `components/shopee/ShopeeClvAnalytics.tsx`, and `components/shopee/ShopeeProfitDashboard.tsx` | Trends, buyer detail, geographic/tier views, CLV tables, product performance, fee breakdown, and product profit table are absent | Reusable full analytics/profit screens retain supported Shopee functions and show explicit partial states elsewhere |
| High | CLV is historical spend renamed as an estimate | `lib/marketplace/analytics/calculators.ts:73-117`; `lib/marketplace/analytics/types.ts`; `components/marketplace/analytics/MarketplaceAnalyticsDashboard.tsx` | Misleading forward-looking metric and rankings | Separate `historicalNetSales` from a documented, horizon-bound predictive CLV; return predictive CLV unavailable when data sufficiency fails |
| High | Returned/refunded orders can remain revenue | `lib/marketplace/analytics/calculators.ts:6-8`; platform status maps in `lib/{shopee,lazada,tiktok,shopify}/sync.ts`; return/refund ingestion | Regex only excludes cancel/fail; returns and refunds lack canonical normalization | Canonical lifecycle plus payment/refund state; subtract verified refunds and exclude only proven void/unpaid sales |
| Medium | Product allocation is global and identity omits shop | `lib/marketplace/analytics/server.ts:79-96`; `lib/marketplace/analytics/calculators.ts:64-70`; `lib/marketplace/analytics/types.ts` | Product profit may not reconcile and same IDs/SKUs collide across shops | Allocate each order independently with deterministic residual handling; aggregate by platform/shop/product/variant identity |
| Medium | Cache invalidation is incomplete and cron invalidation is fire-and-forget | `lib/cache/cache-utils.ts:503-536`; `app/api/{shopee,lazada,tiktok}/sync/cron/route.ts`; marketplace sync/import/webhook/shop mutation routes | Stale analytics survive cron/mutations or invalidation errors are lost | Versioned keys; awaited, logged invalidation after every order/item/refund/finance/settlement/shop mutation |
| Medium | Capability/backfill models are schema-only and unrelated | `prisma/schema.prisma:1705-1765`; no runtime readers/writers/workers | UI cannot distinguish unavailable access from failures; no backfill occurs | Relational connection state, capability evaluator, leases, cursors, attempts, workers, and operator endpoints |
| Medium | Filters are raw IDs, inconsistent, and request on every keystroke | `components/marketplace/analytics/MarketplaceAnalyticsDashboard.tsx:9-38`; `components/marketplace/profit/MarketplaceProfitDashboard.tsx:10-31`; route parsing in `lib/marketplace/analytics/server.ts` | Invalid requests, platform ID mismatch, request churn, inaccessible multi-shop/currency selection | Authorized shop selector, date preset/range, currency selector; applied/debounced filters and complete query keys |
| Test gap | Core boundaries are not covered | Current tests are limited to `lib/marketplace/analytics/calculators.test.ts` and `server.test.ts` | Adapter, auth, route, invalidation, schema, backfill, and UI regressions can ship | Add fixtures and tests at every ingestion, calculation, API, cache, worker, Prisma, and UI boundary |

## Target Data and API Contract

### Canonical data rules

- Money is stored as source decimal text or integer minor units where practical;
  calculations use a decimal-safe representation. Existing `Float` columns are
  compatibility inputs only and are not extended for new finance records.
- Every normalized amount carries `currency`, `source`, `sourceExternalId`,
  `observedAt`, `quality` (`verified`, `derived`, `legacy-unverified`, `unknown`),
  and an optional `unknownReason`.
- The canonical status dimensions are independent:
  `orderLifecycle` (`pending`, `fulfilled`, `completed`, `cancelled`, `returned`,
  `unknown`), `paymentState` (`unpaid`, `paid`, `partially_refunded`, `refunded`,
  `chargeback`, `unknown`), and `settlementState` (`unsettled`, `settled`,
  `adjusted`, `unknown`). Raw platform status is always retained.
- `grossSales`, discounts, refunds, tax, shipping credits/costs, subsidies, fees,
  adjustments, and settled proceeds are separate signed canonical categories.
  Adapters normalize signs once; calculators do not infer signs from names.
- Product identity is `{ platform, shopId, productExternalId, variantExternalId,
  itemExternalId }`. A missing product ID creates a shop-scoped unmapped item,
  never a name-based merge.

### Endpoint families

All platforms expose these six families through a shared handler:

```text
GET /api/{platform}/stats
GET /api/{platform}/stats/revenue-trend
GET /api/{platform}/stats/products
GET /api/{platform}/stats/buyers
GET /api/{platform}/stats/clv
GET /api/{platform}/stats/profit
```

Accepted query parameters:

| Parameter | Rule |
| --- | --- |
| `shopId` | Internal connection/shop ID from the authorized shop-options endpoint; omit only for all authorized shops |
| `dateFrom`, `dateTo` | UTC calendar dates in `YYYY-MM-DD`, inclusive, `dateFrom <= dateTo` |
| `currency` | ISO 4217 code or `native`; no conversion is implied |
| `granularity` | Trend only: `day`, `week`, or `month`; default `day` |
| `cursor`, `limit` | Tables only; opaque cursor and bounded limit, default 50, maximum 200 |

Success responses use a stable envelope rather than metric-specific top-level
shapes:

```json
{
  "apiVersion": "2026-analytics-v1",
  "calculationVersion": "profit-v3",
  "platform": "shopee",
  "metric": "profit",
  "filters": {
    "shopIds": ["internal-shop-id"],
    "dateFrom": "2025-08-01",
    "dateTo": "2026-07-30",
    "currency": "MYR",
    "granularity": null
  },
  "data": {},
  "coverage": {
    "state": "partial",
    "calculationBasis": "settled",
    "sourceCurrencies": ["MYR"],
    "history": { "requestedFrom": "2025-08-01", "availableFrom": "2025-09-03", "through": "2026-07-30" },
    "orders": { "known": 945, "total": 1000, "percent": 94.5 },
    "financialFields": {},
    "buyerIdentityPercent": 72.4,
    "missing": [{ "field": "returnShipping", "reason": "scope_unavailable" }]
  },
  "capabilities": {
    "orders": "available",
    "finance": "unauthorized",
    "refunds": "degraded",
    "settlements": "unsupported",
    "buyerIdentity": "available"
  },
  "warnings": [],
  "page": null
}
```

Numeric aggregate fields that cannot be computed are `null`, not zero. Empty,
fully known datasets may return zero. Product quantities can be `null` while
sales remain available. Profit includes a category-level fee breakdown and a
paginated product table. CLV returns separate fields:
`historicalNetSales`, `predictedNetRevenueNext12Months`, `method`, `horizonMonths`,
`trainingWindow`, `sampleSize`, and `availabilityReason`.

Capability state meanings:

| State | Meaning |
| --- | --- |
| `unknown` | Not checked with the current grant/client version |
| `available` | Probe succeeded and required fields were observed |
| `degraded` | Endpoint works but fields/history/regions are incomplete |
| `unauthorized` | Endpoint or scope denied for this connection |
| `unsupported` | Verified platform/region/account type does not provide it |
| `error` | Transient or operational failure; retryable metadata is included internally |

Error responses use `{ "error": { "code", "message", "details", "requestId" }
}` and never return HTTP 200 with an `error` property:

- `400 INVALID_QUERY`: malformed enum/cursor.
- `401 UNAUTHORIZED`: no valid session.
- `403 FORBIDDEN`: authenticated actor is outside the approved Admin scope or
  selected shop is outside that scope.
- `404 NOT_FOUND`: unsupported platform/metric or missing selected shop.
- `409 MIXED_CURRENCY`: selected rows contain multiple currencies; `details`
  contains the currencies and candidate shop IDs. No totals are returned.
- `409 CAPABILITY_UNAVAILABLE`: the requested metric has no defensible source;
  use partial success instead when a meaningful known subset exists.
- `422 INVALID_DATE_RANGE` or `INSUFFICIENT_CLV_HISTORY` for a valid request that
  cannot produce the requested result. The CLV summary endpoint may instead
  return 200 with predictive fields `null` so historical analytics remain usable.
- `429 RATE_LIMITED` and `500 INTERNAL_ERROR`; platform credentials/details are
  logged with redaction and are not exposed.

## Phase 0: Contain Incorrect Output and Validate Semantics

**Can implement immediately:** quarantine known bad records, add response
warnings/feature gates, capture fixtures, and validate fields against repository
docs and current payloads. **Blocked:** declaring platform financial fields
verified without authorized live responses and required scopes.

Likely files to modify/create:

- `lib/marketplace/analytics/server.ts`
- `lib/marketplace/analytics/types.ts`
- `lib/marketplace/analytics/calculators.ts`
- `lib/{shopee,lazada,tiktok,shopify}/sync.ts`
- `lib/{shopee,lazada,tiktok,shopify}/types.ts`
- `docs/marketplace_api/**`
- `docs/marketplace-analytics/source-field-matrix.md` (new)
- `test/fixtures/marketplace/{platform}/` (new; redact credentials and PII)

Tasks:

- Stop classifying TikTok item zero defaults as known. Until provenance exists,
  mark affected fields `legacy-unverified`; disable TikTok financial totals or
  derive only from separately verified order payment fields.
- Add a source-field matrix per platform: endpoint/version, JSON path, level,
  sign, unit, currency, tax inclusion, lifecycle mutability, required scope,
  region/account fixture, and canonical destination.
- Verify Lazada row multiplicity/quantity and whether `price`, `paid_price`,
  vouchers, and shipping are unit or line/order amounts. Do not infer quantity.
- Verify Shopee absent-field versus explicit-zero parsing, escrow finality,
  adjustment fields, estimated/actual shipping direction, buyer-paid shipping,
  subsidies, and return/refund linkage.
- Verify TikTok line item quantity, price detail, tax, seller/platform discount,
  refunds, and Finance 202501 transaction signs from live redacted fixtures.
- Verify Shopify `currentTotal*`, refunds/refund line items, transaction status,
  transaction fees, customer protected data, returns, and payout availability
  for the pinned Admin API version.
- Create a canonical status matrix containing every observed raw status and
  explicit inclusion/refund behavior. Unknown status produces a warning and is
  excluded from certified financial output, not guessed.
- Put profit/CLV behind a per-shop readiness flag until migration and
  reconciliation gates pass. Existing pages display an explanatory partial
  state rather than fabricated values.

Acceptance criteria:

- No field identified as legacy-defaulted contributes as a known zero.
- Every enabled canonical financial field has documentation plus at least one
  redacted real response fixture for the applicable region/account.
- Unknown statuses and fields are counted and visible in coverage/warnings.
- A shop without verified revenue/refund semantics cannot show complete profit.

Tests:

- Regression fixture proving the current TikTok hardcoded rows do not report
  zero revenue/refunds as complete data.
- Presence-aware parsing tests for absent, null, string zero, numeric zero, and
  malformed values.
- Status matrix tests for every observed raw status and unknown fallback.

## Phase 1: Schema, Provenance, and Safe Migration

**Can implement immediately:** schema structures, migration scripts, quality
markers, relations, and dual-read compatibility. **Blocked:** field-specific
backfill transformations whose source semantics are not verified in Phase 0.

Likely files to modify/create:

- `prisma/schema.prisma`
- `prisma/client.ts`
- `scripts/marketplace-analytics/audit-legacy-data.ts` (new)
- `scripts/marketplace-analytics/migrate-connections.ts` (new)
- `scripts/marketplace-analytics/mark-legacy-quality.ts` (new)
- `scripts/marketplace-analytics/verify-migration.ts` (new)
- deployment migration/runbook files following the repository's Prisma MongoDB
  schema-deployment workflow

Tasks:

- Add `MarketplaceAnalyticsConnection` as the canonical relational parent with
  `user`, `platform`, `platformShopRecordId`, external shop ID, region, grant
  fingerprint, sync/readiness state, and relations to capabilities, backfills,
  and financial records. Add optional unique `analyticsConnectionId` relations
  to each platform shop and backfill them. This avoids an unenforceable
  polymorphic `shopId` relation.
- Replace free-text capability/backfill state with Prisma enums. Add capability
  `checkedGrantFingerprint`, endpoint/version, observed field set, error code,
  retry time, and evidence timestamp.
- Extend backfill state with target range, stream cursor JSON, lease owner/expiry,
  attempt timestamps, page/item counts, checksum, last successful checkpoint,
  and terminal reason. Use a unique connection/stream key.
- Evolve `MarketplaceFinancialRecord` to decimal-safe amount/minor units,
  currency, canonical category, raw type/name, normalized sign, source timestamps,
  settlement/adjustment linkage, and ingestion revision. Preserve raw payload.
- Add nullable normalized source fields and stable external item/product/variant/
  buyer IDs needed by each platform. Remove defaults from unknown-capable
  financial fields. Make TikTok/Lazada quantity nullable until verified.
- Add `ingestionRevision`, `sourceObservedAt`, `financialQuality`, and
  `rawFinancialPayload` (or equivalent snapshot relation) so old defaults can be
  distinguished from explicit source zeroes.
- Add compound uniqueness scoped by shop for orders/items currently globally
  unique (`LazadaOrder.lazadaOrderId`, `TikTokOrder.tiktokOrderId`, and
  `ShopifyOrder.shopifyOrderId` as applicable). Audit duplicates before changing
  constraints; do not merge records by external ID alone.

Migration and compatibility sequence:

1. Audit counts, currencies, duplicates, zero distributions, date coverage, and
   missing raw payloads without mutation; persist a signed report artifact.
2. Add nullable fields, connection records, quality markers, and indexes. Keep
   legacy fields readable; do not rename/drop them in this deployment.
3. Link shops to connections and mark pre-remediation rows
   `legacy-unverified`. Specifically mark TikTok quantity/subtotal/tax/refund,
   Lazada quantity, absent Shopee escrow-derived zeroes, and Shopify gross-only
   totals. Never mass-convert all numeric zeroes to null.
4. Dual-write verified new sync data to source-compatible and normalized fields.
   Analytics v1 reads only provenance-qualified normalized data, with explicit
   fallback adapters for legacy nonfinancial display fields.
5. Re-fetch/backfill source data. Promote individual fields to `verified` only
   when present in verified payloads; retain unknown when history is unavailable.
6. Compare old/new APIs during a time-boxed compatibility window. Remove legacy
   columns and response adapters only after usage telemetry shows no consumers
   and rollback snapshots have expired.

Acceptance criteria:

- Prisma enforces connection-to-user and connection-to-state-record relations;
  every active platform shop has exactly one analytics connection.
- Migration is idempotent, resumable, dry-runnable, and reports before/after
  counts with no destructive blanket zero conversion.
- New records identify ingestion revision and per-field provenance.
- Stable compound keys prevent cross-shop collision and duplicate replay.

Tests:

- Prisma integration tests for relations, cascade/restrict policy, uniqueness,
  enums, nullable unknowns, and idempotent upserts.
- Migration fixture tests for legitimate zero, defaulted zero, duplicate external
  IDs across shops, interrupted resume, and rollback-compatible reads.

## Phase 2: Platform Adapters and Canonical Status/Refund Rules

**Can implement immediately:** adapter interfaces, null-safe parsing, raw status
retention, Shopify fields available under current grant, and mappings already
proved by fixtures. **Blocked:** finance/refund/settlement ingestion until each
shop's scopes and live field semantics pass Phase 0.

Likely files to modify/create:

- `lib/marketplace/analytics/adapters/{shopee,lazada,tiktok,shopify}.ts` (new)
- `lib/marketplace/analytics/status.ts` (new)
- `lib/marketplace/analytics/provenance.ts` (new)
- `lib/{shopee,lazada,tiktok,shopify}/sync.ts`
- `lib/{shopee,lazada,tiktok,shopify}/{server,custom-api,types}.ts`
- `lib/shopify/graphql-client.ts`
- platform OAuth/scope configuration files discovered during implementation

Shared adapter contract:

- Input is persisted source rows/raw snapshots; output is canonical order,
  items, ledger entries, capabilities, and field-level provenance.
- Parsing rejects non-finite amounts and currency mismatches. Source parsing and
  canonical sign normalization are separate tested functions.
- A return status alone does not invent a refund amount. A refund transaction
  subtracts revenue once even if order, return, and settlement sources all refer
  to it; stable transaction/refund IDs provide deduplication.

Shopee tasks:

- Replace `Number(value || 0)` with presence-aware parsing for escrow values.
- Persist raw escrow/income response, final/post-adjustment proceeds, seller and
  platform discounts, fee categories, buyer shipping credits, seller shipping,
  return shipping, subsidies, and adjustment IDs only after field verification.
- Join returns/refunds to orders/items and normalize partial/full refund state.
- Mark settlement verified only for documented final escrow state; order detail
  remains an estimate. Do not substitute estimated shipping for actual shipping.

Lazada tasks:

- Correct or null quantity based on verified row semantics; preserve stable
  order-item/item/SKU IDs and buyer ID when actually exposed.
- Persist seller/platform vouchers, paid price, original shipping, seller and
  platform shipping discounts, and tax from verified order/item fields.
- Ingest Finance signed ledger rows, payouts, logistics fees, and returns with
  raw regional names and stable external IDs. Unknown categories remain
  `other/unknown` and partial, not forced into an English fee enum.

TikTok Shop tasks:

- Remove hardcoded quantity/subtotal/tax/refund and schema defaults. Map verified
  order detail/price-detail fields and preserve absent values as null.
- Add Finance 202501 statement and order transaction clients using existing
  signing/cursor conventions; persist order/SKU revenue, refunds, fees, taxes,
  shipping, subsidies, and settlement components with raw breakdowns.
- Verify virtual bundle/repeated-unit behavior before deriving quantity.
- Require and probe the documented finance scope before enabling settled profit.

Shopify tasks:

- Pin the Admin GraphQL API version. Query current subtotal/total tax/discount/
  shipping/net totals, stable customer/product/variant/line IDs, refunds and
  refund line items, returns, and successful order transactions.
- Store original and current quantities separately. Use current post-refund
  totals for net sales and successful refund transactions for reconciliation.
- Ingest transaction fees and Shopify Payments payout/balance transactions only
  when granted. Third-party gateway fees remain unknown.
- Continue excluding test orders and explicitly normalize voided/cancelled/
  refunded financial states.

Acceptance criteria:

- All four adapters satisfy the same fixture-driven contract and never emit a
  known zero for absent input.
- Full and partial refunds reduce revenue exactly once; returned-without-refund
  remains a return state with unknown/pending refund.
- Unknown raw statuses/categories are retained, metered, and do not silently
  enter certified totals.
- Replaying any page produces no duplicate orders, items, refunds, or ledger rows.

Tests:

- Adapter fixtures for absent/zero fields, partial/full refunds, return without
  refund, cancellation before payment, post-settlement adjustment, multi-item
  order, mixed item currency, pagination replay, and regional unknown fees.
- Signed-client contract tests with HTTP mocks, redacted fixture snapshots, and
  assertions that secrets/PII are not logged.

## Phase 3: Shared Calculators, Reconciliation, and CLV

**Can implement immediately** once normalized fixtures exist. CLV projection is
not blocked by finance scope, but it remains unavailable where order history or
stable buyer identity is insufficient.

Likely files to modify/create:

- `lib/marketplace/analytics/types.ts`
- `lib/marketplace/analytics/calculators.ts`
- `lib/marketplace/analytics/reconciliation.ts` (new)
- `lib/marketplace/analytics/clv.ts` (new)
- `lib/marketplace/analytics/calculators.test.ts`
- `lib/marketplace/analytics/clv.test.ts` (new)

Tasks:

- Replace nullable-number-plus-`known()` arithmetic with explicit known/unknown
  result types. Produce both field totals and known/total denominators.
- Apply canonical inclusion rules: exclude proven unpaid/void cancellations;
  include paid sales and subtract deduplicated refunds/chargebacks/adjustments;
  keep returns without a known refund partial.
- Calculate each order independently. Allocate order-level amounts by verified
  item net-sales share, then quantity/value fallback only when documented. If no
  defensible denominator exists, leave allocation unknown.
- Round at platform currency minor-unit precision. Assign rounding residuals in
  stable item-ID order so item allocations exactly equal each order total.
- Aggregate products by shop-scoped stable identity. Return unmapped items
  separately and never merge by title.
- Keep historical buyer net sales as `historicalNetSales`; do not label it CLV.
- Implement predictive 12-month net-revenue CLV as a documented Gamma-Poisson
  repeat-purchase model: estimate a shop/cohort prior from the trailing 12 months,
  update each buyer's purchase rate using their observed orders/exposure, and
  multiply expected next-12-month orders by the buyer/cohort shrinkage-adjusted
  net order value. Version prior parameters and exclude profit/COGS claims.
- Require at least 180 days of observable history, 100 identified buyers, 20
  repeat buyers, and 70% buyer-identity coverage by default. Return predictive
  values null with `availabilityReason` below thresholds. Validate thresholds
  with holdout tests before rollout; changing them increments calculation version.
- Use orders before `dateTo` as the CLV training history; `dateFrom` limits
  displayed cohort/acquisition analysis but must not truncate lifetime history
  without disclosure. Return training window and as-of date.
- Add temporal holdout evaluation (MAE and weighted absolute percentage error)
  against a historical 90-day/12-month outcome where sufficient data exists.
  Do not enable predictive labels if the model performs worse than the approved
  historical-rate baseline.

Acceptance criteria:

- No calculator silently coalesces unknown financial values to zero.
- Per-order and product allocations reconcile exactly at minor-unit precision.
- Summary, trend, products, buyers, CLV historical spend, and profit use the
  same order inclusion/refund rules.
- CLV is explicitly predictive, horizon-bound, reproducible by version, and
  unavailable when data sufficiency or holdout quality fails.

Tests:

- Property tests for allocation conservation, deterministic residuals, order
  permutation invariance, null propagation, and no cross-shop product merging.
- Table tests for status/refund combinations, settled versus partial estimates,
  tax exclusion, discounts, shipping signs, fees, and negative adjustments.
- CLV tests for no history, sparse identity, one-time buyers, deterministic
  as-of calculation, leakage prevention, and holdout metrics.

## Phase 4: Consolidate All Six Endpoint Families and Access Scope

**Can implement immediately** after Phases 1-3 contracts stabilize.

Likely files to modify/create:

- `lib/marketplace/analytics/server.ts`
- `lib/marketplace/analytics/query.ts` (new)
- `lib/marketplace/analytics/response.ts` (new)
- `lib/marketplace/access.ts`
- `app/api/[platform]/stats/route.ts` (new shared summary route)
- `app/api/[platform]/stats/[metric]/route.ts`
- `app/api/marketplace/shops/route.ts` (new selector endpoint)
- all static `app/api/{shopee,lazada,tiktok,shopify}/stats/route.ts`
- all static `app/api/{shopee,lazada,tiktok,shopify}/stats/products/route.ts`
- all static `app/api/{shopee,lazada,tiktok,shopify}/stats/revenue-trend/route.ts`
- Shopee static `buyers`, `clv`, and `profit` routes

Tasks:

- Build one request parser, authorization guard, normalized query service,
  response envelope, and error mapper used by summary plus five metric routes.
- Validate selected internal shop IDs against authorized connections before any
  aggregate query. Do not accept platform-specific `sellerId` aliases in v1.
- Preserve the approved scope already encoded by `marketplaceOwnerIds`: global
  role `admin` sees marketplace connections owned by the approved Admin data
  scope and shares cache scope `admin-shared`; non-Admin users see only their own
  connections. Confirm this policy with product/security owners and test it.
  Never broaden protected customer fields merely because order totals are shared.
- Return only masked buyer identifiers unless the actor and platform grant permit
  protected customer data. CSV follows the same authorization.
- Move summary (`/stats`) onto the normalized service. Add metric selectors so
  endpoints do not calculate/fetch unused payloads.
- Migrate all static route files to thin re-exports of the shared handler for one
  release, with deprecation headers and contract telemetry. Then delete them so
  Next.js cannot shadow dynamic routes.
- Publish the explicit v1 envelope. If current internal consumers need legacy
  fields, add a time-boxed server adapter selected by an explicit legacy version
  header, not route-specific behavior. Never translate unknown nulls to zero.
- Update `lib/api.ts` and all current callers in the same release. Record old
  contract usage and a removal date.

Acceptance criteria:

- A contract test matrix proves all 24 platform/metric combinations plus four
  summary endpoints have the same envelope, filters, auth, cache policy, and
  error semantics.
- Static route precedence cannot change behavior; after removal, only the shared
  route implementation handles analytics.
- Cross-owner shop IDs return 403/404 without leaking existence or data.
- Mixed currency always returns 409 before calculating totals.

Tests:

- Route tests for 401, Admin shared scope, non-Admin isolation, shop validation,
  date/currency/granularity/cursor errors, mixed currency, partial capability,
  empty known dataset, and internal error redaction.
- Snapshot/schema validation for each endpoint response and compatibility header.

## Phase 5: Versioned Cache and Exhaustive Invalidation

**Can implement immediately** after the endpoint contract is fixed.

Likely files to modify/create:

- `lib/cache/cache-utils.ts`
- `lib/marketplace/analytics/cache.ts` (new)
- every marketplace sync/import/webhook/refund/finance/payout/shop mutation route
- `app/api/{shopee,lazada,tiktok}/sync/cron/route.ts`
- future Shopify cron/backfill routes
- `lib/marketplace/analytics/cache.test.ts` (new)

Tasks:

- Centralize keys as `marketplace-analytics:{apiVersion}:{calculationVersion}:
  {platform}:{accessScope}:{shopSetHash}:{metric}:{dateFrom}:{dateTo}:{currency}:
  {granularity}:{page}`. Canonically sort shop IDs and never put PII in keys.
- Increment calculation version for semantic changes; retain short TTL as a
  fallback, not the correctness mechanism.
- Centralize `invalidateMarketplaceAnalytics` by platform and affected
  connection(s). Invalidate all six families and all date/currency/page variants
  after order/item, status, refund/return, finance, settlement/payout, connection,
  capability, and completed backfill writes.
- Add the marketplace analytics pattern to `invalidateAllServerCaches`.
- Await invalidation in manual sync, import, webhook, cron, capability, and
  worker completion paths. Log and fail/retry the job when invalidation fails;
  remove `void invalidateAllServerCaches()` fire-and-forget calls.
- Invalidate only after committed writes. A failed/partial sync invalidates if
  any material rows committed and records that fact in the sync result.

Acceptance criteria:

- No mutation or cron returns success before required invalidation completes.
- All key dimensions prevent cross-scope/filter/version collisions.
- Invalidation telemetry identifies platform, connection, cause, key count,
  duration, and failure without PII.

Tests:

- Key determinism/isolation tests and mutation coverage tests enumerating every
  write route/worker.
- Integration test: warm all six caches, apply each write class, assert all
  affected keys miss and unrelated platform keys remain.

## Phase 6: Capability Evaluation and Resumable 12-Month Backfill

**Can implement immediately:** worker framework, state machine, leases, operator
APIs, order-stream backfill within existing access, and capability probes that
use known endpoints. **Blocked:** finance/refund/settlement streams where scopes,
history approval, region support, or verified fields are absent.

Likely files to modify/create:

- `lib/marketplace/analytics/capabilities.ts` (new)
- `lib/marketplace/analytics/backfill/{types,runner,windows}.ts` (new)
- `lib/marketplace/analytics/backfill/{shopee,lazada,tiktok,shopify}.ts` (new)
- `app/api/marketplace/analytics/capabilities/route.ts` (new)
- `app/api/marketplace/analytics/backfill/route.ts` (new)
- `app/api/marketplace/analytics/backfill/cron/route.ts` (new)
- `prisma/schema.prisma`
- existing platform clients and OAuth scope configuration

Tasks:

- Evaluate capabilities on connect/reconnect, scope change, manual refresh, and
  scheduled expiry. A scope string alone is not `available`; perform a minimal,
  non-mutating probe and record evidence/field observations.
- Implement streams `orders`, `refunds`, `finance`, and `settlements` per
  connection. Unsupported/unauthorized streams terminate honestly and do not
  block available order analytics.
- Target `[today - 12 months, today]`, but store actual earliest/latest returned.
  Respect verified endpoint limits: Shopee 14/15-day windows where required;
  Lazada below documented 180-day maxima with smaller retryable windows; TikTok
  cursor/time windows; Shopify 60 days unless `read_all_orders` is approved.
- Use DB leases, bounded exponential backoff with jitter, rate-limit reset data,
  checkpoint after every committed page, idempotent upserts, and max attempts.
  Never hold a request open for the complete 12-month job.
- Schedule recent overlap re-sync for late returns, refunds, fees, disputes, and
  settlement adjustments. Advance coverage only after page validation and commit.
- Expose Admin-safe status/start/retry/cancel operations. Cancellation stops at
  a checkpoint and remains resumable. Do not expose raw credentials or payloads.
- On completion, run reconciliation and invalidate caches; readiness changes
  only if capability, coverage, and reconciliation gates all pass.

Acceptance criteria:

- A worker resumes from the last committed page after process termination and
  concurrent workers cannot own the same connection/stream lease.
- Replayed pages are idempotent; late adjustments update existing records.
- UI/API reports actual coverage and reasons for restricted history.
- Capability models have active readers/writers and backfill models have active
  workers, not schema-only records.

Tests:

- Window boundary, cursor, lease expiry, concurrent claim, timeout resume,
  duplicate page, rate limit, retry exhaustion, cancellation, restricted history,
  late adjustment, invalidation, and capability-transition tests.

## Phase 7: Reusable Full Analytics and Profit UI

**Can implement immediately:** component architecture, selectors, request apply
behavior, tables/charts, partial states, CSV, and restoration against the v1
contract. Platform-specific panels remain gated by actual capability/data.

Likely files to modify/create:

- `components/marketplace/analytics/MarketplaceAnalyticsDashboard.tsx`
- `components/marketplace/profit/MarketplaceProfitDashboard.tsx`
- `components/marketplace/analytics/{Filters,Coverage,RevenueTrend,BuyerAnalytics,ClvAnalytics,ProductPerformance}.tsx` (new)
- `components/marketplace/profit/{ProfitSummary,FeeBreakdown,ProductProfitTable}.tsx` (new)
- `components/marketplace/analytics/useMarketplaceAnalyticsFilters.ts` (new)
- `app/admin/{shopee,lazada,tiktok,shopify}/{analytics,profit}/page.tsx`
- `components/layouts/admin-navigation.tsx`
- old `components/shopee/ShopeeBuyerAnalytics.tsx`, `ShopeeClvAnalytics.tsx`, and
  `ShopeeProfitDashboard.tsx` after feature parity is proven

Tasks:

- Restore Shopee summary, revenue/profit trends, buyer/repeat analytics, top
  buyers, spending tiers, geography where permitted, RFM/churn, CLV details,
  product velocity/performance, fee breakdown, shipping disclosure, and product
  profit table in reusable components.
- Populate a shop select from `/api/marketplace/shops`; never require raw IDs.
  Use platform-consistent internal IDs and show shop name, region, currency, and
  capability badges.
- Provide date presets plus validated dates and a currency select constrained to
  currencies actually present. Multi-shop selections with different currencies
  require selecting one currency/shop; do not offer fake conversion.
- Keep draft filters local and fetch on Apply (or debounce free-text table search
  only). Query keys include normalized applied filters, API/calculation version,
  metric, and page. Abort stale requests and check non-2xx responses before JSON use.
- Render loading, empty, partial, unauthorized, unsupported, stale, backfilling,
  and error states distinctly. Unknown financial categories show `Unavailable`,
  not `0.00`; known zero remains `0.00`.
- Profit displays gross sales, seller discounts, refunds, net sales, shipping
  credits/costs/subsidies, fee categories, adjustments, known-cost profit,
  settled proceeds/reconciliation, margin when valid, and exclusions.
- CSV uses the applied server result and includes API/calculation version,
  filters, currency, basis, coverage, missing fields, stable shop/product IDs,
  fee breakdown, and rows matching displayed rounded values. Escape spreadsheet
  formulas and enforce the same protected-data scope.
- Preserve responsive desktop/mobile behavior and accessible chart/table
  alternatives. Remove old Shopee components only after parity tests pass.

Acceptance criteria:

- Shopee has at least the analytics/detail functionality that existed before the
  four-card regression, now using corrected shared semantics.
- Every platform gets identical controls and core layout; unsupported panels
  explain the missing capability rather than displaying zero.
- Typing does not issue network requests; Apply issues one coherent filter change.
- CSV reconciles to the visible data and includes disclosure metadata.

Tests:

- React Testing Library tests for selectors, Apply behavior, request errors,
  loading/empty/partial/capability states, mixed currency, null versus zero,
  pagination, Shopee parity sections, and CSV escaping/content.
- Playwright coverage for Admin/non-Admin access, shop/date/currency switching,
  stale request cancellation, desktop/mobile layout, and download.

## Phase 8: Reconciliation, Rollout, and Legacy Removal

Likely files to modify/create:

- `lib/marketplace/analytics/reconciliation.ts`
- `app/api/marketplace/analytics/reconciliation/route.ts` (new Admin endpoint)
- `scripts/marketplace-analytics/reconcile.ts` (new)
- feature flag/system configuration files used by this repository
- operational dashboards and alerts
- legacy routes/components only after removal gates pass

Tasks:

- Reconcile sampled shops/date ranges against Seller Center exports, finance
  statements, Shopify Admin/refund reports, and payout totals at order and daily
  levels. Store expected, actual, delta, source artifact hash, reviewer, and date.
- Define tolerance per currency as exact minor-unit order reconciliation and an
  approved aggregate tolerance only for timing/window differences. Explain every
  residual category; do not hide it in `otherCharges`.
- Run shadow v1 responses without exposing profit, compare old/new for diagnosis,
  and classify differences as corrected defect, expected scope gap, or blocker.
- Roll out by platform, region, and shop behind readiness flags: internal test,
  selected Admins, reconciled shops, then broader availability.
- Monitor legacy version usage. Remove compatibility adapters, shadowing routes,
  old columns, and obsolete Shopee components only after the announced window,
  zero active consumers, backup verification, and rollback period.

Acceptance criteria and rollout gates:

- **Gate A, semantics:** source matrix approved; no unresolved field contributes
  to complete financial output.
- **Gate B, data:** schema migration verified; active shops linked; bad historical
  defaults quarantined; backfill coverage truthfully recorded.
- **Gate C, code:** adapter/calculator/route/cache/backfill/UI tests pass and all
  six families use one contract.
- **Gate D, reconciliation:** representative shop samples across enabled regions
  reconcile at order and statement level; unresolved deltas block that shop.
- **Gate E, security:** approved Admin shared scope, customer-data masking, OAuth
  scopes, logs, and CSV reviewed.
- **Gate F, operations:** alerts, retry/runbook, rollback, feature flags, and
  support diagnostics are live.
- **Gate G, removal:** no legacy consumers for the agreed observation period.

Verification commands:

```bash
npx prisma generate
npx tsc --noEmit
npm test
npm run lint
npm run build
```

Add the repository's integration and Playwright commands when their suites are
created. Existing unrelated failures are documented separately, not suppressed.

## Observability and Operations

Emit structured, PII-redacted metrics/logs with request/job correlation IDs:

- Orders/items/refunds/finance rows fetched, inserted, updated, rejected, and
  deduplicated by platform/connection/stream.
- Unknown/default-quarantined field counts, unknown raw statuses/categories,
  currency conflicts, and adapter parse failures.
- Capability state transitions, probe latency, grant fingerprint changes, and
  unauthorized/unsupported counts.
- Backfill lag, requested/actual coverage, cursor age, lease expiry, attempts,
  rate limits, and terminal failures.
- Cache hit/miss/invalidation count, duration, and failure by metric/version.
- API latency/error code by endpoint family and calculation version.
- Reconciliation absolute/relative deltas, stale settlement age, CLV eligibility,
  and CLV holdout error by shop cohort.

Alert on repeated worker failure, stuck lease, rising unknown-status rate,
invalidation failure, mixed-currency spikes, reconciliation regression, finance
capability loss, source field disappearance, and stale coverage. Runbooks must
cover credential reconnect, capability re-probe, safe stream retry, cache purge,
shop disablement, and migration rollback.

## External Decisions and Blockers

These require verified platform documentation, authorized credentials, or owner
approval. Until resolved, the associated values remain unknown/partial:

| Platform/area | Decision or evidence required | Safe behavior while blocked |
| --- | --- | --- |
| Shopee | Payment API access; final/post-adjustment escrow fields; actual versus estimated shipping sign; subsidies and return shipping by region | Order analytics only; fee/shipping/profit partial or unavailable |
| Lazada | Whether order-item rows imply quantity one; voucher/shipping/tax semantics; Finance/logistics/returns access and regional fee signs | Quantity metrics null; known order sales only; no complete profit |
| TikTok | `seller.finance.info` or current documented equivalent; Finance 202501 availability; line quantity/bundle semantics; price/tax/refund field paths and signs | Quarantine historical defaults; disable complete revenue/profit |
| Shopify | Pinned API version; `read_all_orders`, protected customer data, returns, and payout scopes; fee availability for non-Shopify gateways | Actual accessible history only; masked/no buyer analytics; third-party fees unknown |
| Currency | Approved rate source, rate timestamp policy, base/quote convention, rounding, restatement policy | Return 409 for mixed currency; filter to one currency/shop |
| Access | Product/security confirmation that global approved Admins share marketplace totals and which protected buyer fields may be shared/exported | Use current owner scope, mask buyer details, do not broaden access |
| CLV | Product approval of predictive horizon/label and holdout quality threshold | Show historical buyer value; predictive CLV null |

Implementation must not work around blocked scopes by scraping Seller Centers,
guessing endpoint versions, substituting similarly named fields, or assigning
zero. Manual exports may be used for controlled reconciliation, not silently
mixed into API-sourced production records without a separately designed import
and provenance contract.

## Key Risks

- Platform fields and permissions differ by region, account program, and API
  version; one fixture is not proof for all shops.
- Financials mutate after delivery through refunds, disputes, shipping
  measurement, and settlement adjustments; overlap sync and source timestamps
  are mandatory.
- Prisma MongoDB constraint deployment and large historical rewrites can be
  operationally expensive; use additive fields, batches, checkpoints, and index
  preflight checks.
- Protected customer-data approval can reduce buyer/CLV coverage independently
  of order coverage.
- Product allocation is an estimate even when order profit is settled unless the
  finance source provides SKU-level costs; disclose allocation method.
- A predictive CLV can be statistically valid but operationally poor for sparse
  shops; data sufficiency and holdout gates prevent false precision.
- Legacy consumers may depend on old shapes or zero defaults; telemetry and an
  explicit compatibility window are required, but known-wrong values are never
  emulated in the new contract.

## Definition of Done

- [ ] TikTok hardcoded quantity/subtotal/tax/refund values are removed,
  historical defaults are quarantined, and affected data is re-fetched or shown
  unknown.
- [ ] Lazada quantity semantics are verified or quantity remains null; Shopee
  escrow/shipping semantics and Shopify current/refund totals are corrected.
- [ ] Every enabled source field has documented semantics, scope, live redacted
  fixture, provenance, and adapter test; blocked fields remain unknown.
- [ ] Canonical lifecycle, payment, settlement, return, refund, chargeback, and
  adjustment rules prevent returned/refunded revenue overstatement and duplicate
  refund subtraction.
- [ ] Shared calculators propagate unknowns, reject mixed currencies, use
  decimal-safe rounding, and reconcile per-order product allocations exactly.
- [ ] Product keys include platform and shop identity and never join by name.
- [ ] Historical buyer spend is not labelled CLV; predictive 12-month CLV has a
  versioned method, sufficiency gate, training metadata, and holdout validation.
- [ ] Summary, revenue trend, products, buyers, CLV, and profit for all four
  platforms use one authenticated, versioned contract and error model.
- [ ] Static route shadowing and legacy route behavior are removed after the
  compatibility gate; route auth/contract tests cover all combinations.
- [ ] Approved Admin shared scope and non-Admin isolation are confirmed, tested,
  cache-separated, and applied to API, UI, and CSV; protected buyer data is masked.
- [ ] Cache keys include API/calculation version, platform, access scope, shop
  set, metric, date, currency, granularity, and page; every relevant mutation,
  webhook, worker, and cron awaits exhaustive invalidation.
- [ ] Capability and backfill Prisma models are relational and have production
  readers, writers, probes, workers, retries, leases, and operator controls.
- [ ] Resumable idempotent backfills attempt 12 months, record actual coverage,
  and refresh late refunds/fees/settlements without claiming unavailable history.
- [ ] Reusable UI restores Shopee trends, buyers, CLV details, product
  performance, fee breakdown, and product profit table across responsive layouts.
- [ ] Shop/date/currency selectors use authorized options and applied filters,
  represent partial/unknown states correctly, and do not request on each keystroke.
- [ ] CSV matches displayed calculations, includes provenance/coverage/version
  metadata, protects customer data, and escapes spreadsheet formulas.
- [ ] Adapter, calculator, Prisma, migration, route auth/contract, cache
  invalidation, backfill, reconciliation, and UI tests pass.
- [ ] Representative enabled shops reconcile to official marketplace/Admin
  reports and statements; unresolved semantics or deltas block rollout per shop.
- [ ] Observability, alerts, runbooks, feature flags, rollback, and legacy-consumer
  telemetry satisfy all rollout gates.

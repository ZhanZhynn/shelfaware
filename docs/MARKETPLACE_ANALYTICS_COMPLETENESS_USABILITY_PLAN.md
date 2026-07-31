# Marketplace Analytics Completeness and Usability Plan

## Purpose and Scope

Complete the marketplace analytics experience in dependency order without
presenting unverified marketplace data as revenue, fees, refunds, settlement,
or profit. This plan builds on
`MARKETPLACE_ANALYTICS_PROFIT_REMEDIATION_PLAN.md` and the current source-field
matrix/completeness work in `docs/marketplace-analytics/source-field-matrix.md`.

The immediate goal is a usable, isolated operational analytics interface for
Shopee, Lazada, TikTok Shop, and Shopify. Financial analytics and profit remain
per-shop capabilities that can be enabled only after external evidence,
provenance, backfill, and reconciliation gates pass.

In scope:

- Operational order, trend, product, and availability views with truthful
  filters, pagination, errors, and empty states.
- A shared, authenticated API contract and UI behavior that do not require a
  financial interpretation of source fields.
- The data/provenance, adapter, finance, reconciliation, and rollout work
  needed to make financial panels available later.

Out of scope until separately approved and evidenced:

- COGS, advertising, payroll, overhead, and fully loaded accounting profit.
- Cross-currency totals or conversion without an approved dated-rate policy.
- Seller Center scraping, guessed APIs, inferred field meanings, or using zero
  for absent data.

## Current Safe Baseline

The following is usable today and is the starting point, not proof of financial
completeness:

- Dynamic shared analytics routes exist at `app/api/[platform]/stats/route.ts`
  and `app/api/[platform]/stats/[metric]/route.ts`; current static platform
  routes are thin delegators.
- Authenticated shop selection is available through
  `app/api/marketplace/shops/route.ts` and `lib/marketplace/shops.ts`; server
  queries revalidate selected internal shop IDs against authorized shops.
- The server rejects mixed source currencies and unavailable conversion rather
  than combining them in `lib/marketplace/analytics/server.ts`.
- Financial readiness requires both a persisted finance capability and
  reconciliation state. Unready orders are marked `legacy-unverified`, and
  calculation output is unavailable or partial rather than complete.
- The source-field matrix explicitly keeps Shopee escrow, Lazada quantity,
  TikTok line finance/quantity, and Shopify legacy gross totals outside public
  financial totals.
- The dashboards already use draft/applied filters, masked buyer labels, and
  an `Unavailable` display for null numeric values.

Known usability/completeness gaps remain: all analytics panels are requested as
one group; an error or slow optional panel degrades the page; multi-shop default
selection can lead to mixed-currency errors; tables slice small in-memory lists
instead of consuming cursors; shop options do not expose enough observed
availability metadata; and profit labels such as "certified" must not imply
external financial semantics before the per-shop gate has passed.

## Non-Negotiable Correctness Rules

1. Unknown, inaccessible, legacy-defaulted, malformed, and unverified values
   are `null` with a reason, never numeric zero.
2. A zero is shown only when supplied explicitly by a verified source or
   derived from fully known, verified operands.
3. Never aggregate source currencies. `native` is not permission to combine
   currencies; mixed results return `409 MIXED_CURRENCY` until all rows are
   converted using an approved rate policy.
4. Stable identity is platform plus internal shop plus external entity ID.
   Names, titles, email text, and SKU text are display labels, never join keys.
5. A successful order sync, an OAuth scope string, or a model field does not
   prove finance, refunds, settlements, buyer identity, or history coverage.
6. Financial field semantics require platform documentation, a redacted
   authorized fixture, scope confirmation, and validation of currency, unit,
   sign, lifecycle, pagination, and regional/account behavior.
7. Returns, refunds, chargebacks, cancellations, and settlement adjustments are
   separate states. A return never invents a refund amount, and an adjustment
   is deducted once only.
8. Financial panels must state their calculation basis and coverage. A partial
   known-cost result is not complete profit; historical buyer spend is not
   predictive CLV.
9. Every mutation affecting orders, items, refunds, finance, settlements,
   capabilities, or backfills invalidates the applicable analytics cache after
   commit and before successful completion is reported.
10. Platform/region/shop rollout is opt-in through readiness gates. A blocked
    shop continues to receive operational analytics only.

## Now vs External Verification

### Now: implementation-safe work

The following may proceed from repository data and existing contracts because
it does not establish new marketplace financial meaning:

- Isolate panel requests, improve applied filters/defaults, pagination, table
  accessibility, loading/error/empty states, and URL behavior.
- Expose observed operational availability and explicit feature-gate reasons.
- Change labels from claims of financial completeness to the existing returned
  basis, coverage, and capability state.
- Harden auth, cursor, cache, response, and UI tests while preserving nulls and
  current server-side access checks.
- Add schema/provenance plumbing, fixtures, audit reports, worker framework,
  and tests that keep data unknown until validation is complete.

### External verification: required before finance semantics change

The following must not be implemented as a local inference or represented as a
Phase 1 outcome:

- Treating order totals, shipping, discounts, tax, quantities, refunds, fees,
  payouts, or proceeds as verified financial inputs.
- Enabling a financial aggregate, margin, proceeds, product allocation, or CSV
  as complete for a shop.
- Converting or aggregating currencies.
- Enabling protected buyer fields, predictive CLV, finance/refund/settlement
  backfill streams, or broad Admin export access.

Each such change requires the evidence and rollout gates in Phases 3 through 5.

## Prioritized Build Plan

## Phase 1: Safe Operational Analytics Usability

**Classification: Now.** Deliver a responsive operational experience without
changing financial formulas, source mappings, or readiness criteria. The only
numeric operational measures introduced or retained in this phase are observed
record counts and other values already returned as non-financial. Any existing
financial field remains unavailable unless the server's existing readiness gate
returns it.

### Work

1. Split the analytics dashboard into independently loading panels. Summary,
   operational order trend, product rows, buyer/CLV availability, and profit
   must own their request, loading, error, and empty state. A failed optional
   panel must not hide summary or product operations. Do not fetch profit from
   the analytics page unless its panel is opened or the server says the feature
   is available.
2. Keep draft filters local and fetch only applied filters. On first load with
   no `shopId`, select the sole authorized shop; for multiple shops, select the
   first deterministic authorized shop rather than silently querying all shops.
   Preserve an explicit all-shops choice only where the selector can state that
   a single source currency is required; the API remains authoritative and may
   return `MIXED_CURRENCY`.
3. Add operational date presets (for example 7, 30, 90 days and all available)
   that write valid UTC calendar dates into the existing filters. Preserve an
   explicit custom range and query-string deep links. A preset changes the
   draft only; Apply performs the request.
4. Return shop-option metadata sufficient to explain safe defaults: display
   name, region, internal ID, connection state, and observed source currency
   availability when known. This is display metadata, not a conversion promise
   or financial certification.
5. Make `cursor` and `limit` first-class client query parameters for product
   and buyer tables. Replace fixed `slice(0, 8)`/`slice(0, 50)` list displays
   with accessible tables, next/previous controls, result counts, loading
   placeholders, and empty messages. Retain `Unavailable` for null quantity or
   money fields; do not fabricate values to fill columns.
6. Make the server calculate/fetch only the requested metric where practical,
   while preserving the existing response envelope, authorization, currency
   validation, and `page` contract. This reduces coupling and makes panel
   isolation real; it is not a calculation rewrite.
7. Replace premature financial language. The profit page must say
   "Marketplace financial analytics unavailable" until readiness is `ready`.
   When a result is available, label it with the returned calculation basis
   (`settled`, `order-estimate`, or `partial`) and coverage, not simply
   "certified profit." Keep COGS and other exclusions visible. CLV must remain
   "historical buyer net sales" unless a separately validated predictive model
   is enabled.
8. Use capability/readiness states to gate panel content and exports. The gate
   explains what is missing and links users to operational analytics; it must
   not request, derive, or expose a financial fallback.

### Likely Files and Modules

- `components/marketplace/analytics/MarketplaceAnalyticsDashboard.tsx`
- `components/marketplace/analytics/MarketplaceFilters.tsx`
- `components/marketplace/analytics/MarketplaceStatus.tsx`
- `components/marketplace/analytics/marketplaceAnalyticsUi.ts`
- `components/marketplace/analytics/marketplaceAnalyticsUi.test.ts`
- `components/marketplace/analytics/MarketplaceOperationalTable.tsx` (new)
- `components/marketplace/analytics/MarketplaceAnalyticsPanel.tsx` (new, only
  if a small shared panel boundary avoids duplicating query state)
- `components/marketplace/profit/MarketplaceProfitDashboard.tsx`
- `lib/marketplace/analytics/server.ts`
- `lib/marketplace/analytics/http.ts`
- `lib/marketplace/shops.ts`
- `app/api/marketplace/shops/route.ts`
- `app/api/[platform]/stats/route.ts`
- `app/api/[platform]/stats/[metric]/route.ts`
- `app/admin/{shopee,lazada,tiktok,shopify}/{analytics,profit}/page.tsx` only
  if page-level feature flags or descriptions need alignment

### Acceptance Criteria

- A summary or products request succeeds and renders even when a buyer, CLV,
  trend, or profit request is slow, unavailable, or errors.
- No initial multi-shop request is made when multiple authorized shops exist;
  the selected-shop default is deterministic and visible in the filter.
- Draft edits make no request. Apply issues one request per enabled panel using
  normalized applied filters; stale requests are aborted or cannot replace the
  newer result.
- Product and buyer tables use API cursors, expose total/result position, and
  are keyboard navigable. Page changes retain all applied filters.
- `null` displays as `Unavailable`; a known zero displays as `0` or formatted
  `0.00`. Tables do not relabel unavailable money as zero.
- All-shops mixed currency remains a `409` with a corrective filter message;
  the UI never displays an aggregate total from the failed response.
- Profit, export, buyer-detail, and predictive-CLV controls are disabled or
  visibly unavailable when their existing capability/readiness state is not
  sufficient. No Phase 1 text claims that a platform's finance semantics were
  verified.

### Tests

- Extend `marketplaceAnalyticsUi.test.ts` for default/filter serialization,
  cursors, date presets, applied versus draft requests, and non-2xx errors.
- Add React Testing Library coverage for isolated panel error/loading/empty
  states, shop defaults, Apply behavior, mixed currency, null versus zero,
  pagination, keyboard table controls, and unavailable feature gates.
- Extend `lib/marketplace/analytics/server.test.ts` for metric isolation,
  pagination bounds/cursors, selected-shop authorization, and unchanged mixed
  currency behavior.
- Add route tests for shop metadata authorization and analytics response shape;
  verify that unauthenticated, cross-owner, malformed cursor, and unavailable
  feature requests do not leak data.
- Add Playwright coverage for one representative platform on desktop and
  mobile: first-load default, filter Apply, table paging, panel failure
  isolation, and the unavailable-profit explanation.

### Phase 1 Rollout Gate

Ship behind an operational-analytics UI flag if the repository has a suitable
flag mechanism. Enable for internal Admin users first, then all authorized
users after the Phase 1 tests, accessibility review, and production monitoring
show no cross-shop access, cursor, mixed-currency, or request-churn regression.
This gate authorizes usability changes only; it does not enable finance.

## Phase 2: Operational Contract and Coverage Hardening

**Classification: Now.** Stabilize the non-financial portions of the shared
contract before broadening financial use. This phase may improve data quality
reporting but must not promote a source field to verified.

### Work

1. Separate operational response types from financial response types in
   `lib/marketplace/analytics/types.ts`, so count/trend/product availability
   cannot accidentally inherit a finance-ready label.
2. Return per-panel coverage: observed date range, raw record count, unknown
   status/quantity count where applicable, source currencies, and a
   user-actionable unavailability reason. Distinguish no data, not authorized,
   backfilling, unsupported, and error.
3. Consolidate static platform routes to shared handlers, retaining only the
   time-boxed delegators needed by current clients. Add contract telemetry
   before removing delegators.
4. Make cache keys and invalidation cover all applied filter/page dimensions
   and await invalidation after existing committed marketplace writes. Do not
   add finance mutations until their adapters are verified.
5. Add UI-safe CSV only for operational table rows if needed. It must carry
   filters, source currency state, coverage, API/calculation version, and no
   unmasked buyer fields. Financial CSV remains gated.

### Likely Files and Modules

- `lib/marketplace/analytics/types.ts`
- `lib/marketplace/analytics/server.ts`
- `lib/marketplace/analytics/http.ts`
- `lib/marketplace/analytics/cache.ts`
- `lib/cache/cache-utils.ts`
- `lib/marketplace/analytics/cache.test.ts`
- `lib/marketplace/analytics/server.test.ts`
- `app/api/[platform]/stats/route.ts`
- `app/api/[platform]/stats/[metric]/route.ts`
- `app/api/{shopee,lazada,tiktok,shopify}/stats/**/route.ts`
- `components/marketplace/analytics/MarketplaceStatus.tsx`
- `components/marketplace/analytics/MarketplaceAnalyticsDashboard.tsx`

### Acceptance Criteria and Tests

- All six metric families keep one versioned envelope, auth policy, error
  model, cache scope, and filter semantics for every platform.
- Operational coverage never reports financial readiness, settlement, or
  profit completeness.
- Cache keys isolate access scope, shop set, currency, date range, metric, and
  cursor; relevant existing writes invalidate affected operational results.
- Contract tests cover all platform/metric combinations, including `401`,
  `403`, `409 MIXED_CURRENCY`, malformed pagination, empty known data, and
  unavailable capability. Cache tests warm/purge paginated results without
  touching another owner's or platform's keys.

## Phase 3: Evidence, Provenance, and Verified Platform Adapters

**Classification: mixed.** Schema, audit, fixture harness, null-safe parsing,
and capability/backfill scaffolding can start now. Promoting fields or enabling
financial streams requires external verification for each platform, region, and
shop.

### Work

1. Complete the source-field matrix for every proposed financial input. Record
   endpoint/version, JSON path, source level, currency, sign, unit, tax
   treatment, lifecycle/finality, scope, redacted fixture, and canonical
   destination.
2. Preserve raw payload/provenance, ingestion revision, observed timestamp,
   quality, and unknown reason. Remove unknown-capable defaults, but do not
   mass-convert legitimate explicit zeroes.
3. Implement platform adapters and canonical lifecycle/payment/refund/
   settlement state independently. Deduplicate refunds and adjustments by
   stable external IDs and retain unknown statuses/categories.
4. Add relational capability records and resumable backfill state. Probe with
   minimal authorized calls; scope strings alone remain `unknown`.
5. Backfill only verified streams using leases, checkpoints, idempotent upserts,
   overlap re-sync, actual coverage dates, and post-commit invalidation.

### Likely Files and Modules

- `docs/marketplace-analytics/source-field-matrix.md`
- `prisma/schema.prisma`
- `prisma/client.ts`
- `scripts/marketplace-analytics/audit-legacy-data.ts`
- `scripts/marketplace-analytics/mark-legacy-quality.ts`
- `lib/marketplace/analytics/{adapters,status,provenance,capabilities}.ts`
- `lib/marketplace/analytics/backfill/{types,runner,windows}.ts`
- `lib/marketplace/analytics/backfill/{shopee,lazada,tiktok,shopify}.ts`
- `lib/{shopee,lazada,tiktok,shopify}/sync.ts`
- `lib/{shopee,lazada,tiktok,shopify}/{types,server,custom-api}.ts`
- `lib/shopify/{server,sync,graphql-client}.ts`
- `test/fixtures/marketplace/{shopee,lazada,tiktok,shopify}/`

### Acceptance Criteria and Tests

- Every enabled financial field has platform documentation and at least one
  redacted authorized fixture for the applicable region/account; otherwise it
  remains unknown and excluded.
- Absent/null/malformed fields, explicit numeric/string zeroes, partial/full
  refunds, return-without-refund, cancellation-before-payment, replay, and
  late adjustments are fixture-tested.
- Capability and backfill records have active readers/writers/workers; resumes
  are idempotent and report actual rather than requested history coverage.
- Prisma/migration tests cover legitimate versus legacy-defaulted zeroes,
  cross-shop external-ID collisions, interruption/resume, and rollback-safe
  reads. Adapter client tests redact secrets and PII.

## Phase 4: Financial Calculators, Reconciliation, and Feature Eligibility

**Classification: external-gated.** Implement calculator mechanics against
verified fixtures now, but enable a shop's financial UI only after its Phase 3
evidence and reconciliation are complete.

### Work

1. Replace implicit nullable-number arithmetic with explicit known/unknown
   results. Use decimal-safe amounts and currency minor-unit rounding.
2. Apply canonical inclusion/refund rules and per-order deterministic product
   allocation. Unmapped products stay shop-scoped and separate.
3. Reconcile summary, trend, products, buyers, and profit to the same filters,
   inclusion rules, calculation version, and source currency.
4. Reconcile enabled shops against official marketplace/Admin reports and
   statements at order and daily levels. Store evidence hash, reviewer, date,
   delta, and explained residual category.
5. Keep predictive CLV disabled until approved labels, data-sufficiency rules,
   and temporal holdout performance are verified. Historical net sales remains
   an operational/historical measure, not a prediction.

### Likely Files and Modules

- `lib/marketplace/analytics/calculators.ts`
- `lib/marketplace/analytics/calculators.test.ts`
- `lib/marketplace/analytics/reconciliation.ts`
- `lib/marketplace/analytics/clv.ts`
- `lib/marketplace/analytics/clv.test.ts`
- `lib/marketplace/analytics/server.ts`
- `app/api/marketplace/analytics/reconciliation/route.ts`
- `scripts/marketplace-analytics/reconcile.ts`
- `components/marketplace/profit/MarketplaceProfitDashboard.tsx`

### Acceptance Criteria and Tests

- Unknown finance operands propagate to `null`; no calculator coalesces them to
  zero. Mixed currency is rejected before calculation.
- Order-level and product allocations reconcile exactly at currency minor-unit
  precision. Refunds and adjustments are applied once.
- Each enabled shop has reviewed evidence that reconciles at order level and
  within approved daily timing tolerances. An unresolved delta disables that
  shop's financial panels and export.
- Property/table tests cover null propagation, allocation conservation,
  deterministic residuals, status/refund combinations, currency isolation, and
  no cross-shop product merge. CLV tests cover sufficiency, leakage prevention,
  and holdout quality.

## Phase 5: Controlled Financial Rollout and Removal

**Classification: external-gated.** Roll out by platform, region, and shop;
never enable a platform globally because one shop passed.

### Work

1. Shadow the versioned financial response for reconciled test shops and
   classify every old/new difference as corrected defect, expected coverage
   gap, or blocker.
2. Enable feature flags in order: internal test shop, selected Admins,
   reconciled shops, then broader eligible shops. Keep operational Phase 1
   analytics available throughout.
3. Monitor coverage regression, unknown fields/statuses, capability loss,
   backfill/lease failure, cache invalidation failure, reconciliation deltas,
   access denial, and user-visible error rates.
4. Remove legacy routes, response adapters, fields, and old Shopee components
   only after consumer telemetry is zero for the announced window, backups are
   verified, and rollback retention has expired.

### Likely Files and Modules

- Feature-flag/system configuration modules used by this repository
- `lib/marketplace/analytics/{server,http,cache,reconciliation}.ts`
- `app/api/marketplace/analytics/{capabilities,backfill,reconciliation}/route.ts`
- Marketplace sync/import/webhook/cron routes
- `components/marketplace/{analytics,profit}/**`
- Legacy `app/api/{shopee,lazada,tiktok,shopify}/stats/**/route.ts` delegates
- Operational dashboards, alerts, and runbooks

### Acceptance Criteria and Tests

- Feature eligibility is evaluated per connection/shop and is false by default.
- Rollback hides financial panels without deleting source/provenance data or
  interrupting operational analytics.
- End-to-end tests cover Admin/non-Admin isolation, feature-gated export,
  backfill-to-readiness transition, reconciliation failure, and rollback.
- Runbooks cover reconnect/re-probe, safe retry, cache purge, shop disablement,
  incident rollback, and support diagnostics without exposing credentials/PII.

## External Blockers

| Area | Evidence or decision required | Safe behavior while blocked |
| --- | --- | --- |
| Shopee | Authorized Payment API access; final/post-adjustment escrow; actual versus estimated shipping signs; subsidy and return-shipping semantics by region | Operational orders only; fees, shipping, refunds, and profit unavailable/partial |
| Lazada | Order-item row multiplicity/quantity; voucher, shipping, tax, Finance, logistics, and returns semantics/access by region | Quantity null where unproved; no complete financial totals |
| TikTok Shop | Current finance permission/API; Finance 202501 access; line quantity/bundle behavior; price/tax/refund paths and signs | Historical defaulted values quarantined; no revenue/profit enablement |
| Shopify | Pinned Admin API version; `read_all_orders`, protected customer data, returns, transaction/payout scopes; third-party gateway fee availability | Actual accessible history only; masked buyer data; unknown fees remain unknown |
| Currency | Approved rate source, timestamp/base-quote/rounding/restatement policy | One source currency only; mixed requests return `409` |
| Access | Product/security approval for shared Admin scope, protected buyer display/export, and CSV policy | Existing owner scope and masked identifiers only |
| CLV | Approved predictive label/horizon and holdout-quality threshold | Historical buyer net sales only; predictive fields null |
| Reconciliation | Official reports/statements and an approved reviewer/tolerance policy per enabled shop | Financial UI/export remains unavailable |

Manual exports may support controlled reconciliation only. They must not be
silently imported into API-sourced production totals without a separate import,
provenance, access, and reconciliation design.

## Rollout Gates

| Gate | Required result | What may ship |
| --- | --- | --- |
| A: operational safety | Phase 1 acceptance/tests pass; no finance formula or mapping changed; access/currency safeguards intact | Operational usability UI only |
| B: contract and operations | Shared contract, pagination, cache isolation/invalidation, observability, and access tests pass | Broader operational analytics rollout |
| C: source semantics | Field matrix, fixtures, scopes, units/signs/finality, and regional behavior verified per proposed field | Verified adapter ingestion for that field/shop only |
| D: data and code | Provenance migration, idempotent backfill, adapter/calculator tests, actual coverage, and capability evidence pass | Financial response remains shadowed |
| E: reconciliation and security | Shop-level official-report reconciliation, Admin/CSV review, buyer masking, alerts, runbooks, rollback flag pass | Financial panels/export for that eligible shop |
| F: removal | Zero legacy consumer telemetry for the agreed observation period; backup and rollback-retention checks pass | Delete legacy adapters/routes/components |

Required repository verification for every applicable phase:

```bash
npx prisma generate
npx tsc --noEmit
npm test
npm run lint
npm run build
```

Add the repository's integration and Playwright commands as their suites are
created. Existing unrelated failures must be recorded and fixed separately, not
suppressed to pass an analytics gate.

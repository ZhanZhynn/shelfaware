# Shared Catalog SKU Mapping Implementation Plan

## Status And Scope

Approved design for ShelfAware's shared-organization, cross-marketplace SKU-analysis foundation. This document is the implementation sequence; it does not authorize inventory, marketplace listing, or stock-sync mutations.

### Superseded Plan

The older [`docs/MARKETPLACE_SALES_NORMALIZATION_PLAN.md`](../MARKETPLACE_SALES_NORMALIZATION_PLAN.md) has been superseded by this document. That plan's workspace-scoped model, early CSV assumptions, and phased structure are preserved there for historical reference; all new work follows the shared-catalog design below.

### Implementation Status (2026-08-12)

- [x] Shared, non-workspace catalog foundation for Product Families, Sales SKUs, immutable effective-dated Shopee mappings, mapping audit events, and analytics-only recipes/components.
- [x] Shared read policy and global-admin mutation policy on the SKU mapping APIs and read-only non-admin mapping page.
- [x] Shopee variant identity validation, exact normalized-SKU candidates, manual candidate confirmation/rejection, correction/supersession, history display, and catalog/recipe authoring.
- [x] Shopee offer/Sales SKU and Product Family reporting with native-currency buckets, date selection, mapping/recipe coverage, and explicit mixed-recipe exclusion from normalized family units.
- [x] Admin-only CSV export and server-side stable-identity dry-run validation/conflict contract.
- [x] CSV commit: implemented with persisted drafts, idempotent commits, and atomic rollback.
- [x] Shopify source facts hardened for newly synced orders: upstream product/variant GIDs, original ordered quantity, native source-money snapshots, pagination completeness, atomic sync, and incomplete-refresh preservation are persisted.
- [x] Canonical offer/source-line/performance-fact projections, durable backfill worker, dated FX conversion, Product Performance integration, reconciliation/monitoring, migration assistant, and rollout controls.
- [ ] Deferred: Shopify attribution analytics and mapping UI support. Existing Shopify orders remain incomplete for attribution unless re-synced with hardened source facts.
- [ ] Deferred: multiple-component recipe authoring UI and allocation basis points. The service accepts/validates multiple components, while the current UI safely authors one component and reports mixed recipes as excluded.

ShelfAware has one shared organization. There is no workspace segregation for the shared catalog, offer mappings, source sales, normalized facts, or analytics:

- Every authenticated user except `sourcer` can read the shared catalog, mappings, mapping coverage, and analytics.
- Only users whose global `User.role` is `admin` can create, edit, confirm, supersede, archive, or otherwise mutate catalog, mapping, family, recipe, and backfill records.
- `sourcer` users are excluded from these read and write surfaces unless a later product decision changes that policy.
- Existing `Workspace` records remain for features that use them today, but none of the new catalog-analysis models, queries, cache keys, or authorization checks use `workspaceId` as a tenant boundary.

The canonical analytical chain is:

```text
Marketplace offer/variant
  -> immutable effective-dated confirmed mapping
  -> SalesSku
  -> ProductFamily
  -> analytical SalesSkuRecipe components
  -> physical WMS Product
```

An offer is the marketplace item or variant actually sold. A `SalesSku` is the shared sellable identity across offers. A `ProductFamily` groups related Sales SKUs for family-level analysis. A recipe analytically expands one Sales SKU into one or more physical WMS `Product` components. Recipes are analytics-only in the first release; they do not reserve, deduct, allocate, publish, or synchronize inventory.

## Decisions And Invariants

1. Marketplace offers and product families have separate performance views. Offer performance answers listing/channel questions; family performance aggregates confirmed Sales SKU mappings and recipe-derived product contribution without replacing offer metrics.
2. Marketplace external identity is stable and shop-scoped. Use the normalized tuple `platform + internalShopId + externalProductId + externalVariantId-or-offer-sentinel`; seller SKU, item title, and variant name are mutable display/search snapshots only.
3. Confirmed mappings are immutable. A correction, reclassification, or date change creates a new effective-dated mapping version and closes/supersedes the prior range. No update may alter what a prior confirmed version meant.
4. A mapping candidate is a draft. Suggestions from matching SKU/title data are never analytical truth and never change coverage. An admin confirms a candidate only after seeing validation and historical impact.
5. Mapping history is retained indefinitely. The confirmation preview defaults to the earliest available historical order for the offer, but the admin can override `effectiveFrom`; the preview, confirmation audit record, and projection use the selected override.
6. Source order facts remain single canonical facts. Do not create, copy, or maintain a second `UnmatchedOrder`/`UnmatchedOrderItem` fact store. The mapping inbox is a query/projection over canonical platform order lines or the new normalized source-line table, joined to mapping coverage.
7. Source money is stored and reported in its native currency and minor-unit scale. Cross-currency totals require a dated reporting-currency conversion with explicit rate provenance and coverage. A missing rate is represented as uncovered, not zero and not silently excluded.
8. Mapping and recipe projections are deterministic, idempotent, append-only/superseding analytical facts. A rerun must not double count. Unknown source quantities and amounts remain nullable.
9. The physical WMS `Product` remains the inventory record. New analytics tables must not call code that updates `Product.quantity`, `Product.reservedQuantity`, `StockAllocation`, `StockMovement`, marketplace stock endpoints, or SiteGiant stock state.

## Target Data Model

Add the following MongoDB Prisma models to `prisma/schema.prisma`; names below are the target vocabulary and should be used consistently in server types, APIs, and UI.

| Model | Purpose and key fields |
|---|---|
| `SalesSku` | Shared sellable identity: `id`, unique immutable `code`, `name`, `status` (`active`/`archived`), audit fields. No `workspaceId`. |
| `ProductFamily` | Shared analytical family: `id`, unique immutable `code`, `name`, `status`, audit fields. |
| `SalesSkuFamilyMembership` | Effective-dated, immutable assignment from `salesSkuId` to `productFamilyId`; `effectiveFrom`, `effectiveTo`, `status`, confirmation/audit fields. Enforce one effective family per Sales SKU at a time. This preserves family-history meaning when a SKU is reclassified. |
| `MarketplaceOffer` | Shop-scoped stable external offer identity: `platform`, `internalShopId`, `externalProductId`, nullable `externalVariantId`, `identityKey`, and mutable display snapshots (`sellerSku`, product/variant names, image, observed timestamps). Use a non-null offer sentinel for non-variant listings so Mongo uniqueness is reliable. Unique `identityKey`; indexes for platform/shop and SKU search. |
| `MarketplaceOfferSalesSkuMapping` | Immutable confirmed mapping and draft candidates: `offerId`, `salesSkuId`, `status` (`draft`, `confirmed`, `superseded`, `rejected`, `retired`), `effectiveFrom`, `effectiveTo`, candidate method/confidence/evidence, preview summary, confirmed/superseded audit fields. Confirmed ranges for an offer must not overlap. |
| `SalesSkuRecipe` | Stable, analytics-only recipe parent per Sales SKU: `salesSkuId`, `code`, `name`, status, audit fields. |
| `SalesSkuRecipeVersion` | Immutable version of a recipe with `status` (`draft`, `confirmed`, `retired`), effective range, audit fields. Confirmed ranges for a recipe cannot overlap. |
| `SalesSkuRecipeComponent` | Version component: `wmsProductId`, positive `unitsPerSalesSkuUnit`, optional/allocation-required `gmvAllocationBasisPoints`, and `position`. On confirmed versions, components must belong to the shared catalog and allocations sum to 10,000 bp. |
| `MarketplaceSourceSalesLine` | Platform-neutral canonical source-line projection with stable upstream order/line identity, `offerId` when resolvable, native money minor units/scale/currency, nullable quantity and quality/eligibility metadata, source revision, sanitized raw reference/payload, and timestamps. Unique platform/shop/external-order/external-line/revision identity according to upstream revision semantics. |
| `MarketplaceOfferPerformanceFact` | Idempotent offer-level analytical projection keyed by source-line revision. Retains raw marketplace quantity and native GMV separately from any Sales SKU or recipe expansion. |
| `SalesSkuPerformanceFact` | Idempotent confirmed-mapping projection keyed by source-line revision, mapping ID, and calculation version; records Sales SKU identity, native amount, and marketplace units. |
| `WmsProductSalesFact` | Recipe-component projection keyed by source line, mapping version, recipe version, component, and calculation version; records normalized physical units and allocated native GMV. Supersede rather than overwrite when mappings/recipes change. |
| `ReportingExchangeRate` | Dated rate to the chosen reporting currency: source currency, reporting currency, rate date/granularity, fixed-point rate, source/provenance, observed time. Unique source/reporting/date/provenance policy. |
| `MappingBackfillRun` | Admin-controlled preview/commit job with selected effective date, candidate/mapping IDs, source-line bounds, checkpoints, counts, status, errors, calculation version, and audit fields. |

Use explicit string status fields with validation constants rather than Prisma enums, matching the current MongoDB schema style. Add indexes for effective-date lookup, inbox status and last-sale ordering, source/fact date ranges, Sales SKU/family reporting, native currency, and reporting conversion coverage.

`ProductChannelMapping` remains unchanged in the first schema migration. It is a legacy one-to-one Shopee-era link (`wmsProductId`, channel snapshot ID, `channelType`) and cannot express shop scope, effective dates, candidate states, Sales SKU/family semantics, recipes, or immutable history. New analytics must not treat it as the mapping source of truth.

## Authorization And Data Access

1. Add a small shared catalog authorization helper near `lib/marketplace/access.ts` that obtains the session once and exposes `requireSharedCatalogRead` and `requireSharedCatalogAdmin`.
2. Read access accepts authenticated `admin`, `user`, `supplier`, `client`, and `retailer` roles, and rejects `sourcer`, pending, and unauthenticated users. Confirm exact active-role behavior against existing session/status helpers before implementation.
3. Mutation access requires global `role === "admin"`; do not substitute `WorkspaceMember.role`, owner IDs, or `marketplaceOwnerIds` for this policy.
4. All shared-catalog queries are organization-wide. Do not accept client-supplied `userId`, owner lists, or `workspaceId` filters. Shop connection credentials can keep their existing ownership model, but their discovered offers and analytics are readable through the shared catalog policy.
5. Make cache keys organization-shared and invalidate them after confirmation, supersession, recipe confirmation, backfill completion, or reporting-rate changes. Do not use the current non-admin per-user `marketplaceCacheScope` for shared catalog read results.
6. Record admin ID, timestamp, old/new effective ranges, candidate evidence, and backfill/run IDs for every mutation in durable audit fields or the existing audit mechanism.

## Phased Delivery

### Phase 0: Contract And Read-Only Guardrails

- Reconcile this plan with `docs/MARKETPLACE_SALES_NORMALIZATION_PLAN.md`; mark its workspace boundary and early CSV assumptions superseded, or update it to link here before implementation begins.
- Document and test the no-inventory-mutation boundary around the new services.
- Define platform adapters' stable product/variant/order-line IDs and native-money field matrix before enabling a platform.
- Establish the approved reporting-currency policy, date basis (normally order/sale date), rate source, precision, and missing-rate behavior.

### Phase 1: Shared Catalog And Offer Foundation

- Implement `SalesSku`, `ProductFamily`, membership history, `MarketplaceOffer`, draft/confirmed mappings, and validation/repositories under `lib/marketplace/` or a focused `lib/shared-catalog/` module.
- Build offer discovery/upsert adapters from existing Shopee snapshots first, then Lazada, TikTok, and Shopify. They upsert identity/display snapshots only and never infer a confirmed mapping.
- Create admin-only catalog and offer mapping commands. Validate identity, target existence, date range, no overlapping confirmed mapping, immutable confirmed rows, and no `workspaceId` scope checks.
- Add read APIs for catalog search, offer details/history, mapping coverage, and inbox counts.

### Phase 2: Mapping Inbox And Confirmation Flow

- Make the mapping inbox the primary UI, rather than adding mapping controls only to individual marketplace pages.
- Add an inbox route such as `app/admin/marketplace/mappings/page.tsx` and reusable components under `components/marketplace/mappings/`: filters, queue table, offer detail, candidate editor, effective-date picker, history timeline, confirmation dialog, and preview results.
- Show unmapped offers and draft candidates ordered by materiality/last sale, with shop/platform, stable external identity, current SKU/title snapshots, date range, native-currency totals, data quality, and mapping state.
- Support draft creation, rejection, and confirmation. Confirmation defaults `effectiveFrom` to the earliest known historical order for that offer; allow an override and recompute the impact preview before commit.
- Preview affected history, mappings/recipe conflicts, raw marketplace units, expanded units, per-currency GMV, reporting-currency conversion coverage, unknown values, and the fact count to be generated. Only confirmation starts a durable backfill.

### Phase 3: Source Lines, Recipes, And Deterministic Projections

- Implement the canonical source-line adapter and backfill worker/service. Reuse platform snapshots as inputs; do not duplicate a separate unmatched-order fact collection.
- Add analytics-only recipe/version/component authoring to the same mapping experience or an adjacent admin catalog route. Recipes may be drafted and confirmed, but do not integrate them with inventory operations.
- Resolve an offer's confirmed mapping and a Sales SKU's family/recipe versions by sale date. Produce separate offer, Sales SKU, and WMS component facts with deterministic keys and a calculation version.
- Use fixed-point minor-unit allocation and deterministic residual distribution. Keep source amount/quantity null when unknown, and retain native currency on every fact.
- Backfills must checkpoint, retry safely, reconcile per-source-line allocations, and supersede projections for the affected range without deleting history.

### Phase 4: Currency And Coverage Foundation

- Implement dated `ReportingExchangeRate` ingestion/admin management and a conversion service that returns both converted values and coverage metadata.
- Every API response and UI aggregate must expose native-currency buckets by default. Only expose a reporting-currency total when all included amounts have applicable dated rates, or label the total as partial with numerator/denominator coverage and excluded currencies/amounts.
- Make mapping coverage distinct from conversion coverage, quantity coverage, eligibility coverage, and recipe coverage. Do not turn unavailable values into zero to improve a percentage.

### Phase 5: Product Performance First Analytics Slice

- Deliver Product Performance as the first consumer of the new data foundation, before broader dashboard/export work.
- Replace the Shopee-only `ProductChannelMapping` visibility logic in `lib/server/product-performance-data.ts`, `types/product-performance.ts`, `hooks/queries/use-product-performance.ts`, its API route, and `components/product-performance/ProductPerformanceDashboard.tsx` with shared offer/Sales SKU/recipe facts and coverage states.
- Preserve WMS inventory recommendations as a separate concern. Display normalized sales and mapping/currency coverage beside stock data; recipes must not mutate stock or claim true available-to-sell conversion.
- Include drill-downs from physical Product to contributing Sales SKUs/offers and separate offer-level versus family-level performance views. Keep all currency labels and partial-data warnings visible.

### Phase 6: Broader Analytics And Controlled Operations

- Add standalone offer performance and Product Family performance APIs/pages after Product Performance is validated. Do not collapse listing metrics into family metrics or vice versa.
- Add reconciliation/monitoring for unmapped materiality, draft age, mapping conflicts, projection failures, source-to-fact GMV conservation, duplicate projection keys, and rate coverage.
- CSV dry-run import and commit are implemented (persisted drafts, idempotent commits, atomic rollback). Continue monitoring inbox metrics for conflict and error rates.

## File-Level Implementation Map

| Area | Existing files to change | New files/directories anticipated |
|---|---|---|
| Schema and generated client | `prisma/schema.prisma`; `prisma/client.ts` only if its generation wrapper needs adjustment | Prisma migration/runbook appropriate for MongoDB deployment; model fixtures |
| Shared access | `lib/marketplace/access.ts`; session/auth helpers found during implementation | `lib/marketplace/catalog-access.ts` and tests |
| Legacy mapping transition | `types/product-channel-mapping.ts`, `types/index.ts`, `hooks/queries/use-shopee-product-mapping.ts`, `lib/api/endpoints.ts`, `app/api/shopee/products/create-wms-product/route.ts`, `components/shopee/CreateWmsProductDialog.tsx`, `components/shopee/BulkCreateWmsProductsDialog.tsx`, Shopee product screens | Compatibility adapter and migration command under `lib/marketplace/mappings/` or `scripts/` |
| Offer/source adapters | Current Shopee models in `prisma/schema.prisma`; marketplace sync modules under `lib/shopee/` and peer platform modules | `lib/marketplace/offers/*`, `lib/marketplace/source-lines/*`, platform adapter tests |
| Mapping/recipe domain | None of the legacy one-link mapping APIs can be reused as the source of truth | `lib/marketplace/mappings/*`, `lib/marketplace/catalog/*`, `lib/marketplace/recipes/*`, validations, repositories, commands, tests |
| APIs | `app/api/marketplace/analytics/*`; retire/adapter-wrap Shopee mapping mutations only after parity | `app/api/marketplace/mappings/*`, `app/api/marketplace/catalog/*`, `app/api/marketplace/performance/*`, `app/api/marketplace/exchange-rates/*` |
| Inbox UI | Existing Shopee product components are transition surfaces, not the primary destination | `app/admin/marketplace/mappings/page.tsx`, `components/marketplace/mappings/*`, hooks and shared types |
| First analytics consumer | `lib/server/product-performance-data.ts`, `lib/server/product-performance-data.test.ts`, `types/product-performance.ts`, `hooks/queries/use-product-performance.ts`, existing Product Performance route/page/component | Shared performance query/conversion services and tests |
| Operations | `app/api/marketplace/analytics/backfill/*`, `docs/marketplace-analytics/source-field-matrix.md` | Mapping backfill worker/runbook, reconciliation jobs, dashboards |

File names are implementation targets, not a requirement to create all routes before the phase that uses them. Follow the repository's existing route and test colocation conventions where they differ.

## Legacy Shopee Transition And Compatibility

1. Keep `ProductChannelMapping` and the Shopee create-WMS-product flow working during Phase 1-2. Existing callers, types, endpoints, and Shopee screens must not break merely because the shared models exist.
2. Backfill `MarketplaceOffer` from `ShopeeProduct` and `ShopeeProductVariant` using the internal `ShopeeShop` ID plus `shopeeItemId` and `modelId`; never identify the offer by `itemSku` or `modelSku`.
3. Inventory-product creation is not a mapping confirmation. The legacy `POST /api/shopee/products/create-wms-product` flow may continue to create a WMS product and its legacy link, but must not automatically create a confirmed `SalesSku`, family membership, recipe, or new mapping.
4. Provide a visible compatibility state in Shopee screens: legacy-linked, shared mapping draft, shared mapping confirmed, or needs mapping. For product performance and new analytics, prefer confirmed shared mappings; use legacy data only as explicitly labelled migration/compatibility evidence, never as an unlabelled fallback that changes totals.
5. Build an admin-reviewed migration assistant that proposes draft candidates from legacy `ProductChannelMapping` rows. Resolve product-versus-variant ambiguity, multiple links, stale/deleted Shopee snapshots, and cross-shop identity before confirmation. Preserve the legacy row and audit the candidate provenance.
6. After all supported Shopee surfaces read shared mapping state and historical mapping is reviewed, deprecate legacy mutation controls behind a feature flag. Remove them only after a measured compatibility period, migration reconciliation, and an explicit cleanup decision. Do not delete `ProductChannelMapping` as part of the initial rollout.

## Migration, Rollout, And Operations

1. Deploy additive schema changes and generate the Prisma client. MongoDB deployments need an idempotent migration command that creates indexes, validates existing data, records a run ID, and can resume; do not rely on destructive schema reset behavior.
2. Seed no automatic confirmed mappings. Populate offers first, then generate reviewable draft candidates from legacy links and safe exact matching. Capture candidate evidence and confidence.
3. Release read-only shared catalog/inbox visibility behind a feature flag, initially with Shopee data. Verify that all eligible non-sourcer roles can read the same results and only admins see enabled mutation controls.
4. Pilot a small set of admin-confirmed mappings. Compare source lines, mapping dates, native amounts, recipe allocations, and family aggregation with manually verified orders before broad historical backfill.
5. Enable projections and Product Performance for the pilot shops. Publish mapping, source-data, and currency conversion coverage beside metrics; do not present incomplete cross-currency figures as complete.
6. Expand platform by platform only after each adapter's external identity, line identity, quantity semantics, and money fields pass reconciliation. Keep feature flags and rollback-by-disable controls; rollback must stop new projections/UI exposure, never delete historical records.
7. CSV dry-run import and commit are implemented. Continue monitoring inbox metrics for stable confirmation and low conflict/error rates. Keep true stock conversion, stock synchronization, inventory mutations, and marketplace listing changes deferred.

## Test Plan

- Unit-test identity-key construction, including parent offers, variants, identical seller SKUs in different shops, and mutable seller SKU/title changes.
- Unit-test authorization for each global role: all authenticated non-sourcer roles can read; only global admins mutate; workspace membership does not grant or restrict shared-catalog access.
- Test candidate-to-confirmed transitions, rejected candidates, audit fields, immutable confirmed mappings, effective-date override, default earliest historical date, no overlapping ranges, and mapping/recipe supersession.
- Test source-line adapters for stable idempotency, nullable quantities/GMV, eligibility preservation, and no duplicate unmatched-order facts.
- Test recipe validation, component units, basis-point totals, fixed-point residual allocation, projection keys, replay idempotency, and source-GMV conservation per native currency.
- Test offer, Sales SKU, physical Product, and Product Family aggregates separately so one offer cannot be counted twice through multiple paths.
- Test reporting conversion at date boundaries, rate precision/provenance, missing rates, partial coverage labels, and prevention of mixed native currencies being silently summed.
- Add API integration tests for inbox filtering, preview versus commit, admin-only mutations, page-level read policy, backfill checkpoints/retries, and legacy Shopee compatibility responses.
- Add Product Performance regression tests proving normalized marketplace analytics supplement, rather than mutate, WMS stock/recommendation data.
- Add a deployment smoke test that asserts the new commands never invoke inventory mutation services or marketplace stock-update clients.

## Acceptance Gates And Risks

Do not move from foundation to broad analytics until the following are true:

- One confirmed mapping is effective for any offer/date, history is queryable, and a date override changes only the intended projection range.
- Inbox totals reconcile to canonical source lines without a duplicated unmatched fact collection.
- Offer and family performance remain independently queryable and explainable through drill-down.
- All aggregate money carries native currency or explicit reporting-conversion coverage.
- Product Performance reads confirmed shared mappings/facts and WMS inventory remains untouched.
- Legacy Shopee creation and mapping screens have an explicit, tested compatibility path.

Primary risks are unstable upstream identifiers, platform-specific order revision semantics, incomplete financial fields, missing historical FX rates, incorrectly scoped access inherited from workspace/owner code, and accidental use of legacy one-to-one mappings as analytical truth. Mitigate each with platform readiness gates, preview-before-confirmation, immutable effective dating, idempotent facts, visible coverage, audit trails, reconciliation dashboards, feature flags, and the compatibility period above.

## Explicit Deferrals

- Inventory mutations, reservations, deductions, allocations, or `Product.quantity`/`Product.reservedQuantity` changes driven by marketplace sales.
- Marketplace or SiteGiant stock synchronization and listing/offer mutation.
- Treating recipe component expansion as true operational inventory conversion.
- Any workspace-based segmentation of shared catalog/mapping/analytics data.
- Shopify attribution analytics or mapping use of these hardened snapshots; this change only preserves source facts for future work.

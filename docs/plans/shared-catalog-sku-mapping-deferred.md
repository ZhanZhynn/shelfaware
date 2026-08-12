# Shared Catalog SKU Mapping — Deferred Items

These items are intentionally out of scope for the current implementation. They are documented here for future planning.

## Shopify Attribution Analytics

**Status:** Source facts hardened (upstream GIDs, original quantity, native money snapshots, pagination, atomic sync, incomplete-refresh preservation). Attribution wiring deferred.

**What's needed:**
- Historical Shopify order backfill with hardened source facts (requires re-sync of pre-hardening orders)
- Shopify offer adapter (analogous to Shopee offer adapter in `lib/marketplace-attribution/offer-adapter.ts`)
- Shopify source-line projector
- Shopify mapping UI support in the inbox
- Verify Shopify quantity/revenue semantics (original ordered vs current quantity policy)

**Blocker:** Pre-hardening Shopify orders lack `isLineItemsComplete` and source GIDs. A full historical backfill requires re-syncing all Shopify orders with the hardened sync path.

---

## Lazada/TikTok Attribution

**Status:** Excluded from attribution analytics. Quantities and subtotals are intentionally unverified/null in current sync.

**What's needed:**
- Verify Lazada quantity semantics (currently stored as `null` due to unverified row multiplicity)
- Verify TikTok quantity and combined-product semantics (currently stored as `null`)
- Lazada/TikTok offer adapters and source-line projectors
- Lazada/TikTok mapping UI support in the inbox

**Blocker:** Lazada and TikTok synced quantities/subtotals are known to be unreliable. Attribution must not use unverified data.

---

## Marketplace-Driven Restock/Excess Decisions

**Status:** Product Performance shows marketplace demand as informational only. WMS OrderItem revenue remains authoritative for restock/excess decisions.

**What's needed:**
- Validate marketplace quantity semantics across all channels
- Define safety stock and reorder point formulas incorporating marketplace velocity
- Integrate marketplace normalized units into restock threshold calculations
- Requires completed attribution for all channels first

---

## Inventory Kit Stock Mutation

**Status:** Recipes are analytics-only. No inventory mutation from marketplace sales.

**What's needed:**
- Separate assembled-kit inventory design (product kind, BOM/version, assembly/disassembly transactions)
- Component stock movements and warehouse allocation
- Theoretical availability calculation: `min(floor(componentAvailable / unitsRequired))`
- Must not conflate analytical recipe normalization with operational inventory

---

## Marketplace Stock Push / Listing Mutation

**Status:** Explicitly deferred. ShelfAware never calls marketplace stock-update APIs.

**What's needed:**
- Per-channel "Update Stock" toggle
- Manual sync button per canonical SKU
- Auto sync on order events
- Tally/reconcile action to force-push current sellable stock
- Requires completed attribution and validated marketplace API credentials

---

## ProductView / Conversion Tracking

**Status:** No `ProductView`, `viewCount`, click events, or add-to-cart events exist in the schema. Sell-through rate is the only computable proxy.

**What's needed:**
- `ProductView` model or equivalent event tracking
- Client-side product page view capture
- Per-product conversion rate calculation: `orders / views`
- Shopee Ads `directConversions`/`broadConversions` are campaign-grain only, not product-grain

---

## Full Marketplace Profit Dashboard Unification

**Status:** Per-platform profit detail exists (`lib/marketplace/analytics/profit-detail.ts`). No unified cross-channel profit view.

**What's needed:**
- Unified cross-channel profit using shared attribution facts
- COGS integration (currently excluded from all profit calculations)
- Per-product gross margin using `PurchaseReceiptItem.unitLandedCostMyr`
- Returns/refunds aggregated per product (currently per-order only)

---

## Multi-Component Recipe Authoring UI

**Status:** Service accepts and validates multiple components. UI safely authors one component and reports mixed recipes as excluded from normalized units.

**What's needed:**
- Multi-component recipe editor with quantity and allocation basis points per component
- Validation that basis points sum to 10,000
- Preview of normalized units and allocated GMV per component
- Mixed-recipe reporting (currently excluded from normalized family rollups)

---

## Workspace Segregation

**Status:** All shared catalog, mapping, source-line, fact, and analytics models are organization-wide (no `workspaceId`).

**What's needed:**
- If multi-org tenancy is required: add `workspaceId` to all shared models
- Explicit workspace-shop association (`WorkspaceMarketplaceShop`)
- Workspace-scoped authorization for catalog/mapping/analytics
- Per-workspace base currency and FX rate overrides

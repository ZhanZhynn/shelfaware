# Marketplace Sales Normalization Plan

> **⚠ SUPERSEDED — 2026-08-12**
>
> This plan has been superseded by [`docs/plans/shared-catalog-sku-mapping.md`](plans/shared-catalog-sku-mapping.md).
> The shared-catalog plan is the authoritative design for the shared-organization analytical catalog,
> offer/SKU mapping, source-line projection, performance-fact projection, FX conversion, and
> reconciliation work. The original content below is preserved for historical reference only.

---

## Purpose

ShelfAware operates as a **read-only marketplace analytics application**. It reads sales data from Shopee, Lazada, TikTok, and Shopify, normalizes them into canonical WMS base-product units and allocated GMV, then presents consolidated analytics.

**SiteGiant remains the source of truth for inventory management.** ShelfAware never reserves, deducts, publishes, or otherwise mutates stock.

## Problem

Marketplaces sell products in different forms:

- **Single-unit SKU:** `paper_xbag` → 1 unit of paper_xbag
- **Multipack SKU:** `paper_xbag(100)` → 100 units of paper_xbag
- **Mixed kit SKU:** `starter_kit` → 100 × paper_xbag + 2 × label_roll + 1 × carton_small

Each marketplace may assign different seller SKUs to the same underlying product. Without normalization:

- Sales reporting cannot show total paper_xbag units sold across all listings.
- GMV is reported at the listing level but cannot be attributed to base products.
- Cross-marketplace comparisons are meaningless without a common product key.

## Strategy

### Core Invariant

```text
Marketplace offer → approved sales recipe → base WMS SKU units + allocated GMV
```

A sales recipe is a versioned, operator-approved definition that says:

```text
When marketplace SKU "paper_xbag(100)" sells 1 unit,
normalize to 100 units of WMS SKU "paper_xbag",
allocate 100% of gross item sales to that product.
```

For mixed kits:

```text
When marketplace SKU "starter_kit" sells 1 unit,
normalize to:
  - 100 × paper_xbag      (70% of GMV)
  - 2 × label_roll          (20% of GMV)
  - 1 × carton_small        (10% of GMV)
```

### Rules

1. ShelfAware **never** calls any marketplace stock-update API.
2. ShelfAware **never** writes to `Product.quantity`, `Product.reservedQuantity`, `StockAllocation`, or `StockMovement`.
3. All normalization is read-only and idempotent.
4. SKU name parsing (e.g., detecting `paper_xbag(100)`) produces **suggestions only**; an operator must approve every mapping.
5. Unknown quantities and GMV remain `null`, never coerced to zero.
6. Mixed currencies are never silently summed.
7. Historical backfills use effective-dated mappings and recipe versions.

---

## Data Model

### Sales Recipes

A recipe defines how a marketplace SKU decomposes into base WMS products.

#### `MarketplaceSalesRecipe`

| Field | Type | Description |
|---|---|---|
| id | ObjectId | Primary key |
| workspaceId | ObjectId? | SKU scope boundary |
| code | String | Stable human-readable identifier |
| name | String | Display name |
| status | String | `active`, `archived` |
| createdBy | ObjectId | Creator |
| createdAt | DateTime | |
| updatedAt | DateTime | |

Unique constraint: `[workspaceId, code]`

#### `MarketplaceSalesRecipeVersion`

| Field | Type | Description |
|---|---|---|
| id | ObjectId | Primary key |
| recipeId | ObjectId | Parent recipe |
| version | Int | Sequential version number |
| status | String | `draft`, `approved`, `retired` |
| effectiveFrom | DateTime | When this version applies |
| effectiveTo | DateTime? | Null until superseded |
| approvedBy | ObjectId? | Who approved |
| approvedAt | DateTime? | When approved |
| createdAt | DateTime | |

Unique constraint: `[recipeId, version]`

#### `MarketplaceSalesRecipeComponent`

| Field | Type | Description |
|---|---|---|
| id | ObjectId | Primary key |
| recipeVersionId | ObjectId | Parent version |
| wmsProductId | ObjectId | Base WMS product |
| unitsPerMarketplaceUnit | Int | e.g., 100 for paper_xbag(100) |
| gmvAllocationBasisPoints | Int | e.g., 7000 = 70% |
| position | Int | Ordering and residual allocation |

Unique constraint: `[recipeVersionId, wmsProductId]`

Rules:

- `unitsPerMarketplaceUnit` must be a positive integer.
- `gmvAllocationBasisPoints` must sum to exactly 10,000 across all components.
- Components must belong to the same workspace/SKU scope as the recipe.
- A recipe with one component and 10,000 basis points represents a simple multipack.
- A recipe with one component where `unitsPerMarketplaceUnit = 1` represents a 1:1 mapping.

---

### Marketplace Mapping

Links a stable marketplace offer to an approved recipe version.

#### `MarketplaceSalesMapping`

| Field | Type | Description |
|---|---|---|
| id | ObjectId | Primary key |
| platform | String | `shopee`, `lazada`, `tiktok`, `shopify` |
| internalShopId | ObjectId | Internal shop reference |
| externalProductId | String | Marketplace product ID |
| externalVariantId | String? | Marketplace variant ID |
| sellerSkuSnapshot | String? | For display/search only |
| recipeVersionId | ObjectId | Approved recipe version |
| effectiveFrom | DateTime | When this mapping applies |
| effectiveTo | DateTime? | Null until superseded |
| status | String | `active`, `retired`, `superseded` |
| mappingMethod | String | `manual`, `suggested_sku`, `imported`, `csv` |
| createdBy | ObjectId | |
| approvedBy | ObjectId? | |
| createdAt | DateTime | |
| updatedAt | DateTime | |

Unique constraint: `[platform, internalShopId, externalProductId, externalVariantId]`

Rules:

- Only one approved mapping may be effective at any point in time for a given marketplace offer.
- `sellerSkuSnapshot` is never used as a database identity.
- Changing the effective recipe version creates a new mapping record rather than editing the old one.

---

### Source Sales Lines

Platform-neutral representation of every marketplace order line.

#### `MarketplaceSourceSalesLine`

| Field | Type | Description |
|---|---|---|
| id | ObjectId | Primary key |
| platform | String | |
| internalShopId | ObjectId | |
| externalOrderId | String | |
| externalLineId | String | Stable upstream line identity |
| externalProductId | String | |
| externalVariantId | String? | |
| sellerSku | String? | Display/search only |
| productName | String? | |
| orderDate | DateTime | |
| marketplaceQuantity | Int? | Nullable if source unknown |
| grossItemSalesMinor | Int? | Nullable if source unknown |
| amountScale | Int | Decimal places (e.g., 2 for MYR) |
| currency | String | |
| orderStatus | String? | Raw upstream status |
| orderEligibility | String | `eligible`, `ineligible`, `unknown` |
| quantityQuality | String | `verified`, `observed`, `unknown` |
| gmvQuality | String | `verified`, `observed`, `unknown` |
| rawFinancialPayload | Json? | Sanitized source payload |
| sourceObservedAt | DateTime | When this snapshot was observed |
| sourceRevision | String? | Revision/version from upstream |
| createdAt | DateTime | |
| updatedAt | DateTime | |

Unique constraint: `[platform, internalShopId, externalOrderId, externalLineId]`

Index: `[platform, internalShopId, orderDate]`

Rules:

- Cancelled or proven unpaid orders have `orderEligibility: "ineligible"`.
- Unknown statuses have `orderEligibility: "unknown"`.
- Missing quantity remains `null`; never becomes zero.
- Missing GMV remains `null`; never becomes zero.
- Line GMV is gross item sales before refunds.
- Order totals are not distributed to lines unless an approved allocation policy exists.
- Raw payloads are sanitized before storage.

---

### Normalized Product Sales Facts

The analytics projection from source lines through recipes.

#### `MarketplaceProductSalesFact`

| Field | Type | Description |
|---|---|---|
| id | ObjectId | Primary key |
| sourceLineId | ObjectId | Source sales line |
| mappingId | ObjectId | Active mapping at time of projection |
| recipeVersionId | ObjectId | Snapshot of recipe version |
| wmsProductId | ObjectId | Base WMS product |
| normalizedUnitsSold | Int | `marketplaceQuantity × unitsPerMarketplaceUnit` |
| allocatedGmvMinor | Int | Fixed-point allocated GMV |
| allocationBasisPoints | Int | Weight used for allocation |
| currency | String | |
| saleDate | DateTime | From source order |
| projectionVersion | String | Calculation version for reproducibility |
| projectionKey | String | Deterministic idempotency key |
| projectedAt | DateTime | |
| createdAt | DateTime | |

Unique constraint: `[projectionKey]`

Index: `[wmsProductId, saleDate]`

The deterministic projection key must include:

```text
platform + shop + external order + external line + source revision
+ mapping id + recipe version + component product + calculation version
```

Rules:

- Reprocessing the same source line with the same mapping produces the same fact.
- A new mapping effective date creates a new projection rather than editing old facts.
- The sum of component allocated GMV for one source line must equal the source line GMV.
- Facts are never deleted; they are superseded by new projections.

---

## GMV Allocation Algorithm

### Integer Arithmetic

All monetary calculations use fixed-point minor units to avoid floating-point rounding:

```text
allocatedGmvMinor = sourceLineGmvMinor × basisPoints / 10,000
```

### Residual Distribution

When component allocations do not exactly consume all minor units due to integer division:

```text
residual = sourceLineGmvMinor - sum(componentAllocations)
```

The residual is assigned to the component with the highest `position` value. This ensures:

```text
sum(all component allocatedGmvMinor) === sourceLineGmvMinor
```

### Single-Component Recipe

```text
paper_xbag(100): 1 component, 10,000 basis points
Source line GMV: MYR 15.00 (1500 minor units)
Allocated: MYR 15.00 (1500 minor units) to paper_xbag
Units: 1 × 100 = 100
```

### Multi-Component Recipe

```text
starter_kit: 3 components
Source line GMV: MYR 80.00 (8000 minor units)

Component 1: paper_xbag    7000 bp → MYR 56.00 (5600)
Component 2: label_roll    2000 bp → MYR 16.00 (1600)
Component 3: carton_small  1000 bp → MYR 8.00  (800)
Total: 8000 bp → MYR 80.00 (8000)
```

---

## Analytics Coverage

### Required Metrics

| Metric | Definition |
|---|---|
| Source GMV | Total gross item sales from all mapped and unmapped source lines |
| Mapped GMV | GMV from source lines with an approved mapping |
| Unmapped GMV | GMV from source lines without an approved mapping |
| Allocated product GMV | Sum of component GMV from normalized facts |
| Normalized units sold | Sum of `normalizedUnitsSold` per WMS product |
| GMV per unit | `allocatedGmvMinor / normalizedUnitsSold` |
| Marketplace units sold | Raw marketplace listing quantity (before normalization) |
| Kit decomposition count | How many source lines were normalized through a multi-component recipe |
| Mapping coverage | `mapped GMV / source GMV` |
| Quantity coverage | `% of source lines with known quantity` |
| GMV coverage | `% of source lines with known GMV` |

### Coverage Invariant

```text
Mapped source GMV === sum of allocated product GMV
```

### Per-Product Breakdown

```text
WMS Product: paper_xbag
  Total normalized units sold: 12,450
  Total allocated GMV: MYR 6,225.00
  Contributing listings:
    - Shopee paper_xbag(100): 80 marketplace units → 8,000 normalized, MYR 4,000
    - Shopee paper_xbag(50): 40 marketplace units → 2,000 normalized, MYR 1,000
    - Lazada paper_xbag(100): 22 marketplace units → 2,200 normalized, MYR 1,100
    - Shopify paper_xbag: 250 marketplace units → 250 normalized, MYR 125
```

---

## Effective-Dated Backfill

### Mapping Approval Workflow

1. Operator selects an unmapped marketplace offer.
2. Operator browses or creates a recipe.
3. Operator chooses an effective date.
4. ShelfAware previews affected historical source lines.
5. Preview shows:
   - Affected orders
   - Marketplace units
   - Normalized component units
   - Known GMV
   - Unknown GMV
   - Currencies
   - Unknown statuses
   - Lines without quantity
   - Potential mapping conflicts
6. Operator approves the mapping.
7. An idempotent backfill creates `MarketplaceProductSalesFact` records.
8. Existing facts outside the effective period remain unchanged.

### Recipe Version Changes

When a recipe changes:

1. A new `MarketplaceSalesRecipeVersion` is created.
2. The new version gets its own `effectiveFrom` date.
3. Source lines before that date use the old version.
4. Source lines on or after that date use the new version.
5. Historical facts are never silently rewritten.

---

## Implementation Phases

### Phase 1: Read-Only Boundary

- Add explicit analytics-only mode guard.
- Verify analytics routes never call inventory mutation services.
- Document SiteGiant as inventory authority.
- Add guard tests.

### Phase 2: Recipe Schema And Validation

- Add `MarketplaceSalesRecipe`, `MarketplaceSalesRecipeVersion`, `MarketplaceSalesRecipeComponent` to Prisma schema.
- Add workspace-scoped validation.
- Add component quantity and allocation weight validation.
- Add cycle and scope checks.

### Phase 3: Mapping Schema And Validation

- Add `MarketplaceSalesMapping` to Prisma schema.
- Add one-effective-mapping-per-offer enforcement.
- Add workspace and shop authorization checks.

### Phase 4: Generic Mapping UI

- Build shared mapping APIs and components for all four platforms.
- Add WMS product search.
- Add recipe preview for a single marketplace sale.
- Add SKU parsing as suggestion only.
- Add bulk CSV mapping import with preview-and-commit.

### Phase 5: Source Sales Line Adapter

- Create a platform-neutral source sales line resolver.
- Ensure stable external line identities.
- Preserve nullable quantities and GMV.
- Add marketplace-specific field extraction.
- Maintain raw sanitized payloads.

### Phase 6: Projection Engine

- Resolve effective mapping by sale date.
- Snapshot the applicable recipe version.
- Expand source lines into component facts.
- Allocate fixed-point GMV with residual distribution.
- Add idempotent replay via projection key.
- Create `MarketplaceProductSalesFact` records.

### Phase 7: Historical Backfill

- Add preview, approval, checkpoint, retry, and cancellation.
- Backfill only approved effective periods.
- Invalidate analytics caches after committed projections.
- Add reconciliation checks.

### Phase 8: Product Analytics API

- Add canonical WMS product sales API.
- Add product, kit, marketplace, and shop breakdowns.
- Show separate source and normalized metrics.
- Add governed CSV export with mapping and coverage metadata.

### Phase 9: Reconciliation And Monitoring

- Compare source line totals with normalized projections.
- Verify GMV conservation per source line.
- Verify unit multiplication against sample orders.
- Run per-platform pilots.
- Monitor unmapped and failed projection rates.

---

## Platform Readiness

| Platform | GMV Readiness | Normalized Units | Blocker |
|---|---|---|---|
| Shopee | After gross item sales field verification | After order-line identity and quantity verification | Source field matrix pending |
| Lazada | After gross item sales field verification | **Blocked** | Quantity semantics unknown |
| TikTok | After gross item sales field verification | **Blocked** | Quantity and combined-product semantics unknown |
| Shopify | After gross item sales field verification | After order-line identity and quantity verification | Source field matrix pending |

A platform may report GMV while normalized units remain unavailable, or vice versa.

---

## Acceptance Criteria

- [ ] A Shopee multipack sale correctly expands into base-product units.
- [ ] Mixed kits allocate GMV without duplication.
- [ ] Product allocations conserve source GMV to the minor unit.
- [ ] Reprocessing an order creates no duplicate facts.
- [ ] Mapping versions preserve historical meaning.
- [ ] Unmapped lines remain visible in totals and coverage.
- [ ] Missing quantities and GMV remain unavailable rather than zero.
- [ ] Mixed currencies are never summed silently.
- [ ] Cross-shop and cross-workspace mappings are rejected.
- [ ] Marketplace synchronization never mutates WMS or marketplace stock.
- [ ] SiteGiant remains the sole inventory-management authority.
- [ ] Historical backfills respect effective dates.
- [ ] GMV per unit is correctly calculated as `allocated GMV / normalized units`.
- [ ] Coverage metrics accurately reflect mapped versus total source data.

---

## External Dependencies

- Verified gross-item-sales fields per platform (Shopee, Lazada, TikTok, Shopify source-field matrix).
- Verified order-line quantity semantics per platform.
- Verified order-line identity and stability per platform.
- Stable WMS product catalog with correct SKU scope.
- Approved allocation-weight policy for mixed kits.
- No changes to SiteGiant inventory synchronization.

# Shared Catalog SKU Mapping — Deployment Runbook

## Prerequisites

- Node.js 20+
- MongoDB accessible via `DATABASE_URL`
- Admin access to the application

## 1. Prisma Schema Push

```bash
# Generate Prisma client (idempotent)
npx prisma generate

# Push schema to MongoDB (additive — does not drop existing collections)
npx prisma db push
```

`prisma db push` is the correct command for MongoDB deployments. It creates new collections and indexes without destructive resets. Verify the output shows no errors.

## 2. Index Creation Verification

After schema push, verify the new collections and indexes exist. Run `npx prisma db pull` to introspect the database and confirm no schema drift:

```bash
npx prisma db pull
npx prisma validate
```

Then verify indexes directly in the MongoDB shell (`mongosh`):

```javascript
// Connect to your database, then:
db.MarketplaceSkuMapping.getIndexes()
db.MarketplaceSourceSalesLine.getIndexes()
db.SalesSkuPerformanceFact.getIndexes()
db.WmsProductSalesFact.getIndexes()
db.MappingBackfillRun.getIndexes()
db.ExchangeRate.getIndexes()
```

Expected unique indexes:
- `MarketplaceSkuMapping`: `[platform, shopId, offerKey, effectiveFrom]`
- `MarketplaceSourceSalesLine`: `[platform, internalShopId, externalOrderId, externalLineId]`
- `SalesSkuPerformanceFact`: `projectionKey` (unique)
- `WmsProductSalesFact`: `projectionKey` (unique)

If any index is missing, re-run `npx prisma db push` and check the output for errors.

## 3. Feature Flag Rollout Sequence

All flags default to **enabled in development**, **disabled in production**.

### Step 1: Read access
```bash
SHARED_SKU_MAPPING_ENABLED=true
```
Verify: non-sourcer users can see shared catalog, mappings, and inbox at `/admin/marketplace/mappings`.

### Step 2: Pilot mappings
```bash
SHARED_SKU_MAPPING_MUTATIONS_ENABLED=true
```
Verify: admin can create families, Sales SKUs, confirm mappings, and run CSV imports.

### Step 3: Backfill
Run the backfill worker for a pilot shop and date range:
```bash
# Via API or admin UI — backfill is gated by SHARED_SKU_MAPPING_MUTATIONS_ENABLED
```
Verify: `MappingBackfillRun` status is `completed` or `completed_with_errors`.

### Step 4: Analytics
```bash
SHARED_SKU_MAPPING_ANALYTICS_ENABLED=true
```
Verify: Product Performance page shows fact-based analytics with mapping and currency coverage.

### Step 5: Full rollout
All three flags enabled. Monitor reconciliation dashboard at `/api/inventory/sku-mapping/reconciliation`.

## 4. Rollback Procedure

Rollback is **disable feature flags, no data deletion**:

```bash
# Disable in order: analytics → mutations → read
SHARED_SKU_MAPPING_ANALYTICS_ENABLED=false
SHARED_SKU_MAPPING_MUTATIONS_ENABLED=false
SHARED_SKU_MAPPING_ENABLED=false
```

Effects:
- Read disabled: shared catalog/inbox/APIs return 403 for all users.
- Mutations disabled: admin mutation endpoints (confirm, backfill, migration) return 403.
- Analytics disabled: Product Performance falls back to legacy Shopee snapshot path.

No historical data (`MarketplaceSkuMapping`, `SalesSkuPerformanceFact`, etc.) is deleted. Re-enabling flags restores access to existing data.

## 5. Smoke Test Checklist

Run as an admin user after each rollout step:

```bash
# Via API
GET /api/inventory/sku-mapping/smoke-test
```

Expected results:
- [ ] No inventory mutation calls from new services (static check).
- [ ] One confirmed mapping can be created and read back.
- [ ] Source-line and fact projection works end-to-end.
- [ ] FX conversion returns coverage metadata (identity conversion for same currency).

## 6. Monitoring

After full rollout, monitor:

```bash
# Admin-only reconciliation endpoint
GET /api/inventory/sku-mapping/reconciliation
```

Key metrics:
- `unmappedMateriality.unmappedOfferCount` — should decrease over time.
- `mappingConflicts.overlappingCount` — should be zero.
- `duplicateProjectionKeys.total` — should be zero.
- `fxCoverage.coveragePercent` — should be 100% for supported currencies.
- `projectionFailures.failedRunCount` — investigate any non-zero values.

## File Reference

| Component | File |
|---|---|
| Feature flags | `lib/marketplace-attribution/feature-flags.ts` |
| Smoke test | `lib/marketplace-attribution/smoke-test.ts` |
| Migration assistant | `lib/marketplace-attribution/migration-assistant.ts` |
| Reconciliation API | `app/api/inventory/sku-mapping/reconciliation/route.ts` |
| Migration API | `app/api/inventory/sku-mapping/migration/route.ts` |
| Migration UI | `components/sku-mapping/LegacyMigrationPanel.tsx` |
| Inbox (updated) | `components/sku-mapping/SkuMappingInbox.tsx` |

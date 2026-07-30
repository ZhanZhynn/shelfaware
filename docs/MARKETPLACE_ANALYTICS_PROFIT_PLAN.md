# Marketplace Analytics and Profit Tracking Plan

## Objective

Deliver a consistent analytics and estimated-profit experience for Shopee,
Lazada, TikTok Shop, and Shopify. The implementation will use one shared
calculation contract and shared UI while preserving platform-specific ingestion
and financial semantics.

The initial release includes:

- Revenue and order analytics
- Buyer, repeat-purchase, and CLV analytics
- Product performance analytics
- Platform fees, refunds, shipping, and settlement tracking
- Channel-level and product-level estimated profit
- A resumable 12-month historical backfill
- Shared approved-Admin access and cache scope

Standalone advertising dashboards and return-management workflows are outside
this phase. Refund and return amounts required for net sales and profit will
still be ingested.

## Agreed Accounting Scope

The feature will report estimated profit based on marketplace proceeds and
known marketplace costs. It will not include COGS, advertising spend, payroll,
overhead, or other operating expenses.

```text
net sales =
  gross sales
  - seller-funded discounts
  - refunds

estimated profit =
  net sales
  + buyer-paid shipping and platform subsidies credited to the seller
  - marketplace fees
  - payment and transaction fees
  - seller shipping and return-shipping charges
  - other known marketplace charges

estimated margin = estimated profit / net sales * 100
```

Tax will be reported separately and excluded from revenue or profit where the
platform treats it as a pass-through amount.

Missing costs must remain unknown. They must not be converted to zero. Every
profit response and dashboard will disclose:

- Calculation basis: `settled`, `order-estimate`, or `partial`
- Financial coverage percentage
- Missing or unavailable cost categories
- Reporting currency and conversion metadata
- Explicit exclusion of COGS and advertising spend

## Canonical Platform Sources

### Shopee

Primary sources:

- `docs/marketplace_api/shopee/payment/get_escrow_detail.md`
- `docs/marketplace_api/shopee/payment/get_escrow_detail_batch.md`
- `docs/marketplace_api/shopee/payment/get_income_detail.md`
- `docs/marketplace_api/shopee/order/get_order_list.md`
- `docs/marketplace_api/shopee/order/get_order_detail.md`
- `docs/marketplace_api/shopee/returns/get_return_list.md`
- `docs/marketplace_api/shopee/returns/get_return_detail.md`

Use final escrow and post-adjustment escrow as the strongest settled-profit
basis. Use order values only while escrow is unavailable.

### Lazada

Primary sources:

- `docs/marketplace_api/lazada/finance/finance_transaction_details_get.md`
- `docs/marketplace_api/lazada/finance/finance_payout_status_get.md`
- `docs/marketplace_api/lazada/finance/finance_transaction_accountTransactions_query.md`
- `docs/marketplace_api/lazada/finance/lbs_slb_queryLogisticsFeeDetail.md`
- `docs/marketplace_api/lazada/order/orders_get.md`
- `docs/marketplace_api/lazada/order/order_items_get.md`
- `docs/marketplace_api/lazada/returns/reverse_getreverseordersforseller.md`
- `docs/marketplace_api/lazada/returns/order_reverse_return_detail_list.md`

Treat finance transaction rows as the canonical signed ledger. Preserve raw
transaction type, fee type, and fee name because categories may vary by region.
Use payout statements for aggregate reconciliation and logistics fee detail for
seller shipping charges.

### TikTok Shop

Primary sources:

- `docs/marketplace_api/tiktok/finance/get-transactions-by-order.md`
- `docs/marketplace_api/tiktok/finance/get-transactions-by-statement.md`
- `docs/marketplace_api/tiktok/finance/get-unsettled-transactions.md`
- `docs/marketplace_api/tiktok/finance/get-statements.md`
- `docs/marketplace_api/tiktok/order/get-price-detail.md`
- `docs/marketplace_api/tiktok/order/get-order-list.md`
- `docs/marketplace_api/tiktok/order/get-order-detail.md`

Use `/finance/202501/orders/{order_id}/statement_transactions` as the canonical
settled source. It contains order and SKU-level revenue, refunds, fees, taxes,
shipping costs, subsidies, and settlement amounts. Use price detail only for
pending-order estimates.

### Shopify

Primary official Admin GraphQL sources:

- `Order`
- `OrderTransaction`
- `TransactionFee`
- `Refund` and `RefundLineItem`
- `Return`
- `ShopifyPaymentsPayout`
- `ShopifyPaymentsBalanceTransaction`
- Shopify API access scopes and order-history permissions

Use current post-refund order totals and successful transactions for net sales.
Use Shopify Payments transaction fees when available. Use payout and balance
transactions for reconciliation when the merchant grants payout access.

## Phase 1: Shared Contracts and Calculators

Create shared marketplace analytics code under `lib/marketplace/analytics/`.

Define normalized types for:

- Money and currency values
- Marketplace order financials
- Product financial allocation
- Buyer order history
- Profit summary and fee breakdown
- Data coverage and capability state
- Date range and reporting currency

Implement pure calculation helpers for:

- Gross and net sales
- Refund-adjusted revenue
- Known marketplace costs
- Estimated profit and margin
- Product-level allocation of order costs
- Repeat-buyer rate and average order value
- RFM segments, churn risk, and estimated CLV
- Revenue and profit trends

The shared layer must not know Prisma model names or platform API response
shapes. Platform adapters will produce the normalized inputs.

## Phase 2: Correct Existing Sync Data

Fix data correctness before exposing new analytics.

### Shopee

- Preserve imported estimated shipping fees.
- Store final escrow and adjustment values needed by the shared contract.
- Allocate order-level shipping once across products instead of duplicating it
  for every item.
- Add date filters to profit, buyer, and CLV reporting.
- Remove hardcoded MYR formatting.

### Lazada

- Persist seller and platform vouchers separately.
- Persist original shipping, seller shipping discount, and platform shipping
  discount.
- Persist tax, paid price, buyer ID, stable item/SKU IDs, and return IDs.
- Validate whether API order rows represent item quantity or one row per unit;
  do not continue hardcoding quantity without a verified rule.

### TikTok Shop

- Populate line-item subtotal, tax, seller discount, platform discount, and
  refund values instead of defaulting them to zero.
- Derive quantity from verified line-item semantics, including repeated unit
  rows and virtual bundles.
- Flatten the order payment fields required for indexing and aggregation while
  retaining the raw payload.

### Shopify

- Normalize cancellation status handling.
- Use discounted and current post-refund values consistently.
- Exclude test orders from business metrics.
- Store stable customer, product, variant, and line-item IDs.

All product aggregation must use stable marketplace product, variant, item, or
SKU identifiers. Product names must not be used as join keys.

## Phase 3: Schema and Financial Ingestion

Update `prisma/schema.prisma` with the smallest platform-specific additions
required to preserve source data and produce normalized analytics.

### Shopee additions

- Final escrow after adjustments
- Seller and platform discounts
- Additional seller fees and shipping adjustments needed by the current API
- Raw escrow payload for forward-compatible fields

### Lazada additions

- Normalized order and item financial fields
- `LazadaFinanceTransaction` keyed by transaction number and order/item IDs
- `LazadaPayoutStatement` keyed by statement number
- `LazadaLogisticsFee` keyed by statement/order/item/fee identifiers
- `LazadaReturn` with order, item, refund amount, status, and reason

### TikTok additions

- Normalized price-detail snapshot
- `TikTokStatement`
- `TikTokStatementTransaction` with order and SKU breakdowns
- Raw fee, tax, shipping, and revenue breakdown JSON for regional extensions

### Shopify additions

- Current totals, discounts, net payment, and customer ID on orders
- `ShopifyOrderTransaction` with successful payment/refund transactions and
  transaction fees
- `ShopifyRefund` and refund line items
- Optional payout and balance transaction models when payout scope is granted

All ingestion must be idempotent. External IDs and stable compound keys must
prevent duplicate records during retries and historical backfills.

## Phase 4: API Clients and Permissions

Extend the existing signed clients rather than introducing new SDKs unless an
official SDK materially reduces risk.

### Shopee

- Add batch escrow and income-detail synchronization.
- Verify the connected app type has Payment API access.
- Process order and income windows in the documented 14/15-day ranges.

### Lazada

- Add signed Finance and logistics requests to `lib/lazada/custom-api.ts`.
- Process finance windows below the documented 180-day maximum.
- Preserve unknown transaction categories and localized names.
- Verify Finance API availability per seller region.

### TikTok Shop

- Add Finance 202501 and statement endpoints to the existing signed client.
- Request and verify `seller.finance.info` in addition to order access.
- Use cursor pagination and store raw regional breakdowns.

### Shopify

- Expand OAuth configuration to request only approved required scopes:
  - `read_orders`
  - `read_all_orders` after Partner approval
  - `read_customers` after protected customer data approval
  - `read_returns`
  - `read_shopify_payments_payouts` when available
- Query current totals, refunds, successful transactions, and transaction fees.
- Reconnect existing stores when their granted scopes are insufficient.

Each shop must expose capability flags so the UI can distinguish unsupported
APIs from failed synchronization.

## Phase 5: Resumable 12-Month Backfill

Add idempotent per-shop backfill jobs with persisted progress.

Requirements:

- Separate cursors for orders, finance, refunds, and settlements
- Platform-specific time windows and pagination
- Retry with bounded exponential backoff
- Rate-limit handling and clear sync-log errors
- Safe restart after deployment or timeout
- Incremental updates for late refunds, fees, and settlement adjustments
- Per-shop history start/end and financial coverage status

Expected windowing:

- Shopee: 14/15-day windows
- Lazada: less than 180 days per finance request, with smaller operational
  windows where necessary
- TikTok Shop: cursor pagination over order and statement time ranges
- Shopify: 60 days until `read_all_orders` is approved, then backfill 12 months

The backfill must attempt the agreed 12 months but record the actual earliest
date returned by each platform. It must not claim full coverage when a platform
or permission limits history.

## Phase 6: Shared Server APIs and Caching

Provide consistent endpoints for all four platforms:

```text
/api/{platform}/stats
/api/{platform}/stats/revenue-trend
/api/{platform}/stats/products
/api/{platform}/stats/buyers
/api/{platform}/stats/clv
/api/{platform}/stats/profit
```

Every endpoint must support:

- `shopId`
- `dateFrom`
- `dateTo`
- Reporting currency
- Shared approved-Admin owner scope
- Platform capability and coverage metadata

Cache keys must include:

- Platform
- Shared Admin or user scope
- Shop selection
- Date range
- Reporting currency
- Calculation version

Sync, refund, finance, and payout updates must invalidate all affected summary,
trend, product, buyer, CLV, and profit caches.

## Phase 7: Shared Analytics and Profit UI

Create reusable components under `components/marketplace/analytics/` and
`components/marketplace/profit/`. Platform pages should configure the shared
components instead of copying Shopee-specific dashboards.

Add routes:

```text
/admin/lazada/analytics
/admin/lazada/profit
/admin/tiktok/analytics
/admin/tiktok/profit
/admin/shopify/analytics
/admin/shopify/profit
```

Migrate the existing Shopee analytics and profit pages to the same shared
contract and components.

### Analytics page

- Date range and shop selector
- Orders, net sales, and average order value
- Revenue trend
- Unique and repeat buyers
- Repeat-purchase rate
- Top buyers and spending tiers
- Geographic distribution where usable buyer data is available
- RFM segments, churn risk, and estimated CLV
- Product velocity, stock risk, and sales performance
- History and buyer-identity coverage disclosure

### Profit page

- Gross sales
- Seller-funded discounts
- Refunds
- Net sales
- Marketplace and payment fees
- Shipping charges and subsidies
- Other marketplace adjustments
- Estimated profit and margin
- Settlement reconciliation status
- Product/SKU estimated profit
- CSV export
- Data basis, coverage, missing costs, and exclusions

The UI must be responsive on desktop and mobile. Missing capabilities should
show an explanatory partial state rather than a zero-value card.

Update `components/layouts/admin-navigation.tsx` with Analytics and Profit
Tracking links for Lazada, TikTok Shop, and Shopify.

## Phase 8: Shopee Unification

Shopee is the existing reference but not the final calculation standard.
Migrate it after the shared contract is stable and fix known inconsistencies:

- Date-aware profit and customer metrics
- Consistent cancellation filtering
- Currency-aware formatting and aggregation
- Scope/filter-complete React Query keys
- Correct product and shipping allocation
- Shared coverage and calculation-basis labels
- Shared CSV export behavior

This keeps all four platforms behaviorally consistent without preserving known
Shopee calculation defects.

## Testing and Verification

### Unit tests

- Profit formulas and sign normalization
- Missing-value and partial-coverage behavior
- Tax exclusion
- Seller-funded versus platform-funded discounts
- Partial and full refunds
- Shipping subsidies and return-shipping charges
- Product-level allocation
- Currency conversion
- RFM, churn, and CLV calculations

### Platform adapter tests

- Shopee escrow and adjustment mapping
- Lazada signed finance rows, payout summaries, and regional fee names
- TikTok settled and unsettled transaction breakdowns
- Shopify current totals, successful refunds, and transaction fees
- Idempotent upserts and replayed pages

### Access and cache tests

- Shared approved-Admin owner scope
- Non-Admin isolation
- Shop ownership validation
- Cache isolation by scope, shop, date, currency, and version
- Invalidation after all sync types

### Backfill tests

- Window boundaries and pagination
- Resume after failure
- Duplicate prevention
- Late settlement/refund updates
- Restricted history and partial coverage

### UI verification

- Empty, loading, error, partial, and complete states
- Shop/date/currency switching without stale data
- Desktop and mobile layouts
- CSV values match displayed calculations

Run the standard verification gates:

```bash
npx prisma generate
npx tsc --noEmit
npm test
npm run lint
npm run build
```

Existing unrelated lint failures must be documented separately and must not be
hidden by disabling lint rules in the analytics implementation.

## Rollout Sequence

1. Add shared contracts, calculators, and formula tests.
2. Correct existing marketplace order and item synchronization.
3. Add schema fields and financial models.
4. Implement Shopee, Lazada, TikTok, and Shopify financial adapters.
5. Add capability checks and OAuth permission changes.
6. Implement and run resumable 12-month backfills.
7. Add shared analytics APIs and cache keys.
8. Build shared analytics and profit components.
9. Add Lazada, TikTok Shop, and Shopify pages and navigation.
10. Migrate Shopee to the shared contract.
11. Reconcile sample results against each Seller Center or Shopify Admin.
12. Enable the feature shop by shop based on capability and coverage.

## External Dependencies and Risks

- Platform app permissions can prevent finance or historical access even when
  the endpoint is documented.
- Shopify history beyond 60 days requires `read_all_orders` approval.
- Shopify transaction fees are complete only for Shopify Payments; other
  gateways may not expose processing fees.
- Lazada fee names and categories vary by seller region and must be treated as
  source data rather than a fixed English enum.
- TikTok and Shopee financial fields vary by region and seller program.
- Financial values can change after delivery due to returns, disputes,
  shipping measurement, and settlement adjustments.
- Multi-currency totals must never be summed without explicit conversion.

The system must remain useful under partial access while clearly distinguishing
settled results from estimates.

## Deferred Work

- Cross-platform advertising integrations and ad-spend attribution
- Dedicated Lazada, TikTok Shop, and Shopify return-management pages
- COGS and inventory-cost accounting
- Fully loaded operating profit
- Automatic bank-deposit reconciliation outside marketplace payout APIs
- Attribution integrations for Meta Ads, Google Ads, and TikTok Business Ads

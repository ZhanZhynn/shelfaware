# Live Shopee order items

The marketplace v1 API supports optional item lines on live Shopee order lists
and direct detail lookup by the upstream Shopee order ID (`order_sn`). Both use
the existing `marketplace:live` scope, owned-shop authorization, rate limit,
transient SDK token storage, and `Cache-Control: no-store` responses.

## API

```text
GET /api/v1/marketplaces/shopee/live/orders?shopId=<internal-shop-id>&includeItems=true
GET /api/v1/marketplaces/shopee/live/orders/<order_sn>?shopId=<internal-shop-id>
```

Lists retain their bounded date filters, limit (at most 50), provider cursor, and
`data` array. `includeItems` accepts exactly `true` or `false`, defaults to false,
and is supported only for Shopee orders. It adds `item_list` to the detail request
already made for each page, without extra per-order requests. Direct detail
returns one object under `data`, always includes item evidence, and calls
`getOrdersDetail` directly without listing orders or running synchronization. It
accepts only `shopId` as a query parameter. Other platforms do not support live
detail. Local order detail continues to use an internal persisted-record ID.

## Item contract

Each normalized `lineItems` entry exposes:

- `externalLineId`, `productExternalId` (Shopee `item_id`), and
  `variantExternalId` (`model_id`; the no-model sentinel 0 becomes null).
- `title`, `variantTitle`, `sku`, and `imageUrl`.
- `quantity`, `unitPrice`, `originalUnitPrice`, `unitPriceBasis`, `subtotal`, and
  `currency`.

Listing-level reporting groups by shop ID plus `productExternalId`. Variant SKUs
and names are descriptive, not listing identifiers. Responses map only these
source fields rather than exposing raw provider objects.

`lineItemsCoverage.state` is `ready`, `partial`, or `unavailable`. Missing or
malformed `item_list` produces `lineItems: null` and unavailable coverage. An
explicit empty provider array produces `[]`. Missing line identifiers, quantity,
or usable prices produces partial coverage; unknown numbers remain null.

## Sales price basis

Live reads and order synchronization share `lib/shopee/order-item.ts`:

1. Use a valid `model_discounted_price`, including zero.
2. Otherwise use a valid `model_original_price`.
3. Compute subtotal as purchased quantity times the selected unit price.

`unitPriceBasis` identifies the chosen field. The sync validates required prices
and quantities before replacing persisted item lines. Source absence is not
converted to a fabricated zero. Previously stored original-price rows require
an order re-sync; a deployment alone does not rewrite history.

These are product merchandise sales, not seller settlement. Order-level
discounts, shipping, refunds, and fees can make them differ from order totals or
seller proceeds. Escrow requests are not added by item inspection.

## CLI

```sh
shelfaware marketplace orders list --platform shopee --shop <shop-id> \
  --live --include-items --all --output json
shelfaware marketplace orders get <order_sn> --platform shopee \
  --shop <shop-id> --live --output json
```

Deploy the backend changes and rebuild the CLI together. JSON/JSONL retain nested
lines and coverage metadata; table output remains an order summary.

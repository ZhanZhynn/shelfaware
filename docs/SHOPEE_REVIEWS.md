# Shopee customer reviews

## Storage and source contract

`lib/shopee/reviews-sync.ts` collects reviews independently of order imports from
Shopee's [`v2.product.get_comment`](https://open.shopee.com/documents/v2/v2.product.get_comment?module=89&type=1).
Requests use `cursor`, `page_size` (at most 100), and an optional numeric `item_id`.
Responses use `item_comment_list`, `more`, and `next_cursor`.

`ShopeeReview` uses `(shopId, externalId)` as its unique key. `externalId` is the
comment ID, stored as a string. Unsafe numeric identifiers are rejected rather
than rounded. Ratings, review text, variant IDs, media, seller replies, visibility,
and provider timestamps remain nullable when unavailable. Reply normalization
accepts both `comment_reply` and `cmt_reply`. Content hashes detect edits independently
of observation time; first-observed and last-changed timestamps are retained.
`reviewsChanged` counts any canonical source-fact hash change (including replies
or media URLs), not specifically customer text edits.

Buyer usernames and arbitrary raw response payloads are not stored. The private
order reference is stored for linkage but excluded from review reports. Text and
seller replies are untrusted quoted data. Media contains bounded HTTP(S) URL
lists, never executable content. No reply-writing API is provided.

Product/order links use stable identifiers constrained by shop and owner. Missing
or ambiguous parents leave the review unlinked. At the end of each collection,
up to 200 retained unlinked records are rechecked in oldest-link-check order,
without changing the review's source-observation timestamp.

## Setup and execution

```sh
npx prisma generate
node --env-file=.env --import tsx scripts/create-shopee-review-indexes.ts
```

The index script creates only the new review collections' indexes. Syncs write to
the backend's configured MongoDB database. No whole-schema database push is needed.

`POST /api/v1/marketplaces/shopee/syncs` accepts:

```json
{
  "shopId": "<internal shop ObjectId>",
  "syncType": "reviews",
  "executionMode": "foreground",
  "input": { "maxReviews": 1000 }
}
```

`input.itemId` optionally selects an upstream listing. `maxReviews` accepts 1–1,000.
Reviews reject date bounds and `daysBack`. Queued and foreground execution share
the durable task engine; every invocation handles one page, renews its lease, and
persists a checkpoint before the next invocation. Public task responses expose
only checkpoint counters, not provider cursors or collected comment IDs.

Shopee's durable `all` graph is orders-and-escrow, products, ads, then reviews.
Reviews do not inherit the order date range. Optional stream failure hands off
to the following task using the delivery outbox; required failures still cancel
dependent work. Foreground work never creates queued deliveries.

The daily NAS Shopee `all` job automatically includes reviews after deployment.
A standalone review job is only needed for a different refresh cadence or listing
scope. New review text and edits are refreshed whenever returned in the available
window. Previously collected rows are retained when absent from that window;
absence is not deletion, and out-of-window edits are not guaranteed observable.

## Coverage

`ShopeeReviewCollection` records the latest run per `shop` or `product:<itemId>`
scope. It tracks pages, raw/unique counts, source run, provider pagination state,
limits, termination reason, safe errors, and observation/completion times.

- `collecting`: collection is still running; report coverage is `partial`.
- `observed`: available pages ended below a documented cap.
- `limited`: provider/documented/configured/page limits were reached.
- `partial`: pagination stalled, provider warning/error, or collection failure.
- `missing`: no collection exists for the requested scope.

Documentation describes differing 500/1,000 review limits. Live read-only probing
on 2026-10-24 returned exactly 1,000 unique reviews in ten pages with `more: false`.
An exhausted cursor at either documented boundary is still `limited`. At most
20 pages are attempted; repeated/missing cursors or no progress fail safely.
Every response retains `historyCompleteness: "unknown"`.

## Read API

All reads require `marketplace:read`, owner-scoped shop access, and rate limiting.
Starting/executing syncs requires `marketplace:sync`; foreground monitoring also
requires `marketplace:read`.

- `GET /api/v1/marketplaces/shopee/reviews`: paginated stored review list.
- `GET /api/v1/marketplaces/shopee/reviews/summary`: collected ratings and topics.
- `GET /api/v1/marketplaces/shopee/reviews/products`: top listing groups.
- `GET /api/v1/marketplaces/shopee/reviews/status`: storage/link/collection diagnostics.

Filters: required internal `shopId`; optional `itemId`, `rating`, `ratingMax`, literal
case-insensitive `search`, `hasText`, `unreplied`, `createdAfter`, and `createdBefore`.
Dates are whole-second RFC3339 instants and filter provider review creation time.
Records without source creation time do not match date bounds. `unreplied=true`
means no seller reply was returned, not proof of no actual reply. `hasText=false`
matches known blank text, not unavailable text.

Lists accept `limit` (1–100) and an opaque filter-bound `cursor`. Product rankings
accept `limit` and return `page.hasMore`; they are not cursor-paginated. Reports
retain nulls and coverage/freshness warnings. Summary averages use known ratings
only and describe the collected corpus, not Shopee's official store rating.

Summary topic analysis counts multilingual keyword mentions for quality,
packaging, delivery, value, and seller service in at most the latest 1,000 matching
text reviews. It reports sample size and limitation, and makes no sentiment claim.

## Verified snapshot (2026-10-24)

The development CLI against a local production backend build and the connected
shop's real database collected ten pages / 1,000 available reviews per run.
Later new arrivals brought the retained corpus to 1,004 distinct comment IDs;
records outside the latest 1,000 window remained available. An immediate repeat
updated 1,000 existing records and created zero duplicates. First-observed times
were preserved, every review linked to a product, and 1,003 linked to imported
orders (one remained available without its order).

This collected corpus had a 4.95 average from 1,004 known ratings, five 1–2-star
reviews, and 204 text reviews. Coverage remained `limited` / historical completeness
unknown. Stored pagination, low-rating and product filters, literal punctuation
search, product totals, private-field omission, table output, and strict-mode exit
behavior were checked through the actual CLI/API. No customer text or credentials
were emitted in the validation report.

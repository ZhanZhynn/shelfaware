# Marketplace reliability test baseline

Verified on 2026-10-21 against backend base commit `a866e90`.

## Run the tests

```sh
npm run test:marketplace
npm run test:marketplace:coverage
npm run test:marketplace:strict
```

The focused suite executes provider sync implementations with synthetic provider
fixtures and mocked database/HTTP boundaries. It also tests live/local adapters,
SKU aggregation, ownership, task leases, retry timing, queue delivery, and sync
log outcomes. These tests do not start a sync against a connected shop.

`tests/setup-unit.ts` prevents the real Prisma singleton from connecting during
test imports and blocks unmocked `fetch` calls. The after-test assertion catches
accidental boundary access even if application code swallows its error. Tests
that exercise these boundaries supply explicit mocks. A synthetic test-only JWT
secret avoids depending on environment values incidentally loaded by Prisma.

Coverage HTML and machine-readable reports are generated under
`coverage/marketplace/`. The directory is git-ignored. The exact measured source
scope is defined in `vitest.marketplace.config.ts`; it includes unexecuted files
as well as executed files, rather than reporting only imported happy paths.

## Measured improvement

The baseline was run from an isolated worktree of `a866e90`, using the same source
coverage scope and test runner dependencies, with the new gates disabled. It
contained 359 passing cases in 58 files. The expanded suite contains 727 cases in
75 files: 710 normal passes and 17 executed expected failures. That is 368 added
cases, including the explicitly tracked defects below.

| Coverage measure | Baseline | Expanded suite |
| --- | ---: | ---: |
| Statements | 55.48% | 82.69% |
| Branches | 48.21% | 72.21% |
| Functions | 63.18% | 83.47% |
| Lines | 58.15% | 86.53% |

| Implementation | Baseline lines | Expanded lines | Expanded branches | Expanded functions |
| --- | ---: | ---: | ---: | ---: |
| Shopee sync | 37.33% | 93.99% | 73.55% | 92.10% |
| Lazada sync | 62.88% | 93.55% | 77.85% | 98.33% |
| TikTok sync | 39.86% | 96.07% | 80.77% | 100% |
| Shopify sync | 50.60% | 98.78% | 88.61% | 95.65% |
| Lazada custom API | 49.31% | 98.63% | 92.88% | 100% |
| TikTok custom API | 75.40% | 100% | 81.69% | 100% |
| Shopify GraphQL client | 60.71% | 100% | 85% | 100% |
| Shared live adapters | 76.58% | 99.36% | 80% | 97.50% |
| Shared local catalog | 59.37% | 99.21% | 82.75% | 97.05% |
| Analytics server | 70.55% | 93.86% | 77.77% | 93.67% |
| Durable task/run engine | 59.41% | 97.05% | 87.50% | 95% |

Coverage includes expected-failure execution: it measures which code was
exercised, not whether the underlying defects have been fixed.

### Enforced gates

Each provider's `sync.ts` independently requires at least 90% lines, 90%
functions, 70% branches, and 85% statements. Separate gates cover both custom API
clients, Shopify GraphQL traversal, live/local adapters, the analytics server,
and the durable task engine. The shared retry and sync-log helpers require 100%
of all four measures. A well-tested provider cannot compensate for another
provider falling below its own gate.

## Behavior exercised

- Non-empty product and order ingestion, both create and update paths, source
  IDs, shop/owner isolation, actor attribution, and persistence error reporting.
- Provider list pagination, reordered detail groups, 50-ID batching, offset
  limits, missing continuation, and rejection of duplicate order/finance pages.
- TikTok search/detail SKU formats, warehouse stock aggregation, explicit zero
  values, image preservation, and unknown quantities.
- Shopify nested order-line retrieval through the top-level client, incomplete
  snapshot preservation, original versus current quantity, original versus
  discounted prices, exact decimal snapshots, and finance/refund deduplication.
- Lazada item-group omissions, source currencies, creation/update date filters,
  logistics amount shapes, source-calendar payout dates, and finance pagination.
- Shopee model attribution, product/model persistence, return windows and
  amounts, payout deduplication, ads chunking/metrics, retries, and lock cleanup.
- Actual retry execution with fake timers, exact attempt budgets, nonretryable
  failures, sync-log failure propagation, and lock release on errors.
- SKU aggregation for all four platforms, cancelled/failed exclusions, distinct
  weekly source-date scopes, unknown units, product pagination, and UTC trends.
- Lease renewal/loss, compare-and-set settlement races, retry exhaustion,
  dependent-task cancellation, bounded diagnostics, and durable outbox recovery.
- Actual Shopify query documents are parsed, instead of replacing every query
  with a mock label. A small documented schema projection reproduces the
  order-transaction list/connection mismatch; it is not a full Shopify schema.

## Executed known-defect regressions

The `knownGap` helper in `tests/helpers/known-gap.ts` runs these tests as Vitest
expected failures in normal mode. They are **not skipped**. An unexpected pass
fails the suite, prompting conversion to an ordinary `it` test after the fix.

Strict mode runs the same assertions as ordinary tests and currently exits
unsuccessfully for these 17 defects. This makes the difference between a passing
test baseline and a defect-free implementation explicit.

| Regression ID | Required invariant currently violated |
| --- | --- |
| `SHOPEE-PRODUCT-DETAILS` | Missing details must not erase known product facts. |
| `SHOPEE-ZERO-PRICE` | An explicit zero current price must not fall back to original price. |
| `SHOPEE-ORDER-DETAILS` | Missing order details must not overwrite a previously observed order. |
| `SHOPEE-RETURNS` | A failed return page must be reported as incomplete work. |
| `TIKTOK-DETAILS` | Silently omitted requested detail IDs must produce an error. |
| `TIKTOK-FRESHNESS` | Partial persistence must not advance successful shop freshness. |
| `TIKTOK-ATOMICITY` | Failed item replacement must preserve the previous item set. |
| `TIKTOK-SKU` | Missing/invalid price must not overwrite a known price with zero. |
| `LAZADA-GROUPS` | Duplicate bulk-response groups must be rejected before replacement. |
| `LAZADA-RETRY` | HTTP 429 must be retryable independently of envelope-code wording. |
| `LAZADA-PRODUCT-PAGING` | A non-advancing timestamp page must not be appended as new catalog data. |
| `SHOPIFY-FRESHNESS` | Incomplete retrieval must not advance successful shop freshness. |
| `SHOPIFY-SCHEMA` | Order transaction selections must match the documented list shape. |
| `SHOPIFY-CURSOR` | Repeated cursors must terminate within a bounded request budget. |
| `SHOPIFY-COVERAGE` | An order with incomplete items cannot be reported as ready. |
| `LIVE-SHOPEE-DETAILS` | Incomplete enrichment needs explicit coverage rather than apparent completeness. |
| `LIVE-TIKTOK-BOUNDARY` | The live query must include the requested inclusive upper second. |

## Verification and remaining coverage

- Focused coverage suite and its per-module gates pass.
- Strict regression mode reproduces exactly the 17 documented defects as
  ordinary assertion failures, rather than setup errors or timeouts.
- TypeScript check: `npx tsc --noEmit --incremental false` passes.
- ESLint on new/modified test and configuration files passes.
- Full `npm test`: 156 files pass; one existing file,
  `lib/react-query/invalidate-coverage.test.ts`, has 13 failures. The same 13
  failures reproduce on isolated untouched `a866e90`; they are not introduced by
  these tests. Full-run totals: 1,464 normal passes, 17 expected failures, and 13
  ordinary failures.

This is high unit coverage of the reviewed reliability surfaces, not complete
coverage of the application. The broad report intentionally retains gaps in
legacy analytics, profit-detail paths, and backfill logic. OAuth/UI code is not
part of this coverage gate.

Mocked Prisma transaction tests verify application transaction boundaries and
error handling. The stateful TikTok atomicity regression demonstrates the
current destructive behavior, but does not prove MongoDB rollback semantics.
Real replica-set transaction, distributed-concurrency, and provider-schema
integration checks are separate work. Provider fixtures establish the tested
normalization behavior; they do not invent missing upstream quantity semantics.

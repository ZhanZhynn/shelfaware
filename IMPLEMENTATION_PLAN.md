# Marketplace CLI Backend Implementation Plan

## Goal

Provide a versioned, machine-authenticated ShelfAware marketplace API for the `shelfaware` CLI.

The API must let authorized remote agents:

- Query local synchronized marketplace data.
- Query provider data live without persisting it.
- Start and monitor durable synchronization jobs.
- Query analytics, finance records, reconciliation readiness, and profit details.

ShelfAware remains the owner of MongoDB access, marketplace credentials, OAuth tokens, provider integrations, and synchronization workers. The CLI never accesses those resources directly.

## Decisions

- Keep the existing Next.js application as the backend; do not create a separate Go marketplace server.
- Add `/api/v1` routes instead of treating legacy platform routes as a public CLI contract.
- Support scoped bearer API tokens alongside existing browser session-cookie authentication.
- Use one canonical ShelfAware internal shop ID across all v1 routes.
- Default reads come from synchronized MongoDB data.
- Live reads call provider adapters without persisting data.
- Synchronization becomes an asynchronous, durable job.
- Analytics and finance reports remain local-data calculations; clients refresh before querying when freshness is required.

## Current Constraints

- Normal APIs authenticate through the browser `session_id` cookie in `utils/auth.ts`.
- Existing platform routes inconsistently use provider IDs, local Prisma IDs, and Lazada seller IDs.
- Most existing GET routes query Prisma/MongoDB and caches; they do not call providers live.
- Sync code runs within HTTP requests and uses process-local locks.
- Shopee, Lazada, TikTok, and Shopify clients maintain mutable module-global shop/seller context, making concurrent provider requests unsafe.
- Static analytics routes default to legacy response contracts unless clients supply `apiVersion=2026-analytics-v1`.

## Phase 1: Machine Authentication

### Data model

Add `ApiToken` to `prisma/schema.prisma`:

```text
id
userId
name
prefix
tokenHash
scopes
expiresAt
lastUsedAt
revokedAt
createdAt
```

Store only a secure hash of the plaintext token. Return the plaintext `swa_...` token once, when it is created.

### Authorization helpers

Add:

```text
lib/auth/api-token.ts
lib/auth/require-api-scope.ts
```

The principal resolver should accept either:

- A valid browser session, preserving web-app behavior.
- `Authorization: Bearer swa_...`, resolving an approved non-revoked user and token scopes.

Initial scopes:

```text
marketplace:read
marketplace:live
marketplace:sync
marketplace:finance
marketplace:pii
```

Requirements:

- Reuse existing marketplace ownership/data-scope checks for both sessions and tokens.
- Update `lastUsedAt` safely.
- Write token lifecycle and CLI mutation audit records.
- Rate-limit by authenticated token identity after authentication; do not trust caller-supplied `x-user-id`.
- Require `marketplace:pii` for buyer names, email, phone, or address fields. Redact those fields by default.

Acceptance criteria:

- Read tokens access only authorized shops.
- Read tokens cannot invoke live, sync, or finance writes.
- Expired and revoked tokens return `401`.
- A token cannot cross tenant/owner scope boundaries.

## Phase 2: Versioned API and Contracts

### API schemas and DTOs

Add:

```text
lib/marketplace/api/schemas.ts
lib/marketplace/api/contracts.ts
```

Define shared Zod request schemas and response DTOs for shops, orders, products, sync jobs, analytics, finance records, reconciliation, and errors.

Use a consistent response envelope:

```json
{
  "data": [],
  "page": { "nextCursor": null },
  "meta": {
    "platform": "shopee",
    "source": "local",
    "observedAt": "2026-09-26T12:00:00Z",
    "lastSyncedAt": "2026-09-26T11:59:00Z",
    "requestId": "req_..."
  }
}
```

Normalize order status while retaining the provider value:

```json
{
  "id": "internal-order-id",
  "providerOrderId": "external-order-id",
  "status": "ready_to_ship",
  "providerStatus": "READY_TO_SHIP"
}
```

Use the canonical ShelfAware internal `shopId` returned by v1 shop discovery. Provider IDs remain output fields, not v1 route selectors.

### Route surface

Add:

```text
GET  /api/v1/marketplaces/shops

GET  /api/v1/marketplaces/{platform}/orders
GET  /api/v1/marketplaces/{platform}/orders/{id}
GET  /api/v1/marketplaces/{platform}/products
GET  /api/v1/marketplaces/{platform}/products/{id}

GET  /api/v1/marketplaces/{platform}/analytics/{metric}

GET  /api/v1/marketplaces/{platform}/financial-records
GET  /api/v1/marketplaces/{platform}/reconciliation-status
GET  /api/v1/marketplaces/{platform}/profit
```

Platforms:

```text
shopee
lazada
tiktok
shopify
```

Metrics:

```text
summary
revenue-trend
products
buyers
clv
profit
```

Use uniform local query filters:

```text
shopId
status
from
to
limit
cursor
```

### Query services

Extract shared local query services:

```text
lib/marketplace/query/shops.ts
lib/marketplace/query/orders.ts
lib/marketplace/query/products.ts
lib/marketplace/query/analytics.ts
lib/marketplace/query/finance.ts
```

Migrate existing web platform routes and AI tools to these services where behavior is equivalent. This prevents distinct Prisma queries, cache keys, authorization behavior, and DTOs for the same resource.

Adapt existing v1 analytics calculation code in `lib/marketplace/analytics/`; do not create a second analytics implementation.

Acceptance criteria:

- New local routes never invoke a provider client.
- Equivalent legacy and v1 reads share query/access logic.
- All invalid filters produce structured `400` errors.
- Existing web routes remain compatible.

## Phase 3: Provider Adapters and Live Reads

### Provider adapters

Create:

```text
lib/marketplace/providers/types.ts
lib/marketplace/providers/shopee.ts
lib/marketplace/providers/lazada.ts
lib/marketplace/providers/tiktok.ts
lib/marketplace/providers/shopify.ts
```

The common behavior should support:

```text
listOrders(context, shop, filters)
getOrder(context, shop, providerOrderId)
listProducts(context, shop, filters)
getProduct(context, shop, providerProductId)
sync(context, shop, stream, window)
```

Separate three concerns currently interleaved in sync implementations:

1. Provider requests and pagination.
2. Provider payload mapping and canonical DTO normalization.
3. MongoDB persistence, sync logs, attribution, and cache invalidation.

### Remove global provider context

Replace module-global active shop/seller state in:

```text
lib/shopee/server.ts
lib/lazada/server.ts
lib/tiktok/server.ts
lib/shopify/server.ts
```

with per-shop client instances. Each adapter receives the selected connection/token explicitly. A request for one shop must never be able to use another shop's token or regional endpoint.

### Live routes

Add:

```text
GET /api/v1/marketplaces/{platform}/live/orders
GET /api/v1/marketplaces/{platform}/live/orders/{providerOrderId}
GET /api/v1/marketplaces/{platform}/live/products
GET /api/v1/marketplaces/{platform}/live/products/{providerProductId}
```

Live routes require `marketplace:live`, enforce shop ownership, apply provider-supported filters only, and return `meta.source = "live"`.

They must not create sync logs, write MongoDB, trigger attribution, or invalidate caches.

Add bounded pagination, request timeouts, safe retry behavior for idempotent reads, provider rate-limit handling, and provider error-to-API-error mapping.

Acceptance criteria:

- Concurrent requests for different shops remain token/endpoint isolated.
- Live requests do not mutate MongoDB.
- All providers return normalized DTOs.
- Unsupported provider filters return a structured `400` instead of being silently ignored.

## Phase 4: Durable Sync Jobs

### Data model

Add `MarketplaceSyncJob` to `prisma/schema.prisma`:

```text
id
platform
shopId
stream
requestedByUserId
requestId
idempotencyKey
status
leaseOwner
leaseExpiresAt
startedAt
completedAt
progress
result
error
createdAt
updatedAt
```

Statuses:

```text
queued
running
succeeded
failed
cancelled
```

### Job routes

Add:

```text
POST /api/v1/marketplaces/{platform}/syncs
GET  /api/v1/marketplaces/{platform}/syncs/{id}
```

Creating a job requires `marketplace:sync` and returns `202 Accepted`. The request must include an idempotency key. Job status must not be cached while the job is queued or running.

### Worker

Add a job service that atomically:

- Creates jobs.
- Resolves idempotency requests.
- Claims and renews database-backed leases.
- Persists progress, results, and safe error details.
- Recovers jobs after expired leases.

Use QStash to trigger worker execution initially. MongoDB remains authoritative for job state, leases, and idempotency. The worker invokes provider adapters and persistence services.

Migrate scheduled cron work to enqueue jobs instead of executing all provider syncs in the request path. Keep existing sync routes temporarily while the web UI migrates.

Acceptance criteria:

- Repeated idempotent requests return the same job.
- Jobs cannot execute twice across application instances.
- Failed worker leases can be recovered safely.
- Job polling exposes all statuses and progress.

## Phase 5: Correctness and Security Fixes

Resolve the following as part of the extraction work:

1. Normalize Shopee order statuses before near-SLA and canonical status filtering; current casing is inconsistent.
2. Validate date values, thresholds, page limits, and cursors with Zod. Reject invalid dates rather than sending invalid `Date` objects to Prisma.
3. Fix existing Shopee routes that use provider numeric `shopId` as a string.
4. Fix Lazada and TikTok cache keys that omit `createdAfter`.
5. Do not return raw provider or database error messages to callers. Use stable public error codes and log causes server-side.
6. Invalidate analytics caches after reconciliation and finance-record mutations.
7. Make Shopify `all` sync semantics explicit: include finance or rename/document the products-and-orders behavior.
8. Store OAuth state durably and validate it for every platform. In particular, replace Shopify's process-local state map and implement generated/stored/verified state for Shopee and Lazada.
9. Apply one shared shop-access helper to all v1 routes.
10. Verify token lengths before `timingSafeEqual` for cron/service secret checks.

## Documentation and Tests

Update `lib/api/openapi-spec.ts` with v1 marketplace paths, bearer authentication, request schemas, response schemas, errors, scopes, cursor pagination, and source semantics.

Add tests for:

- Token scope enforcement, expiry, and revocation.
- Tenant/shop data isolation.
- PII redaction.
- Local routes avoiding provider clients.
- Live routes avoiding MongoDB writes.
- Provider DTO normalization.
- Live adapter pagination/rate-limit/error mapping.
- Sync job idempotency, leases, retry, cancellation, and recovery.
- Refresh followed by a local query.
- Legacy web API compatibility after service extraction.

Run after each phase:

```bash
npm test
npm run lint
npm run build
```

## Delivery Order

1. API-token model and authorization helpers.
2. Canonical v1 shop discovery and local query services/routes.
3. Versioned analytics and finance routes.
4. Provider adapter extraction and removal of global provider context.
5. Live order/product routes.
6. Durable synchronization jobs and worker triggering.
7. OAuth, validation, cache, reconciliation, and error-handling fixes.
8. OpenAPI, integration/contract tests, and web-route migration.

The CLI can begin its supported implementation after steps 1 and 2. `--live` depends on step 5. `--refresh` depends on step 6.

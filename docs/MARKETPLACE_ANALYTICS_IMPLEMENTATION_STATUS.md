# Marketplace Analytics Safe Foundation Status

## Completed Safe Phases

- Containment: unknown, legacy-defaulted, malformed, and unverified financial
  values remain unavailable rather than becoming zero; mixed source currencies
  are rejected.
- Operational analytics: shared authenticated, shop-scoped analytics contracts,
  operational dashboards, filters, pagination, coverage/capability states, and
  cache invalidation are in place for Shopee, Lazada, TikTok Shop, and Shopify.
- Foundation plumbing: additive Prisma provenance, quality, capability,
  readiness, reconciliation, backfill, audit, redaction, and rollout structures
  are in place. Finance/refund/settlement backfill remains blocked.
- Safety and operations: legacy routes delegate to the shared contract, buyer
  labels remain masked, raw payload handling is redacted, and operator runbooks
  describe safe backfill, invalidation, rollback, and reconciliation handling.

## Verification

- `npm test`: passed, 65 files and 599 tests.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- Targeted lint and `git diff --check`: passed.

Full TypeScript verification is currently blocked by the installed dependency
state: `@playwright/test` is missing from installed dependencies, which affects
unchanged e2e files and Playwright configuration. This is not a marketplace
analytics type failure; install the declared development dependencies before
re-running the full TypeScript check.

## Financial Rollout Gates

Financial reporting is intentionally disabled and unavailable by design. It
must remain so until all applicable platform, region, and shop gates are met:

- Platform field semantics, authorized scopes, and redacted fixtures verify
  currency, units, signs, lifecycle, and regional/account behavior.
- An approved FX source, dated-rate, base/quote, rounding, and restatement
  policy exists before any conversion or cross-currency aggregation.
- Official marketplace statements/reports reconcile at the required order and
  daily levels, with an approved reviewer decision and tolerance policy.
- Product and security approve access scope, buyer-data handling, exports, and
  financial presentation.
- Predictive CLV has approved labels and data-sufficiency rules plus temporal
  holdout validation that meets the approved threshold.
- A production duplicate external-order-ID audit is complete and a scoped-index
  migration, rollback plan, and deployment are explicitly approved.

Until these gates pass, financial fields remain unknown or partial as applicable;
no financial aggregate, profit, settlement, finance/refund backfill, financial
export, or predictive CLV is enabled.

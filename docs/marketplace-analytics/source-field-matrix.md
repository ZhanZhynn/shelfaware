# Marketplace Analytics Source Field Matrix

This first containment tranche does not certify any marketplace financial field.
All listed financial values are retained only as raw/source-compatible data and
are excluded from public financial totals until a redacted authorized fixture,
scope, units, signs, currency, and lifecycle behavior are recorded.

| Platform | Existing source | Field/path | Current treatment | Blocker |
| --- | --- | --- | --- | --- |
| Shopee | escrow detail | `order_income.*` | Presence-aware nullable raw values; quality `unknown` | Finality, signs, shipping semantics, fixture |
| Lazada | order items | row multiplicity | `quantity: null` | Proof that a row is one unit or documented quantity field |
| TikTok | order detail | line price/quantity/tax/refund | quantity/subtotal/tax/refund null; prices only raw | Field mapping, bundle semantics, Finance scope/fixture |
| Shopify | current orders query | original gross totals | legacy-unverified, excluded | Pinned current/refund/transaction fields and scopes |

`verified` is reserved for a field mapping backed by authorized fixture evidence.
`derived` is reserved for a documented formula over certified operands.
`legacy-unverified` and `unknown` never enter financial totals. Explicit numeric
source zero is retained only when supplied by the source parser with provenance.

## Structural Observability

The read-only `scripts/marketplace-analytics/audit-legacy-data.ts` report records
full duplicate collision groups (rather than only counts), financial-quality
coverage, and capability/backfill state counts by platform. It does not merge
collisions, promote quality, or infer source semantics. Capability records start
as `unknown`; no scope string or successful order sync is treated as finance,
refund, or settlement evidence. Backfill stream records are orchestration state
only until an authorized, fixture-validated adapter is explicitly enabled.

## Deferred Duplicate Constraint Migration

The existing global external-order unique constraints are intentionally unchanged.
Replacing them with shop-scoped uniques is blocked until a production duplicate
audit and rollback approval are complete. The additive shop/external-ID indexes
support that audit; they are not approval to migrate or merge duplicate orders.

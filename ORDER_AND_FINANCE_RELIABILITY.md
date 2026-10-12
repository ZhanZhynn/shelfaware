# Order And Finance Reliability

## Goal

Make marketplace data safe to use for operational reporting: live reads are
fresh and explicitly partial where necessary, while local financial reporting
never represents missing or unverified data as zero revenue or profit.

## Data Contract

- Every live response identifies its `source`, `asOf`, and provider state.
- Live Shopee order responses include gross order amounts when supplied by the
  provider. Settlement values remain distinct because they become available
  only through escrow details after the provider makes them available.
- Financial reports include coverage and freshness metadata. A requested range
  with no usable financial evidence is unavailable, not zero.
- Unknown or unverified ledger values stay visible in records but are excluded
  from calculated net financial totals.

## Delivery

1. Add provider-aware live error diagnostics, including retryability and
   remediation, without leaking raw provider responses.
2. Return normalized Shopee live financial fields and settlement availability.
3. Expose finance coverage, last-observed data, and missing-data reasons.
4. Return required API token scopes with finance authorization failures and
   display profile/API context in the CLI.
5. Add opt-in cursor traversal through `--all` for reporting exports.
6. Add regression tests for pagination, finance authorization, coverage, and
   live-order financial mapping.

## Source Semantics

`live` data is provider-read, non-persistent, and may be incomplete for a
provider's settlement lifecycle. `local` data is persisted and can be audited;
its response coverage describes whether it is recent and sufficiently complete
for the requested financial calculation.

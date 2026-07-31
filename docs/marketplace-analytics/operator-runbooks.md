# Marketplace Analytics Operator Runbooks

## Reconnect and capability diagnosis

Confirm the affected shop is visible to the authorized Admin, reconnect through the platform's existing OAuth flow, then inspect `GET /api/marketplace/analytics/capabilities?platform=...&shopId=...`. A scope string or successful sync is not evidence that finance, refunds, or settlements are available. Do not set capability state or financial readiness manually.

## Safe order backfill

Only request the `orders` stream through `POST /api/marketplace/analytics/backfill`. Use a bounded UTC date window. Inspect status with `GET` on the same route. Cancel a pending/running job with `action: cancel`; retry only an interrupted, failed, or cancelled operational job. Finance, refund, and settlement streams are intentionally blocked.

## Cache invalidation failure

Do not report a write as complete until its existing invalidation path completes. If invalidation fails, record a redacted operational event, use the existing marketplace cache purge mechanism for the affected platform, and verify a fresh operational request. Never place payloads, credentials, buyer data, or external IDs in incident notes.

## Disablement and rollback

Disable the per-connection financial display rollout setting. This hides finance navigation only; operational analytics and persisted provenance remain available. Do not delete records as a rollback action.

## Reconciliation remediation

Financial readiness requires authorized official evidence, an approved reviewer decision, and an unexpired record. Investigate external-report deltas outside this application. Do not create an approved reconciliation merely to restore a panel.

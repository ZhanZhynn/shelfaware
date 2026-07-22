# Remaining Work

## SLA And Escalation

- [ ] Add workspace-configurable SLA rules for first response, quote submission, approval, and shipment.
- [ ] Add workspace business hours and timezone handling for due-date calculations.
- [ ] Add escalation recipients and escalation thresholds for overdue cases.
- [ ] Add SLA performance reporting: on-time rate, breach counts, and time waiting by owner.

## Currency Completeness

- [ ] Replace secondary UI-local `$` formatters with `formatMoney` and explicit currencies.
- [ ] Persist currency on remaining marketplace product, fee, ad, and historical record types where upstream data provides it.
- [ ] Add historical-rate selection for date-based marketplace/reporting conversion.
- [ ] Add a reconciliation report for records excluded from MYR aggregates because their currency is unknown.
- [ ] Review fixed shipping, discount, and tax rules to ensure their numeric thresholds are explicitly MYR-denominated.

## Test Coverage

- [ ] Add Playwright browser coverage for sourcing request, multi-offer comparison, approval, PO creation, shipment, and receipt.
- [ ] Add browser coverage for comments, mentions, attachments, notifications, and SLA reminders.
- [ ] Add payment integration coverage for MYR checkout and webhook currency/amount validation.
- [ ] Add MongoDB integration coverage for sourcing transactions, concurrent edits, and receipt idempotency.
- [ ] Resolve existing repository-wide invalidation coverage and unrelated TypeScript test failures so the full test suite passes.

## Production Rollout

- [ ] Deploy the committed sourcing, currency, and reporting changes.
- [ ] Verify Vercel cron execution for exchange-rate refresh and sourcing reminders.
- [ ] Verify email queue delivery, preference enforcement, and absolute notification links in production.
- [ ] Run a production smoke test for sourcing, currency conversion, PO receipt, and supplier evaluation workflows.
- [ ] Monitor unknown-currency reporting and complete marketplace currency backfills before relying on combined totals.

# Marketplace sync jobs

`MarketplaceSyncJob` durably records and leases requested v1 marketplace syncs.
The create and status endpoints intentionally **do not execute providers or
enqueue QStash work**. Current provider clients retain mutable module-global
shop context, so concurrent workers could cross shop credentials.

TODO: after provider clients are per-shop instances, add a worker trigger that
claims the database lease, renews it around bounded provider calls, and uses
`completeMarketplaceSyncJob` or `retryMarketplaceSyncJob` to persist outcome.

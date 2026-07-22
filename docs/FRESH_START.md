# Fresh Start and Resync Runbook

This is an operator-only procedure. It never drops a database, changes indexes, calls marketplace APIs, or deletes ImageKit files. Stop application writes, workers, webhooks, and every marketplace cron before starting. Verify a restorable database backup and keep the restore procedure/operator available before any non-dry-run command. The sole exception is the explicitly guarded local/dev marketplace clear described below.

## Target policy

Both commands print a normalized, credential-free target such as `mongodb://localhost:27017/shelfaware`. Passwords, query parameters, and connection credentials are never printed or used in confirmations.

Only loopback MongoDB hosts (`localhost`, `127.0.0.1`, or `::1`) and explicitly marked development/test invocations (`FRESH_START_TARGET=development` with `NODE_ENV=development` or `test`) may use the non-production confirmations. Every other target, including an unknown target, fails closed and requires production-specific confirmations containing the exact displayed target and database. Start with dry run; it requires no confirmation and changes nothing.

## Ordered procedure

1. Quiesce app writes: disable cron/workers, pause marketplace webhooks/sync jobs, and stop user/admin writes. Take and verify a backup. A reset cannot substitute for a backup restore.
2. If the schema changed, inspect the target first, then run `npm run prisma:push` interactively against that exact target. `prisma db push` can make destructive schema changes; do not use `--accept-data-loss`. After it succeeds, run `npm run prisma:generate`.
3. Inspect the reset scope: `npm run fresh-start:reset -- --dry-run`.
4. Run the guarded transactional reset. It refuses standalone/non-transaction-capable MongoDB deployments; configure a replica set or sharded cluster and retry rather than attempting partial deletes.
5. Inspect bootstrap: `BOOTSTRAP_ADMIN_EMAIL=jun@example.com BOOTSTRAP_WORKSPACE_NAME="Jun Workspace" npm run fresh-start:bootstrap -- --dry-run`.
6. Run guarded bootstrap, configure operational data, then resync through the authenticated UI.
7. Re-enable writes, jobs, and webhooks only after smoke testing. If recovery is needed, restore the verified backup before resuming writes.

## Reset

Reset deletes application business data transactionally, including workspace, sourcing, inventory, purchase, sale, support, audit, and operational records. It preserves accounts, settings, connected shops/tokens, and **all marketplace product/order/return/ads snapshots and sync logs**. This is the safer default: current marketplace syncs do not promise a truthful complete historical replay. Because snapshots are retained, shop `lastSyncedAt` and other operational sync state are also retained.

For a recognized local/dev target, replace the displayed target below exactly:

```bash
ALLOW_RESET=yes \
RESET_CONFIRMATION='RESET:mongodb://localhost:27017/shelfaware:shelfaware' \
DATA_RESET_BACKUP_ACKNOWLEDGEMENT='BACKUP_VERIFIED:mongodb://localhost:27017/shelfaware' \
DATA_RESET_MAINTENANCE_ACKNOWLEDGEMENT='MAINTENANCE_QUIESCED:mongodb://localhost:27017/shelfaware' \
npm run fresh-start:reset
```

For an unknown or production target, use the production-specific form. Do not place these values in shared deployment configuration:

```bash
ALLOW_PRODUCTION_RESET=yes \
PRODUCTION_RESET_CONFIRMATION='RESET_PRODUCTION:mongodb+srv://cluster.example.com/shelfaware:shelfaware' \
DATA_RESET_BACKUP_ACKNOWLEDGEMENT='BACKUP_VERIFIED:mongodb+srv://cluster.example.com/shelfaware' \
DATA_RESET_MAINTENANCE_ACKNOWLEDGEMENT='MAINTENANCE_QUIESCED:mongodb+srv://cluster.example.com/shelfaware' \
npm run fresh-start:reset
```

The backup acknowledgement means a backup was completed and restore-verified, not merely scheduled. The maintenance acknowledgement means all application, cron, worker, webhook, and external write paths are quiesced. Partial supplier/category deletion commands have been retired so package scripts cannot bypass these safeguards. The retired `script:delete-all-data` remains non-destructive.

## Full Marketplace Snapshot Clear

`--include-marketplace` additionally deletes all marketplace snapshots in the same transaction: Shopee products, variants, orders/items, returns, both ads series, and sync logs; Lazada, TikTok, and Shopify products, variants, and orders/items; and generic multi-channel `SyncLog` records. It retains connected `ShopeeShop`, `LazadaShop`, `TikTokShop`, and `ShopifyShop` credential/configuration records, but clears each retained shop's `lastSyncedAt` value so the next sync is not treated as current. There are no Lazada, TikTok, or Shopify return collections in the current schema.

Always inspect the exact delete and sync-state-clear counts first:

```bash
npm run fresh-start:reset-marketplace -- --dry-run
```

For a recognized local/dev target, a backed-up full clear additionally needs the target-bound marketplace confirmation:

```bash
ALLOW_RESET=yes \
RESET_CONFIRMATION='RESET:mongodb://localhost:27017/shelfaware:shelfaware' \
DATA_RESET_BACKUP_ACKNOWLEDGEMENT='BACKUP_VERIFIED:mongodb://localhost:27017/shelfaware' \
DATA_RESET_MAINTENANCE_ACKNOWLEDGEMENT='MAINTENANCE_QUIESCED:mongodb://localhost:27017/shelfaware' \
MARKETPLACE_RESET_CONFIRMATION='RESET_MARKETPLACE:mongodb://localhost:27017/shelfaware' \
npm run fresh-start:reset-marketplace
```

For an explicitly authorized irreversible no-backup local/dev clear, replace the backup acknowledgement with the distinct exact confirmation below. This path is rejected for production, Vercel production, and every unknown/remote target, even if other production reset confirmations are present:

```bash
ALLOW_RESET=yes \
RESET_CONFIRMATION='RESET:mongodb://localhost:27017/shelfaware:shelfaware' \
DATA_RESET_IRREVERSIBLE_NO_BACKUP_CONFIRMATION='IRREVERSIBLE_NO_BACKUP:mongodb://localhost:27017/shelfaware' \
DATA_RESET_MAINTENANCE_ACKNOWLEDGEMENT='MAINTENANCE_QUIESCED:mongodb://localhost:27017/shelfaware' \
MARKETPLACE_RESET_CONFIRMATION='RESET_MARKETPLACE:mongodb://localhost:27017/shelfaware' \
npm run fresh-start:reset-marketplace
```

## Bootstrap

Bootstrap requires an existing account, promotes it to application `admin`, creates/reuses the named workspace owned by that account, and upserts its admin membership. It never creates accounts. Supplying both `BOOTSTRAP_ADMIN_ID` and `BOOTSTRAP_ADMIN_EMAIL` is allowed only when they identify the same account; conflicting values are rejected.

For a local/dev target, the confirmation explicitly binds the target, resolved account ID, and workspace name. Obtain the ID from bootstrap dry run and use it exactly:

```bash
BOOTSTRAP_ADMIN_EMAIL=jun@example.com \
BOOTSTRAP_WORKSPACE_NAME="Jun Workspace" \
ALLOW_BOOTSTRAP=yes \
BOOTSTRAP_CONFIRMATION='BOOTSTRAP:mongodb://localhost:27017/shelfaware:<jun-account-id>:Jun Workspace' \
npm run fresh-start:bootstrap
```

Unknown/production targets require `ALLOW_PRODUCTION_BOOTSTRAP=yes` and `PRODUCTION_BOOTSTRAP_CONFIRMATION='BOOTSTRAP_PRODUCTION:<displayed-target>:<jun-account-id>:<workspace-name>'`. Optional comma-separated `BOOTSTRAP_MEMBER_EMAILS` and `BOOTSTRAP_MEMBER_IDS` add existing accounts only. Set `BOOTSTRAP_MEMBER_ROLE` to `admin`, `sourcer`, `warehouse`, or `viewer`.

## Marketplace Resync and Files

Use the authenticated UI after verifying each retained connection: Shopee `POST /api/shopee/sync`, Lazada `POST /api/lazada/sync`, TikTok `POST /api/tiktok/sync`, and Shopify `POST /api/shopify/sync`. Do not use cron endpoints for reset recovery. Historical marketplace snapshots are retained, so this procedure does not claim to reconstruct full history.

The database reset intentionally does not delete ImageKit assets. Deleted database references can leave orphaned ImageKit product and QR assets. Inventory and remove those assets through an approved, separately reviewed ImageKit cleanup procedure only after the backup retention window; never bulk-delete an ImageKit folder as part of this runbook.

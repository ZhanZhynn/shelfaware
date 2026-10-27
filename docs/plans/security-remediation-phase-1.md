# Security Remediation — Phase 1 Rollout

Status: code implemented and locally verified; production rotation,
account review, and deployed smoke checks pending.

## Implemented

- Runtime startup rejects missing/placeholder/short `JWT_SECRET`, weak configured
  `CRON_SECRET`, `MARKETPLACE_SYNC_WORKER_SECRET` or `INTERNAL_API_KEY`, and
  reuse among them. Each configured value must have at least 32 characters and
  no leading/trailing whitespace. An unset optional service secret disables its
  service as before; an explicitly empty value is rejected. Error messages name
  the variable but do not expose its value.
- Session signing and verification re-read and validate the runtime JWT secret.
  Rotating the signing secret invalidates prior JWTs; it does **not** revoke
  database-backed `swa_` API tokens.
- The real Next.js production-build phase can use the Docker build-only
  placeholder; signing/verification has no build bypass. At runtime an
  instrumentation failure rejects requests, though Next.js may leave its process
  running and print a `Ready` line. Docker Compose now uses a local, no-redirect
  `/api/auth/session` probe that expects 401; a failed runtime reports unhealthy.
- Central redaction removes recognizable credential fields, auth headers,
  provider URLs/query credentials, request/response bodies, raw SDK configs and
  nested values. Traversal is bounded, detached, cycle-safe, avoids getters and
  omits unrecognized class instances. Sentry event, breadcrumb, transaction,
  span, log and metric hooks share the policy. SDK automatic collection of raw
  HTTP cookies/bodies/query parameters, DB parameters and AI content is disabled;
  HTTP headers are restricted to a small allowlist. Replay custom events are
  scrubbed separately; replay input/text, URL-bearing attributes, media, and
  network body capture are masked or disabled. Console warning/error capture
  remains enabled with the same send-time scrubbing. Custom raw Sentry integrations/attachments and direct
  native console writes are not generally covered by the application logger;
  review any new telemetry surface before enabling it.
- `@sentry/nextjs` is updated to 10.76.2. No `@sentry/*` package is currently
  reported by `npm audit --omit=dev`; other advisories remain for later phases.
- All four `*demo*` CLIs require an explicit **local fixture** `DEMO_DATABASE_URL`
  named `shelfaware_demo`, `shelfaware_test`, or one of their suffixed fixture
  databases, plus `NODE_ENV=development|test`. They reject Vercel environments,
  remote MongoDB hosts, missing fixture configuration and production mode before
  creating a database client. They never fall back to `DATABASE_URL`.
- Demo passwords are supplied via `DEMO_CLIENT_PASSWORD`,
  `DEMO_SUPPLIER_PASSWORD` or `DEMO_USER_PASSWORD` as needed, are not printed,
  and must be 16+ characters and no more than bcrypt's 72-byte limit. Demo-user
  role changes require an explicit `--to` argument; `admin` is no longer the
  default. Supplier fixture operations no longer reassign the first supplier.

The local-target guard prevents accidental remote database selection; do not
point a localhost tunnel/proxy at a real database while running fixture scripts.

## Local verification

- The targeted security, Sentry transport/tunnel, demo CLI, cron, worker and API
  token tests pass. Tests use synthetic values, mocked external services and a
  local in-memory Sentry transport; no production credentials or provider calls.
- A clean Node 22 build with Docker's build-only placeholder succeeds in an
  isolated snapshot without project `.env` files. Standalone checks confirm an
  unsafe JWT, reused JWT/cron key, and missing JWT return HTTP 500, while an
  independent-key configuration serves login, rejects a cron-signed JWT, and
  authenticates an empty worker request without dispatching a job.
- TypeScript, changed-file lint, and `docker compose config --quiet` pass.
  Building/running the actual Docker image remains blocked by local Docker socket
  permissions. Production secret rotation and account checks have not been run.
- The full unit suite still reports the 13 previously documented
  cache-invalidation failures and 16 expected known-gap tests; Phase 0 tracked
  those on the original baseline. Full release gates remain unresolved.

## Deployment sequence

1. Inventory each production deployment and scheduler/worker/internal caller.
   Privately compare their configured values. Do not print secrets into terminals
   shared with logs, PRs, monitoring events or shell history.
2. Generate a **distinct, random** value for the JWT and each configured bearer
   service credential. Update every runtime and caller together. Coordinate
   mixed-instance deployments: an instance with the old reused or weak secret
   cannot serve after this validation is deployed. Do not temporarily disable
   validation or fall back to an old shared secret.
3. Deploy the build with the prepared runtime secrets. Docker's build placeholder
   is not a valid runtime credential. Check health through a local, no-follow
   `/api/auth/session` request: the unauthenticated response should be 401, not a
   redirect, 500, or a successful response from another host. Verify the actual
   deployed SHA and Sentry SDK version. Cloud/platform readiness probes should
   likewise avoid following redirects and assert an expected status.
4. Confirm the rotated JWT invalidates prior browser sessions and legitimate
   users can sign in. Confirm new scheduler/worker credentials work and old
   credentials are rejected, using non-mutating checks or a staging environment.
   Coordinate any QStash-related secret updates separately.
5. Privately review demo accounts and approved global admins in production.
   Disable/reject unintended accounts and revoke their API tokens using the
   approved administrative procedure. Do not run demo fixture tools against
   production; removing their known passwords from source does not disable users
   already in the database.
6. Review historical telemetry privately for credentials. Revoke/rotate any
   confirmed exposed marketplace tokens or app secrets and reconnect affected
   shops as required. The audit's vendor-documentation examples alone do not
   establish exposure of a live credential.
7. Send a synthetic, secret-free monitoring event through the configured tunnel
   and inspect the captured event. Verify expected labels/request IDs remain and
   raw credentials/HTTP payloads do not appear. Existing Sentry data retention,
   transaction metrics and intentionally excluded body/query data may differ.

Do not treat the Sentry scrubber as proof that no secret has ever left the app:
it cannot retroactively sanitize already stored events or every future custom
integration.

## Local fixture usage

Configure a private local shell with the following variable **names**; do not put
real fixture passwords in command arguments or committed files:

```text
NODE_ENV=development
DEMO_DATABASE_URL=mongodb://127.0.0.1:27017/shelfaware_demo
DEMO_CLIENT_PASSWORD=<private fixture password>
DEMO_SUPPLIER_PASSWORD=<private fixture password>
DEMO_USER_PASSWORD=<private fixture password>
```

Run `npx tsx scripts/create-demo-accounts.ts`,
`npx tsx scripts/verify-demo-accounts.ts`, or an explicit
`npx tsx scripts/update-demo-user.ts --to supplier`. Admin selection is permitted
only as an explicit local fixture operation. Protect shell history and inherited
environment variables; the scripts do not display the passwords.

## Rollback

If a deployment fails, correct the independent runtime secrets and deploy the
fixed build. Do not roll back to the shared JWT/cron value or restore default
demo admin credentials. Retaining the newly generated JWT invalidates old sessions
until users sign in again. Preserve separate service secrets and update callers
consistently; do not repeat token rotation without tracking every dependent caller.

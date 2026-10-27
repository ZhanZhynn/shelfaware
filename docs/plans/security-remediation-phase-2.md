# Security Remediation — Phase 2

Status: implemented and locally verified. No production secrets,
database indexes, marketplace permissions, or deployments have been changed.

## Changes

- Browser login, registration, and API-token creation require an exact configured
  Origin and JSON Content-Type. Logout, token revocation, user administration and
  shop disconnection require trusted Origin. Cookie-authenticated write handlers
  using `getSessionFromRequest` apply the same Origin boundary. Bearer-token
  clients continue to authenticate using their scoped token, without a browser
  Origin requirement.
- Approved admins initiate all four marketplace connections from a confirmation
  page on the configured callback host. The page displays the current account.
  Cross-host users must sign in on that host; the validated return path survives
  password and Google login, including the localhost-behind-tunnel case. Auth
  initiation is a JSON POST on that host; legacy GET auth endpoints now return
  the confirmation-page URL rather than issuing provider authorization directly.
- MongoDB `MarketplaceOAuthAttempt` documents contain only hashes of random state
  and browser challenge, user/provider/callback binding, optional Shopify domain,
  expiry and consumption metadata. A host-only HttpOnly/SameSite=Lax cookie binds
  the initiating browser. The callback rechecks user approval, validates provider,
  browser, target and expiry, then claims the attempt atomically before code
  exchange. Attempts expire after ten minutes; expired records are removed during
  later initiation. Each attempt is single-use, including failed exchanges.
- Login limits include trusted-client and normalized account buckets. Redis uses
  an atomic Lua script; strict requests mirror a bounded local budget for missing,
  failed or timed-out Redis. The in-process fallback is **per instance**, not a
  distributed protection mechanism. Active blocked identities are never evicted
  to make room. Unknown client IPs share a conservative bucket.
- Limiter identities are hashed before storage. Neither raw `x-user-id` nor
  untrusted forwarding headers choose a limiter key. HTTP 429 includes Retry-After.

## Required configuration and rollout

1. Inventory every real browser origin. `NEXT_PUBLIC_APP_URL`,
   `NEXT_PUBLIC_API_URL`, `AUTH_URL`, `NEXTAUTH_URL`, and the valid provider
   callback origins are trusted. Add secondary exact HTTPS origins through the
   comma-separated `APP_TRUSTED_ORIGINS`. Host / forwarded-host request headers
   are never used as the trust source. In a Vercel preview, the platform-provided
   `VERCEL_URL` is trusted for that preview only. Local development includes
   `http://localhost:3000` and `http://127.0.0.1:3000`; other development ports
   must be explicitly listed.
2. Set each `<PLATFORM>_REDIRECT_URL` to the exact canonical callback path
   (`/api/shopee/callback`, `/api/lazada/callback`, `/api/tiktok/callback`,
   `/api/shopify/callback`) on an HTTPS application host. Configure each provider
   console to accept that callback. Each callback host must serve this app and
   allow admins to sign in there. Existing in-flight authorization attempts cannot
   be resumed across the release and must be restarted.
3. Create the additive indexes **before** deploying code that uses the new
   model. With the deployment's MongoDB environment loaded securely, run:

   ```bash
   npx tsx scripts/create-marketplace-oauth-indexes.ts
   ```

   This creates indexes only on `MarketplaceOAuthAttempt`, including the unique
   `stateHash` index. Verify the output and index names. It does not migrate or
   encrypt stored marketplace tokens. The Prisma client is regenerated at build.
4. Choose the client-IP trust boundary. Vercel is auto-detected and uses the
   platform-overwritten `x-forwarded-for`; if a Vercel trusted-proxy feature is
   enabled, validate its upstream trust configuration as well. For Cloudflare, set
   `TRUSTED_PROXY_PROVIDER=cloudflare` **only if all traffic is forced through an
   ingress that overwrites `CF-Connecting-IP`**, with the origin port inaccessible
   directly. Otherwise leave it unset or `none`, which uses a shared fallback key
   and may throttle unrelated users together. Verify proxy behavior before enabling
   trust. Edge-level protection remains necessary for distributed Redis outages.
5. Deploy to staging first. Exercise password and Google login, API token creation
   and revocation, all configured shop authorization/reconnection flows, and a
   scoped bearer CLI request. Test the actual canonical host and provider callback
   for each integration. These checks require staging accounts and live provider
   cooperation; local mocks do not prove a provider's callback behavior.
6. Deploy all application instances consistently after indexes/configuration.
   Monitor 401/403/415/429 rates, Redis availability, callback failures, and the
   health of authentication. Remove caller-supplied/unsafe IP trust if the ingress
   contract cannot be guaranteed.

## Local verification

- Unit and route tests cover login CSRF, missing/null/untrusted origins, API-token
  writes, scoped bearer compatibility, all four callback flows, browser mismatch,
  expiry, changed/rejected user, wrong provider/domain, duplicate query parameters,
  concurrent claim, real provider SDK authorization URL parameters, and tunnel
  handoff paths. External providers and MongoDB are mocked; no production data or
  marketplace tokens are used.
- Limiter tests cover atomic EVAL invocation, concurrent callers, Redis timeout,
  local fallback, bounded capacity and trusted-header behavior. They do not replace
  an integration test against the deployed Redis/ingress.
- A clean Node 22 build using a synthetic MongoDB URL and no project `.env` files
  passed. An isolated standalone HTTP smoke test checked cross-origin and
  form-compatible login denial, API-token CSRF denial, canonical tunnel handoff,
  and unauthenticated callback denial for all four providers. TypeScript and
  changed-file lint passed (the latter retains existing LoginPage warnings).
- The repository's full suite retains the 13 pre-existing cache-invalidation test
  failures documented in Phase 0; normal marketplace tests retain 16 expected
  known gaps. Full production readiness must not be inferred from mock-only tests.

## Rollback

Pause marketplace authorization if provider behavior or callback-host configuration
cannot satisfy state/browser binding. Do not downgrade to a callback that exchanges
codes without validating state. Existing connections remain stored, and restarting
an interrupted authorization creates a new attempt. If reverting unrelated code,
retain the additive indexes; no business or marketplace records need deletion.

Application-level encryption of recoverable marketplace access/refresh tokens in
MongoDB is a separately deferred item.

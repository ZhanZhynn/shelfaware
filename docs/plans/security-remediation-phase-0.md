# Security Remediation — Phase 0 Implementation and Rollout

Date: 2026-10-24. Audit baseline: `59bed65`.

Status: implemented and locally verified; production rollout pending.

## Implemented

- Raised `next` and `eslint-config-next` to `^16.4.3` and regenerated the lockfile.
  The locked and clean-installed image stack is Next.js **16.4.3**, Sharp
  **0.35.5**, with patched native image libraries.
- Added `lib/image-optimization.ts`, used by `next.config.ts`.
- Restricted remote optimization to the configured ImageKit account host/path.
  Removed hostname-wide ImageKit, Robohash and Google-avatar optimization access;
  existing unoptimized avatar rendering uses its original URL directly.
- Disabled upstream redirects, local-IP fetching and SVG optimization. Limited
  source response size to 5 MiB, filesystem image cache to 256 MiB, and request
  quality to 75. Kept AVIF/WebP output with the patched native stack.
- Added 32 tests exercising Next's real request validator, account/path/host and
  query rejection, invalid configuration, PNG-to-AVIF/WebP conversion, and SVG
  source rejection. No marketplace/provider credentials are needed by these tests.

## Build-time configuration

Set `NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT` before the build. The existing Docker
workflow already passes this variable as a build argument. If it is absent,
`IMAGEKIT_URL_ENDPOINT` is the fallback for builds where that server variable is
available.

Examples of valid endpoints:

```text
https://ik.imagekit.io/your_account
https://images.example.com
https://images.example.com/catalog
```

Use the endpoint actually owned/configured for this application. The shared
`https://ik.imagekit.io/` root is rejected. Endpoint paths accept account/folder
segments made from letters, digits, underscores and hyphens. Credentials,
wildcards, custom ports, queries and fragments are rejected without echoing the
configured value.

- An absent/blank endpoint means **no remote image optimization is permitted**.
- Optimized source URLs must be below the configured path and have no query
  string. Normalize any legacy query-bearing ImageKit source URLs before relying
  on them in optimized components; do not widen the host to unrelated accounts.
- Changing runtime environment variables does not rewrite an existing build's
  image allowlist. Rebuild and redeploy after endpoint changes.
- Redirecting delivery URLs will fail; use the final account-scoped HTTPS URL.
- These restrictions protect the optimizer. Browser-native image requests do not
  pass through it and are not an application-wide outbound-request allowlist.

## Local verification results

| Check | Result |
|---|---|
| Clean `npm ci` in an isolated source snapshot | Passed |
| `npm run build` under Node 22.23.4 | Passed; standalone output generated |
| Standalone packaged Next/Sharp versions | 16.4.3 / 0.35.5, including successful native Sharp loading |
| Standalone login HTML, forged session/API rejection, admin redirect | Passed |
| Standalone optimizer rejection of foreign/lookalike accounts, avatar host, private IP, query strings, unsupported quality | Passed |
| `npm test -- lib/image-optimization.test.ts` | 32 passed |
| `tsc --noEmit` | Passed |
| ESLint on changed TypeScript files | Passed |
| Production-dependency audit | No `next` or `sharp` finding; 39 other package findings remain for later phases |
| Full unit suite | 1,692 passed, 16 expected failures, 13 failures in cache-invalidation coverage |
| Strict marketplace suite | 912 passed, 16 known-gap failures |
| Repository-wide lint | 18 errors in existing UI/hook code; updated rules expose more diagnostics than the original toolchain's 5 errors |
| Docker image build/runtime verification | Blocked by local Docker socket permissions |
| Production deployment and owned-account browser smoke tests | Pending |

The cache-invalidation failures and strict marketplace gaps were reproduced
against `59bed65` source with the current test runner. Their failing application
files were not changed by this implementation. Keep these release blockers
visible rather than treating the full suite as green.

The isolated build copied no project `.env` files and used synthetic configuration.
The standalone smoke server used that build and synthetic session/database
settings; it did not authenticate to production shops or call marketplace APIs.

Remaining critical audit entries include `next-auth`/`@auth/core` and
`@sentry/nextjs`. Handle reachability and compatible remediation in the main plan;
this patch does not establish that every dependency is free of advisories.

## Production rollout

1. Verify the exact account endpoint is set in each build environment, including
   the GitHub Actions variable used for the Docker build.
2. Build a fresh image/deployment from the updated lockfile. Record its commit
   and immutable image tag/deployment ID; do not rely only on a mutable `latest`.
3. Verify versions **inside that image**, not just on a development machine:

   ```bash
   docker run --rm --entrypoint node "$IMAGE" -e '
     const { createRequire } = require("node:module");
     const fromNext = createRequire(require.resolve("next/package.json"));
     console.log({
       next: require("next/package.json").version,
       sharp: fromNext("sharp").versions.sharp,
     });
   '
   ```

   Set `IMAGE` to the newly built immutable tag. Expected minimums for this
   implementation are Next.js 16.4.3 and Sharp 0.35.5; recheck current advisories
   before using a newer release.

4. In staging, check a real owned product image and QR code, ordinary avatars,
   and the public login/register pages. Check that another ImageKit account's
   `/_next/image` request returns 400. Confirm owned images do not require a
   redirect/query string that the new contract rejects.
5. Deploy to every affected instance. Verify its deployed SHA/versions and repeat
   the read-only smoke checks. Resolve or explicitly assess the existing suite
   and lint blockers before declaring the full release gates satisfied.
6. If rollout must be delayed, disable the vulnerable optimizer route/capability
   on the old deployment. Setting individual components to unoptimized does not
   disable a publicly reachable optimizer endpoint.

Rollback only to a patched build. If image delivery fails, correct the owned
endpoint and rebuild or use a patched build with optimization disabled; do not
restore the vulnerable dependency versions or hostname-wide allowlist.

Next work: Phase 1 secret separation, telemetry redaction, compatible Sentry SDK
patching, and production demo-account review. MongoDB token encryption remains
the separately deferred work item.

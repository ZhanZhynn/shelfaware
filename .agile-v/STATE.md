# Agile V — Project State

| Field | Value |
|-------|-------|
| **Cycle** | C1 |
| **Phase** | `phases/02-sentry-chunk-order-fix` |
| **Infinity Loop stage** | Prove → Verify (REQ-0014/0015 code done, lint+test PASS, awaiting deploy) |
| **Last updated** | 2026-06-27 |
| **Active REQ range** | REQ-0001 … REQ-0015 |
| **Prod deploy target** | pending push (REQ-0014/0015); baseline `9a2e37c` |
| **Human Gate 1** | APPROVED (retroactive bootstrap) |
| **Human Gate 2** | PENDING — Sentry 24h + manual nav smoke; new REQ-0014/0015 pending automated pass |
| **Resume token** | — |

## Current focus

1. **REQ-0014** — ChunkLoadError auto-reload in `ErrorBoundary` (stale deploy chunk)
2. **REQ-0015** — `OrderDialog` `logger.error` → `logger.warn` for RHF client-side validation callback
3. **REQ-0009** — Sentry regression watch: hydration on `/admin/dashboard-overall-insights` MONITOR only
4. **REQ-0001/0006** — manual removeChild nav smoke (optional)

## Session resume (every chat)

1. Read `.agile-v/STATE.md` + `.agile-v/REQUIREMENTS.md`
2. Load skill: `.agile-v/skills/SKILLS_INDEX.md` (01 core → task skill)
3. Cursor rule active: `.cursor/rules/agile-v-core.mdc` (`alwaysApply: true`)
4. Red Team: `npm run lint && npm run test && npm run test:invalidate && npm run build`
5. Write-through on material change: `DECISION_LOG.md`, `BUILD_MANIFEST.md`, `VALIDATION_SUMMARY.md`

## Pipeline (V-model)

```
[Specify ✓] → [Constrain ✓] → [Orchestrate ✓] → [Prove ✓] → [Verify ◐] → [Evolve ◐]
```

## C1 completion snapshot

| Area | Status |
|------|--------|
| Sentry/Groq/Select (REQ-0001–0007) | code done; manual QA partial |
| Agile V bootstrap (REQ-0008) | done |
| Zod + 4xx logging (REQ-0010–0013) | done, 284 tests |
| TanStack invalidation | unchanged; 200 audit pass |

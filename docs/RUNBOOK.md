# Runbook — operating QuantEdge

The things you need when something is on fire or you're about to ship. Written from
incidents we actually hit.

## Deploy
**Deploy = push to `main`.** Railway builds and runs two processes from `Procfile`:
- `web`  → `npm run build && npm start`  (Express API + static client)
- `worker` → `npm run start:worker`      (cron scanners + notifications)

`railway.json` + `Procfile` define this. There is no Replit/Render/Hetzner path anymore —
Railway only. Rollback = revert the commit and push, or redeploy a previous Railway build.

**Pre-push checklist:** `npm run check` (tsc) green · `npx vite build` succeeds · docs updated in the same PR.

## Database (Neon Postgres + Drizzle)
- **Auto-archiving is the #1 outage cause.** A Neon branch archives when idle; the app then
  throws *"endpoint has been disabled"*. **Fix:** in Neon, disable auto-suspend/archiving on the
  production branch, or keep it warm. This has bitten us and caused a full outage.
- **`drizzle-kit push` is destructive.** It once **truncated `trade_ideas`** (a real data loss).
  - Local dev: `npm run db:push` is fine (dev branch).
  - **Production: do NOT `push`.** Generate a migration, review the SQL, then apply it. Never run
    an unreviewed schema sync against prod. Back up first.
- Recovery after data loss: check sibling Neon branches (production_old, parent) for a snapshot
  before assuming it's gone; if all branches read empty, it's gone — let scanners regenerate.

## The worker
- Runs scanners, the evening playbook, and notifications on a cron; a **catch-up runs on boot**
  so a restart doesn't skip a cycle.
- If ideas stop appearing: confirm the worker process is alive (Railway logs), the DB is reachable,
  and market-data keys are valid.

## Market-data fallback chain
Quotes/chains resolve **Tradier → CBOE (delayed) → Yahoo**. If flow/chains look empty:
- **Tradier 401** → the account is inactive/unfunded (a known state). The CBOE/Yahoo fallback should
  cover it; verify the fallback is firing in logs rather than assuming Tradier.
- One provider being down should degrade, not break — if it breaks, the fallback chain regressed.

## Health & logs
- `npm run health` → `/api/health`.
- Railway logs per process (`web`, `worker`). Filter for the failing service.

## Secrets
- All secrets are env vars (see ONBOARDING for the list). Rotate by updating Railway env + `.env`.
- Never commit them; never echo them in chat/issues/PRs. If one leaks, rotate immediately.

## Fast triage
| Symptom | Likely cause | First move |
|---|---|---|
| "endpoint has been disabled" | Neon branch archived | Re-enable branch / disable auto-suspend |
| Empty flow / chains | Tradier 401 (unfunded) | Confirm CBOE/Yahoo fallback in logs |
| No new ideas | Worker down or DB unreachable | Check worker logs + DB |
| Blank UI / 403 | Beta gate / auth | Sign in; check session |
| Schema errors after deploy | Migration not applied | Apply reviewed migration (never blind push to prod) |

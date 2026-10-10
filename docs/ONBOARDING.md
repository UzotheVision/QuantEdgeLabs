# Onboarding — running QuantEdge locally

Target: a new dev has the app running in ~15 minutes.

## Prerequisites
- **Node 20+** and npm
- A **Neon Postgres** connection string (ask the lead for a dev branch URL — do **not**
  point local dev at the production branch)
- Optional but useful: at least one AI key and one market-data key (the app degrades
  gracefully without them, but scanners will be thin)

## Setup
```bash
git clone <repo> && cd QuantEdgeee
npm install
cp .env.example .env      # then fill in the keys below
npm run db:push           # sync the Drizzle schema to your dev DB
npm run dev               # single process: web + worker via tsx (server/index.ts)
```
Health check once it's up:
```bash
npm run health
```

## Environment keys
`.env.example` lists every key. **Minimum to boot:**
- `DATABASE_URL` — your Neon dev branch (required)
- `SESSION_SECRET` — any random string
- `PORT` — see `.env` / `.claude/launch.json` (dev preview runs on 3000; API health on 5000)

**Add as needed** (each unlocks a capability, absence is handled):
- Market data: `TRADIER_API_KEY` (note: needs a *funded* account or it 401s — see RUNBOOK),
  `FINNHUB_API_KEY`, `TWELVE_DATA_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `DATABENTO_API_KEY`
- AI: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` / … (multi-provider)
- Comms: `DISCORD_WEBHOOK_*`, `RESEND_API_KEY`
- Auth/pay: `GOOGLE_CLIENT_ID/SECRET`, `STRIPE_*`
- Admin: `ADMIN_PASSWORD`, `ADMIN_ACCESS_CODE`

> Never commit `.env`. Never paste real keys into chat, issues, or PRs.

## The dev vs prod process model
- **Dev:** one process — `npm run dev` runs `server/index.ts` (web **and** worker together via tsx).
- **Prod:** two processes — `npm run build` bundles `server/web.ts` and `server/worker.ts` to
  `dist/`, then `npm start` (web) and `npm run start:worker` (worker) run separately. Railway
  runs both from `Procfile`.

## First-run tour
1. Open `/t` — the **Terminal** (Oracle/Flow/Heatmap/GEX/PRISM). This is the future front door.
2. The legacy shells still exist at `/p /h /g /r /pos /j` while we fold them into the Terminal.
3. `npm run check` runs `tsc` — keep it green before you push.

## Common gotchas
- **"endpoint has been disabled"** → your Neon branch auto-archived (idle). Re-enable it in Neon
  or use an active branch. See RUNBOOK.
- **Blank Terminal / 403s** → the beta gate; sign in with the dev account.
- **Schema drift errors** → re-run `npm run db:push` against your dev branch.

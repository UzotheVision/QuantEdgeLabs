# QuantEdge Codex handoff

Last updated: 2026-09-26

## Repository

- GitHub: `https://github.com/Maleek23/QuantEdgeResearch.git`
- Production branch: `main`
- Active development branch: `redesign/phase1-demolition`
- Deployed release: `0999216f841429755bdc7c869049901ea62f3f3f`

## Production

- Public site: `https://quantedgelabs.net`
- Host: DigitalOcean VPS (`104.248.127.195`), behind Caddy
- App directory: `/opt/quantedge`
- Process manager: PM2
- Production process: `quantedge-web`, serving `dist/web.js` on port 3000
- Server-only PM2 configuration: `/opt/quantedge/eco.config.cjs`
- The Railway GitHub integration is legacy and does not serve the public domain.

Do not commit `.env`, `.env.supabase`, API keys, database passwords, access
codes, or deployment private keys. Copy environment configuration between
trusted machines through a password manager or another encrypted channel.

## Local setup on another computer

```bash
git clone https://github.com/Maleek23/QuantEdgeResearch.git
cd QuantEdgeResearch
git checkout redesign/phase1-demolition
npm ci
# Add the local .env through a secure channel.
npm run dev
```

The development server uses the port configured in `.env`. Production is not
the same process as the local development server.

## Deployment procedure

1. Build locally with `npm run build`.
2. Commit and push the development branch.
3. Promote the tested commit to `main`.
4. On the DigitalOcean VPS, fast-forward `/opt/quantedge` to the release.
5. Run `npm run build` on the VPS.
6. Restart only the existing PM2 web process through `eco.config.cjs` and save
   the PM2 process list.
7. Verify `https://quantedgelabs.net/health` and `/api/health`.

The VPS currently runs the web process only. Do not start the heavier worker
without reviewing memory requirements and scheduler ownership first.

## Current operational state

- Production homepage and `/health` return HTTP 200.
- PostgreSQL is healthy.
- Tradier reports `Access Token not approved`; option-chain features therefore
  rely on configured fallbacks.
- The VPS runs Node 20, while the current `yahoo-finance2` package recommends
  Node 22. Plan a controlled Node upgrade rather than changing it during an
  unrelated release.
- The repository production build passes.
- The full TypeScript check still has a substantial legacy error backlog.

## Recent implementation checkpoint

- Unified ticker research shell and embedded workup.
- Six-session index 0DTE outcomes/replay surface.
- TradingView closing-drive indicator documentation and Pine source.
- Account-size/risk/max-debit-aware contract fitting controls.
- Durable trigger reconciliation using stored price checkpoints.
- Correct trigger-relative UI wording based on actual live price.
- Expanded Cockpit, Flow, GEX, Crypto, Session Brief, SEO, and navigation work.

## Product priorities still open

1. Make Cockpit the canonical place for active ideas, bot positions, and
   resolved outcomes without duplicated representations.
2. Finish the GEX node/level redesign using horizon-matched expirations and
   explain pin/acceleration behavior without treating gamma as directional.
3. Repair production market-data credentials and make every data source expose
   freshness, provenance, and fallback state.
4. Audit the worker topology before enabling continuous scanners/bots on the
   current VPS size.
5. Finish the trade journal/Webull import and post-trade analytics workflow.
6. Continue responsive/mobile navigation and bundle-size/performance work.

## Starting a new Codex task

Ask Codex to read this file first, inspect the current branch and working tree,
and verify live behavior before editing. A useful opening instruction is:

> Read `docs/CODEX_HANDOFF.md`, inspect the current Git branch and production
> health, then continue the highest-priority unfinished QuantEdge task without
> fabricating market data or overwriting unrelated work.

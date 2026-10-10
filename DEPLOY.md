# Deploying QuantEdge always-on

The platform is cron- and stream-heavy (scanners every 10–30 min, SSE tape,
WebSockets, a 4:10 PM ET worker self-restart). It needs a host where the
process **never sleeps**. Serverless (Vercel/Netlify) and free web tiers
(Render free spins down after ~15 idle minutes) cannot run it correctly.

## Options, honestly compared

| Host | $/mo | Always-on | Fit |
|---|---|---|---|
| **VPS (Hetzner CX22 / DigitalOcean)** | ~$4–7 | yes | **Best** — 4GB RAM runs web+worker exactly as designed under PM2; full control |
| Railway (Hobby) | ~$5+usage | yes | Good — GitHub deploy, no sleep; watch RAM pricing |
| Render Starter | $7 | yes | OK — 512MB is tight; web only, worker needs a 2nd service |
| Render Standard | $25 | yes | Easy — 2GB, zero-ops, current repo already wired |
| Render Free (current) | $0 | **no** | Site preview only — crons dead while asleep |

## VPS quickstart (Ubuntu 22+, ~15 minutes)

```bash
# as root on the fresh server
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs git
npm i -g pm2
git clone https://github.com/Maleek23/QuantEdgeResearch.git /opt/quantedge
cd /opt/quantedge && git checkout redesign/phase1-demolition
# copy the local .env to the server (scp), then:
npm ci --include=dev && npm run build
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

Updates: `cd /opt/quantedge && git pull && npm ci --include=dev && npm run build && pm2 restart all`

Put Caddy or nginx in front for HTTPS + a domain when ready
(`caddy reverse-proxy --from yourdomain.com --to localhost:3000`).

## Notes

- `ecosystem.config.cjs` runs the intended two-process split; the worker's
  4:10 PM ET exit is by design — PM2 restarting it is the memory reset.
- DATABASE_URL: currently the Neon fallback; when the Supabase project is
  resumed (or its backup imported), update `.env` on the server and
  `pm2 restart all`.
- The Tradier key is expired (401) — options chains/contract picking run on
  fallbacks until it is renewed at tradier.com.

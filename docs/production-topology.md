# QuantEdge production topology

QuantEdge is two processes sharing one Postgres database. Running only the web
process serves the UI but does not reliably run the scanners, lifecycle checks,
paper bot, alerts, or historical archives.

## Railway services

Create two Railway services from the same repository and branch:

| Service | Config file | Start command | Responsibility |
| --- | --- | --- | --- |
| Web | `/railway.json` | `npm run start` | HTTP API, authentication, UI, realtime sockets |
| Worker | `/railway.worker.json` | `npm run start:worker` | Scanners, signal lifecycle, bot cycles, alerts, archives |

Both services need the same `DATABASE_URL` and market-data environment variables.
Only the web service should receive public traffic. The worker is a continuously
running process and does not expose a public HTTP port.

## Data capability levels

- Postgres is required. The application cannot persist signals, positions, user
  preferences, or outcomes without it.
- CBOE delayed chains are the free primary/fallback source for contract selection
  and GEX. They are suitable for research and near-close analysis, not execution
  quality or true realtime flow.
- The current Flow feed is unusual chain activity inferred from aggregate contract
  volume, open interest, and premium. It does not observe bid/ask execution side,
  opening versus closing intent, or genuine multi-exchange sweeps. Those require an
  OPRA/time-and-sales provider.
- Tradier is optional for boot, but premium tracking and chain-sensitive features
  should be considered partial when its token is rejected or unavailable.
- Yahoo and Finnhub are rate-limited enrichment/fallback sources. They must stay
  behind the shared caches and cannot be treated as a streaming market feed.

The terminal health badge intentionally reports `Data partial` when an optional
provider is degraded. A green web process is not the same thing as complete market
coverage.

The paper bot may display existing delayed positions for audit, but it will not
open a new position from a delayed CBOE mark. New entries require a non-delayed
contract mark.

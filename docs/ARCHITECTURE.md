# QuantEdge — architecture

The platform as a systems engineer sees it: a **layered pipeline** that turns raw
market data into ranked, tracked trade decisions, plus a **worker** that keeps it
fresh and a **terminal** that interprets it. Read the diagram top-to-bottom — data
flows *down* the ingest side and *up* the serve side.

## The hierarchy

```mermaid
flowchart TB
  U([Users · beta-gated · tiers])

  subgraph CL[6 · CLIENT — React + Vite + Tailwind]
    direction TB
    T["TERMINAL /t — the one shell<br/>(persistent chrome + motion system)"]
    TA["tabs: ORACLE · FLOW · HEATMAP · GEX · PRISM"]
    CX["right-hand CONTEXT panel — renders the engine's reasoning as a sentence"]
    LEG["legacy shells (Home/Hunt/GEX/Research/Positions/Journal) — being folded in"]
    T --> TA --> CX
  end

  subgraph API[5 · API — server/web.ts · Express]
    A1["/api/* — ~700 routes · auth · sessions · Stripe · beta gate"]
  end

  subgraph WK[7 · WORKER — server/worker.ts · cron]
    W1["scanners · evening playbook · notifications · catch-up on boot"]
  end

  subgraph ENG[3 · ENGINES — server/*-engine.ts]
    E1["Convictions — 13-layer score → S/A/B/C band"]
    E2["WinRateService — honest realized P&L (option contract P&L)"]
    E3["GEX / gamma — structural levels: call wall · put support · γ flip · magnet"]
    E4["Rotation — RRG (RS × momentum)"]
    E5["Cash-gate — macro event risk dampening"]
  end

  subgraph SVC[2 · SERVICES — server/*-service.ts · ~150 files]
    S1["Market fetchers + fallback chain (quotes · chains · flow)"]
    S2["News · catalysts · earnings"]
    S3["AI narrative service (multi-provider)"]
    S4["Cache service"]
  end

  subgraph DB[(4 · DATA — Neon Postgres · Drizzle · 76 tables)]
    D1["trade_ideas · positions · journal"]
    D2["gex snapshots · flow · catalyst_events"]
    D3["users · sessions · credits"]
  end

  subgraph EXT[1 · EXTERNAL providers]
    P1["Market: Tradier · CBOE · Yahoo · Finnhub · Twelve Data · Alpha Vantage · Databento"]
    P2["AI: Anthropic · OpenAI · Gemini · Groq · Mistral · Cerebras · OpenRouter"]
    P3["Comms: Discord webhooks · Resend email"]
    P4["Auth/Pay: Google OAuth · Stripe · TradingView webhooks · Alpaca (paper)"]
  end

  U --> CL --> API
  EXT --> SVC --> ENG --> DB
  API --> ENG
  API --> DB
  WK --> SVC
  WK --> ENG
  WK --> DB
  DB --> API
```

## Layer-by-layer interpretation

1. **External providers** — everything the platform *knows* comes from here. No
   single provider is trusted alone: quotes/chains resolve through a **fallback chain**
   (Tradier → CBOE delayed → Yahoo) so one outage doesn't blind the platform. AI is
   multi-provider for the same reason. *Contract: providers are replaceable; nothing
   above this layer hard-codes a vendor.*

2. **Services** (`server/*-service.ts`, ~150 files) — thin adapters that fetch, cache,
   normalize, and shape provider data into internal types. This is where a vendor's
   quirks stay contained. *Contract: a service returns clean internal data or a typed
   failure — never a raw vendor payload leaking upward.*

3. **Engines** (`server/*-engine.ts`) — the actual intelligence, and the part that
   must be *honest*. Convictions turns 13 scored layers into an S/A/B/C band;
   WinRateService reports realized option-contract P&L (not premium-vs-stock fiction);
   GEX derives structural levels; Rotation places sectors on the RRG; Cash-gate dampens
   grades near macro events. *Contract: engines are pure over their inputs and produce
   both a number **and its reasoning** — the reasoning is a first-class output, not a log line.*

4. **Data** (Neon Postgres, Drizzle, 76 tables) — the memory. Ideas, positions, journal,
   GEX/flow snapshots, catalysts, users/sessions/credits. *Gotcha that bit us: the Neon
   branch auto-archives when idle and `drizzle-kit push` can truncate — see RUNBOOK.*

5. **API** (`server/web.ts`, Express) — the serve boundary. ~700 routes, auth, sessions,
   Stripe, the beta gate. *Contract: the API composes engine + data; it holds no business
   logic of its own.*

6. **Client** (React + Vite) — **the Terminal** (`/t`) is the consolidation target: one
   persistent chrome, five tabs (Oracle/Flow/Heatmap/GEX/PRISM), one motion system, and a
   right-hand **CONTEXT panel that renders the engine's reasoning as a sentence.** The
   legacy multi-shell app still runs and is being folded into the Terminal tab by tab.

7. **Worker** (`server/worker.ts`, cron) — keeps everything fresh independently of any
   user: scanners generate ideas, the evening playbook runs, notifications fire, and a
   catch-up runs on boot so a restart doesn't skip a cycle. *Web and worker are one process
   in dev (`server/index.ts`) and two processes in prod (`start` + `start:worker`).*

## The core data flow — an idea's life
```
provider quote/chain ─▶ service (fetch+cache+normalize) ─▶ convictions engine
   (13 layers → score+band+reasoning) ─▶ trade_ideas (DB) ─▶ /api ─▶ Terminal
   ─▶ CONTEXT panel renders the reasoning ─▶ user acts ─▶ position/journal
   ─▶ WinRateService judges realized P&L ─▶ calibration feeds back into weights
```
The **loop closing** at the end (outcome → calibration → better weights) is the moat;
most tools stop at "here's a signal" and never grade themselves. See TERMINAL_SPEC.md.

## Terminal tab → engine map
| Tab | Reads | Engine/route |
|---|---|---|
| ORACLE | regime + ranked signals | rotation + convictions (`/api/sector-rotation`, ideas) |
| FLOW | options flow drift | flow service/scanner |
| HEATMAP | market/sector map | market-scanner |
| GEX | dealer positioning | gamma engine (`/api/gex/*`) |
| PRISM | strike × expiry matrix | GEX matrix / spectrum |

## Where the bodies are buried (know before you touch)
- **240 server `.ts` files, 76 tables, ~60 client pages, 8 shells** — real sprawl. The
  Terminal + this canon are the consolidation. See `../AUDIT.md` for the keep/cut map.
- **Engines already compute reasoning the UI throws away** — the highest-leverage work is
  rendering it, not computing more.
- **`drizzle-kit push` is destructive** — it truncated `trade_ideas` once. RUNBOOK covers the safe path.

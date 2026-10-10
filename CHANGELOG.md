# Changelog

All notable user-facing changes. Format: [Keep a Changelog](https://keepachangelog.com).
Update this in the same PR as the change.

## [Unreleased]
### Added
- **Session Brief on the Oracle tab** — sector leadership and the names carrying each group,
  surfaced instead of sitting in an endpoint. Click any ticker to load it across the tabs.
- **Sector leadership is session-aware.** Outside 09:30–16:00 it read regular quotes, i.e.
  yesterday's close — stale exactly when you're deciding what to do at the open. It now reads
  the extended-hours tape in pre/post/overnight, so pre-market leadership is visible before
  the bell. Live at 08:25 ET: Biotech leads (typical +6.46%, MRNA +151.6%), Fintech
  (COIN +15.8%), Crypto (ETH +19.2%); Semi Equipment weakest (−6.96%, AEHR −14.8%).
- **Alerts.** In-app alerts that fire on what CHANGED, not on what is: trigger confirmed,
  T1 hit, danger zone, invalidation, rating moves, high conviction (90+). Each is a
  transition detected against the signal geometry the platform already computes, so nothing
  new is inferred — the changes were simply being thrown away. Bell + unread badge in the
  Terminal chrome, a persistent feed, per-type toggles, quiet hours, and sound (reusing the
  existing Web Audio beeps). Alerts run on every tab, since the point of an alert is to
  reach you when you're not looking at that screen.
- **Compression layer — Darvas box + TTM Squeeze — now scores.** A tested, tight range is a
  coiled spring with definable risk, and the engine had no concept of it. New
  `compression-engine.ts` detects consolidation (tight vs the instrument's own ATR *and*
  in absolute terms, with multiple tested edges) and squeeze (Bollinger inside Keltner).
  Because compression is directionless it only earns points when price presses the side
  that would confirm the trade — and goes **negative** when the name is coiled at the wrong
  end. Live: 8 of 55 picks carry it (VRTX +3 at 98% up the range, BWXT −3 wrong end).
- **Extended-hours candles are marked on charts.** Intraday charts now shade pre/post-market
  spans (with a legend swatch) — those bars are thin, wide-spread and gap-prone, and reading
  them as regular-session prints is misleading. Drawn on the existing overlay, so it costs
  nothing extra.
- **Confidence Index shows its arithmetic.** Signal Components now states the maths —
  `9 layers · +41 −8 = 33` — lists every layer with its reason (previously capped at 6, so
  layers were silently hidden), and names what is arguing against the setup.
- **Personalization is reachable.** The `user_preferences` table, provider and endpoints
  already existed and were entirely unexposed — every user saw an identical, un-tunable
  terminal. Added a Settings panel in the Terminal chrome (account size, max risk per trade,
  options budget, asset types, holding horizon, default view, density, animations).
- **Position sizing per signal** — each signal now says what it means for *your* account:
  share count, dollars at risk, reward at T1, position cost and % of account, sized from
  your own risk settings. Change risk 1% → 2% and every signal re-sizes.
- **Dynamic scan universe** — the scanner no longer only looks at a static approved list.
  Every universe rebuild now absorbs the day's movers (most-active / gainers / losers /
  trending) via the existing Yahoo screener discovery, so names that weren't on anyone's
  list that morning still get scored. Universe went 162 → 281 live, and MRNA (+177% on the
  most-active tape) is now in-scope rather than noticed after the fact.
- **Chart workspace** — every chart has an expand control that opens it full-size over a
  blurred backdrop (Esc / click-out to close, keyboard timeframes preserved).
- **Sector leadership engine** (`/api/sector-leadership`) — ranks every sector across the
  162-name universe by a composite of typical move + breadth + standout gap, and surfaces
  **the leading and lagging names inside each group** (the step rotation leaves out: knowing
  biotech is bid doesn't tell you which biotech to buy). Also tracks the mega-cap group and
  market-wide top movers. Uses the **median** name as the group's move, with an explicit
  skew flag when one outlier is carrying the sector.
- **Trading colour semantics** (`lib/oracle/trading-colors.ts`) — colour is data, so each
  gets one job: green/red for **direction and P&L only**, amber for waiting/caution, cyan
  for structural info, muted for inert. Non-directional health bars (validity, pace) moved
  off green/red — a strong **bearish** setup was rendering green and reading as bullish.
- **Rating deltas with arrows** — conviction scores move, so signal cards and the
  Confidence Index now show ▲/▼ with the point change. Backed by an observed-score tracker
  rather than invented history; the tooltip states exactly what the delta measures.
- **Alert-stream cards rebuilt as live positions** — direction, live P&L, days held,
  lifecycle status, a T1 progress bar, a hold/horizon bar, and drawdown.
- **NEW / BEST / CONVICTION** stream filter (BEST = furthest toward T1) plus a
  **CLOSED TODAY** section for signals that hit target or stopped out.
- **Per-asset-class regime** on the Oracle orb — equities, bonds, dollar, metals and crypto
  each read separately with a bull/bear tally, instead of one SPY number standing in for
  "the market".
- **Oracle signal geometry engine** (`lib/oracle/signal-geometry.ts`) — one pure module that
  derives everything the signal view shows: R-multiples, **T2** (a second target at 2× the T1
  R-multiple — we never had one), progress entry→T1, pace vs horizon spent, drawdown, status
  (PENDING TRIGGER / IN PLAY / AT TARGET / NEAR STOP / INVALIDATED), the VALIDITY / PROGRESS /
  PACE / OVERLAY sub-scores, and the scale-out plan. Validated against the reference terminal:
  risk \$33.00, reward \$37.00, R:R 1.12, PENDING TRIGGER, −2.30% P&L, T1 +11.99%·1.4R,
  STOP −6.24%·0.7R — all exact matches.
- **Oracle panels rebuilt on it** — Price Ladder now carries T2 and R-away per rung; new
  Trade Geometry, Risk/Reward (with dollar risk + reward per share) and Profit Taking Plan
  panels; every panel reads one shared live price so the numbers can't disagree.
- **Terminal (`/t`)** — one shell, five tabs (Oracle · Flow · Heatmap · GEX · PRISM) with a
  shared motion system, sliding tab underline, live uptime, wired to the real engines.
- Oracle Orb (market-regime centerpiece) and Rotation Map (RRG) components.
- Oracle **signal-detail widgets** — Price Ladder (stop/entry/live/target with %/$/away),
  Confidence Index bars (Conviction/Progress/R:R/Structure), and a Context panel with a
  "what to do now" line — all derived from real ConvictionPick data. Wired into the cockpit.
- `/t` is now **full-bleed, no sidebar** (top-nav only, ADR-0001).
- **Universal chart** (ADR-0002) — one `EpochChart` on lightweight-charts v5: real OHLC for
  **any ticker** via `/api/historical-prices` (5m/15m/1h/1D), a flash-UI TF switcher (keys 1–4),
  live OHLC readout, **epoch-anchored trendlines that survive timeframe switches**, and
  horizontal price levels (entry/stop/target). **Embedded in the Terminal Oracle cockpit**,
  replacing the bespoke per-page chart — it's *part of the platform*, not a separate page.
  The `/chartlab` POC route + file were removed once the chart landed in-platform.
- **GEX rankings feed PRISM** — the ranked board (dealer-positioning scan, 39 tickers with
  play score and ±γ polarity) now sits beside the surface: pick a ranked name and PRISM
  loads it. PRISM defaults to the top-ranked play rather than a hardcoded ticker, with SPY
  pinned as the explicit benchmark read.
- **PRISM rebuilt to the desk spec** — the strike × expiry gamma surface (green calls /
  red puts, brighter = more exposure) driven by the shared ticker and defaulting to SPY as
  the market benchmark, with an interpreting panel: spot, net GEX, call wall, put support,
  call-vs-put share, a positive/negative-gamma sentence, the strongest node above and below
  spot, and a "time is your best friend" nudge when that node is near-dated.
- **Terminal utility cluster** — a ticker search in the Terminal chrome that sets the
  shared stock context (search once, every tab follows it, per the desk workflow), an
  active-ticker chip, and a **per-tab GUIDE drawer** (Oracle/Flow/Heatmap/GEX/PRISM) whose
  content is the real workflow: what the tab answers, how to read it, and what it hands to next.
- **Terminal sizing** — bounded the tab content (`max-w-[1600px]`) and capped the Rotation
  Map square so the layout no longer explodes on ultrawide monitors.
- Canonical docs set in `docs/` (Architecture, Onboarding, Runbook, Team) + ADR process + this changelog.
- Cash-secured-put income screener, catalyst research endpoints, cash-gate grade dampening.

### Changed
- Options win-rate now reports **honest realized contract P&L** (was a fabricated ~99.7%).
- Grades display convictionScore-first (single source of truth for score↔grade).

### Fixed
- **Charts were 500ing on every symbol.** `/api/historical-prices` went through the
  `yahoo-finance2` library, which authenticates with a crumb and was being blocked — the
  same symbol fetched directly returned 200. Switched to Yahoo's public v8 chart endpoint
  (no auth), behind the provider cache. INTC/ASTS/AMZN/CRCL: 500 → 124 candles each.
- **Existing ideas still carried the old flat levels.** The level-engine fix only applied to
  newly generated ideas, so the board still showed 8%/4% on every row. Backfilled 61 open
  ideas with structure+ATR levels: **0 legacy 4% stops remain**, 40 distinct stop distances
  (1.7%–15%), R:R spread 1.0–3.67.
- **The stop clamp had become its own constant.** A flat 8% cap fired on every high-ATR name,
  pushing T1 to the 1.5R floor and producing a new fixed 12%/8% — the same disease as the
  percentages it replaced. The cap is now volatility-aware (2.5×ATR, floored 6%, capped 15%),
  so stops scale: MSFT 5.3%, TSLA 6.3%, AMZN 8.9%, PLTR 10.4%, CRCL 13%, MARA 15%.
- **Rotation was structurally frozen overnight.** It computed change from daily CLOSES
  only, so the map couldn't move between 16:00 and 09:30 — but rotation happens overnight
  and by the open leadership is often already decided. It now reads intraday bars with
  pre/post included and takes the latest print, measured against the prior regular close.
  Live: `isStale` went true → **false**, SPY +0.21% (frozen) → −1.3%, XBI +7.67%.
- **Published ideas with impossible levels.** Live rows existed with a LONG target BELOW
  entry and a stop ABOVE it — IBM entry \$236.72 / target \$105 / stop \$240, shipped with
  an R:R of 40. The write-time gate validates on create, but rows can go incoherent
  afterwards. Added a read-time coherence guard that rejects wrong-side levels and
  implausible R:R (>15). Verified: 0 incoherent picks now surface.
- **Yahoo rate-limit storm broke charts.** `/api/historical-prices` was returning 500 under
  load (the "NO DATA" chart). New `provider-cache.ts` coalesces concurrent callers for the
  same key into one upstream request, caches briefly, and serves stale rather than nothing
  when a provider throttles. Chart endpoint: 500 → 200 in 1.5s, then 1.4ms cached.
- **Per-asset-class regime was 2/5 blank.** BONDS/DOLLAR/METALS came through the batch-quote
  service, which silently dropped them when providers throttled. They now ride the same
  chart sweep as extended hours — all five classes resolve.
- **Extended hours was an orphan endpoint** — built but wired into nothing. It now drives the
  Oracle orb (live session badge + pre/post movers + asset-class regime) and the Rotation
  Map (which now says which session it's showing and when it refreshes, instead of just
  "stale").
- **Unreadable type.** 46 instances of 8–9px text and 52 of muted text at ≤55% opacity —
  genuinely illegible on a dark ground. Applied a readability floor across the Terminal:
  nothing below 10px, muted text no fainter than 70%.
- **Provider rate-limit storm (partial).** Boot scanners were requesting the same symbol
  from several call sites simultaneously — logs showed PLTR fetched 4× and 429'd 3× within
  one second — which starved unrelated endpoints and made the app look like it hung. The
  CBOE fetcher now coalesces concurrent callers into one request with a 60s TTL cache
  (verified: 6 concurrent calls → 1 request, repeat 0ms). **Yahoo still needs the same
  treatment** — it currently 500s `/api/historical-prices` under load, which is why charts
  intermittently show NO DATA.
- **Extended-hours blindness.** New `/api/extended-hours` reads the pre/post tape via
  Yahoo's `includePrePost`, ranking gainers/losers/most-active and reporting the live
  session (pre / regular / post / closed) — the window the platform previously ignored.
- **`GET /api/preferences` 404'd for anyone without a saved row** — the normal first-run
  state — so the settings UI could never load. It now creates defaults instead.
- Settings save used a raw `fetch` and was rejected by CSRF (403); now goes through
  `apiRequest`.
- **Trade levels were fixed percentages.** Every stock idea used `target = entry × 1.08`
  and `stop = entry × 0.965` — an identical 2.29 R:R for every ticker, volatility ignored
  (8% is a huge move in MRK and noise in MARA), and the stop placed at an arbitrary price
  rather than where the thesis is wrong. New `level-engine.ts` derives them from the chart:
  stop beyond the nearest **recent** swing padded by ATR, T1 at the next real swing (never
  below a 1.5R minimum), T2 at the following level, plus a written rationale for each.
  R:R now varies by name (1.5–3.1 across MRK/MARA/CRCL/NVDA) instead of being constant.
- **The options-flow scan was never scheduled** — it only ran when someone called the API
  by hand, the second reason flow stopped accumulating. Now runs every 15 min during market
  hours (9:45–15:45 ET) in both the worker and the dev process.
- **The old design kept loading** because `/p` `/h` `/g` still rendered the legacy shells, so
  a bookmark or open tab never redirected. They now redirect into the Terminal, and the
  Terminal tab is deep-linkable via `?tab=`.
- **Options-flow ingestion was dead since Feb 2026.** `fetchOptionsChain` was Tradier-only,
  and the unfunded key returns 401 — so the FLOW tab (the hero product) silently stopped
  collecting. Now falls back to CBOE, which needs no key. A live scan produces 217 prints.
- **The CBOE fallback itself was broken** (so every Tradier fallback, GEX included, was dead):
  CBOE moved the underlying quote fields up one level (`data.quote.*` → `data.*`), and ships
  contract details only inside the OCC symbol — no `strike` / `expiration_date` / `option_type`
  fields, and `last_trade_price` not `last_sale_price`. Added `parseOccSymbol()` and made the
  quote parsing accept both shapes. NVDA now returns 795 contracts w/ spot $218.85.
- **`underlying_price` was never persisted** on flow rows (0 of 2,462) — so % out-of-the-money
  could never be computed. The scanner now captures spot from the chain and stores it.
- Duplicate `start:worker` script in package.json.
- News rate-limit honesty (`data.Information` now counted); idea dedup defaults.

### Known issues
- `/t` renders inside the legacy sidebar (double chrome) — full-bleed top-nav is next (ADR-0001).
- Grades are not yet calibrated (needs weeks of instrumented outcomes → reweight).
- Root has ~40 superseded `.md` files pending a sweep into `docs/archive/`.

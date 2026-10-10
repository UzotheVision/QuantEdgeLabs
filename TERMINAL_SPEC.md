# QuantEdge Terminal — MomoEdge teardown & rebuild spec

Screen-by-screen analysis of the MomoEdge terminal (5 tabs) as a **systems engineer**
(cohesion/architecture) and a **UI/UX designer** (why it's pleasing), then the specific
gaps vs QuantEdge and what to rebuild. Companion to `BLUEPRINT.md` + `AUDIT.md`.

---

## Why it feels cohesive — the invariants (this is the whole trick)
MomoEdge repeats the **same skeleton on every tab**. Cohesion isn't 5 pretty pages; it's
one grammar applied 5 times:

1. **One persistent chrome** — top bar `MOMOEDGE // LIVE ORACLE TERMINAL` + `● STATUS ENGAGED`
   + the **5 tabs** (ORACLE · FLOW · HEATMAP · GEX · PRISM) + a per-tab **GUIDE** button +
   notifications/settings/profile. Footer: `● ORACLE ONLINE · UPTIME 00:37:46`. Always there.
2. **One layout grammar** — every tab = **working surface (left/center) + a right CONTEXT panel
   that _interprets_**. GEX: *"saturated positive γ — expect drift, not pinning."* PRISM:
   *"call-dominant, dealer hedging dampens moves — mean-reversion between levels."* **The
   interpretation is the product.** Data is table stakes; the sentence is the edge.
3. **One color language** — cyan accent; green/red = bull/bear; in GEX/PRISM **gold = focus
   cell (leads the board), cyan = largest single value**; regime tints (green/amber/red).
4. **One type system** — monospace for every number/label, clean sans for prose.
5. **One motion** — the Oracle orb pulses, the uptime ticks, transitions are uniform.
6. **A GUIDE on every tab** + a built-in tutor ("Momo") — learning is in-context, not a manual.

**QuantEdge is the inverse:** 6 shells, ~120 routes, 763 endpoints, inconsistent tokens, no
shared motion, and it shows *data without the interpreting sentence*. Same substance, no grammar.

---

## Tab teardown — the specific components (what to match)

### 1 · ORACLE  (≈ QuantEdge Home + Hunt)
- **Oracle Sphere** — central pulsing orb: regime (NEUTRAL / RISK-ON), `AVG CONFIDENCE 61.9%`,
  `SIGNALS ACTIVE 4`, `STATUS ENGAGED`, live `STREAM: MSFT`.
- **Macro regime popover** — EQUITIES · BONDS · DOLLAR INDEX · METALS · RISK APPETITE · CRYPTO,
  each NEUTRAL/BULLISH/BEARISH; `17% BULL · 17% BEAR` breadth.
- **3-column dashboard:**
  - *Alert Stream (left):* NEW / BEST / CONVICTION toggle; signal rows w/ P&L, T1, HOLD, mini-bar.
  - *Analysis (center):* the **price ladder** — `STOP $360 · ENTRY $393 · LIVE $383.96 · T1 $430 · T2 $475`
    each with **% and $ and "away"** distance; a chart; **WHAT TO DO NOW**; live signal brief.
  - *Confidence Index (right):* setup score gauge (`72`); **SIGNAL COMPONENTS bars** —
    VALIDITY / PROGRESS / PACE / OVERLAY; **TRADE GEOMETRY** — stop-loss & T1 distance "away".
- **Alert Preferences modal** — per-alert-type channel matrix (Push · Sound · In-app · SMS · Email),
  presets (Focused), **Quiet Hours**, alert types incl. New signal / Trigger confirmed / Target hit /
  Danger zone / Invalidation / Whale / Score 90+.

### 2 · FLOW  (≈ options-flow-scanner)
- **Flow Drift · 5D** line per ticker: `Bull $13.2M · Bear $33.9M · Net −$20.7M`.
- **Flow Breakdown** — Total premium · # contracts · Avg premium · Direction · Sweep % ·
  Order type (Cluster/Ladder) · OI · Volume · Size/OI · Size/Vol · IV · Pattern.
- **735 signals** list + search; **watchlist w/ live prices** (TSM +1.30%, MU +2.07%).

### 3 · HEATMAP  (≈ market-scanner / heatmap)
- **Sector treemap** — every sector block, ticker cells **sized by cap, colored by change**;
  PRICE / FLOW / **MAP** / TABLE views; CAP / EQUAL weighting; `1D 1W 1M YTD`; breadth bar +
  `SPY −0.42%`; per-sector % headers; `Showing Wed Jul 8 close`.
- **Table view** — Ticker · Name · Industry · Cap · Price · **Chg% · RS** · Vol.
- **Ticker detail bar** — Price · Change · Mkt Cap · Volume (x avg) · **RS** · Bear/Bull ·
  Flow Intensity · Sweeps · Whales · Unusual.

### 4 · GEX  (≈ gamma-exposure)
- **GEX Terminal** — Net GEX · Call Wall · HVL · Put Support · P/C ratio · Call OI · Put OI.
- **Strike bars** — positive/negative GEX, per-strike, labeled `TRIGGER · WALL · MAGNET · Γ FLIP`;
  hover tooltip: Net GEX, Call/Put OI, Call/Put Γ per strike.
- **Right regime panel** — market state (**DRIFT / TRANSITION**) + a *sentence*
  ("passive positioning — expect drift, not pinning"); **structural range** visual
  (PUT SUPP → FLIP → MAGNET → CALL WALL); **γ polarity** (SHORT γ DOMINANT); **gravity ↑77% / 23%↓**.

### 5 · PRISM  (≈ GEX Matrix + Spectrum)
- **Strike × expiration matrix** — strikes (rows) × expirations (2d / 9d / **Σ ALL**), cells
  **green = call-side, red = put-side, intensity = size**, **gold = focus (leads board),
  cyan = largest**; values in `$K / $M`.
- Controls: lenses **GEX · VEX · OI · VOL · UNUSUAL**; **SINGLE / CONFLUENCE**; DTE 4/8;
  range ±10/±20/±40; scope DEFAULT / ODTE / Σ ALL; unit `$ Γ / 1% MOVE`; `● LIVE`.
- **Context panel** — the interpreting sentence + Net GEX + legend.

---

## Gap analysis — QuantEdge already has the engine; it lacks the grammar
| Module | QuantEdge engine (exists) | The gap to close |
|---|---|---|
| Oracle sphere | `marketContext.regime`, sector-rotation | ✅ orb built — add macro sub-regimes (equities/bonds/dollar/metals/crypto) |
| Signal analysis | Hunt cockpit (list/subject/analytics) | **price-ladder geometry** (STOP/ENTRY/LIVE/T1/T2 + %/$/away), **WHAT TO DO NOW** line |
| Confidence index | convictionScore + 13 layers | present layers as **VALIDITY/PROGRESS/PACE/OVERLAY bars** + trade-geometry "away" |
| Flow | `options-flow-scanner` | **Flow Drift 5D** chart + the full breakdown field set + sweep/pattern |
| Heatmap | market-scanner | **cap-weighted treemap** + the per-ticker RS/whales/unusual detail bar |
| GEX | `gamma-exposure` | **structural-range gradient**, **γ-polarity**, **gravity %**, and the *interpreting sentence* |
| PRISM | GEX Matrix + Spectrum | **lens switching** (GEX/VEX/OI/VOL/Unusual), **gold-focus/cyan-largest**, confluence, `$Γ/1% move` unit |
| Everywhere | — | the **right-hand CONTEXT panel that interprets** (QuantEdge already computes the "why" in the engine — it just never renders it), a **per-tab GUIDE**, uniform **tokens + motion** |

**The single biggest gap is not a feature — it's the interpretation layer.** MomoEdge turns every
number into a sentence. QuantEdge's convictions engine already produces that reasoning (`layers[].why`,
regime, breadth interpretation) and throws it away in the UI.

---

## What to rebuild (the spec)
1. **ONE Terminal shell** — persistent chrome (title · STATUS · **5 tabs** ORACLE/FLOW/HEATMAP/GEX/PRISM ·
   per-tab GUIDE · uptime footer). Replaces 6 shells + ~120 routes (see AUDIT.md).
2. **The layout grammar, everywhere** — working surface + **right CONTEXT panel** that renders the
   engine's existing reasoning as a sentence. This is the highest-leverage change.
3. **Adopt the specific patterns** (cheap, high-impact): price-ladder geometry · confidence-component
   bars · PRISM lens matrix w/ gold-focus/cyan-largest · GEX structural-range + γ-polarity + gravity ·
   flow-drift chart + breakdown fields · per-tab GUIDE.
4. **All on the design + motion system** (`lib/motion.ts` + consolidated tokens) — the cohesion.

## Build order (ties to BLUEPRINT.md §5)
1. Shell + tab chrome + tokens/motion (the grammar).  →  2. Oracle tab (orb ✅ + ladder + confidence bars).
→  3. GEX + PRISM (structural + matrix, the "wow").  →  4. Flow + Heatmap.  →  5. CONTEXT panels wired to
the engine's reasoning across all tabs.  →  6. Guides + tutor.

### One-line version
QuantEdge has every engine MomoEdge has. The rebuild is **one shell, one grammar (surface + interpreting
context panel), one motion system** — and *rendering the reasoning the engine already computes.*

---

## Pattern catalog — the granular design + engineering details

### A · UI/UX patterns (reusable components + configs)
1. **Segmented control** (the workhorse — reused ≥10×): NEW/BEST/CONVICTION · PRICE/FLOW/MAP/TABLE ·
   CAP/EQUAL · SINGLE/CONFLUENCE · GEX/VEX/OI/VOL/UNUSUAL · DTE 4/8 · ±10/±20/±40 · DEFAULT/ODTE/ΣALL ·
   1D/1W/1M/YTD · NORM GLOBAL/PER-COL. **One component, everywhere.**
2. **Live status pills** — STATUS ENGAGED · ● LIVE · LOADING… · `ORACLE ONLINE · UPTIME 00:37:46` (ticking) ·
   MARKET OPEN/CLOSED. Semantic dot + mono label.
3. **Data-state stamp** — "Showing Wed Jul 8 close · Market closed" / "stale". Honest freshness on every view.
4. **HeatCell** — value + background intensity scaled to magnitude, sign→hue (treemap + PRISM matrix).
5. **Level chips** — inline TRIGGER / WALL / MAGNET / Γ FLIP / ODTE badges anchored to rows.
6. **Distance "away" badges** — every level shows its distance in **R / % / $** ("0.7R away", "2.5R away").
   Relative framing is a *pattern*, not an afterthought.
7. **Standout highlight** — ★ **gold = focus/lead** cell · **cyan = largest**. Draw the eye to the one that matters.
8. **Component bars** — VALIDITY / PROGRESS / PACE / OVERLAY as 0–100 horizontal bars (decomposed score).
9. **Arc gauge** — setup/confidence score (72, 96) as a radial dial.
10. **Structural-range bar** — horizontal gradient w/ positioned markers PUT SUPP → FLIP → MAGNET → CALL WALL + spot dot.
11. **Split meter** — gravity ↑77% / 23%↓ · P/C bull/bear · breadth bar.
12. **Price ladder** — vertical STOP/ENTRY/LIVE/T1/T2, each w/ %/$/away, colored by role.
13. **Sparkline** — Flow Drift 5D mini line (bull vs bear, net).
14. **Context/regime panel** — right column: an interpreting *sentence* + legend + net figure + HOW TO READ.
15. **Hover breakdown tooltip** — per cell/row: underlying components (strike → Net GEX, Call/Put OI, Call/Put Γ).
16. **Unit selector** — explicit `$ Γ / 1% MOVE` (shows the normalization unit).
17. **Config bar per view** — metric · DTE · range · scope · norm as a parameter row; views are config-driven.
18. **Honest empty states** — "No single standout — the lead is shared" · "No picks fired yet".
19. **Preference matrix** — alerts: per-type × per-channel (Push/Sound/In-app/SMS/Email) checkboxes, presets,
    quiet-hours window, greyed "COMING SOON", locked "required" rows.
20. **Per-tab GUIDE + in-context tutor** — help lives where you use it.

### B · Engineering patterns (computations / data / config)
1. **`computeGexStructure(chain)`** → { callWall = argmax +GEX strike, putSupport = argmax −GEX,
   gammaFlip = zero-crossing, magnet/HVL = high-vol strike, netGEX = Σ }. One primitive feeds GEX + PRISM.
2. **Dollar-gamma-per-1%-move unit** — perStrike = γ · OI · 100 · spot² · 0.01 · sign. Explicit normalization.
3. **Matrix normalization modes** — GLOBAL (color vs whole-grid max) vs PER-COL (per-expiration max): `normalize(cells, mode)`.
4. **Confluence aggregation** — SPX·SPY·QQQ = weighted sum of normalized matrices → composite grid.
5. **Focus-cell scorer** (★ Heat Seeker) — rank cells by deviation (z-score / |v|/σ) → flag the standout.
6. **Regime classifier** — state = f(sign(netGEX), |netGEX|, γ-polarity, spot vs flip) → DRIFT / TRANSITION /
   PINNING, **each mapped to a canned interpreting sentence.** A tiny state machine.
7. **Gravity split** — P(up) vs P(down) from GEX mass above/below spot.
8. **Flow-drift series** — cumulative Σ(bull − bear premium) over 5d, per ticker.
9. **Signal geometry (R-multiples)** — risk = entry−stop; T1_R = (t1−entry)/risk; away = (level−live)/live. Derived.
10. **Component decomposition** — convictionScore → VALIDITY/PROGRESS/PACE/OVERLAY sub-scores (map the 13 layers).
11. **Alert-routing schema** — { alertType → { channel → bool } } + presets + quietHours{start,end,on} + locked.
12. **Parameterized view state** — { metric, dte, range, scope, norm, single|confluence } → persisted; view = pure(config, data).
13. **Live cadence** — uptime counter + polling/WS per tool; LIVE badges = freshness; stale detection.
14. **Saved views / watchlist-as-universe** — user-config scan universe + saved filter sets.

### What to rebuild — at the code level
- **`components/ui/` library** — the 20 patterns above as reusable primitives on the token + motion system
  (SegmentedControl, StatusPill, DataStamp, HeatCell, LevelChip, AwayBadge, StandoutMark, ComponentBars,
  Gauge, StructuralRange, SplitMeter, PriceLadder, Sparkline, ContextPanel, BreakdownTooltip, UnitSelect,
  ConfigBar, EmptyState, PreferenceMatrix, GuideButton).
- **`lib/quant/` primitives** — computeGexStructure · dollarGammaPer1pct · normalizeMatrix · confluence ·
  focusScore · classifyRegime→{state,sentence} · gravitySplit · flowDrift · signalGeometry · decomposeConviction.
- **Config-driven views** — each tab = (viewConfig + data) → render. No bespoke per-page logic.

QuantEdge has the *engines* but computes this ad-hoc per page with no shared primitives, no normalization
modes, no focus-scorer, no component decomposition, and no shared component library. **That's the rebuild:
a component library + a primitives library + config-driven views** — not new features.

---

## Demo-transcript extraction — how the platform is actually TRADED
Source: the 28-min walkthrough. This is the highest-fidelity spec we have, because it's
usage, not marketing. Everything below is stated in the demo.

### Trading heuristics the product must encode (not just display)
1. **"Time is your best friend."** Repeated 5×. Never take the nearest lit expiry — step
   out a week/month even at higher premium. *Contract Engine must default to buying time
   and say why.* We currently pick 5–12 DTE by default. **Gap.**
2. **Premium alone means nothing.** A print only matters if it's *unusual for that ticker*.
   → score must be premium **relative to that ticker's baseline**, not absolute size.
3. **Score is not a trigger.** "A low score that actually killed it" (BABA 103C → 4–5×).
   Score ranks; the chart decides. Below ~75 is usually skipped, but not mechanically.
4. **Confirm three things before entry:** does the chart have room · is the premium unusual ·
   is the upside worth it. Also: has the name been heavily sold (rebound potential).
5. **OPEX distorts everything.** Near a monthly expiry, outstanding gamma is inflated by
   months-old positions. *Interpretation must be OPEX-aware.* **Gap — we have none.**
6. **Timing:** heatmap at the open; flow needs ~15–30 min to build (start ~10:00 ET).
7. **Trade the sector, not the ticker.** One name moving → scan its whole peer group for
   the best chart in the group.

### Flow card — the exact fields shown
ticker · strike · expiration · **premium spent** · **% out-of-the-money** · **per-contract
price** · direction · **score** · sweep/whale/repeat badges · "W" badge · add-to-watchlist.
*We were missing % OTM and per-contract price.*
Plus: **market-overview sector flow** panel (bullish vs bearish flow for the day, e.g.
"QQQ strong bullish flow"), ticker search across the **past 1–2 weeks** of flow.

### Their own admitted gaps = our openings
- **Whale-exit tracking** — "I have to have unusual showcasing if a whale exited… I want to
  add a tracker that shows when whales sell." **Not built yet.** Entry without exit is half
  the story; we could ship this first.
- **Ask Oracle** — natural-language Q&A over platform data ("what sectors are leading
  today", "highest flow stock today"). **Planned, not built.** We already run multi-provider AI.
- **Flow outcome tracking** — he manually recalls that a past card 4–5×'d. Nobody is
  scoring flow *after the fact*. Ties directly to our WinRateService/calibration moat.
- Two-person team, admits being overwhelmed. Speed is a real advantage for us.

### Per-tab details previously missed
- **Oracle:** alert-stream filter **NEW / BEST / CONVICTION**; **T2** (not just T1);
  profit-taking plan; **history tab** (win rate + active trades); **alerts w/ sounds**;
  user-configurable **indicators on their chart**.
- **Heatmap:** **RS = volume traded**; industry column; best/weakest performer reads;
  filter-by-flow; click cell → per-ticker flow detail; table view.
- **GEX:** magnet + gamma-flip stated as a *sentence* ("flips positive above 400 — huge
  momentum flip"); levels + outstanding exposure.
- **PRISM:** **star badge** = standout node; brightness = probability of hitting; range +
  strike-count + DTE + metric + scope controls; **0DTE** and **ΣALL** scopes; VEX/OI/VOL/
  UNUSUAL lenses; **SPY as the market benchmark** before any single-name trade;
  **confluence** across three tickers.
- **Cross-cutting:** watchlist → unusual-flow alert → jump to Prism is the alerting loop.

### Build order implied by all of this
1. Flow scoring + flow cards (their hero, our weakest) — with % OTM, contract price, badges.
2. **Whale-exit tracker** (their missing piece — leapfrog).
3. Heatmap best/weakest by industry + filter-by-flow.
4. Prism star/brightness emphasis + SPY benchmark + scope controls.
5. Contract Engine: encode "buy time"; OPEX-awareness across GEX/PRISM.
6. Ask Oracle (NL Q&A) + flow outcome tracking (closes our calibration loop).

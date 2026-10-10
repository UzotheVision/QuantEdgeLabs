# ADR 0002 — Charting system: extend lightweight-charts, epoch-anchored overlay

- **Status:** Accepted (POC landed)
- **Date:** 2026-08-19

## Context
We want an institution-grade charting suite: crisp candles, an indicator suite, a
"flash" keyboard-driven UI, and — the differentiator — **drawings (trendlines, levels,
anchored-VWAP) that survive timeframe switches, panning and zooming.** Off-the-shelf
drawing tools anchor to bar *index*, so a line drawn on 5m detaches when you switch to
1h. `lightweight-charts` v5 is already a dependency and already used in several places.

## Decision
**Build on lightweight-charts v5 as the render core; do NOT write a canvas engine from
scratch.** It gives GPU-fast candles and a native UNIX-epoch time axis.

On top of it we own three layers:
1. **Epoch-anchored drawing overlay** — drawings store absolute `{ time: unix-seconds,
   price }` anchors. A canvas overlay re-projects them every frame. Critically, we map an
   epoch to an x-coordinate via **fractional logical-index interpolation**
   (`epochToLogical` → `timeScale().logicalToCoordinate`), NOT `timeToCoordinate` —
   because `timeToCoordinate` returns null for an epoch that doesn't land exactly on a
   bar, which is the common case after aggregating to a coarser timeframe. This is the
   subtlety that makes anchors resolve on *any* timeframe.
2. **Indicator suite** — a registry computing EMA/VWAP/anchored-VWAP/RSI/MACD/BB/ATR/
   session-levels client-side over the series, rendered as extra series/panes.
3. **Flash UI** — keyboard timeframe switching (1–5), live crosshair OHLC readout,
   minimal chrome, terminal palette; TFs aggregate from a 1-minute base by epoch bucket.

## Consequences
- **Good:** the hard part (persistent, correct drawings) is solved and proven in
  `ChartLab` (`/chartlab`); candles + performance come free from a mature lib; the
  overlay/indicator/flash-UI layers are ours to differentiate on.
- **Cost:** we maintain the overlay projection + indicator math ourselves.
- **Follow-ups:** swap the demo generator for a real `/api` candle endpoint; add
  mouse-drawn trendlines (persist anchors to DB); build the indicator registry;
  gate `/chartlab` behind auth before prod (currently a public dev route).

## Files
- `client/src/components/charting/epoch-chart.tsx` — render core + epoch overlay + flash UI
- `client/src/pages/chart-lab.tsx` — the POC demo (`/chartlab`)

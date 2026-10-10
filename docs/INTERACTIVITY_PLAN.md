# Platform Interactivity Plan — ✅ SHIPPED IN FULL 2026-08-26
_2026-08-26 · follows docs/DESIGN_SYSTEM.md · every item must work on real data or not ship_

## Already interactive (inventory — don't rebuild)
- Charts: pan / wheel-zoom / dbl-click reset / ⤢ expand-blur modal, everywhere via NexusPriceChart
- Universal workup: any symbol click, any tab (workup-bus); ESC closes; peer-hop re-anchors
- Landing sparks: hover crosshair + date/price/% tooltip (shipped with the landing)
- Rails: drag-resize + dbl-click expand on every tab (useColResize)
- ⌘K search: NEXUS/GEX/BOT + shell searches, jump-and-flash
- Filters that filter: FLOW dir/sort, LEAPS budget/grade, CATALYST impact, BOT rule tabs, board bands
- Tape: pauses + labels itself when stale; landing tape pauses on hover

## P0 — highest leverage — ✅ shipped (47bf939)
1. **Radar chip hover-preview** — hovering a Pattern Radar chip shows a mini real-series
   spark + the pattern's levels in a popover (the landing Spark component is reusable).
   Today a chip needs a click-through to see anything.
2. **GEX matrix cell → strike drill-in** — click a strike×expiry cell to open a popover:
   that strike's OI/volume/γ history and its distance to spot. The data is already in the
   terminal payload; it's display-only work.
3. **Board card quick-actions** — on each signal card: one-click "watch", "open workup",
   "why not the bot?" (runs the audit-table logic for that one symbol — the machinery
   from today's board-vs-book audit, surfaced as UI).

## P1 — depth — ✅ shipped (5f9bbbf)
4. **Crosshair sync in cockpit** — the three cockpit charts share one crosshair/time
   cursor (one pub-sub on hover time; chart engine already exposes hover).
5. **Workup keyboard nav** — ←/→ cycle tabs, ↑/↓ cycle the related-peers list.
6. **Ledger rows → replay view** — click a shadow-ledger or paper-book row to see its
   barrier replay drawn on the real chart (levels + touched barrier highlighted).
7. **Level-cross alerts** — "alert me at X" on any chart level; the bot's alert relay
   already exists server-side, needs the UI affordance + wiring.

## P2 — polish — ✅ shipped (5f9bbbf); typography sweep lives as its own task chip
8. Drag-to-reorder watchlist (persist order).
9. Radar group expand ("+149 more") into a full-screen pattern browser with sort/filter.
10. Mobile touch: pinch-zoom on charts, swipe between workup tabs.
11. `prefers-reduced-motion` pass per the design brief §10.

## Rules of engagement
- Interaction reveals measured data or it doesn't ship; no hover theater.
- Every new surface keeps the honesty affordances: freshness, sample size, NOT MEASURED.
- One restart per batch, outside cash hours unless actively broken.

# Motion tiers

The colour system in this app is semantic: clay is the losing side, moss the
winning side, Ice Signal is structural, amber is time running out. Nothing is
coloured for decoration.

**Motion is held to the same standard.** In a trading terminal, movement means
something changed. If cards float, sections parallax and backgrounds drift, the
one animation that matters — a price ticking, a level breaking, a signal firing —
stops registering, because everything is already moving.

This document is the list. If an animation is not on it, it is a bug.

---

## Tier 1 — Data changed

The only tier that earns motion on a data surface. A number moved because the
market moved.

| Use | Primitive | Notes |
|---|---|---|
| A number that updates in place | `LiveValue` | Flashes moss up / clay down, tweens between values. `tween={false}` for counts and ids, where an intermediate number would be a lie. |
| Proof the screen is still connected | `Heartbeat` | Pulsing dot plus an age that counts up, amber when stale, clay when dead. |
| A magnitude that moved | `RangeBar`, `DecayBar`, `StackedBar`, `GravitySplit` | Width/position transitions only. |
| A series gaining a point | `Sparkline` | |
| A score that changed | `ScoreDial` | Arc sweeps to the new value. |

**`Heartbeat` requires a real timestamp from the payload.** Use the server's own
`generatedAt` / `asOf` / `calculatedAt` / `scannedAt`. Do **not** substitute the
client's fetch time: a server-cached response can be hours old while the fetch is
five seconds old, and a green dot in that situation is a false claim of freshness.
If an endpoint exposes no timestamp, show no heartbeat and say the age is unknown —
the same rule as an empty state saying why it is empty.

## Tier 2 — State changed

Motion that confirms the user's own action. Brief, 120–250ms, and never looping.

- Open/close: dialogs, drawers, accordions, popovers
- Selection and tab changes
- Hover and focus affordances on things that are actually interactive
- A row entering or leaving a list the user filtered

## Tier 3 — Navigation

Route and view transitions. At most one per navigation, under 300ms.

## Tier 0 — Ambient

**Marketing surfaces only** — the landing page, and only there. The app itself
gets none of this.

- `PredictiveArc` on the landing hero
- Scroll-driven reveals on the landing page

The distinction is that a visitor is being introduced to the product, while a
user is trying to read it. Cinematic is correct in the first case and hostile in
the second.

---

## Rules that apply to every tier

1. **Nothing loops on a data surface.** A looping animation next to a number
   competes with the number. `Heartbeat`'s pulse is the single exception, and it
   earns it by encoding freshness rather than decorating it.

2. **Honour `prefers-reduced-motion`.** `usePrefersReducedMotion()` lives in
   `viz/index.tsx`. Under it: no tweening, no pulsing, no parallax. Values still
   update, state still changes — only the motion stops.

3. **Nothing animates off-screen.** Pause on `IntersectionObserver`, or render on
   demand. Frames spent on something nobody is looking at are pure cost.

4. **Motion never conveys anything colour or text is not already conveying.** A
   flash draws the eye to a change; the number states it. Anyone with motion
   disabled must lose nothing but the cue.

5. **Deleting animation is part of this work, not a failure of it.** Most of the
   value in this phase is removing motion that competes, not adding more.

---

## Current adoption

Measured 22 Aug 2026. The primitives were built and then largely never wired in,
which is the actual gap this phase closes.

| Primitive | Files using it |
|---|---|
| `Heartbeat` | 0 → wiring in progress |
| `LiveValue` | 1 |
| `ScoreDial` | 1 |
| `Sparkline` | 1 |
| `ParticipationStrip` | 1 |
| `RangeBar` | 3 |

78 components poll on an interval. Every one of them is a Tier 1 surface and
should show, at minimum, whether what you are looking at is current.

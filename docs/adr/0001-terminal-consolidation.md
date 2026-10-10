# ADR 0001 — Consolidate to one Terminal shell

- **Status:** Accepted
- **Date:** 2026-08-19

## Context
QuantEdge grew to 8 shells, ~60 pages, ~700 API routes, and 3 competing navigation
systems (left sidebar + top search + per-page tabs). MomoEdge — the design template —
uses a single terminal: one persistent chrome, five top tabs, one motion system, and a
context panel that interprets the data. Cohesion there comes from *one grammar applied
five times*, not from five pretty pages.

## Decision
Build **one Terminal shell** at `/t` with five tabs (Oracle · Flow · Heatmap · GEX ·
PRISM), a shared motion system (`lib/motion.ts`), and a right-hand CONTEXT panel that
renders the reasoning the engines already compute. Fold the legacy shells into tabs
one at a time; retire each shell only when its tab reaches parity.

**Navigation moves off the sidebar to top-nav** (see ADR-0002 when written): the five
tabs are the primary nav; utilities (search, watchlists, alerts, settings, profile) move
to a top-right cluster; Research becomes a ticker-keyed slide-over; Positions/Journal
become a "Desk" menu. Scoped to `/t` first so it's reversible.

## Consequences
- **Good:** one cohesive surface; the interpretation layer (our real differentiator) finally
  renders; the AUDIT keep/cut plan gets an execution target.
- **Cost:** every tab must be rebuilt to the grammar; some current destinations become
  secondary surfaces rather than top-level pages.
- **Risk:** parity gaps during the fold — mitigated by keeping legacy shells live until each
  tab is done.

# Team — how we work

For a small team (you + a few) shipping a large codebase without it turning back into
sprawl. Right-sized: enough process to stay coordinated, not so much it slows you down.

## Single source of truth: GitHub
Everything lives in the repo and its GitHub surfaces. No work exists unless it's an Issue.

- **Board** — GitHub Projects, one board, columns: `Backlog → Next → In Progress → Review → Done`.
  Nothing is "in progress" in someone's head; it's a card.
- **Issues** — every task/bug/idea. Title is an outcome ("Oracle tab: price-ladder + context panel"),
  body has acceptance criteria.
- **Labels** — `area:oracle|flow|heatmap|gex|prism|engine|data|infra` · `type:feat|bug|chore|docs` ·
  `prio:P0|P1|P2` (P0 = broken in prod, drop everything).
- **Milestones** — one per Terminal tab + "Consolidation". A milestone is *done* when its tab reaches
  parity and the legacy shell is retired.

## Code flow
1. Branch off `main` (short-lived): `feat/oracle-ladder`, `fix/neon-archive`.
2. Small PRs. One PR = one reviewable idea. A 40-file PR is a smell.
3. **CI gate before merge:** `npm run check` (tsc) + `npx vite build` must pass. Add these as required
   GitHub checks so red can't merge.
4. One review approval. Author merges. **`main` auto-deploys to Railway** (see RUNBOOK).
5. **Docs update in the same PR** as the code (the one rule from docs/README).

**Definition of Done:** merged · CI green · deployed · docs updated · the Issue's acceptance criteria met · verified in the running app (not just "it compiles").

## Ownership
- `CODEOWNERS` maps areas → people so reviews auto-route. Until the team grows, the lead owns all;
  add entries as people take areas.
- Each Terminal tab gets an owner once staffed — they hold its milestone and its context panel copy.

## Decisions — ADRs
Non-trivial choices get a short **Architecture Decision Record** in `docs/adr/NNNN-title.md`
(context → decision → consequences). One page. This is how a new teammate learns *why*, not just what.
Seed: `docs/adr/0001-terminal-consolidation.md`.

## Keeping everyone updated
- **CHANGELOG.md** (root, keep-a-changelog format) — user-facing changes per release. Update in the PR.
- **Weekly async written update** — what shipped, what's next, what's blocked. Posted to the team channel.
- **Weekly 30-min demo/review** — show the running app, not slides. Pull the next milestone's cards into `Next`.
- **Daily async standup** (one message: yesterday / today / blockers) — only once there's more than one dev.

## Cadence at a glance
| When | What | Output |
|---|---|---|
| Daily | Async standup (multi-dev only) | blockers surfaced |
| Per PR | Review + CI gate | merged, deployed, docs current |
| Weekly | Demo + plan next milestone | board refilled |
| Per decision | ADR | `docs/adr/*` |
| Per release | CHANGELOG + async update | team knows what changed |

## Guardrails that keep sprawl from returning
- **No new root `.md` files** — docs go in `docs/` (see README). New top-level doc = rejected PR.
- **Consolidate before you add** — a new page/service must say what it replaces (link the AUDIT).
- **One shell** — features land in the Terminal tabs, not new standalone shells/routes.

# QuantEdge — documentation canon

**Start here.** This folder is the *single source of truth*. The ~40 loose `.md`
files at the repo root grew over many vibe-coding sessions and overlap/contradict
each other — they are **superseded** (see the list below) and kept only as history.

## The canon (read in this order)
| Doc | What it answers | Audience |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the platform is built — the hierarchy diagram + interpretation | Everyone |
| [ONBOARDING.md](ONBOARDING.md) | Get it running locally in 15 min | New dev, day 1 |
| [RUNBOOK.md](RUNBOOK.md) | Operate it — deploy, incidents, the gotchas that bit us | On-call / whoever ships |
| [TEAM.md](TEAM.md) | How we work — board, branches, PRs, cadence, decisions | Everyone |
| [../TERMINAL_SPEC.md](../TERMINAL_SPEC.md) | The MomoEdge teardown + the UI/engineering pattern catalog | Design + frontend |

Supporting (still current): `../DESIGN_SYSTEM.md`, `../CALCULATIONS.md`,
`docs/adr/` (decision records), `../CHANGELOG.md`.

## The one rule
**Docs change in the same PR as the code they describe.** A doc that drifts from
the code is worse than no doc. If you can't update the doc, the PR isn't done.

## Superseded (history only — do not trust as current)
Root: `PLATFORM_ARCHITECTURE.md`, `PLATFORM_COMPARISON_AND_ROADMAP.md`,
`PLATFORM_SIMPLIFICATION_PLAN.md`, `PAGE_AUDIT.md`, `LOGIC_AUDIT.md`,
`QUANT-AUDIT.md`, `NAVIGATION_GUIDE.md`, `RESEARCH_GRADE_*.md`, `VISUAL_ENHANCEMENTS*.md`,
`SESSION_SUMMARY.md`, `IMPROVEMENTS_IMPLEMENTED.md`, `*_REDESIGN.md`, and the rest of
the root `.md` sprawl. `docs/ARCHITECTURE_HIERARCHY.md` + `docs/TECHNICAL_DOCUMENTATION.md`
are folded into `ARCHITECTURE.md`.

> Cleanup task (TEAM.md backlog): move the superseded files into `docs/archive/` in one
> sweep so the root is clean. Not done yet — flagged so nobody adds doc #41 to the root.

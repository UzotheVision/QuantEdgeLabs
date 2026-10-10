# QUANTEDGE TERMINAL — Design System Brief

The mock author's design language, codified. This is the source of truth for
every new surface. The reference mocks (NEXUS, CHART, FLOW, GEX, LEAPS,
CRYPTO, BOT, WORKUP) were wired verbatim; screens composed without a mock
must be built from this brief.

Two standing platform rules override the brief where they conflict:
1. The operator explicitly requested a light theme toggle — it stays,
   implemented as re-grounds over the same tokens (§13's "never light mode"
   yields to the operator's own instruction).
2. §09's "price jitter" is fabrication. Motion only ever rides real data:
   a cell flashes when a real quote changed, never on a timer with noise.

---

## 01 · PHILOSOPHY

- **Terminal first, website never.** This is a cockpit, not a marketing page. Respect the operator's attention.
- **Density without clutter.** Every pixel earns its place. Whitespace is structural, not decorative.
- **Cinematic darkness.** Deep near-black backgrounds (#06070a → #0a0c11) with luminous accents. Light is earned, not given.
- **Data is the hero.** Typography, color, and motion exist to make numbers and relationships legible at a glance.
- **Silent motion.** Animations are ambient (particles, scanlines, subtle pulses) — never distracting.
- **Module identity.** Each module has its own accent color, but the skeleton is shared.

## 02 · COLOR SYSTEM

### Base
```
--bg:          #06070a
--bg-2:        #0a0c11
--panel:       rgba(14,17,23,0.72)
--panel-solid: #0e1117
--panel-2:     #131720
--panel-hi:    #1a1f2a
--nx-border:      rgba(79,209,197,0.08)   (renamed from --border: shadcn holds
--nx-border-hi:   rgba(79,209,197,0.18)    an HSL triplet under that name)
```

### Text
```
--text:       #e8ecf3
--text-dim:   #8b93a3
--text-mute:  #525a6b
```

### Semantic
```
--cyan:       #4fd1c5   (primary accent, Oracle/Chart)
--green:      #3ddc97   (positive, long, calls)
--red:        #ff5470   (negative, short, puts)
--amber:      #f5b642   (warning, partial data)
--purple:     #a78bfa   (secondary, options)
--blue:       #60a5fa   (tertiary)
```

### Module accents
```
ORACLE   → cyan      GEX      → amber/orange
CHART    → cyan      LEAPS    → gold (#fbbf24)
FLOW     → green     CRYPTO   → btc-orange (#f7931a) + eth-purple (#8b7ee0)
CATALYST → event-orange (#fb923c)
BOT      → bot-blue  (#38bdf8)
```

### Rules
- Every accent gets a `*-bright` (glow) and `*-dim` (pressed) variant.
- Glow via `text-shadow` / `box-shadow` at 0.3 opacity — never full saturation.
- Red/green are **semantic only** — never use them decoratively.

## 03 · TYPOGRAPHY

Three fonts, strict roles:

| Font | Role | Use |
|---|---|---|
| **Space Grotesk** | Display | Module titles, ticker symbols, big numbers |
| **Inter** | UI | Body, labels, descriptions |
| **JetBrains Mono** | Data | Prices, stats, timestamps, codes, badges |

### Scale
```
Display:   22–28px, weight 700, letter-spacing -0.02em
Title:     14–16px, weight 700
Body:      12.5px (root), weight 400–500
Caption:   10–11px, weight 600, uppercase, letter-spacing 0.8–1.2px
Data:      10–13px, JetBrains Mono, weight 600–700
```

### Gradient text — module titles only
```css
background: linear-gradient(135deg, #fff, var(--module-accent-bright));
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
```

## 04 · LAYOUT PRIMITIVES

- Global grid: `44px topbar · 28px ticker-tape · 1fr main · 26px bottombar` (the shell owns all chrome).
- Two-column default: `minmax(0,1fr) var(--nx-side,320px)`; three-column for dense modules.
- Columns separated by `1px solid var(--nx-border)`; rails drag-resizable via useColResize.
- Every column's first section: `position: sticky; top: 0` with backdrop blur.
- Section anatomy: `.sec-num` (mono 10px accent uppercase) → `.sec-title` (Grotesk gradient) → `.sec-sub` (Inter 11px dim) → `.sec-meta` (tag pills).

## 05 · COMPONENT LIBRARY

- **Tag/pill**: 2px 7px, 10px/600, radius 3px. Variants `.live .mute .cyan .amber .event .bot .btc .eth`.
- **Status chip** (topbar): pulsing dot, `.ok`/`.warn`, uppercase.
- **Card**: `linear-gradient(135deg, var(--panel-solid), var(--panel-2))`, 1px `--nx-border`, radius 6–8px, hover = border-hi + translateY(-1px).
- **Accent-bar card**: `::before` 2px left edge in module color with glow.
- **Stat card**: 9px uppercase label → 14–16px mono value → 9.5px sub; top hairline gradient in module color.
- **Data table**: sticky `--bg-2` header, hover `rgba(accent,0.04)`, mono numbers, hairline borders, never zebra.
- **Grades**: S → gold, A → cyan, B → blue, C → muted.
- **Buttons**: primary = accent gradient + dark text + glow; ghost = transparent + border-hi.

## 06 · INTERACTIVE CARDS

1. Hover = commitment: lift 1–2px, border brightens.
2. Click = focus: 1px accent border + soft outer glow at 0.15.
3. State always visible — never hidden behind hover.
4. A card must read at 240px wide AND full-width.

Symbol clicks anywhere open the universal Ticker Workup (workup-bus).

## 07 · 3D & IMMERSIVE

- GEX Prism (Three.js strike×expiry mesh) and Chart Lab 3D are the only 3D surfaces; always with a 2D fallback. Camera 0.002–0.003 rad/frame, fog #06070a 15–40, wireframe overlay 0.12.
- Ambient canvas per mock page at 0.5 opacity; scanlines at 0.012 overlay; vignette radial.

## 08 · MOTION

| Element | Duration | Easing |
|---|---|---|
| Hover lift | 200ms | ease |
| Card reveal | 300ms | cubic-bezier(.2,.8,.2,1) |
| Modal open | 250ms | fade + slight scale |
| Pulse dot | 1.8s | infinite |
| Brand spin | 8s | linear infinite |
| Ticker tape | 90–100s | linear infinite |
| Progress fill | 800ms | cubic-bezier(.2,.8,.2,1) |

Never animate on scroll except first viewport entry.

## 09 · LIVE DATA PATTERNS (integrity-gated)

- Ticker tape: infinite scroll, duplicated content, fade edges — PAUSES and labels itself when quotes go stale.
- Cell flash on change: only when a REAL value changed. No synthetic jitter, ever.
- Log streams: new entries slide in 0.4s; entries are real events.
- Pulsing dots mean a live feed is actually connected.
- Unmeasured values render `NOT MEASURED` / `—`, never a placeholder number.

## 10 · ACCESSIBILITY

- Contrast ≥ 4.5:1 body, 3:1 display. Never color alone — pair icon/label/position.
- Monospace for anything compared numerically. Touch targets ≥ 32px.
- `prefers-reduced-motion`: disable particles, tape scroll, pulses.

## 11 · BEFORE BUILDING A NEW SCREEN

Ask (or resolve from context): module? primary operator action? density?
live or snapshot? 3D justified? right-sidebar context?

## 12 · IMPLEMENTATION NOTES (this codebase)

- All module CSS lives in `client/src/styles/nexus.css`, one scoped block per
  page (`.nexus-embed .chartlab .flowlab .gexlab .leapslab .cryptolab .botlab
  .workuplab .catalystlab`), tokens on `.nexus-vars`.
- The shell (`terminal-shell.tsx`) owns topbar/tape/bottombar; pages are
  embedded boards.
- Charts: `NexusPriceChart` (pan/zoom/expand, wick-clamp disclosure) — never
  hand-rolled candles.
- Rails: `useColResize`. Workup: `openWorkup()` from `lib/workup-bus`.

## 13 · ANTI-PATTERNS

- ❌ Rounded corners > 12px · drop shadows (use border glow) · >3 fonts
- ❌ Color without semantic meaning · marketing copy · generic dashboards
- ❌ Icons without labels in dense contexts · animations >1s unless ambient
- ❌ Fabricated data of any kind — jitter, random walks, placeholder stats

## 14 · SCREEN MAPPING

| Screen | Accent | Primary component | 3D? |
|---|---|---|---|
| Oracle | cyan | Signal cards + ranked book | no |
| Chart | cyan | Candle chart + OHLC | optional |
| Flow | green | Options flow table | no |
| GEX | amber | Strike×expiry matrix | yes (Prism) |
| Leaps | gold | LEAPS card grid | no |
| Crypto | orange/purple | Spot cards + proxy board | no |
| Catalyst | event-orange | Calendar + impact table | no |
| Bot | bot-blue | Bot cards + rules table + log | no |
| Ticker Workup | contextual | Modal with 5 tabs | optional |

When in doubt, default to **density, darkness, and data**.

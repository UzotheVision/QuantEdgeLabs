# QuantEdge — approved identity tokens

Generated via Higgsfield Brandkit. Palette rev 1, typography rev 1.
State: `brandkit/state.json`. Editable boards: `brandkit/reviews/`, `brandkit/type/`.

## Palette — "Cold Read"

| Role | Name | Hex | HSL (theme var) |
|---|---|---|---|
| background | Deep Navy | `#0E1420` | `220 39% 9%` |
| support / card | Slate | `#161E2C` | `218 33% 13%` |
| text | Cold Light | `#D6DEE8` | `213 28% 87%` |
| primary / signal | Ice Signal | `#78C6E8` | — |
| accent up | Moss | `#6E9E7A` | — |
| accent down | Clay | `#B5705F` | — |
| border | (derived) | — | `218 25% 20%` |
| muted text | (derived) | — | `213 15% 62%` |

Contrast: Cold Light on Deep Navy ≈ 13.5:1. Passes AAA for body text.

**Why these:** forensic and dispassionate. A navy-black base rather than neutral
black, so the surface reads as evidence rather than console. Moss and Clay replace
the casino green/red — a losing position should read as a fault light, not a
catastrophe, which matters on a product whose honest expectancy is negative.

## Typography — "Technical Editorial"

| Role | Family | Weights |
|---|---|---|
| display / prose | Space Grotesk | 400 500 600 700 |
| data / numerals | Spline Sans Mono | 400 500 600 700 |

- https://fonts.google.com/specimen/Space+Grotesk
- https://fonts.google.com/specimen/Spline+Sans+Mono

Space Grotesk has drawn quirks that survive at display sizes, so headlines get
personality without adding a third family. Spline Sans Mono stays quiet under
dense columns.

**Rule:** mono is for numbers, tickers, and anything that benefits from aligning.
Everything else is Space Grotesk. See `.ui-data` / `.ui-eyebrow` / `.ui-prose`
in `client/src/index.css`.

## Ported into

- `client/src/index.css` — `.dark` core palette, `--brand-cyan`, `--trade-bullish`,
  `--trade-bearish`, `--font-sans`, `--font-mono`
- `client/index.html` — Google Fonts preload/stylesheet

## Not done

No logo. It was deprioritised against a 10-credit budget, and logo generation is
the only paid step — palette and typography rendered locally at zero cost.
Credits remain intact.

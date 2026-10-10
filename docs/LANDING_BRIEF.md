# QuantEdge — landing page design brief

Paste this whole file as the prompt. It is written to be specific enough that the
output can't be a template.

---

## The subject

**QuantEdge** is an options research terminal. Not a broker, not a signals group,
not a course. It reads the options chain and price structure and tells you what
conditions exist right now on a stock.

**Who it's for:** one person trading their own money. Small account, options not
shares, mostly semiconductors and AI infrastructure. They already know what a
gamma flip is. They are not a beginner and they are not an institution — this is
somebody at a desk at 6am ET before the open, deciding what to look at.

**The page's single job:** convince a competent retail options trader that this
tool is honest with them. Not that it will make them money.

---

## The thesis — build the page around this

Every product in this category promises certainty. Win-rate badges, green candles,
"10X YOUR PORTFOLIO," a testimonial from someone in a rented Lamborghini.

**QuantEdge's actual differentiator is that it tells you what it doesn't know.**

That is not a tagline, it is how the software genuinely behaves:

- Options prices come from a free delayed feed, and every price is **labelled
  delayed** rather than passed off as live.
- The paper-trading bot shows **no win rate at all** until real trades close,
  because a number before then would be invented.
- The published track record shows **38.5% win rate and −0.36% expectancy per
  trade** — a negative number, displayed prominently, because it is the true one.
- Trades that resolved neither way are shown as a **neutral bucket** instead of
  being quietly dropped to make the win rate look better.
- When a section is empty it says *why* it's empty — "no tracked event landed
  inside the horizon" — never a blank space implying all-clear.

**The design should feel like a measuring instrument, not a slot machine.** A
seismograph, a spectrometer, a pair of calipers. Something built to report a
reading accurately, including when the reading is bad news.

The boldest move available: put the negative expectancy number **on the page, at
size**. Nobody in this category does that. It is the most persuasive thing here.

---

## What it actually does — use these, they're real

Seven surfaces, real names:

| Surface | What it does |
|---|---|
| **ORACLE** | Scores setups across 15 independent layers. Stops sit under real swing lows padded by ATR; targets sit at prior structure. Minimum 1.5R or it moves the target and says so. |
| **FLOW** | Options flow, ranked by open-interest growth rather than premium — because premium can't tell accumulation from churn, and open interest can. Tracks repeat buyers and whale exits. |
| **GEX / PRISM** | Where dealers have to hedge. Gamma flip, call wall, put wall as levels. Full strike × expiry surface. |
| **CATALYST** | Upcoming events joined to live signals — and it leads with **conflicts**, where the calendar disagrees with the direction we published. |
| **BOT** | Paper-trades the board's own signals in contracts, not shares, at real quotes pulled at that moment. |

Real numbers you may use: 285 tickers scanned · 15 conviction layers · marks ~15
minutes delayed · gap fill rates measured per-ticker from its own history.

---

## Hard constraints

- **Never imply returns, profit, or advice.** No dollar figures as outcomes. No
  "start winning." The operator is not a licensed advisor and the page must not
  read as if he is.
- Every claim on the page must be one of the facts above. Invent no statistics.
- Dark interface. This is used before dawn and during market hours.
- Must survive real density — this links to a tool with 15-column tables.

## Explicitly do not

- **No cream background with a high-contrast serif and a terracotta accent.**
- **No near-black with a single acid-green accent.** The product already looks
  like this and it reads as generic. Green-on-black is the default, not a choice.
- No broadsheet layout with hairline rules and zero border-radius.
- No 01 / 02 / 03 numbered sections. These are seven parallel surfaces, not a
  sequence, and numbering them would assert an order that isn't there.
- No hero with a big number, a small label, and a gradient.

## What I want back

1. A palette of 4–6 named hex values, with the reasoning for each.
2. Two typefaces: a display face with an actual point of view, and a body face.
   **Not** Inter, **not** IBM Plex — the product already uses Plex and it is why
   everything currently reads the same. Mono is acceptable for *numbers only*.
3. A type scale with real contrast between steps, and the tracking per step.
4. One signature element the page is remembered by — and it should embody the
   honesty thesis, not decorate around it.
5. The built page, responsive, keyboard-focusable, reduced-motion respected.

Spend the boldness in one place. Everything around it stays quiet.

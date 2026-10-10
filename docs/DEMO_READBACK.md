# The 28-minute walkthrough — read back, segment by segment

Not a summary. What he says, what it means for the product, and whether we have it.
Legend: ✅ built · ⚠️ partial · ❌ missing

---

## 0:00–3:30 — ORACLE (he opens here, but it is NOT where he starts his day)

**0:15 "you have this here, which is the Oracle kind of sphere. That's going to tell you if
we're bullish, bearish, or neutral on the market."**
The orb is a *verdict*, not decoration. ✅ we have it.

**0:22–0:33 "we're mostly neutral on everything outside of crypto. Crypto, we're a bit
bearish on still. We just see this as a relief bounce."**
Critical: the regime is **per asset class**, not one number. He names equities, dollar,
crypto separately, and at 2:21 adds "we're bullish on the dollar." ❌ **our orb is SPY-only.**

**0:41–0:45 "This shows you the active signals... the confidence... the stream. Currently
have three active plays."**
Three. Not thirty-nine. A short, curated list. ⚠️ we show 39 — that is a wall, not a stream.

**0:45 "You could filter it right here by best, conviction, or new."** ❌ missing.

**1:00 "you'll see the stops we set, the entry, the T1, T2, what to do now, and the signal
thesis."**
**T2** — a second target. ❌ we only have T1. "What to do now" ✅.

**1:08 "if you wanted to see what option recommendation is, it would be broken down here."**
✅ Contract Engine.

**1:08–1:18 "You can also break it down by chart... via TradingView. You can set up your
own indicators on our platform."**
❌ user-configurable indicators.

**1:26 "We have history here if you want to track the external performance."**
**3:09 "historic performance is all here, win rate, etc. You can see our active trade."**
Public accountability sits one click from the signal. ⚠️ we have WinRateService but it is
not surfaced in the Terminal.

**1:33–3:29 "notifications where you guys set it up... just to set up sounds and everything
else... you go to settings and you just want to get alerts for stuff."** ❌ missing.

**1:42 "There's Oracle guide too, where we updated a lot of stuff that'll tell you about
this specific page."** ✅ built (per-tab guide).

---

## 3:36–6:19 — FLOW ("our hero product")

**3:36 "one of my favorite features and this is really going to be our hero product... our
flow scoring mechanism."**

**3:45–3:53 "this is EY, somebody spent $1.2 million on the 190 strike for July 31st.
That's 4% out the money, each contract is $1,100."**
Read that literally. One card = **one order**: ticker · premium · strike · expiry · **% OTM**
· **per-contract price**. ⚠️ we render all of these, but CBOE gives us daily aggregate per
contract, not a single order. **This is the data-feed wall, not a UI gap.**

**4:00–4:16 "why this was ranked high is because it looks like AI might be coming close to
a bottom... it might get a relief rally."**
The score is not mechanical — it encodes a *thesis about the sector*. ❌ ours is mechanical.

**4:31–4:48 "utilize charts too just to make sure it works, because a lot of these are just
people with big money buying contracts and not understanding the charts — or they have
insider information sometimes."**
Flow is a lead, never an entry.

**4:48–4:56 "this is also the market overview sector here. There was a lot of bullish and a
lot of bearish flow today. QQQ had a lot of strong bullish flow."** ✅ built.

**4:56–5:04 "if you wanted to add anything to your watch list, you can set it up here."** ✅.

**5:04–5:11 "If you wanted to search up a ticker that's not actively here and just see the
past flow of the week or two weeks."** ✅ (window switch 1D/1W/1M/ALL).

**5:11–5:18 "This was a low score that actually killed it. This BABA contract was July 17th
103 calls. BABA right now is at 110. So this flow 4 or 5x'd from there."**
**A LOW SCORE 5x'd.** The score ranks; it does not gate. And note what he is doing: looking
*back* at a past card to see what happened. ❌ **nobody tracks flow outcomes — including him.**

**5:27–5:34 "you want to look at the chart, what the upside could be, and if the stock's
been heavily sold as to how it can scale back."**

**5:42–5:51 "We also have a flow guide — how to read a flow card, what the flow tab shows,
conviction score and tiers, sweeps, whales, and W badges, watchlist, quick tips."** ✅.

**6:01–6:09 "filter it by score, direction, type, premium size, if it's a sweep, if it's a
whale."** ✅ all six built.

**6:09 "there was actually a QCOM whale today. I don't think we've had a whale in like two
days."**
Whales are **rare** — a couple a week. Ours would flag dozens because we score aggregate
volume. Confirms the feed problem.

---

## 6:27–10:19 — HEATMAP (where the day ACTUALLY starts)

**6:34 "the heat map for the S&P showcases all the individual stocks, how they performed on
the day price-wise."** ✅ treemap.

**6:41 "If you wanted to filter it by flow, you can do that here."** ⚠️ ours has a flow
overlay but not a clean toggle.

**6:41–6:57 "you click through and it looks like, wow, NVIDIA had crazy call flow today...
$18 million in calls, because NVIDIA announced sales to China."**
Click a cell → per-ticker flow detail. ✅ we have the detail panel.

**7:06 "You can filter it out by table."** ⚠️.

**7:06–7:29 "I like to look at the best performing tickers on the day... it has the industry
here and it has best performers."** ❌ **best/weakest lists by industry — missing.**

**7:45–8:00 "I like to look at the weakest performers of the day. So biotech has been
killing it. They took a hit today... And then there's airlines, which makes sense because
gas soared."**
He reasons across industries — cause and effect, not just colors.

**8:15–8:31 "We're going to have an *ask oracle* where you can basically ask questions —
what sectors are leading today, what's the highest flow amount stock today."**
❌ **planned, not built. We already run multi-provider AI.**

**9:20–9:27 "the RS is based on volume traded."** ⚠️ our RS is price-relative vs SPY.

**9:39–10:09 "I'm on the platform in the morning looking at the sector heat map when the
market opens... then I'll hop into flow — typically takes like 15 minutes for flow scoring
to come in."**
**10:19 "10 a.m. is when I typically start."**
✅ our scanner cron now matches (9:45–15:45).

---

## 11:38–13:24 — How he actually picks a name

**11:45–11:52 "with AAM... they basically power semiconductors. So it's more an AI trade
rather than software."**

**12:33–13:15 "if I'd seen it in the morning I would look at all the other AI plays — NVDA,
AMD, ARM... I think Cloudflare went crazy as well, so cybersecurity was getting bid up. I
would look at those individual sectors, see which ones are lagging, see which ones have the
most opportunity, and then line up Prism with it."**
**He never trades the ticker in isolation — he trades the peer group and picks the best
chart in it.** ❌ no peer-group view.

**13:32–13:48 "if you want to search up a ticker... you type AAM in the search bar, and
then you go to Prism and it's going to pop up for you."**
✅ built — shared ticker across tabs.

---

## 13:57–20:28 — PRISM (the biggest block of the video)

**13:57–14:06 "Green is call side, red is put side. If it's positive, there's more call flow
on this individual strike. If negative, more put flow."** ✅.

**14:13–14:26 "there's a lot of green upper nodes to the downside as well — these are heavy
support for call sides. Even if AAM went down, 127.50 would be a big level because it's a
big call wall."** ✅ call wall / put support.

**14:26–14:42 "131 looks good cuz it's lit up. But I would also do maybe the 135s for July
17 — that way it gives me enough time."**
**Lit up = tradeable level. And immediately: buy more time.** ✅ both built today.

**15:11–15:20 "let me just expand the range. We'll do the range and then the strikes."**
⚠️ we have DTE buckets + strikes-around-spot; no explicit ± range control.

**15:42–15:50 "if you wanted to look at 0DTE you can click this here. If you wanted to look
at all together — all the outstanding gamma flow — you could see this here."**
❌ **0DTE and ΣALL scope toggles missing.**

**15:58 "the ones that are lit up have the higher chances of hitting."**

**16:01–16:10 "I know the 410 is lit up for Friday. I like to buy time... July 17 410 calls
are better, or potentially 420."** ✅ our nudge fires exactly here.

**16:25–17:21 (SPY)** "SPY, as an example, 740 was lit up since yesterday. It hit 740 in the
morning... there's a huge wall at 750 that can gravitate SPY... if it breaks 745 it can
plunge to 740, and if it breaks up we can lean to 750+."
**This is the one place SPY belongs — reading the market's own levels.** He arrives here
*after* AAM, TSLA. So SPY is a **destination, not a default.** ⚠️ ours defaults to SPY.

**18:21–18:45 "next week is OPEX. A lot of these numbers are overexposed because there's a
lot of options expiring."**
**25:24–25:46 "OPEX has a lot of people that bought calls a month, two months, three months
out for July 17 that haven't sold yet, so there's a lot of outstanding gamma."**
❌ **OPEX distortion awareness — completely missing.**

**18:54–19:34 (META)** "Meta was lit up for 625 for Friday... he made 250% in like an hour.
Again, I like buying time — let me get the 640 calls for August."

**19:41–19:50 "we have a top 50, but you can search this up if you wanted to look at
individual stocks on GEX and then it'll transition over here."**
**A ranked top-50 that hands off into PRISM.** ⚠️ **this is the GEX-hub × PRISM link.**

**19:50–20:06 "The Confluence... It'll show you all three tickers, what the upper nodes are,
what the lower nodes are."** ❌ SPX/SPY/QQQ confluence.

**20:06–20:15 "You can also filter out by VEX, open interest, volume, unusual. And then the
ranges, how many days out, the metric and the scope."**
⚠️ we have GEX/VEX only. ❌ OI / VOL / UNUSUAL lenses.

---

## 20:28–23:13 — The loop closing: FLOW → PRISM → GEX

**20:28–20:46 "how I'll typically do it — I'm going to go back to flow. So QCOM, this whale
trade looks interesting. Let me dive into Prism on QCOM."**
**This is the product.** A flow hit is a *question*; PRISM answers it. ✅ our flow card sets
the shared ticker → PRISM follows.

**20:46–21:17 (QCOM)** "decent negative exposure but higher positive... 190 is a big level it
could break and get to 200... I'd buy that same expiration or a little further out. 185 is a
huge level — as long as it holds above, the chart looks decent."

**21:25–22:09 (ORCL)** "Oracle had the same flow as yesterday, the 147 July 31st. **It looks
like this whale keeps buying it.**"
❌ **repeat-whale detection across days.**

**22:33–23:13 (TSLA, in GEX) "The magnet is 400 here... this is where it flips into positive
gamma territory when it passes 400. So it'll be a huge flip of momentum."**
✅ magnet + flip exist. ⚠️ not phrased as that sentence.

---

## 23:44–26:49 — Rules and his own gaps

**23:44–23:59 "time is your best friend. Just because something says July 17 doesn't mean
you have to take it. If we have a signal that says August, you can always get September."**
Said for the 5th time. ✅ now encoded in PRISM.

**24:24–24:42 "add meta to your watch list on flow scoring, and if anything popped up
unusual you go on Prism and it'll show you. That's how you can alert yourself."**
❌ watchlist → unusual-flow alert → PRISM loop.

**24:42–25:03 "And the stars there, what does that mean?"** ❌ star/standout badge.

**26:17–26:49 "I'm like 90% sure they closed out. **I have to have an unusual basically
showcasing if a whale exited.** ... I want to add a tracker that shows when whales sell.
That'll be included potentially in the next couple weeks."**
❌ **HIS BIGGEST ADMITTED GAP. Entry without exit is half the trade.**

**28:07 "I typically don't touch anything under 75. I've been looking a little bit lower
because sometimes flow gets me missed in terms of chasing, but if the chart lines up, I'll
buy it."**
Even his own threshold is a guideline he overrides on chart confirmation.

---

## What this changes about our build order
1. **GEX top-50 ranking → PRISM hand-off** (19:41) — the missing spine between two tabs.
2. **Heatmap best/weakest by industry** (7:06) — where his day starts.
3. **Whale-exit tracker** (26:43) — he says it out loud; not built anywhere.
4. **Per-asset-class regime** (0:22) — orb is currently SPY-only.
5. **OPEX awareness** (18:21) — silently distorts every gamma read near monthly expiry.
6. **PRISM: 0DTE / ΣALL scopes, OI/VOL/UNUSUAL lenses, confluence** (15:42, 20:06).
7. **Ask Oracle** (8:15) — planned by him, and we already have the AI stack.

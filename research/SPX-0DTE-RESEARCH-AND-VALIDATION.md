# QuantEdge SPX / index 0DTE research and validation plan

Date: 2026-09-25
Status: implementation baseline; performance claims withheld pending quote-path validation

## Executive conclusion

The screenshot proves that a set of SPX calls produced large realized gains. It does not disclose the losing trades, selection rule, execution timestamps, bid/ask fills, account drawdown, or whether the displayed rows were selected after the fact. QuantEdge must not optimize to those rows. The defensible goal is a small, auditable family of index-0DTE policies whose direction, contract, fill, risk, and exits can all be replayed without look-ahead.

The current code already has useful building blocks—GEX regime, gamma flip/walls, VWAP, ORB, volume delta, Bullflow net premium, and intraday scheduling—but previously joined them too loosely. The scanner also attached a heuristic strike and estimated premium instead of selecting an account-fit contract from a live chain. That execution defect is now gated.

## What the evidence supports

1. **Gamma is a regime variable, not a standalone direction signal.** Research finds positive market-maker gamma is associated with lower subsequent intraday volatility and stronger reversal; negative gamma is associated with momentum. Use positive gamma for fades/pins and negative gamma for confirmed breaks, never one universal interpretation.
2. **Opening 0DTE order flow contains some short-horizon downside information.** Gamma-weighted put/call opening flow has evidence for predicting the occurrence of a negative next hour, but not the depth of extreme declines. It belongs in a confirmation gate, not a price target model.
3. **Near-expiry contracts are extremely sensitive to small underlying moves.** Cboe explicitly warns that near-the-money 0DTE options require close monitoring. This supports time stops, one-position limits, and smaller risk—not promises of routine 2–3× returns.
4. **SPXW mechanics matter.** SPXW is European style, cash settled, has a $100 multiplier, and expiring SPXW ordinarily stops trading at 4:00 p.m. ET. Standard AM-settled SPX and PM-settled SPXW must not be mixed in expiration logic.
5. **Flow needs execution-side context.** A call can be sold and a put can be sold. Contract type alone is not direction. Bullflow's provider classification or measured ask-vs-bid net premium is required.

Primary sources:

- Cboe SPX specifications: https://www.cboe.com/tradable-products/sp-500/spx-options/spx-specifications
- Cboe 0DTE resources: https://www.cboe.com/tradable-products/0dte
- Cboe/OI paper, *0DTE Index Options and Market Volatility*: https://www.cboe.com/optionsinstitute/research
- Dim, Eraker, Vilkov, *0DTEs: Trading, Gamma Risk and Volatility Propagation*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4692190
- Maurer and Müller, *Intraday 0DTE Option Order Flow and S&P 500 Downside Risk*: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7339718
- OCC options risk disclosure: https://www.theocc.com/company-information/documents-and-archives/options-disclosure-document
- Bullflow API docs: https://www.bullflow.io/api/docs

## Proposed policy family

Do not optimize one strategy over hundreds of variants and report the winner. Pre-register three economically distinct policies, then test each chronologically.

### A. Negative-gamma continuation

- Observation window: no entries before 09:45 ET.
- Regime: total GEX negative or provider setup explicitly signals a bearish/bullish node migration.
- Structure: price breaks and holds beyond the gamma flip, call wall, put wall, or 30-minute opening range.
- Confirmation: price on the correct side of VWAP; Bullflow SPY net-premium direction agrees and is strengthening; no contradictory volume-delta divergence.
- Vehicle: long call for upside / long put for downside; strike must be reached by T1; debit and managed stop must fit account budget.
- Invalidation: underlying closes back inside the broken structure or premium hard stop, whichever occurs first.

### B. Positive-gamma wall fade

- Observation window: 10:00–14:30 ET.
- Regime: positive GEX with stable wall/flip locations.
- Structure: excursion into a call/put wall or VWAP deviation band, followed by rejection/reclaim.
- Confirmation: net-premium does not strongly oppose the fade; Bullflow GEX node has not migrated through price.
- Vehicle: debit vertical preferred when outright premium is expensive; long single option only when spread and account gates clear.
- Target: VWAP, gamma flip, or next measured node. Never a fixed formula beyond the structural destination.

### C. Event/no-trade policy

- No new 0DTE entries immediately ahead of FOMC, CPI, payrolls, Powell/Fed remarks, or other scheduled high-impact events.
- After an event, require a fresh opening range and new GEX/flow readings; pre-event walls can become stale immediately.
- No trade when GEX, VWAP, and measured flow disagree. `WAIT` is a valid model output.

## Contract and account gate

Every recommendation must satisfy all of the following:

- Directionally valid underlying ladder: stop on the invalidation side and T1 on the profit side.
- Underlying R:R at least 1.0 before option selection.
- T1 reaches or passes the selected strike in the trade direction.
- Modeled contract return at T1 clears the declared floor.
- Bid and ask are both positive; spread no wider than 15% of mid.
- Long-option paper fill uses the ask, not midpoint.
- One-contract managed loss fits the user's dollar risk budget.
- Contract debit fits the user's debit ceiling and available cash.
- Delayed quote cannot be used during opening price discovery.
- No automatic midpoint fill after a large premium move from publication.

For a trader willing to lose at most $200–$300, standard SPX may frequently be unsuitable. The engine should preserve the SPX thesis but recommend XSP or SPY when a valid SPXW contract cannot fit. It must say `no account-fit contract` rather than manufacture a cheap far-OTM lottery.

Implemented 2026-09-25:

- The cockpit contract panel now accepts account size, maximum managed loss, and maximum debit and persists that local risk profile.
- The quant bot re-selects from the live chain at execution time instead of trusting the signal's stored contract.
- Long-option fills cross at the ask, reject spreads above 15%, and reject delayed opening quotes before 10:00 ET.
- The selected strike must be reached by T1, modeled return at T1 must clear the floor, and one contract must fit both risk and debit limits.
- The index scanner can preserve the SPX structural thesis but execute with liquid SPY 0DTE when SPX cannot fit the configured small-account limits.

### SNOW execution incident

The stored SNOW thesis entered the underlying at `$335`, invalidated at `$300`, and targeted `$350`, while the attached vehicle was a `$420C` expiring 2027-01-15. T1 could not reach the strike and the stock plan offered only `$15` reward against `$35` risk (`0.43:1`). The signal stored a `$15.775` premium, but the bot booked the contract at `$25.18` at 09:38 ET. Its later mark was `$15.80`, a `-37.25%` option loss even though SNOW's stock had risen. That was vehicle/execution failure, not proof the underlying thesis was wrong. The historical position is retained unchanged as an audit record; the new gates prevent the same class of entry.

## Bullflow capability map

| Capability | QuantEdge state | Correct use |
|---|---|---|
| Live alerts SSE | Connected and persisted | Contract-level unusual activity; never infer direction from call/put alone |
| Net premium series | Connected | Direction and slope confirmation for SPY/QQQ/IWM and active-book names |
| Top tickers | Connected | Discovery; request balanced bullish/bearish rows and retain ETFs for index research |
| Net GEX / VEX | Connected as chain fallback | Regime, flip, walls, and node movement |
| GEX setup SSE | Added 2026-09-25 | Live node migration/proximity context and restart history |
| Dark pool trades | Added to ticker workup context | Map meaningful price levels using notional, percent of day volume, and 30-day context; not directional by itself |
| Peak return | Connected | Opportunity labeling only; not win rate or realized P&L |
| Historical replay SSE | Added to research workflow | Point-in-time alert replay from 2025-06-01 onward |
| Last trade price | Added | Provider timestamp/freshness cross-check |
| Custom alerts | Three index-0DTE rules configured | Broad discovery plus separate provider-classified bullish/bearish lanes |

## Backtest design

### Stage 1 — Bullflow opportunity replay

`scripts/backtest-bullflow-index-0dte.ts` replays provider alerts in timestamp order. The base study:

- SPY/QQQ/IWM, 0DTE only.
- Provider-classified bullish calls and bearish puts only.
- 09:45–14:30 ET.
- $25–$300 contract debit.
- Maximum two selected observations per day with a 30-minute same-direction cooldown.
- Chronological 60% train / 20% validation / 20% test split.
- Reports peak-return hit rates, explicitly not win rates.

This stage answers: “Did a qualifying alert later offer +25%, +50%, +100%, or +200%?” It does **not** answer whether a stop occurred first or whether that peak was fillable.

### Completed seven-month opportunity study

The 2026-03-01 through 2026-09-24 run requested 149 weekdays. Bullflow completed 148; 2026-04-03 returned no trade data. The policy selected 288 chronological observations, of which Bullflow resolved 229 peak-return labels (`79.5%` coverage); 59 returned provider HTTP 404/502 and remain unresolved rather than being filled with an assumed result.

| Slice | Resolved observations | Later +25% print | Later +50% print | Later +100% print | Later +200% print | Median best-later return |
|---|---:|---:|---:|---:|---:|---:|
| Train (first 60%) | 136 | 75.0% | 58.1% | 40.4% | 25.0% | 67.65% |
| Validation (next 20%) | 44 | 77.3% | 65.9% | 52.3% | 22.7% | 109.47% |
| Test (last 20%) | 49 | 61.2% | 55.1% | 36.7% | 20.4% | 59.77% |
| All resolved | 229 | 72.5% | 59.0% | 41.9% | 23.6% | 68.49% |

Bullish calls and bearish puts were similar on the resolved sample (`43.1%` versus `40.8%` later +100% occurrence). SPY and QQQ were also similar (`41.0%` versus `42.3%`); IWM had only one resolved observation and supports no conclusion. The test degradation relative to validation and the 20.5% unresolved-label rate are both reasons **not** to turn these figures into a marketed win rate. An executable target-before-stop result remains Stage 2 work.

### Stage 2 — executable quote-path backtest

#### Ten-session ordered-minute pilot (2026-09-14 through 2026-09-25)

The first target-before-stop replay is intentionally classified as **insufficient coverage**, not a bot win rate. It joined 19 selected alerts to reported one-minute option trades, entered at the next minute's first reported trade, charged a 50% premium stop before a 100% target whenever both appeared in one OHLC minute, and capped debit at $200. Only five alerts across three dates had a usable ordered path: one target and four stops (`20%` target-hit rate), `-$164.50` marked P&L, and `0.48` profit factor. Fourteen alerts lacked retained minute-option trades. Five observations cannot validate the strategy, and reported trades are not executable NBBO fills.

The Sept. 25 account-fit `7745C` pilot entered at `$0.75` on the next minute, reached the `$1.50` first target at 15:43 ET, and later collapsed to a `$0.15` final print (with a `$0.05` low). That is precisely why Cockpit must manage a cheap expression rather than merely find it: a first-target exit would mark `+$150` on two contracts, while holding the same lottery into the close would surrender nearly all premium. The older `7740C $2.00 → $7.20` row is a recorded replay, not a paper-bot fill.

Required before deployment or a performance claim:

- Historical option NBBO or quote bars for every candidate contract.
- Underlying 1-minute bars and point-in-time GEX/flow features.
- Signal computed only from information timestamped at or before decision time.
- Entry at next executable ask after the signal; exit at next executable bid.
- Exchange fees, commissions, spread, and slippage.
- Explicit rule when stop and target occur in the same bar; quote/tick ordering preferred.
- Mark-to-market equity and intraday drawdown, not exit-only drawdown.
- Expiration and SPX/SPXW settlement semantics.
- Separate results by year/month, calls/puts, time block, GEX regime, event day, and premium bucket.
- Purged walk-forward evaluation; no overlapping-label leakage.
- Report trade count, expectancy, median return, profit factor, max drawdown, CVaR, consecutive losses, exposure, and confidence intervals.
- Compare against simple baselines: random same-window direction, SPY underlying ORB, and always-long intraday.

The configured Polygon account was tested against an actual replayed QQQ 0DTE option and returned HTTP 403 (`not entitled`) for historical option quotes. Therefore Stage 2 cannot be represented as complete using current subscriptions. Bullflow peak return remains suitable only for Stage 1 opportunity labels; a historical option-NBBO entitlement or broker export is required for executable results.

### Stage 3 — paper shadow

- Minimum 30–50 out-of-sample signals before any “validated” label.
- Broker/paper marks captured at alert, entry, every management decision, and exit.
- No parameter changes during a locked evaluation window.
- Weekly model monitoring: rejection reasons, data-source freshness, performance by regime, and drift.

## Why QuantEdge missed the screenshot move

The Sept. 24 Bullflow replay contained 38,175 trades and 22 Bullflow algo alerts, but zero index alerts before QuantEdge's custom rules were configured. The scanner therefore had no index-specific Bullflow event to receive. A bounded custom rule now captures SPY/QQQ/IWM same-day flow, and separate bullish/bearish rules preserve provider direction in replay.

Even with the alert, a valid system may still abstain. A move can occur without a pre-registered setup. Missing one selected winner is not evidence that the gate is broken; taking every cheap 0DTE contract would increase false positives and tail losses.

## Model-risk controls

- Never call `peakReturn` a win rate.
- Never backfill a missing result with an assumed gain/loss.
- Never grade a historical signal with today's contextual layers.
- Snapshot model version, thresholds, source timestamps, and selected contract at publication.
- Preserve rejected candidates and reasons; rejection-rate drift is a monitoring signal.
- Keep signal correctness, vehicle correctness, and execution correctness as three separate outcomes.
- Any strategy promoted from research must be added to the model inventory and challenger/benchmark register in the SR 11-7 report.

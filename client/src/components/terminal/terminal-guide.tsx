/**
 * TERMINAL GUIDE — the per-tab "how to use this" drawer.
 *
 * Every tab has one (Oracle guide / Flow guide / Prism guide …), so learning is
 * in-context instead of in a manual. Content is the actual desk workflow, not
 * generic help: what the tab answers, how to read it, and what it hands off to.
 */
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { EASE, DUR } from '@/lib/motion';

import type { Tab } from '@/pages/shells/terminal-shell';
// Single source of truth — was a hand-mirrored copy that had already drifted
// (still listed 'heatmap'/'prism' after both folded into GEX).
export type TabId = Tab;

interface Guide {
  title: string;
  question: string;
  read: string[];
  next: string;
}

export const GUIDES: Record<Tab, Guide> = {
  oracle: {
    title: 'Oracle Guide',
    question: 'What do I trade?',
    read: [
      'The orb is the market regime — risk-on, transition, or risk-off. Set your bias before you look at any ticker.',
      'The Rotation Map plots sectors on relative strength (x) vs momentum (y). Leading = strong, Improving = accelerating, Weakening/Lagging = fading.',
      'Signals are ranked by conviction. Click one: the chart, price ladder (stop / entry / live / T1), and "what to do now" all update.',
      'The right rail is the WHY — confidence band, which layers fired, and the market context behind the call.',
      'Contract Engine turns the level plan into an actual strike: conservative / balanced / aggressive with ROI and R:R.',
    ],
    next: 'Confirm structure in GEX or PRISM before you size in.',
  },
  chart: {
    title: 'Chart Lab Guide',
    question: 'Does price confirm the idea?',
    read: [
      'Search any ticker once. The same symbol follows you through Chart, Flow, GEX, LEAPS and Catalyst.',
      'Candles are the execution view; line mode removes intrabar noise when you are reading longer structure.',
      'Published Oracle entry, stop and T1 levels are fixed overlays. Live price moves; the original plan does not silently move with it.',
      'Change timeframe before changing the thesis. A valid daily setup can look broken on five-minute noise, and an intraday trigger can disappear on a weekly chart.',
      'No published signal means the chart remains research—not an invented trade plan.',
    ],
    next: 'Validate the same ticker against Flow and GEX, then return to Oracle for execution context.',
  },
  flow: {
    title: 'Flow Guide',
    question: 'What is smart money doing?',
    read: [
      'Each flow card is one premium-qualifying trade: ticker, strike, expiration, premium spent, direction, and score.',
      'Premium alone is not a signal. A big print only matters if it is unusual for that ticker.',
      'Sweeps take liquidity across exchanges (urgency). Whales are the largest prints. Repeats on one contract mean conviction, not a one-off.',
      'Filter by score, direction, type, premium size, sweep, or whale to cut the tape down to what you actually trade.',
      'Always confirm against the chart: does price have room to move, and is the upside worth the risk?',
    ],
    next: 'Take a flow hit into PRISM to see whether the strike lines up with gamma.',
  },
  gex: {
    title: 'GEX Guide',
    question: 'Where does price pin or push?',
    read: [
      'Gamma exposure shows where dealers are positioned, which tells you the levels price gets pulled toward or pushed away from.',
      'Call wall = resistance overhead. Put support = the floor. The magnet is where price tends to gravitate.',
      'The gamma flip is the pivot: above it, dealer hedging dampens moves (mean reversion); below it, moves get amplified.',
      'Positive gamma means drift and pinning. Negative gamma means momentum and bigger swings.',
    ],
    next: 'Use these levels as targets and invalidation on the chart in ORACLE.',
  },
  leaps: {
    title: 'LEAPS Guide',
    question: 'What is worth owning for the next year?',
    read: [
      'Every signal on the board is capped at 45 days — swing setups resolve to 25-45 DTE and lotto setups to 5-12. This tab is the only place a 6-to-24 month thesis appears.',
      'These are scanned and graded separately from the signal board: sector trend, price trend, and contract quality, scored to S/A/B/C.',
      'ROI@T1 is the projected return on PREMIUM at the target, not on the stock. It is modelled with Black-Scholes against the real quoted mid, decayed to the target date.',
      'Long-dated contracts carry less theta per day but far more vega — a drop in implied volatility hurts a LEAP more than a weekly, and that is not modelled here.',
    ],
    next: 'Cross-check the name in GEX: a LEAP strike above the long-dated call wall is fighting dealer positioning for a year.',
  },
  crypto: {
    title: 'Crypto Guide',
    question: 'What is crypto doing, and which equity actually expresses it?',
    read: [
      'BTC and ETH are the underlying market read: their 24-hour range, daily RSI, realized volatility, and history describe crypto itself, not an equity trade.',
      'The proxy board distinguishes direct wrappers, treasury exposure, exchanges, and miners. They can all move differently from the asset underneath.',
      'A measured beta appears only when the historical relationship can be calculated. “Relationship read pending” is intentionally not a number.',
      'Open a proxy to evaluate its own chart, structure, gamma, option-chain spread, open interest, and expiry. BTC moving is never enough by itself.',
    ],
    next: 'Use the ticker workup to turn a crypto thesis into a specific, liquid options trade—or reject it.',
  },
  catalyst: {
    title: 'Catalyst Guide',
    question: 'Does the calendar agree with the call?',
    read: [
      'This page joins our tracked events to the signals we publish — it is not a news feed to browse.',
      'CONFLICTS lead on purpose: these are signals whose events point AGAINST the direction we called. Read the thesis again before sizing.',
      'BINARY EVENT RISK means a coin-flip (earnings) lands before the trade is meant to be done. It is not directional — it argues for a smaller position or waiting.',
      'CONFLUENCE is the calendar agreeing with the setup. It reinforces a thesis; it never creates one on its own.',
      'UNCLAIMED are strong catalysts on tickers with no live signal — the watchlist for what to look at next.',
      'An empty section means no TRACKED event landed inside the horizon. It does not mean no catalyst exists.',
    ],
    next: 'Click any row to load that ticker, then go to ORACLE to read the full setup.',
  },
  bot: {
    title: 'Bot Guide',
    question: 'What would these signals have done?',
    read: [
      'The bot paper-trades the board’s own published signals in OPTIONS, using the same strikes the Contract Engine picks.',
      'Every fill and every mark is a real quote pulled at that moment — nothing is simulated or back-filled.',
      'Marks come from the CBOE delayed chain, so open P&L is roughly 15 minutes behind. It is a fair mark, not an execution price.',
      'Win rate stays blank until positions actually close. A number before then would be made up.',
      'Open positions re-price on each cycle; expired contracts settle at intrinsic value.',
    ],
    next: 'Compare the bot’s entries against ORACLE — they are the same signals, so divergence means something broke.',
  },
  positions: {
    title: 'Positions Guide',
    question: 'How is my book doing?',
    read: [
      'The treemap sizes each position by capital at risk and colors it by open P&L — the biggest boxes deserve your attention first.',
      'This is your live book, not a backtest: marks come from real quotes, so intraday P&L moves with the tape.',
      'A position deep red against the original thesis is an exit candidate, not a hope candidate. Check it against the signal that opened it.',
    ],
    next: 'Log the exit rationale in Journal so the next similar setup starts from evidence.',
  },
  journal: {
    title: 'Journal Guide',
    question: 'Am I getting better?',
    read: [
      'Trade Log is every trade you took — History is your past AI chats and research runs. They answer different questions.',
      'Metrics cuts win rate and average R by setup type: that is where your edge (or lack of one) actually shows.',
      'Backtest runs a strategy on historicals before you risk capital on it.',
      'The journal only works if exits get logged with the reason. An unlogged trade teaches nothing.',
    ],
    next: 'Take a pattern from Metrics and pressure-test it in Backtest.',
  },
};

export function TerminalGuide({ tab, open, onClose }: { tab: Tab; open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const g = GUIDES[tab];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: DUR.fast }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md overflow-y-auto border-l border-border/60 bg-card"
            initial={reduce ? false : { x: '100%' }}
            animate={{ x: 0 }}
            exit={reduce ? undefined : { x: '100%' }}
            transition={{ duration: DUR.base, ease: EASE }}
            role="dialog"
            aria-label={g.title}
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-border/40 bg-card px-4 py-3">
              <div>
                <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-foreground">{g.title}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{g.question}</div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close guide"
                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              {g.read.map((line, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="mt-0.5 shrink-0 text-[10px] font-mono tabular-nums text-[var(--brand-cyan,#3b8cff)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="text-[12px] leading-relaxed text-foreground/80">{line}</p>
                </div>
              ))}

              <div className="mt-4 rounded-lg border border-border/40 bg-foreground/[0.03] px-3 py-2.5">
                <div className="mb-0.5 text-[10px] font-mono uppercase tracking-widest text-[var(--brand-cyan,#3b8cff)]">
                  Next step
                </div>
                <div className="text-[11px] font-mono text-foreground/85">{g.next}</div>
              </div>

              <p className="pt-2 text-[10px] leading-relaxed text-muted-foreground">
                Educational only — not investment advice. Confirm every signal against your own risk plan.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

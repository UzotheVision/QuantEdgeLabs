/**
 * QuantEdge Changelog — single source of truth for "What's New".
 *
 * Add new entries to the TOP of CHANGELOG. Each entry has:
 *   id        unique slug — used for "seen" tracking in localStorage
 *   date      ISO date (YYYY-MM-DD)
 *   title     short headline (≤ 60 chars)
 *   blurb     1-2 sentence description (≤ 200 chars)
 *   link      href to take the user to the feature
 *   tag       category for filtering / icon styling
 *   linkLabel optional override for the CTA button (default: "Go to feature")
 *
 * The unread badge in the sidebar shows count of entries newer than
 * the user's last-seen id (stored in localStorage as `qe_changelog_seen`).
 *
 * To ship a new feature: add an entry, push. The platform tells the user.
 */

export type ChangeTag =
  | 'feature'
  | 'fix'
  | 'design'
  | 'data'
  | 'workflow'
  | 'ai';

export interface ChangeEntry {
  id: string;
  date: string;        // YYYY-MM-DD
  title: string;
  blurb: string;
  link?: string;       // optional internal route
  linkLabel?: string;
  tag: ChangeTag;
}

export const CHANGELOG: ChangeEntry[] = [
  // ─── Most recent first ───────────────────────────────────────
  {
    id: '2026-06-05-leap-tracker-fundamentals',
    date: '2026-06-05',
    title: 'LEAP Tracker — 52 names + live fundamentals (EPS · revenue · cash)',
    blurb: 'Expanded the LEAP universe from 29 to 52, adding speculative retail/Twitter names (QUBT, QBTS, IONQ, LAES, SERV, HPE, SOFI, HOOD, ONDS, RKLB, ASTS, OKLO +more) flagged with a SPEC badge. Each pick now carries fundamentals — EPS, revenue, YoY growth, cash, market cap, forward P/E — with a profitability reality-check on speculative names.',
    link: '/h?tab=leaps',
    linkLabel: 'Open LEAP Tracker',
    tag: 'feature',
  },
  {
    id: '2026-06-05-unified-realtime-data',
    date: '2026-06-05',
    title: 'Unified real-time data layer — one price, everywhere',
    blurb: 'Every quote across the platform now flows through a single source of truth with per-asset caching and a stale-cache fallback, so movers, briefings, LEAPs and the option engine no longer show divergent prices under rate-limiting. The option-selection engine also gained a Yahoo fallback so contract picks survive CBOE/Tradier outages.',
    tag: 'data',
  },
  {
    id: '2026-06-05-whats-new-fix',
    date: '2026-06-05',
    title: "What's New now actually opens",
    blurb: 'Fixed a state-isolation bug where clicking the sidebar bell never opened the drawer. The bell, toast, and drawer now share one store — so this panel you are reading finally works.',
    tag: 'fix',
  },
  {
    id: '2026-05-27-intraday-scanners',
    date: '2026-05-27',
    title: 'Intraday Scanners — bull flags, 20-day breakouts, unusual flow',
    blurb: 'Three new scanners that surface intraday setups on demand. Bull flag (Qullamaggie pole+flag pattern), 20-day high breakouts (volume-confirmed), and unusual options flow (wraps existing flow scanner with watchlist filter). All accept ?watchlistOnly=true to scope to YOUR active tickers. Endpoints: /api/scans/bull-flags /breakouts /unusual-flow.',
    tag: 'feature',
  },
  {
    id: '2026-05-27-pm-ah-movers',
    date: '2026-05-27',
    title: 'PM / After-Hours / Overnight movers scanner — /movers',
    blurb: 'New scanner covers the 3 windows when regular market is closed: pre-market gappers (4-9:30am ET), after-hours movers (4-8pm ET), and overnight futures + crypto. Yahoo Finance + CoinGecko feeds, auto-refresh 60s, click any ticker → /r/[ticker]. Closes the gap that QuantEdge was blind outside RTH.',
    link: '/movers',
    linkLabel: 'Open Movers',
    tag: 'feature',
  },
  {
    id: '2026-05-11-contract-analyzer',
    date: '2026-05-11',
    title: 'Contract Analyzer — Bullflow-style A+/B+ grading on any contract',
    blurb: 'Paste "QCOM 300C 1/27 @ $18.50" anywhere → get a terminal-style graded card with 9 signals (moneyness, DTE, delta, theta, IV, OI concentration, price action, catalyst, analyst PT). Includes T1/T2/stop plan + ROI scenarios at ±1σ/2σ + one-click "Push to Trade Desk". Live on /analyze.',
    link: '/analyze',
    linkLabel: 'Open Contract Analyzer',
    tag: 'feature',
  },
  {
    id: '2026-05-10-radar-ui-fetchers-complete',
    date: '2026-05-10',
    title: 'Radar UI shipped + all 6 fetchers wired + Gamma Squeeze pattern live',
    blurb: 'New /radar destination with 4 tabs (Forming · Picks · Patterns · Track Record) + /btc dashboard for live beta watchlist. Wired remaining fetchers: IV percentile (from historical chain), News catalysts (catalyst-tracker), Analyst ratings (target-price upside), Institutional flow (block/dark-pool premium proxy). Added 6th pattern: Gamma Squeeze Detector — finds dealer short-gamma traps for UNH-style penny-call premium juice.',
    link: '/radar',
    linkLabel: 'Open Thesis Radar',
    tag: 'feature',
  },
  {
    id: '2026-05-10-btc-beta-tracker',
    date: '2026-05-10',
    title: 'BTC Beta Tracker — autonomous crypto-equity alerts',
    blurb: 'Tracks BTC price + key levels + 30/90-day rolling beta on MSTR/COIN/MARA/RIOT/CRCL/CLSK/HUT/BITF/IREN/WULF. Detects 4 patterns: breakout long, breakdown short, divergence alpha, vol regime shift. Auto-pushes A+ signals to Trade Desk every 09:35/11:00/13:00/15:00/15:55 NY. Conviction-graded with full Greeks + thesis explanation.',
    link: '/api/btc/scan',
    linkLabel: 'Run BTC scan now',
    tag: 'feature',
  },
  {
    id: '2026-05-10-radar-priceaction-wired',
    date: '2026-05-10',
    title: 'Thesis Radar — price-action grader live',
    blurb: 'Wired chart-analysis to the Radar fetcher. The conviction agent now grades RSI(14), MACD bullish cross, 20-SMA + 20-EMA reclaim, and distance from 50-DMA — bringing 6 of 9 conviction signals online (was just options flow). DGXX setup pattern fires with full price-action context tomorrow morning.',
    tag: 'feature',
  },
  {
    id: '2026-05-06-thesis-radar-v1',
    date: '2026-05-06',
    title: 'Thesis Radar v1 — find the next DGXX before it gaps',
    blurb: '5 starter pattern signatures (DGXX setup, Aschenbrenner 2nd-derivative, Bottleneck whisper, Institutional accumulation, Catalyst whisper) + Bullflow-style conviction agent with A+/A/A-/B+ letter grades + Discord webhook for FORMING/CONFIRMED alerts + track record for accountability. The platform now hunts for setups instead of waiting to be asked.',
    link: '/api/radar/patterns',
    linkLabel: 'See pattern library',
    tag: 'feature',
  },
  {
    id: '2026-05-04-earnings-trade-desk-bridge',
    date: '2026-05-04',
    title: 'Earnings → Trade Desk bridge — push lottos to your book',
    blurb: 'Every Earnings Hub lotto now has a "+ Push" button that creates a real Trade Desk idea with full plan (entry/T1/T2/stop/catalyst). "Push All S/A" bulk button at the top — one click puts the entire weekly lotto basket on your desk. PINS just gapped +15.78% post-market — this prevents missing the next one.',
    link: '/p?tab=earnings&subtab=lottos',
    linkLabel: 'Open Earnings Hub',
    tag: 'workflow',
  },
  {
    id: '2026-05-02-mcu-layer',
    date: '2026-05-02',
    title: 'New rotation layer: Microcontrollers / Power IC',
    blurb: 'MCU shortage thesis added to the 18-layer map (now 19 layers). Tracks NVTS, AMBA, CEVA, HIMX, AOSL, POWI + the megacaps (MCHP, NXPI, ON). Same cycle classifier — see when this layer transitions to early/mid.',
    link: '/p?tab=rotation',
    linkLabel: 'See rotation map',
    tag: 'data',
  },
  {
    id: '2026-05-02-movers-tab',
    date: '2026-05-02',
    title: 'Earnings → Movers sub-tab (UI built, data pending)',
    blurb: 'Third sub-tab inside Earnings Hub: post-earnings gappers with implied-vs-realized, reaction classification (BEAT-RIP / BEAT-FADE / MISS-DUMP / MISS-RECOVER) + follow-up trade ideas. Backend cron next sprint.',
    link: '/p?tab=earnings&subtab=movers',
    linkLabel: 'Open Movers',
    tag: 'feature',
  },
  {
    id: '2026-05-02-earnings-calendar',
    date: '2026-05-02',
    title: 'Earnings Calendar — full universe (every reporter)',
    blurb: 'New "Calendar" sub-tab inside Earnings. Shows ALL ~1500 next-week reporters grouped by day and BMO/AMC/TBD session. Search by ticker or name. Filter by importance (1-5), sector, time. Top-30 by market cap surfaced as quick-pick chips.',
    link: '/p?tab=earnings&subtab=calendar',
    linkLabel: 'Open Calendar',
    tag: 'feature',
  },
  {
    id: '2026-05-02-earnings-hub',
    date: '2026-05-02',
    title: 'Earnings Hub — auto-scanned lottos with ROI scenarios',
    blurb: 'Pulse → Earnings tab now auto-runs the same scan we did manually: pulls calendar + chains + beat history + IV, scores 0-100, ranks lottos by cost-to-implied-move ratio. ATM call < $4, ≥1 beat in 4Q, +1.5σ ROI ≥ 60%.',
    link: '/p?tab=earnings',
    linkLabel: 'Open Earnings Hub',
    tag: 'feature',
  },
  {
    id: '2026-05-02-observability',
    date: '2026-05-02',
    title: 'Observability foundation — outage alerts + structured errors',
    blurb: 'Server + client errors now flow to Sentry (when SENTRY_DSN set) OR a Discord/Slack webhook (when ERROR_WEBHOOK_URL set). Always logged structured. Stage A of institutional readiness.',
    tag: 'fix',
  },
  {
    id: '2026-05-02-real-health',
    date: '2026-05-02',
    title: '/api/health — real liveness + dependency check',
    blurb: 'Replaced the stub. Now actually pings Postgres + Tradier and returns 503 when DB is down. Designed for Better Uptime / UptimeRobot / Pingdom monitors.',
    tag: 'fix',
  },
  {
    id: '2026-05-02-ts-budget',
    date: '2026-05-02',
    title: 'TS-error budget gate — no new errors policy',
    blurb: 'Baseline locked at 633 errors. Any PR that increases the count fails CI. Run `npm run ts:budget:diff` to see top offenders, `:update` to lower the baseline after fixing.',
    tag: 'fix',
  },
  {
    id: '2026-05-02-rotation-engine',
    date: '2026-05-02',
    title: 'Sector Rotation Engine — 18-layer cycle map is LIVE',
    blurb: 'The Aschenbrenner answer. Daily-computed cycle stage (pre/early/mid/late/topped/rolling) for 18 AI-buildout layers with breadth, RS, and small-vs-mega broadening signals.',
    link: '/p?tab=rotation',
    linkLabel: 'Open Rotation Map',
    tag: 'feature',
  },
  {
    id: '2026-05-02-sector-hunt',
    date: '2026-05-02',
    title: 'Hunt → Sector Hunt enabled (was "soon")',
    blurb: 'Same rotation matrix — drill into a hot layer to see top movers, breadth, RS. Click any ticker → Research deep-dive.',
    link: '/h?tab=sector',
    linkLabel: 'Open Sector Hunt',
    tag: 'workflow',
  },
  {
    id: '2026-05-02-whats-new',
    date: '2026-05-02',
    title: '"What\'s New" inbox + sidebar badge',
    blurb: 'You\'re reading it. Every shipped feature gets an entry — click the bell or use ⌘? to see them. New entries auto-flag the badge.',
    tag: 'feature',
  },
  {
    id: '2026-05-02-runners',
    date: '2026-05-02',
    title: 'Hunt → Runners — high-ADR small-cap scanner',
    blurb: 'Qullamaggie-style momentum scan. Filters: max price, min ADR%, min RVOL. Returns ranked tickers with auto trade plan (entry/stop/T1/T2).',
    link: '/h?tab=runners',
    linkLabel: 'Open Runners',
    tag: 'feature',
  },
  {
    id: '2026-05-02-spot-indicator',
    date: '2026-05-02',
    title: 'GEX Matrix — spot indicator that always works',
    blurb: 'Floating SPOT pill (top-right), ► marker on closest strike, amber line drawn between strikes when spot is in-between. Click pill to jump.',
    link: '/g?tab=matrix',
    linkLabel: 'Open Matrix',
    tag: 'fix',
  },
  {
    id: '2026-05-02-research-flow',
    date: '2026-05-02',
    title: 'Research → Flow — live options flow per ticker',
    blurb: 'Flowseeker-style table: sweeps, blocks, dark-pool, unusual volume — scoped to one symbol. Filters by type / sentiment / min premium.',
    link: '/r/SPY?tab=flow',
    linkLabel: 'Open Flow',
    tag: 'feature',
  },
  {
    id: '2026-05-02-research-canonical',
    date: '2026-05-02',
    title: 'Research is the canonical per-ticker home',
    blurb: 'Tickers from ⌘K and elsewhere now land at /r/:sym with tabs: Chart · Options · GEX · Flow · News · Setups · Analysis. Hierarchical TickerSwitcher in header.',
    link: '/r/CRDO',
    linkLabel: 'Open Research',
    tag: 'workflow',
  },
  {
    id: '2026-05-02-cmdk',
    date: '2026-05-02',
    title: '⌘K command palette — global search',
    blurb: 'Press ⌘K from anywhere. Jump to any page, tab, or ticker. ⌘1-6 jumps to top-level destinations. Type a ticker → Enter → Research.',
    tag: 'feature',
    linkLabel: 'Try it (press ⌘K)',
  },
  {
    id: '2026-05-02-six-destinations',
    date: '2026-05-02',
    title: '6-destination IA — Home / Hunt / GEX / Research / Positions / Journal',
    blurb: 'Sidebar collapsed from 11 items to 6. Every page is a tab inside one of these. GEX restored as a top-level destination.',
    tag: 'workflow',
  },
  {
    id: '2026-05-02-qe-primitives',
    date: '2026-05-02',
    title: 'Design system enforced — 7 QE primitives',
    blurb: 'Card · Stat · Pill · Bar · Section · Tabs · Drawer. Every page now composes from these. One color palette, consistent visual language.',
    tag: 'design',
  },
  {
    id: '2026-05-01-gex-redesign',
    date: '2026-05-01',
    title: 'GEX Hub redesigned — workflow tabs',
    blurb: 'Replaced 3 redundant leaderboards with workflow tabs: ALL / 0DTE / SWING / LEAPS / FLIP / POS γ / NEG γ. Each is a real data slice with counts.',
    link: '/g?tab=hub',
    linkLabel: 'Open GEX Hub',
    tag: 'workflow',
  },
  {
    id: '2026-05-01-gex-leaps',
    date: '2026-05-01',
    title: 'GEX engine fetches LEAPS — 60→full chain',
    blurb: 'Removed the 60-expiry cap. SPY now scans Jan 2027 / Jan 2028 LEAPS. Per-DTE buckets (0DTE / Week / Month / Quarter / LEAPS) computed.',
    tag: 'data',
  },
  {
    id: '2026-05-01-dealer-flow',
    date: '2026-05-01',
    title: 'Dealer-flow per 1% — the actionable GEX number',
    blurb: 'Every snapshot now exposes dealerFlowPer1Pct: the dollar notional dealers must hedge per 1% spot move. The single most useful gamma metric.',
    tag: 'data',
  },
  {
    id: '2026-05-01-gex-trade-bridge',
    date: '2026-05-01',
    title: 'GEX → Trade Desk one-click bridge',
    blurb: 'On any GEX row, click "+ IDEA" to create a fully-populated Trade Desk idea (bias / target / stop / catalyst from real walls). Tools no longer islands.',
    tag: 'workflow',
  },
  {
    id: '2026-04-30-cboe-fallback',
    date: '2026-04-30',
    title: 'CBOE fallback for weekends + after-hours',
    blurb: 'When Tradier returns nothing (weekends, rate-limit), platform automatically falls back to CBOE delayed chains. No more empty pages.',
    tag: 'data',
  },
  {
    id: '2026-04-30-page-error-boundary',
    date: '2026-04-30',
    title: 'Page error boundaries — one broken card no longer kills the page',
    blurb: 'Every shell wraps content in PageErrorBoundary. If one tab crashes, you see a recovery card with retry — not a white screen.',
    tag: 'fix',
  },
];

/**
 * Get unread entries based on last-seen id.
 * If no id seen yet, all entries are unread.
 */
export function getUnreadEntries(lastSeenId: string | null): ChangeEntry[] {
  if (!lastSeenId) return CHANGELOG;
  const idx = CHANGELOG.findIndex(e => e.id === lastSeenId);
  if (idx < 0) return CHANGELOG;     // stored id is stale → treat all as unread? cap to 5
  return CHANGELOG.slice(0, idx);     // entries before last seen
}

export function getMostRecentId(): string {
  return CHANGELOG[0]?.id ?? '';
}

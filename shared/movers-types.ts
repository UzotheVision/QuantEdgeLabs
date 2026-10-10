/**
 * MOVERS — Shared Types
 * =======================
 * Pre-market / after-hours / overnight gap scanner.
 *
 * What this addresses: QuantEdge previously had NO scanner for the time
 * windows outside regular market hours. PM gappers, post-close earnings
 * reactions, and overnight news catalysts were all invisible to the platform.
 *
 * Now: 3 windows, all scanned, all surfaced with click-to-research.
 */

export type MoversWindow = 'premarket' | 'afterhours' | 'overnight';

export interface MoverQuote {
  symbol: string;
  /** Last quoted price in the active window */
  price: number;
  /** Yesterday's regular-hours close (the baseline for % move) */
  prevClose: number;
  /** % change from prevClose */
  changePct: number;
  /** Volume in the window (pre/post specific, may be partial) */
  volume: number;
  /** Approximate market cap bucket */
  capTier?: 'mega' | 'large' | 'mid' | 'small' | 'micro';
  /** Sector hint */
  sector?: string;
  /** Optional: ticker on user's watchlist */
  onWatchlist?: boolean;
  /** Optional: recent news headline + timestamp */
  newsHeadline?: string;
  newsTimestamp?: string;
  /** Earnings flag (for AH window) */
  hasEarningsToday?: boolean;
  /** Direction marker for UI */
  direction: 'up' | 'down';
  /** Timestamp of the quote */
  asOf: string;
}

export interface MoversScanResult {
  window: MoversWindow;
  asOf: string;
  /** Sorted by absolute % change desc */
  gappers: MoverQuote[];
  /** Optional summary stats */
  summary?: {
    totalScanned: number;
    upGappers: number;
    downGappers: number;
    biggestUp?: MoverQuote;
    biggestDown?: MoverQuote;
  };
}

// ─── Universe to scan ──────────────────────────────────────────────
// We scan a curated list rather than the entire market because:
//   1. Yahoo's rate limits prevent 5000-symbol scans every 5 min
//   2. PM volume is concentrated in ~200 symbols anyway
//   3. The user has specific watchlist names that matter more

export const MOVERS_UNIVERSE: { symbol: string; sector: string; capTier: 'mega' | 'large' | 'mid' | 'small' | 'micro' }[] = [
  // MEGA-CAP TECH (always scan)
  { symbol: 'AAPL',  sector: 'tech',     capTier: 'mega' },
  { symbol: 'MSFT',  sector: 'tech',     capTier: 'mega' },
  { symbol: 'GOOGL', sector: 'tech',     capTier: 'mega' },
  { symbol: 'META',  sector: 'tech',     capTier: 'mega' },
  { symbol: 'AMZN',  sector: 'tech',     capTier: 'mega' },
  { symbol: 'NVDA',  sector: 'semis',    capTier: 'mega' },
  { symbol: 'TSLA',  sector: 'auto',     capTier: 'mega' },
  // SEMIS
  { symbol: 'AMD',   sector: 'semis',    capTier: 'large' },
  { symbol: 'TSM',   sector: 'semis',    capTier: 'mega' },
  { symbol: 'INTC',  sector: 'semis',    capTier: 'large' },
  { symbol: 'ARM',   sector: 'semis',    capTier: 'large' },
  { symbol: 'AVGO',  sector: 'semis',    capTier: 'mega' },
  { symbol: 'MRVL',  sector: 'semis',    capTier: 'large' },
  { symbol: 'MU',    sector: 'semis',    capTier: 'large' },
  { symbol: 'SNDK',  sector: 'semis',    capTier: 'large' },
  { symbol: 'QCOM',  sector: 'semis',    capTier: 'large' },
  { symbol: 'AMAT',  sector: 'semis',    capTier: 'large' },
  { symbol: 'LRCX',  sector: 'semis',    capTier: 'large' },
  { symbol: 'KLAC',  sector: 'semis',    capTier: 'large' },
  { symbol: 'AMBA',  sector: 'semis',    capTier: 'mid' },
  { symbol: 'NVTS',  sector: 'semis',    capTier: 'small' },
  { symbol: 'POET',  sector: 'photonics',capTier: 'small' },
  { symbol: 'AAOI',  sector: 'photonics',capTier: 'mid' },
  { symbol: 'COHR',  sector: 'photonics',capTier: 'large' },
  { symbol: 'LITE',  sector: 'photonics',capTier: 'mid' },
  { symbol: 'CRDO',  sector: 'semis',    capTier: 'mid' },
  { symbol: 'ALAB',  sector: 'semis',    capTier: 'mid' },
  { symbol: 'GFS',   sector: 'foundry',  capTier: 'mid' },
  { symbol: 'KLIC',  sector: 'semis',    capTier: 'mid' },
  { symbol: 'AEHR',  sector: 'semis',    capTier: 'small' },
  { symbol: 'SKYT',  sector: 'foundry',  capTier: 'small' },
  // AI INFRA + DATA CENTER
  { symbol: 'DELL',  sector: 'ai-infra', capTier: 'large' },
  { symbol: 'HPE',   sector: 'ai-infra', capTier: 'mid' },
  { symbol: 'SMCI',  sector: 'ai-infra', capTier: 'large' },
  { symbol: 'VRT',   sector: 'ai-infra', capTier: 'large' },
  { symbol: 'NBIS',  sector: 'ai-infra', capTier: 'mid' },
  { symbol: 'CRWV',  sector: 'ai-infra', capTier: 'large' },
  { symbol: 'APLD',  sector: 'ai-infra', capTier: 'small' },
  { symbol: 'DGXX',  sector: 'ai-infra', capTier: 'micro' },
  { symbol: 'IREN',  sector: 'ai-infra', capTier: 'mid' },
  { symbol: 'WULF',  sector: 'ai-infra', capTier: 'mid' },
  { symbol: 'BTDR',  sector: 'ai-infra', capTier: 'mid' },
  // QUANTUM
  { symbol: 'IONQ',  sector: 'quantum',  capTier: 'mid' },
  { symbol: 'RGTI',  sector: 'quantum',  capTier: 'small' },
  { symbol: 'QBTS',  sector: 'quantum',  capTier: 'small' },
  { symbol: 'QUBT',  sector: 'quantum',  capTier: 'small' },
  // CRYPTO / BTC-CORRELATED
  { symbol: 'COIN',  sector: 'crypto',   capTier: 'large' },
  { symbol: 'MSTR',  sector: 'crypto',   capTier: 'large' },
  { symbol: 'MARA',  sector: 'crypto',   capTier: 'mid' },
  { symbol: 'RIOT',  sector: 'crypto',   capTier: 'mid' },
  { symbol: 'CLSK',  sector: 'crypto',   capTier: 'mid' },
  { symbol: 'HUT',   sector: 'crypto',   capTier: 'mid' },
  { symbol: 'BITF',  sector: 'crypto',   capTier: 'small' },
  { symbol: 'CRCL',  sector: 'crypto',   capTier: 'mid' },
  // AGENTS / SAAS
  { symbol: 'NOW',   sector: 'saas',     capTier: 'large' },
  { symbol: 'CRM',   sector: 'saas',     capTier: 'large' },
  { symbol: 'PLTR',  sector: 'saas',     capTier: 'large' },
  { symbol: 'NET',   sector: 'saas',     capTier: 'mid' },
  { symbol: 'DDOG',  sector: 'saas',     capTier: 'mid' },
  { symbol: 'CRWD',  sector: 'cyber',    capTier: 'large' },
  { symbol: 'PANW',  sector: 'cyber',    capTier: 'large' },
  { symbol: 'BB',    sector: 'cyber',    capTier: 'small' },
  // POWER / NUCLEAR (AI tailwind)
  { symbol: 'OKLO',  sector: 'nuclear',  capTier: 'small' },
  { symbol: 'SMR',   sector: 'nuclear',  capTier: 'small' },
  { symbol: 'NNE',   sector: 'nuclear',  capTier: 'micro' },
  { symbol: 'CCJ',   sector: 'nuclear',  capTier: 'mid' },
  { symbol: 'CEG',   sector: 'nuclear',  capTier: 'large' },
  { symbol: 'TLN',   sector: 'nuclear',  capTier: 'large' },
  { symbol: 'VST',   sector: 'nuclear',  capTier: 'large' },
  // AUTONOMOUS / MOBILITY
  { symbol: 'AUR',   sector: 'autonomous',capTier: 'mid' },
  { symbol: 'UBER',  sector: 'mobility', capTier: 'large' },
  { symbol: 'JOBY',  sector: 'evtol',    capTier: 'small' },
  { symbol: 'INDI',  sector: 'auto-semi',capTier: 'small' },
  { symbol: 'MBLY',  sector: 'auto-semi',capTier: 'small' },
  // FINTECH
  { symbol: 'SOFI',  sector: 'fintech',  capTier: 'mid' },
  { symbol: 'HOOD',  sector: 'fintech',  capTier: 'large' },
  { symbol: 'AFRM',  sector: 'fintech',  capTier: 'mid' },
  // NETWORKING / OPTICAL
  { symbol: 'NOK',   sector: 'telecom',  capTier: 'large' },
  { symbol: 'CIEN',  sector: 'optical',  capTier: 'mid' },
  { symbol: 'ANET',  sector: 'optical',  capTier: 'large' },
  // INDEX ETFs
  { symbol: 'SPY',   sector: 'index',    capTier: 'mega' },
  { symbol: 'QQQ',   sector: 'index',    capTier: 'mega' },
  { symbol: 'IWM',   sector: 'index',    capTier: 'mega' },
  { symbol: 'SMH',   sector: 'index',    capTier: 'large' },
];

// ─── Window-to-active-hours mapping (NY tz) ─────────────────────────

export interface WindowSchedule {
  startHour: number;   // local NY hour, 0-23
  startMin: number;
  endHour: number;
  endMin: number;
  daysActive: number[]; // 1=Mon ... 5=Fri
}

export const WINDOW_SCHEDULES: Record<MoversWindow, WindowSchedule> = {
  premarket:  { startHour: 4,  startMin: 0,  endHour: 9,  endMin: 30, daysActive: [1, 2, 3, 4, 5] },
  afterhours: { startHour: 16, startMin: 0,  endHour: 20, endMin: 0,  daysActive: [1, 2, 3, 4, 5] },
  overnight:  { startHour: 20, startMin: 0,  endHour: 28, endMin: 0,  daysActive: [0, 1, 2, 3, 4, 5, 6] },
};

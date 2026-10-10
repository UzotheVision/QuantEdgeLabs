import { convictionDisplayPercent } from '@shared/conviction-display';

/**
 * Client-side types + helpers for the convictions ("signals") feed.
 *
 * Mirrors the server `ConvictionPick` / `ConvictionsResponse` shapes
 * (server/convictions-engine.ts). Kept as a local copy so the client
 * doesn't import server code. If the server type changes, update here.
 *
 * Everything in the cockpit binds to these — no fabricated values.
 */

export type ConvictionLayerKind =
  | 'technical' | 'ta' | 'convergence' | 'catalyst' | 'regime' | 'breadth' | 'macro'
  | 'geopolitical' | 'fundamental' | 'analyst' | 'sector' | 'freshness'
  | 'weekly' | 'premarket' | 'compression' | 'gex';

export interface ConvictionLayer {
  kind: ConvictionLayerKind;
  label: string;
  points: number;
  why: string;
  data?: Record<string, unknown>;
}

export interface ConvictionPick {
  /**
   * Present and true when this row is something the bot ACTUALLY HOLDS, merged
   * in past every entry filter — see server/bot-held-picks.ts. Held rows carry
   * live P&L instead of a conviction score, because they were never scored for
   * entry and showing a number there would invite a false comparison against
   * candidates that were.
   */
  isBotHeld?: boolean;
  botOwner?: string;
  botBookName?: string;
  botBookLegacy?: boolean;
  quantity?: number;
  unrealizedPnl?: number | null;
  unrealizedPnlPercent?: number | null;
  heldSince?: string | null;
  /** Contract-premium mark and bracket for held options (never underlying prices). */
  currentPremium?: number | null;
  premiumTarget?: number | null;
  premiumStop?: number | null;
  premiumMarkedAt?: string | null;

  ideaId: string;
  symbol: string;
  sector: string;
  direction: 'long' | 'short';
  assetType: string;
  holdingPeriod: string;
  tradeType: string | null;

  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskRewardRatio: number;

  optionType: 'call' | 'put' | null;
  strikePrice: number | null;
  /** Premium per contract at signal time. Null when the idea is not an option. */
  entryPremium: number | null;
  optionDte: number | null;
  expiryDate: string | null;

  convictionScore: number;
  convictionBand: 'S' | 'A' | 'B' | 'C';
  layerCount: number;
  layers: ConvictionLayer[];
  /** Frozen evidence grade at first publication. */
  publishedConvictionScore: number | null;
  publishedConvictionBand: 'S' | 'A' | 'B' | 'C' | null;

  thesis: string;
  catalyst: string;
  catalystSourceUrl: string | null;
  generatedAt: string;

  /** Originating engine — drives the unified cockpit's mode tabs. */
  source: string;

  /** Added dynamically by the API at response time when available. */
  currentPrice?: number;

  /** A plan becomes live only after a trigger or recorded execution. */
  lifecycleState: 'coverage' | 'thesis' | 'pending_trigger' | 'triggered' | 'executed' | 'closed';
}

export interface ConvictionsResponse {
  generatedAt: string;
  marketContext: {
    regime: string;
    riskSentiment: string;
    preferredDirection: string;
    score: number;
    vixLevel: number | null;
    reasons: string[];
  };
  breadth: {
    regime: string;
    bias: number;
    advanceDeclineRatio: number;
    percentAbove200MA: number;
    percentAbove50MA: number;
    newHighsLows: number;
    sampleSize: number;
    interpretation: string;
  } | null;
  geopolitical: { risk: string; activeScenarios: string[] };
  totalCandidatesScanned: number;
  picks: ConvictionPick[];
}

// ─── Tier mapping: band + direction → MOMO-style tier word + tone ───────────

export type Tone = 'bull' | 'bear' | 'neutral';

/** "ELITE" / "STRONG" / "HIGH" / "MED" from the conviction band. */
export function bandStrength(band: ConvictionPick['convictionBand']): string {
  switch (band) {
    case 'S': return 'ELITE';
    case 'A': return 'STRONG';
    case 'B': return 'HIGH';
    default:  return 'MED';
  }
}

export function directionTone(direction: 'long' | 'short'): 'bull' | 'bear' {
  return direction === 'long' ? 'bull' : 'bear';
}

/**
 * Confidence-index display percent (0-100) from the raw confluence score.
 *
 * The server's `convictionScore` is a *confluence-points* sum, not a percent —
 * it realistically tops out around the low 40s, and the bands are:
 *   S ≥ 30 · A ≥ 22 · B ≥ 15 · C < 15  (server/convictions-engine.ts).
 * Rendering that raw number on a 0-100 dial makes an ELITE (band S) signal read
 * as "31" — which looks weak and contradicts the tier label. This is a monotonic
 * transform that anchors each band onto a sensible slice of the dial, so ELITE
 * shows in the high-80s/90s like a real confidence index. It never invents data:
 * same input → same output, strictly increasing with score.
 */
export function convictionPercent(score: number): number {
  return convictionDisplayPercent(score);
}

/**
 * Older persisted ideas called three unrelated measurements a "grade": the
 * whole-signal evidence band, the chart-pattern detector, and the option pick.
 * Keep old records readable without rewriting their audit history.
 */
export function clarifyOracleNarrative(text: string): string {
  return text
    .replace(
      /((?:Bull Flag Pullback|Bear Flag Breakdown))\s*—\s*([SABC][+-]?) grade \((\d+)\/100\)\./gi,
      '$1 · pattern quality $3/100 ($2).',
    )
    .replace(
      /(At signal:[^\n]*?\b)grade\s+([SABC][+-]?)(\))/gi,
      '$1contract quality $2$3',
    );
}

/** e.g. "ELITE BULLISH" / "STRONG BEARISH" */
export function tierLabel(pick: Pick<ConvictionPick, 'convictionBand' | 'direction'>): string {
  const word = pick.direction === 'long' ? 'BULLISH' : 'BEARISH';
  return `${bandStrength(pick.convictionBand)} ${word}`;
}

/** CSS var color for a tone — used for text/stroke. */
export function toneColor(tone: Tone): string {
  if (tone === 'bull') return 'var(--trade-bullish)';
  if (tone === 'bear') return 'var(--trade-bearish)';
  return 'var(--brand-cyan)';
}

// ─── Layer kind → short tag + icon hint (for the components/checklist) ──────

export const LAYER_TAG: Record<ConvictionLayerKind, string> = {
  technical:    'TECH',
  ta:           'SIG',
  convergence:  'CONV',
  catalyst:     'CTLY',
  regime:       'RGME',
  breadth:      'BRTH',
  macro:        'MAC',
  geopolitical: 'GEO',
  fundamental:  'FUND',
  analyst:      'ANLY',
  sector:       'SECT',
  freshness:    'FRSH',
  weekly:       'WKLY',
  premarket:    'PREM',
  compression:  'COIL',
  gex:          'GEX',
};

/**
 * Per-layer accent color (hex) — mirrors the old Trade Desk LAYER_STYLES palette
 * so each confluence kind keeps its identity across the app (tech=cyan,
 * convergence=violet, catalyst=amber, …). Used for the colorful confluence pills.
 */
export const LAYER_COLOR: Record<ConvictionLayerKind, string> = {
  technical:    '#3b8cff', // cyan
  ta:           '#38bdf8', // blue — named chart setup
  convergence:  '#a78bfa', // violet
  catalyst:     '#fbbf24', // amber
  regime:       '#34d399', // emerald
  breadth:      '#2dd4bf', // teal
  macro:        '#e0a458', // amber — event/time risk
  geopolitical: '#fb923c', // orange
  fundamental:  '#60a5fa', // blue
  analyst:      '#818cf8', // indigo
  sector:       '#f472b6', // pink
  freshness:    '#fb7185', // rose
  weekly:       '#fde047', // yellow
  premarket:    '#c084fc', // purple
  compression:  '#e0a458', // amber — stored energy, not yet directional
  gex:          '#5eead4', // teal-light
};

/** Normalize a layer's points into a 0-100 bar fill (points are small ints). */
export function layerBarPct(points: number): number {
  // Layer points typically range 0-10. Clamp to a readable bar.
  const pct = (Math.abs(points) / 10) * 100;
  return Math.max(6, Math.min(100, pct));
}

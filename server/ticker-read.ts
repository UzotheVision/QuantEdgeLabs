/**
 * TICKER READ — what we can say about any symbol, signal or not.
 *
 * Searching a ticker the engine hasn't published on returned "No signal yet" and
 * a chart. That is accurate and nearly useless: plenty is knowable about a stock
 * without a setup having cleared sixteen layers, and refusing to say any of it
 * makes the platform look empty rather than careful.
 *
 * WHY THERE IS NO SINGLE GRADE HERE
 * A conviction band means something specific — that N independent layers agreed
 * on a direction and a level plan. Printing a band on a ticker we did not publish
 * would borrow that credibility for a different claim, and a letter grade on a
 * stock reads as a recommendation no matter how it is captioned. So this returns
 * SEPARATE dimensions, each with its own state and its own sentence, and no
 * composite. Trend up, coiled, earnings in six days, gap 3% below is a genuinely
 * more useful thing to hand someone than "B", and it is honest about the fact
 * that we are describing conditions rather than making a call.
 *
 * Composes engines that need nothing but price and a chain.
 */
import { logger } from './logger';

export type DimState = 'bullish' | 'bearish' | 'neutral' | 'caution' | 'unknown';

export interface Dimension {
  key: string;
  label: string;
  state: DimState;
  /** The headline value, already formatted. */
  value: string;
  /** One sentence a person can act on. */
  read: string;
}

export interface TickerRead {
  symbol: string;
  spot: number;
  asOf: string;
  dimensions: Dimension[];
  /**
   * A search result needs a directional answer, but it must not borrow a
   * Conviction band before entry, invalidation and a structural target exist.
   * This is a transparent count of the directional price conditions, not a
   * 0–100 trade score and never an instruction to enter.
   */
  directional: {
    bias: 'bullish' | 'bearish' | 'neutral';
    aligned: number;
    conflicting: number;
    assessed: number;
    status: 'watch';
    tradeable: false;
    summary: string;
    nextCheck: string;
  };
  /** Deliberately null — see the note above. */
  band: null;
  /** Things that argue for caution regardless of direction. */
  cautions: string[];
  note: string;
}

interface Bar { time: number; open: number; high: number; low: number; close: number; volume?: number }

function ema(v: number[], p: number): number {
  if (!v.length) return NaN;
  const k = 2 / (p + 1);
  let prev = v[0];
  for (let i = 1; i < v.length; i++) prev = v[i] * k + prev * (1 - k);
  return prev;
}

export async function buildTickerRead(symbol: string, bars: Bar[], spyBars: Bar[]): Promise<TickerRead | null> {
  const sym = symbol.toUpperCase();
  if (!bars || bars.length < 60) return null;

  const closes = bars.map((b) => b.close);
  const spot = closes[closes.length - 1];
  const dims: Dimension[] = [];
  const cautions: string[] = [];

  // ── TREND ────────────────────────────────────────────────────────────────
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const vs20 = ((spot - e20) / e20) * 100;
  const stacked = e20 > e50;
  dims.push({
    key: 'trend',
    label: 'Trend',
    state: stacked && spot > e20 ? 'bullish' : !stacked && spot < e20 ? 'bearish' : 'neutral',
    value: `${vs20 >= 0 ? '+' : ''}${vs20.toFixed(1)}% vs 20-EMA`,
    read: stacked
      ? `20-EMA above the 50 and price ${spot > e20 ? 'above' : 'below'} it — uptrend ${spot > e20 ? 'intact' : 'under pressure'}.`
      : `20-EMA below the 50 — the intermediate trend is down${spot > e20 ? ', though price has pushed back above the short average' : ''}.`,
  });

  // ── RELATIVE STRENGTH ────────────────────────────────────────────────────
  if (spyBars.length >= 21) {
    const n = 20;
    const r = (arr: Bar[]) => {
      const a = arr[arr.length - 1].close;
      const b = arr[arr.length - 1 - n]?.close;
      return b > 0 ? ((a - b) / b) * 100 : 0;
    };
    const rel = r(bars) - r(spyBars);
    dims.push({
      key: 'rs',
      label: 'vs SPY',
      state: rel > 2 ? 'bullish' : rel < -2 ? 'bearish' : 'neutral',
      value: `${rel >= 0 ? '+' : ''}${rel.toFixed(1)}% (20d)`,
      read: rel > 2
        ? 'Outperforming the index — money is choosing this over the market.'
        : rel < -2
          ? 'Lagging the index. A long here is fighting the relative trend.'
          : 'Moving roughly with the index — no relative edge either way.',
    });
  }

  // ── COMPRESSION ──────────────────────────────────────────────────────────
  try {
    const { analyzeCompression } = await import('./compression-engine');
    const c = analyzeCompression(bars as any);
    if (c) {
      const coiled = (c as any).quality === 'strong' || (c as any).squeezeOn;
      dims.push({
        key: 'compression',
        label: 'Range',
        state: coiled ? 'neutral' : 'unknown',
        value: coiled ? 'coiled' : 'not compressed',
        read: coiled
          ? 'Range has tightened against its own volatility — the setup precedes a move but does not say which way.'
          : 'No meaningful compression. Nothing is coiling here.',
      });
    }
  } catch { /* compression is optional */ }

  // ── GAPS ─────────────────────────────────────────────────────────────────
  try {
    const { analyzeGaps } = await import('@shared/gap-engine');
    const g = analyzeGaps(bars as any, sym);
    if (g) {
      const below = g.nearestBelow;
      const above = g.nearestAbove;
      const rate = g.stats.fillRate != null ? `${(g.stats.fillRate * 100).toFixed(0)}% of past gaps filled` : 'no fill history';
      dims.push({
        key: 'gaps',
        label: 'Gaps',
        state: below && Math.abs(below.distancePct ?? 0) < 5 ? 'caution' : 'neutral',
        value: below
          ? `$${below.nearEdge.toFixed(2)} (${Math.abs(below.distancePct ?? 0).toFixed(1)}% below)`
          : above
            ? `$${above.nearEdge.toFixed(2)} (${(above.distancePct ?? 0).toFixed(1)}% above)`
            : 'none open',
        read: below
          ? `Unfilled gap below acts as a downside magnet — ${rate}, typically in ${g.stats.medianBarsToFill ?? '—'} sessions.`
          : above
            ? `Unfilled gap above is the nearest upside magnet — ${rate}.`
            : 'No unfilled gaps of significance in either direction.',
      });
      if (below && Math.abs(below.distancePct ?? 0) < 5) {
        cautions.push(`Open gap only ${Math.abs(below.distancePct!).toFixed(1)}% below`);
      }
    }
  } catch { /* optional */ }

  // ── REVERSAL ─────────────────────────────────────────────────────────────
  try {
    const { analyzeReversal } = await import('@shared/reversal-engine');
    const dir = stacked ? 'bearish' : 'bullish'; // look for a turn AGAINST the prevailing trend
    const r = analyzeReversal(bars as any, dir);
    if (r && r.grade !== 'NONE') {
      dims.push({
        key: 'reversal',
        label: 'Reversal',
        state: r.grade === 'CONFIRMED' ? (dir === 'bullish' ? 'bullish' : 'bearish') : 'caution',
        value: `${r.grade.toLowerCase()} (${dir})`,
        read: r.summary,
      });
    }
  } catch { /* optional */ }

  // ── GAMMA ────────────────────────────────────────────────────────────────
  try {
    const { computeGEXFromCBOE } = await import('./gex-cboe-fallback');
    const snap = await computeGEXFromCBOE(sym);
    if (snap && snap.spotPrice > 0) {
      const cw = Number(snap.callWall), pw = Number(snap.putWall);
      const neg = String(snap.regime).includes('negative');
      dims.push({
        key: 'gamma',
        label: 'Dealer gamma',
        state: neg ? 'caution' : 'neutral',
        value: `${neg ? 'short' : 'long'} gamma${Number.isFinite(cw) ? ` · wall $${cw}` : ''}`,
        read: neg
          ? `Dealers are short gamma — they hedge WITH the move, so pushes tend to extend rather than fade.${Number.isFinite(pw) ? ` Put wall $${pw}.` : ''}`
          : `Dealers are long gamma — they hedge against the move, which damps range.${Number.isFinite(cw) ? ` Call wall $${cw} caps rallies.` : ''}`,
      });
      if (neg) cautions.push('Short-gamma regime — moves extend rather than mean-revert');
    }
  } catch { /* optional */ }

  // ── EVENTS ───────────────────────────────────────────────────────────────
  try {
    const { getEarningsBySymbol } = await import('./earnings-calendar');
    const map = await getEarningsBySymbol(30);
    const e = map.get(sym);
    if (e) {
      dims.push({
        key: 'earnings',
        label: 'Earnings',
        state: e.daysAway <= 7 ? 'caution' : 'neutral',
        value: `${e.date} (${e.daysAway}d)`,
        read: `Reports ${e.session === 'pre' ? 'before the open' : e.session === 'post' ? 'after the close' : ''} in ${e.daysAway} sessions. Binary — it says variance is coming, not direction.`.trim(),
      });
      if (e.daysAway <= 7) cautions.push(`Earnings in ${e.daysAway} days — size for a gap`);
    }
  } catch { /* optional */ }

  logger.debug(`[TICKER-READ] ${sym}: ${dims.length} dimensions`);

  // Only dimensions that have a direction count here. Compression, gamma and
  // event risk are useful context, but neither is itself a bullish/bearish
  // vote. This prevents a busy card from pretending to have more directional
  // confirmation than it does.
  const bullish = dims.filter((d) => d.state === 'bullish').length;
  const bearish = dims.filter((d) => d.state === 'bearish').length;
  const assessed = bullish + bearish;
  const bias = bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral';
  const aligned = bias === 'bullish' ? bullish : bias === 'bearish' ? bearish : 0;
  const conflicting = bias === 'bullish' ? bearish : bias === 'bearish' ? bullish : 0;
  const biasWord = bias === 'neutral' ? 'No directional' : `${bias[0].toUpperCase()}${bias.slice(1)}`;
  const summary = assessed > 0
    ? `${biasWord} watch — ${aligned}/${assessed} directional price conditions align${conflicting ? `; ${conflicting} disagrees` : ''}.`
    : 'No directional price conditions are currently available.';

  return {
    symbol: sym,
    spot,
    asOf: new Date().toISOString(),
    dimensions: dims,
    directional: {
      bias,
      aligned,
      conflicting,
      assessed,
      status: 'watch',
      tradeable: false,
      summary,
      nextCheck:
        'A watch becomes a signal only after a fresh trigger plus a structural target and invalidation are verified.',
    },
    band: null,
    cautions,
    note:
      'Conditions, not a call. There is deliberately no grade here: a conviction band means a set of independent layers agreed on a direction and a level plan, and printing one on a ticker the engine has not published would borrow that meaning for something it does not apply to. Read the dimensions and decide for yourself.',
  };
}

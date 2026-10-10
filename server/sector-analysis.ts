/**
 * SECTOR ANALYSIS — run the ticker engines on the sector itself.
 *
 * Every engine here takes bars: gaps, reversal, base rates, compression, trend.
 * Sector ETFs are just tickers, so all of it applies — and nobody applies it.
 * Rotation tells you money is moving INTO Biotech; it does not tell you whether
 * XBI is coiled, whether it has an unfilled gap under it, or whether XBI is a name
 * that actually fills its gaps. Those decide whether the rotation is tradeable.
 *
 * The point is to answer "IGV is bull flagging, right?" with the same evidence
 * standard applied to a single name, rather than a vibe from a heatmap tile.
 */
import { logger } from './logger';
import { analyzeGaps } from '@shared/gap-engine';
import { analyzeReversal } from '@shared/reversal-engine';
import { computeBaseRates } from '@shared/ticker-base-rates';
import { yahooChart } from './yahoo-client';

export const SECTORS: { etf: string; name: string }[] = [
  { etf: 'XLK', name: 'Tech' },
  { etf: 'IGV', name: 'Software / SaaS' },
  { etf: 'SMH', name: 'Semis' },
  { etf: 'XLF', name: 'Financials' },
  { etf: 'XLE', name: 'Energy' },
  { etf: 'XLV', name: 'Healthcare' },
  { etf: 'XBI', name: 'Biotech' },
  { etf: 'XLI', name: 'Industrials' },
  { etf: 'XLY', name: 'Consumer Disc' },
  { etf: 'XLP', name: 'Staples' },
  { etf: 'XLU', name: 'Utilities' },
  { etf: 'XLB', name: 'Materials' },
  { etf: 'XLRE', name: 'Real Estate' },
  { etf: 'XLC', name: 'Comms' },
  { etf: 'ITA', name: 'Defense' },
  { etf: 'KRE', name: 'Regional Banks' },
];

export interface SectorRead {
  etf: string;
  name: string;
  spot: number;
  /** % vs its own 20-day average — position, not prediction. */
  vs20: number;
  /** % vs SPY over 20 sessions. */
  vsSpy: number;
  trend: 'up' | 'down' | 'flat';
  compressed: boolean;
  /** Nearest unfilled gap and how reliably this ETF fills them. */
  gapEdge: number | null;
  gapDistancePct: number | null;
  gapFillRate: number | null;
  gapSamples: number;
  reversalGrade: string | null;
  notes: string[];
}

function ema(v: number[], p: number): number {
  if (!v.length) return NaN;
  const k = 2 / (p + 1);
  let prev = v[0];
  for (let i = 1; i < v.length; i++) prev = v[i] * k + prev * (1 - k);
  return prev;
}

async function barsFor(symbol: string) {
  const j = await yahooChart(symbol, { range: '2y', interval: '1d' });
  const res = j?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  if (!res || !q) return [];
  return (res.timestamp || [])
    .map((t: number, i: number) => ({
      time: t, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i],
    }))
    .filter((b: any) => [b.open, b.high, b.low, b.close].every((v: any) => Number.isFinite(v)));
}

function relative(a: any[], b: any[], n = 20): number {
  const r = (arr: any[]) => {
    const last = arr[arr.length - 1]?.close;
    const then = arr[arr.length - 1 - n]?.close;
    return then > 0 ? ((last - then) / then) * 100 : 0;
  };
  return r(a) - r(b);
}

export async function analyzeSectors(limit = 16): Promise<{ sectors: SectorRead[]; note: string }> {
  const spy = await barsFor('SPY');
  const out: SectorRead[] = [];

  for (const s of SECTORS.slice(0, limit)) {
    const bars = await barsFor(s.etf);
    if (bars.length < 120) continue;

    const closes = bars.map((b: any) => b.close);
    const spot = closes[closes.length - 1];
    const e20 = ema(closes.slice(-60), 20);
    const e50 = ema(closes.slice(-120), 50);
    const vs20 = ((spot - e20) / e20) * 100;
    const vsSpy = spy.length ? relative(bars, spy) : 0;

    const trend: SectorRead['trend'] = e20 > e50 && spot > e20 ? 'up' : e20 < e50 && spot < e20 ? 'down' : 'flat';

    const gaps = analyzeGaps(bars as any, s.etf);
    const below = gaps?.nearestBelow ?? null;
    const above = gaps?.nearestAbove ?? null;
    const nearest = below ?? above;

    // Look for a turn AGAINST the prevailing direction — a sector that has run is
    // more interesting for exhaustion than for confirmation.
    const rev = analyzeReversal(bars as any, trend === 'up' ? 'bearish' : 'bullish');

    let compressed = false;
    try {
      const { analyzeCompression } = await import('./compression-engine');
      const c = analyzeCompression(bars as any);
      compressed = !!((c as any)?.squeezeOn || (c as any)?.quality === 'strong');
    } catch { /* optional */ }

    const notes: string[] = [];
    if (compressed) notes.push('Range has tightened against its own volatility — a move is being set up, direction unstated.');
    if (nearest && gaps?.stats.fillRate != null && gaps.stats.total >= 10) {
      const d = nearest.distancePct ?? 0;
      notes.push(
        `Unfilled gap ${Math.abs(d).toFixed(1)}% ${d < 0 ? 'below' : 'above'} at $${nearest.nearEdge.toFixed(2)} — ` +
        `${s.etf} has filled ${(gaps.stats.fillRate * 100).toFixed(0)}% of ${gaps.stats.total} past gaps.`,
      );
    }
    if (rev && rev.grade !== 'NONE') notes.push(`${rev.grade} ${rev.direction} reversal read: ${rev.summary}`);
    if (Math.abs(vsSpy) > 4) {
      notes.push(vsSpy > 0
        ? `Outperforming SPY by ${vsSpy.toFixed(1)}% over 20 sessions — this is where money went, which also means the easy part is behind it.`
        : `Lagging SPY by ${Math.abs(vsSpy).toFixed(1)}% over 20 sessions.`);
    }

    out.push({
      etf: s.etf, name: s.name, spot,
      vs20: Number(vs20.toFixed(2)),
      vsSpy: Number(vsSpy.toFixed(2)),
      trend, compressed,
      gapEdge: nearest?.nearEdge ?? null,
      gapDistancePct: nearest?.distancePct ?? null,
      gapFillRate: gaps?.stats.fillRate ?? null,
      gapSamples: gaps?.stats.total ?? 0,
      reversalGrade: rev && rev.grade !== 'NONE' ? `${rev.grade} ${rev.direction}` : null,
      notes,
    });
  }

  out.sort((a, b) => b.vsSpy - a.vsSpy);
  logger.info(`[SECTOR-ANALYSIS] ${out.length} sectors read`);

  return {
    sectors: out,
    note:
      'The same engines applied to single names, pointed at the sector itself. Rotation says money is moving; this says whether the sector is coiled, stretched, or sitting above an unfilled gap it historically fills — which is what decides whether the rotation is tradeable.',
  };
}

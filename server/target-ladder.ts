/**
 * CONTEXT TARGET LADDER — T1/T2/T3 from levels the market actually cares
 * about, not formula multiples.
 *
 * Operator 2026-09-24: "these T1 T2 T3 are very unrealistic... no realistic
 * contextual pattern and evidence." Measured: publishers set nearly every
 * target at a flat 2R, and several sat past the 60-day high with nothing
 * marking what was up there.
 *
 * Candidate levels in the trade's direction, merged and de-duplicated:
 *   - chart structure   support / resistance from the TA engine
 *   - dealer positioning GEX call wall, put wall, max-gamma strike
 *   - prior swings      20- and 60-session highs / lows
 * Each rung carries: what the level is, its distance in R and in the stock's
 * own expected range for the holding period (ATR-scaled), and a driftless
 * probability of trading there before the horizon ends. Levels closer than
 * 0.6R are skipped (not worth the risk); nothing beyond 3x the expected range
 * is offered (not a realistic swing target). If no structural level exists,
 * the ladder says so and falls back to expected-range multiples, labelled.
 */
import { fetchCandles } from './historical-candles';

export interface LadderRung {
  rung: 'T1' | 'T2' | 'T3';
  price: number;
  source: string;          // "resistance", "GEX call wall", "60-day high", "1.0× expected range"
  rMultiple: number;       // distance / risk
  rangeMultiple: number;   // distance / expected range for the horizon
  probTouch: number;       // driftless, ≈ 2·(1 − Φ(z))
  structural: boolean;
}

export interface TargetLadder {
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  horizonDays: number;
  atr: number;
  expectedRange: number;
  rungs: LadderRung[];
  publishedTarget: number | null;
  publishedTargetNote: string | null;
  note: string;
}

function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

const horizonFor = (hp?: string | null) => (hp === 'day' ? 1 : hp === 'position' ? 30 : hp === 'leap' ? 90 : 10);

export async function buildTargetLadder(input: {
  symbol: string; direction: 'long' | 'short'; entry: number; stop: number;
  holdingPeriod?: string | null; publishedTarget?: number | null;
  /** GEX needs its own chain fetch — the scoring pass skips it for speed. */
  includeGex?: boolean;
}): Promise<TargetLadder | null> {
  const { symbol, direction, entry, stop } = input;
  const risk = Math.abs(entry - stop);
  if (!(entry > 0) || !(risk > 0)) return null;
  const sgn = direction === 'long' ? 1 : -1;

  const bars = await fetchCandles(symbol, '6mo', '1d');
  if (bars.length < 25) return null;
  const tr = bars.slice(-15).map((b, i, a) =>
    i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - a[i - 1].close), Math.abs(b.low - a[i - 1].close)));
  const atr = tr.slice(1).reduce((x, y) => x + y, 0) / (tr.length - 1);
  const horizonDays = horizonFor(input.holdingPeriod);
  const expectedRange = atr * Math.sqrt(horizonDays);

  // ── candidate levels ──────────────────────────────────────────────────
  const cands: Array<{ price: number; source: string; weight: number }> = [];
  const hi = (n: number) => Math.max(...bars.slice(-n).map((b) => b.high));
  const lo = (n: number) => Math.min(...bars.slice(-n).map((b) => b.low));
  if (direction === 'long') {
    cands.push({ price: hi(20), source: '20-day high', weight: 2 }, { price: hi(60), source: '60-day high', weight: 3 }, { price: hi(120), source: '6-month high', weight: 3 });
  } else {
    cands.push({ price: lo(20), source: '20-day low', weight: 2 }, { price: lo(60), source: '60-day low', weight: 3 }, { price: lo(120), source: '6-month low', weight: 3 });
  }
  try {
    const { getCachedTARead } = await import('./ta-engine');
    const ta: any = await getCachedTARead(symbol, '6mo', '1d');
    const lv = direction === 'long' ? ta?.levels?.resistance : ta?.levels?.support;
    for (const p of (lv ?? []) as number[]) cands.push({ price: p, source: direction === 'long' ? 'chart resistance' : 'chart support', weight: 3 });
    for (const f of (ta?.fib?.levels ?? []) as any[]) {
      if (Number.isFinite(f?.price)) cands.push({ price: Number(f.price), source: `Fib ${f.label ?? f.ratio ?? ''}`.trim(), weight: 1 });
    }
  } catch { /* TA unavailable — other sources still stand */ }
  if (input.includeGex !== false) try {
    const { computeGEXFromCBOE } = await import('./gex-cboe-fallback');
    const gex: any = await computeGEXFromCBOE(symbol);
    if (gex) {
      if (direction === 'long' && gex.callWall) cands.push({ price: Number(gex.callWall), source: 'GEX call wall', weight: 4 });
      if (direction === 'short' && gex.putWall) cands.push({ price: Number(gex.putWall), source: 'GEX put wall', weight: 4 });
      if (gex.maxGammaStrike) cands.push({ price: Number(gex.maxGammaStrike), source: 'max-gamma strike (pin)', weight: 2 });
    }
  } catch { /* options chain unavailable */ }

  // In the trade's direction, meaningful distance, within a realistic reach.
  const minDist = 0.6 * risk;
  const maxDist = 3 * expectedRange;
  const inDir = cands
    .filter((c) => Number.isFinite(c.price) && sgn * (c.price - entry) >= minDist && sgn * (c.price - entry) <= maxDist)
    .sort((a, b) => sgn * (a.price - b.price));

  // Merge levels within 0.25 ATR of each other — keep the heavier source.
  const merged: typeof inDir = [];
  for (const c of inDir) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.price - c.price) < 0.25 * atr) {
      if (c.weight > prev.weight) merged[merged.length - 1] = { ...c, source: `${c.source} + ${prev.source}` };
      else prev.source = `${prev.source} + ${c.source}`;
    } else merged.push({ ...c });
  }

  const rungOf = (price: number, source: string, structural: boolean, idx: number): LadderRung => {
    const dist = Math.abs(price - entry);
    const z = dist / Math.max(expectedRange, 1e-9);
    return {
      rung: (['T1', 'T2', 'T3'] as const)[idx],
      price: Number(price.toFixed(2)),
      source,
      rMultiple: Number((dist / risk).toFixed(2)),
      rangeMultiple: Number(z.toFixed(2)),
      probTouch: Number(Math.min(1, 2 * (1 - normCdf(z))).toFixed(2)),
      structural,
    };
  };

  const rungs: LadderRung[] = merged.slice(0, 3).map((c, i) => rungOf(c.price, c.source, true, i));
  // Fill missing rungs with labelled expected-range multiples (never silently).
  for (const m of [1, 1.5, 2.25]) {
    if (rungs.length >= 3) break;
    const price = entry + sgn * m * expectedRange;
    const last = rungs[rungs.length - 1];
    if (last && sgn * (price - last.price) <= 0.25 * atr) continue;
    if (sgn * (price - entry) < minDist) continue;
    rungs.push(rungOf(price, `${m}× expected range (no structural level here)`, false, rungs.length));
  }

  const pub = input.publishedTarget ?? null;
  let pubNote: string | null = null;
  if (pub != null) {
    const z = Math.abs(pub - entry) / Math.max(expectedRange, 1e-9);
    const nearest = rungs.find((r) => r.structural && Math.abs(r.price - pub) < 0.5 * atr);
    pubNote = nearest
      ? `published target sits on ${nearest.source}`
      : z > 1.5
        ? `published target is ${z.toFixed(1)}× the expected range — a stretch, not a plan`
        : `published target is a formula level (no structure there)`;
  }

  return {
    symbol, direction, entry, stop, horizonDays,
    atr: Number(atr.toFixed(2)),
    expectedRange: Number(expectedRange.toFixed(2)),
    rungs,
    publishedTarget: pub,
    publishedTargetNote: pubNote,
    note: `Expected range = ATR(14) × √${horizonDays} sessions. Odds are driftless touch probabilities over the horizon — a map of reach, not a forecast.`,
  };
}

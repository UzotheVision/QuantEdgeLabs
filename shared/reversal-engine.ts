/**
 * REVERSAL ENGINE — is a move exhausting, and has it actually turned yet?
 *
 * "Find the reversal" is really two questions that get conflated, and conflating
 * them is how people knife-catch:
 *
 *   EXHAUSTION — the move is stretched and losing force. This is a *condition*.
 *                Stretched things can stay stretched, and a stock can be oversold
 *                the whole way down.
 *   TURN       — price has actually done something a continuation wouldn't do:
 *                reclaimed a level it broke, or refused to make a new low.
 *
 * So the output separates them. Exhaustion alone is a watch, never a trigger; the
 * grade only reaches actionable when a turn confirms what exhaustion suggested.
 * Every check is mechanical and reported with its own number, so a call can be
 * argued with rather than taken on faith.
 *
 * Pure functions over OHLC bars. No fetching, no advice — conditions and levels.
 */

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume?: number }

export interface ReversalCheck {
  key: string;
  label: string;
  /** Did it fire? */
  hit: boolean;
  /** 'exhaustion' = stretched/tiring. 'turn' = price confirmed a change. */
  kind: 'exhaustion' | 'turn';
  detail: string;
}

export interface ReversalReport {
  direction: 'bullish' | 'bearish';
  /** Checks that fired, exhaustion and turn separately counted. */
  checks: ReversalCheck[];
  exhaustionCount: number;
  turnCount: number;
  /** WATCH = stretched only. SETUP = stretched + one turn. CONFIRMED = 2+ turns. */
  grade: 'NONE' | 'WATCH' | 'SETUP' | 'CONFIRMED';
  /** The level a turn is measured against — the invalidation if it fails back. */
  pivot: number | null;
  summary: string;
}

// ── indicators ──────────────────────────────────────────────────────────────

export function rsi(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / period, al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  // Wilder smoothing — the standard, and it matters: a simple rolling mean makes
  // RSI jumpier and produces divergences that aren't there.
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    ag = (ag * (period - 1) + g) / period;
    al = (al * (period - 1) + l) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (!values.length) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Index of the lowest low / highest high within the last `n` bars. */
function extremeIdx(bars: Bar[], n: number, kind: 'low' | 'high'): number {
  const start = Math.max(0, bars.length - n);
  let best = start;
  for (let i = start; i < bars.length; i++) {
    if (kind === 'low' ? bars[i].low < bars[best].low : bars[i].high > bars[best].high) best = i;
  }
  return best;
}

// ── the report ──────────────────────────────────────────────────────────────

const LOOKBACK = 40;

export function analyzeReversal(bars: Bar[], direction: 'bullish' | 'bearish' = 'bullish'): ReversalReport | null {
  if (!bars || bars.length < 60) return null;

  const closes = bars.map((b) => b.close);
  const r = rsi(closes);
  const e20 = ema(closes, 20);
  const last = bars[bars.length - 1];
  const lastR = r[r.length - 1];
  const checks: ReversalCheck[] = [];
  const bull = direction === 'bullish';

  // 1. STRETCHED FROM THE MEAN — how far price sits from its own 20-EMA, in ATR-free
  //    percentage terms. Being far from the mean is the precondition for reverting.
  const meanDist = e20[e20.length - 1] > 0 ? ((last.close - e20[e20.length - 1]) / e20[e20.length - 1]) * 100 : 0;
  const stretched = bull ? meanDist < -6 : meanDist > 6;
  checks.push({
    key: 'stretched', kind: 'exhaustion', hit: stretched,
    label: 'Stretched from the mean',
    detail: `${meanDist >= 0 ? '+' : ''}${meanDist.toFixed(1)}% vs the 20-EMA`,
  });

  // 2. RSI EXTREME
  const rsiExtreme = bull ? lastR < 32 : lastR > 68;
  checks.push({
    key: 'rsi', kind: 'exhaustion', hit: rsiExtreme,
    label: bull ? 'RSI oversold' : 'RSI overbought',
    detail: `RSI ${Number.isFinite(lastR) ? lastR.toFixed(0) : '—'}`,
  });

  // 3. MOMENTUM DIVERGENCE — price makes a new extreme, momentum does not. The
  //    classic exhaustion tell: the move is still going but with less force behind it.
  const extIdx = extremeIdx(bars, LOOKBACK, bull ? 'low' : 'high');
  const priorSlice = bars.slice(Math.max(0, bars.length - LOOKBACK * 2), Math.max(1, bars.length - LOOKBACK));
  let divergence = false;
  let divDetail = 'no comparable prior extreme';
  if (priorSlice.length > 5) {
    const priorIdxLocal = priorSlice.reduce(
      (bi, b, i) => (bull ? b.low < priorSlice[bi].low : b.high > priorSlice[bi].high) ? i : bi, 0);
    const priorAbs = Math.max(0, bars.length - LOOKBACK * 2) + priorIdxLocal;
    const priceMoreExtreme = bull
      ? bars[extIdx].low < bars[priorAbs].low
      : bars[extIdx].high > bars[priorAbs].high;
    const rsiLessExtreme = bull ? r[extIdx] > r[priorAbs] : r[extIdx] < r[priorAbs];
    divergence = priceMoreExtreme && rsiLessExtreme;
    divDetail = divergence
      ? `price made a ${bull ? 'lower low' : 'higher high'} but RSI ${bull ? 'held higher' : 'came in lower'} (${r[priorAbs]?.toFixed(0)} → ${r[extIdx]?.toFixed(0)})`
      : 'price and momentum still agree';
  }
  checks.push({
    key: 'divergence', kind: 'exhaustion', hit: divergence,
    label: 'Momentum divergence', detail: divDetail,
  });

  // 4. VOLUME CLIMAX — a capitulation print. Big volume at the extreme is the
  //    supply/demand actually changing hands rather than price drifting.
  const vols = bars.map((b) => b.volume ?? 0).filter((v) => v > 0);
  let climax = false;
  let climaxDetail = 'no volume data';
  if (vols.length > 30) {
    const avg = vols.slice(-30).reduce((a, b) => a + b, 0) / 30;
    const extVol = bars[extIdx].volume ?? 0;
    const x = avg > 0 ? extVol / avg : 0;
    climax = x >= 1.6;
    climaxDetail = `${x.toFixed(1)}× average volume at the ${bull ? 'low' : 'high'}`;
  }
  checks.push({ key: 'climax', kind: 'exhaustion', hit: climax, label: 'Volume climax', detail: climaxDetail });

  // ── TURNS — what a continuation would NOT do ──────────────────────────────

  // 5. RECLAIM — price broke the recent extreme and has closed back through it.
  const pivot = bull ? bars[extIdx].low : bars[extIdx].high;
  const barsSince = bars.length - 1 - extIdx;

  // A reclaim only means something while the break is still FRESH. Without this
  // window the check fired on essentially every stock that simply wasn't sitting
  // on its 40-day low — QCOM, SMH and INTC all "reclaimed" lows set 13-16 sessions
  // earlier, which is not a reversal signal, it's just an uptrend. Price has to
  // have come back through the level within about two weeks for the recovery to be
  // the thing happening now rather than ancient history.
  const RECLAIM_WINDOW = 10;
  const fresh = barsSince >= 1 && barsSince <= RECLAIM_WINDOW;
  const backThrough = bull ? last.close > pivot * 1.005 : last.close < pivot * 0.995;
  const reclaimed = fresh && backThrough;
  checks.push({
    key: 'reclaim', kind: 'turn', hit: reclaimed,
    label: bull ? 'Reclaimed the low' : 'Rejected the high',
    detail: reclaimed
      ? `closed ${bull ? 'above' : 'below'} $${pivot.toFixed(2)} just ${barsSince} sessions after setting it`
      : !backThrough
        ? `still ${bull ? 'at or under' : 'at or over'} $${pivot.toFixed(2)}`
        : `the ${bull ? 'low' : 'high'} at $${pivot.toFixed(2)} is ${barsSince} sessions old — too stale to count as a reclaim`,
  });

  // 6. HIGHER LOW / LOWER HIGH — structure has actually changed, not just bounced.
  const recent = bars.slice(-8);
  const structureTurn = bull
    ? recent[recent.length - 1].low > Math.min(...recent.slice(0, 4).map((b) => b.low))
    : recent[recent.length - 1].high < Math.max(...recent.slice(0, 4).map((b) => b.high));
  checks.push({
    key: 'structure', kind: 'turn', hit: structureTurn,
    label: bull ? 'Higher low forming' : 'Lower high forming',
    detail: structureTurn ? 'the most recent swing improved on the prior one' : 'structure still pointing the old way',
  });

  const exhaustionCount = checks.filter((c) => c.kind === 'exhaustion' && c.hit).length;
  const turnCount = checks.filter((c) => c.kind === 'turn' && c.hit).length;

  // Exhaustion NEVER grades above WATCH on its own. That's the whole discipline:
  // oversold is a description of the past, not a prediction about the next bar.
  let grade: ReversalReport['grade'] = 'NONE';
  if (turnCount >= 2 && exhaustionCount >= 1) grade = 'CONFIRMED';
  else if (turnCount >= 1 && exhaustionCount >= 2) grade = 'SETUP';
  else if (exhaustionCount >= 2) grade = 'WATCH';

  const summary =
    grade === 'CONFIRMED'
      ? `${exhaustionCount} exhaustion signals and ${turnCount} confirmations — price has done something a continuation wouldn't.`
      : grade === 'SETUP'
        ? `Stretched with one confirmation. Needs structure to hold above $${pivot?.toFixed(2)} to count as turned.`
        : grade === 'WATCH'
          ? `Exhausted but NOT turned. Nothing here says the move is over — oversold can stay oversold.`
          : turnCount > 0
            ? `${turnCount} confirmation${turnCount > 1 ? 's' : ''} but no exhaustion behind ${turnCount > 1 ? 'them' : 'it'} — there was no extreme here to reverse from.`
            : `No meaningful exhaustion in the ${direction === 'bullish' ? 'decline' : 'advance'} yet.`;

  return { direction, checks, exhaustionCount, turnCount, grade, pivot, summary };
}

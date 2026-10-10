/**
 * FLOW SCORING — turns one options print into a 0–100 conviction score.
 *
 * Built to the desk's own rules, not to raw dollar size:
 *   • "Premium alone means nothing" — size is scored RELATIVE to that ticker's own
 *     baseline (a $1M print in SPY is noise; in a mid-cap it's a signal).
 *   • Sweeps > blocks (taking liquidity across exchanges = urgency).
 *   • Repeats matter — "smart money rarely hits a strike once."
 *   • Volume/OI > 1 means today's activity is NEW positioning, not existing OI.
 *   • Far-OTM lottos get discounted; reasonable OTM with time gets credit.
 *   • "Time is your best friend" — near-dated expiries are penalised, not rewarded.
 *
 * The score RANKS. It is never a trigger on its own — the chart decides. A low score
 * can still run (the desk's own BABA example), which is why we surface the components
 * so a human can overrule the number.
 */

export interface FlowPrint {
  symbol: string;
  optionType: 'call' | 'put';
  strikePrice: number;
  expirationDate: string;
  volume: number;
  openInterest?: number | null;
  volumeOIRatio?: number | null;
  premium: number;                 // per-contract premium ($)
  totalPremium?: number | null;    // total $ spent
  impliedVolatility?: number | null;
  delta?: number | null;
  underlyingPrice?: number | null;
  /** 'unknown' when direction could not be measured from the tape — see biasBasis. */
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  flowType: 'block' | 'sweep' | 'unusual_volume' | 'dark_pool' | 'normal';
  unusualScore?: number | null;
  isLotto?: boolean | null;
  detectedAt?: string | Date | null;
}

export interface ScoreComponent { label: string; points: number; why: string }
export interface FlowScore {
  score: number;                   // 0–100
  tier: 'S' | 'A' | 'B' | 'C';
  components: ScoreComponent[];
  isWhale: boolean;
  isSweep: boolean;
  isRepeat: boolean;
  pctOtm: number | null;           // + = out of the money
  perContract: number;             // $ per contract
  dte: number | null;
  totalPremium: number;
}

export const WHALE_PREMIUM = 1_000_000;   // the desk's whale bar: >= $1M
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function daysToExpiry(expiration: string, from = new Date()): number | null {
  const t = Date.parse(expiration);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - from.getTime()) / 86_400_000));
}

/** % out-of-the-money, sign-corrected for calls vs puts (+ = OTM, − = ITM). */
export function percentOtm(p: Pick<FlowPrint, 'strikePrice' | 'underlyingPrice' | 'optionType'>): number | null {
  const spot = p.underlyingPrice;
  if (!spot || spot <= 0 || !p.strikePrice) return null;
  const raw = ((p.strikePrice - spot) / spot) * 100;
  return p.optionType === 'call' ? raw : -raw;
}

/**
 * Score a print. `baseline` is the median total premium seen for THIS ticker (so size
 * is judged relative to the name); `repeatCount` is how many times this same contract
 * printed in the recent window.
 */
export function scoreFlow(p: FlowPrint, opts: { baseline?: number; repeatCount?: number } = {}): FlowScore {
  const totalPremium = p.totalPremium ?? p.premium * p.volume * 100;
  const perContract = p.volume > 0 ? totalPremium / p.volume : p.premium * 100;
  const dte = daysToExpiry(p.expirationDate);
  const pctOtm = percentOtm(p);
  const isWhale = totalPremium >= WHALE_PREMIUM;
  const isSweep = p.flowType === 'sweep';
  const repeatCount = opts.repeatCount ?? 0;
  const isRepeat = repeatCount >= 3;   // "3+ hits on the same contract"

  const c: ScoreComponent[] = [];

  // 1 · Size (max 30) — the LARGER of relative-to-baseline and absolute
  // premium points. Relative alone let a $172K print on a sleepy name outrank
  // a $19.5M NVDA whale (small names have small medians); absolute alone
  // misses genuinely unusual size on quiet tickers. Size can now win either way.
  const baseline = opts.baseline && opts.baseline > 0 ? opts.baseline : null;
  const absPts = Math.round(clamp(Math.log10(Math.max(totalPremium, 1_000) / 50_000) * 12, 0, 30));
  if (baseline) {
    const x = totalPremium / baseline;
    const relPts = Math.round(clamp(Math.log2(Math.max(x, 0.25)) * 8, -6, 30));
    if (relPts >= absPts) {
      c.push({ label: 'UNUSUAL SIZE', points: relPts, why: `${x.toFixed(1)}× this ticker's typical print` });
    } else {
      c.push({ label: 'PREMIUM', points: absPts, why: `$${(totalPremium / 1e6).toFixed(1)}M total premium — size speaks for itself` });
    }
  } else {
    c.push({ label: 'PREMIUM', points: absPts, why: `$${(totalPremium / 1000).toFixed(0)}k total premium` });
  }

  // A freshly listed strike has near-zero OI: its vol/OI ratio is calendar
  // mechanics, not aggression, and a 'sweep' label derived from that ratio is
  // unverifiable. Gate both on a real baseline.
  const oiBaseline = (p.openInterest ?? 0) >= 100;

  // 2 · Aggression (max 16)
  if (isSweep && oiBaseline) c.push({ label: 'SWEEP', points: 16, why: 'Took liquidity across exchanges — urgency' });
  else if (isSweep) c.push({ label: 'SWEEP?', points: 5, why: 'Sweep-like ratio on a near-zero-OI strike — freshly listed, aggression unverifiable' });
  else if (p.flowType === 'block') c.push({ label: 'BLOCK', points: 9, why: 'Single negotiated block' });
  else if (p.flowType === 'dark_pool') c.push({ label: 'HIGH SCORE', points: 7, why: 'Legacy bucket — not an off-exchange print' });

  // 3 · Repeats (max 14)
  if (isRepeat) c.push({ label: 'REPEATER', points: 14, why: `${repeatCount} hits on this contract — conviction` });
  else if (repeatCount === 2) c.push({ label: 'REPEAT', points: 6, why: '2 hits on this contract' });

  // 4 · New positioning vs existing OI (max 14) — only against a real baseline
  if (oiBaseline) {
    const vOI = p.volumeOIRatio ?? (p.volume / Math.max(p.openInterest ?? 1, 1));
    const pts = Math.round(clamp((vOI - 0.5) * 10, -4, 14));
    c.push({ label: 'VOL / OI', points: pts, why: `${vOI.toFixed(1)}× open interest — ${vOI >= 1 ? 'new positioning' : 'inside existing OI'}` });
  } else {
    c.push({ label: 'VOL / OI', points: 0, why: 'near-zero OI — no baseline to measure against' });
  }

  // 5 · Time: "time is your best friend" — reward room, penalise same-week gambles (max 12)
  if (dte != null) {
    const pts = dte <= 2 ? -8 : dte <= 7 ? -2 : dte <= 21 ? 8 : dte <= 60 ? 12 : 6;
    c.push({ label: 'TIME', points: pts, why: `${dte} DTE — ${dte <= 7 ? 'little room to be right' : 'room for the thesis to play out'}` });
  }

  // 6 · Strike sanity: far-OTM lottos are cheap for a reason (max 8)
  if (pctOtm != null) {
    const a = Math.abs(pctOtm);
    const pts = p.isLotto ? -8 : a <= 2 ? 6 : a <= 8 ? 8 : a <= 15 ? 3 : -6;
    c.push({ label: 'STRIKE', points: pts, why: `${pctOtm >= 0 ? '+' : ''}${pctOtm.toFixed(1)}% ${pctOtm >= 0 ? 'OTM' : 'ITM'}` });
  }

  const raw = c.reduce((s, x) => s + x.points, 0);
  const score = clamp(Math.round(38 + raw), 0, 100);
  const tier = score >= 80 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : 'C';

  return { score, tier, components: c, isWhale, isSweep, isRepeat, pctOtm, perContract, dte, totalPremium };
}

/** Median total premium per symbol — the baseline "unusual" is measured against. */
export function baselinesBySymbol(prints: FlowPrint[]): Record<string, number> {
  const bucket: Record<string, number[]> = {};
  for (const p of prints) {
    (bucket[p.symbol] ||= []).push(p.totalPremium ?? p.premium * p.volume * 100);
  }
  const out: Record<string, number> = {};
  for (const [sym, arr] of Object.entries(bucket)) {
    arr.sort((a, b) => a - b);
    out[sym] = arr[Math.floor(arr.length / 2)];
  }
  return out;
}

/** How many times the same contract (symbol+type+strike+expiry) printed. */
export function repeatCounts(prints: FlowPrint[]): Record<string, number> {
  const key = (p: FlowPrint) => `${p.symbol}|${p.optionType}|${p.strikePrice}|${p.expirationDate}`;
  const out: Record<string, number> = {};
  for (const p of prints) out[key(p)] = (out[key(p)] ?? 0) + 1;
  return out;
}
export const contractKey = (p: FlowPrint) => `${p.symbol}|${p.optionType}|${p.strikePrice}|${p.expirationDate}`;

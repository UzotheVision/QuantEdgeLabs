/**
 * TICKER BASE RATES — what this specific name actually tends to do.
 *
 * The gap engine works because it answers a question with the ticker's own record
 * instead of a rule of thumb: "MARA has filled 100% of its last 31 gaps, median 3
 * sessions" beats "gaps usually fill" every time. This applies the same method to
 * the other questions that decide an options trade.
 *
 * Every rate here carries its sample count and refuses to assert anything on thin
 * evidence. A 100% rate on 4 observations is not a tendency, it is a coincidence,
 * and reporting it as a number invites exactly the overconfidence the platform is
 * supposed to protect against.
 *
 * All computed from daily OHLC. No chain, no auth, works on any listed ticker.
 */

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume?: number }

export interface BaseRate {
  key: string;
  label: string;
  /** Formatted headline value, or null when there isn't enough evidence. */
  value: string | null;
  samples: number;
  confidence: 'none' | 'low' | 'moderate' | 'good';
  /** What it means for an options position specifically. */
  read: string;
}

/** Sample thresholds shared by every rate, so "good" means the same thing throughout. */
function confidenceFor(n: number): BaseRate['confidence'] {
  if (n === 0) return 'none';
  if (n < 10) return 'low';
  if (n < 30) return 'moderate';
  return 'good';
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

/**
 * OVERNIGHT vs INTRADAY.
 *
 * Splits total return into the gap (previous close → open) and the session (open →
 * close). This is the single most useful stat for an options trader and almost
 * nobody computes it: if a name earns everything overnight, buying calls at 10am
 * and selling at 3pm is structurally losing money no matter how good the read is.
 */
function overnightSplit(bars: Bar[]): BaseRate {
  let overnight = 0, intraday = 0, n = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close, o = bars[i].open, c = bars[i].close;
    if (!(prev > 0) || !(o > 0)) continue;
    overnight += Math.log(o / prev);
    intraday += Math.log(c / o);
    n++;
  }

  // Report the two legs SEPARATELY rather than as a share of the total. A share is
  // meaningless whenever the legs have opposite signs — which is precisely the
  // interesting case, a name that gaps up and fades all day — because the ratio
  // leaves [0,1] and any clamp then reports 0% or 100%. NVDA read "100% overnight"
  // and MARA "0%" for exactly that reason, and both were artefacts rather than
  // findings. Two cumulative returns cannot lie in that way.
  const onPct = (Math.exp(overnight) - 1) * 100;
  const inPct = (Math.exp(intraday) - 1) * 100;
  const fmt = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(0)}%`;

  let read: string;
  if (n < 10) {
    read = 'Not enough sessions to split the return.';
  } else if (onPct > 0 && inPct < 0) {
    read = `All of the gain arrived overnight (${fmt(onPct)}) while the session gave back ${fmt(inPct)}. Buying at the open and selling into the close has been the wrong side of this name — the return is in the gap, and only a held position captures it.`;
  } else if (inPct > 0 && onPct < 0) {
    read = `The session earned ${fmt(inPct)} while gaps cost ${fmt(onPct)}. This one rewards being flat overnight; holding through the close has been a drag.`;
  } else if (onPct > inPct) {
    read = `Gaps contributed ${fmt(onPct)} against ${fmt(inPct)} intraday. Weighted toward the overnight, so intraday option trades fight where the return lives.`;
  } else {
    read = `The session contributed ${fmt(inPct)} against ${fmt(onPct)} overnight. Day trades have room to work here.`;
  }

  return {
    key: 'overnight',
    label: 'Overnight vs intraday',
    value: n < 10 ? null : `${fmt(onPct)} / ${fmt(inPct)}`,
    samples: n,
    confidence: confidenceFor(n),
    read,
  };
}

/**
 * STREAK REVERSION — after N consecutive down closes, what happened next?
 * The empirical version of "it's due for a bounce", which is usually wrong and
 * occasionally, for a specific name, isn't.
 */
function streakReversion(bars: Bar[], streakLen = 3): BaseRate {
  let hits = 0, up = 0;
  for (let i = streakLen; i < bars.length - 1; i++) {
    let down = true;
    for (let k = 0; k < streakLen; k++) {
      if (bars[i - k].close >= bars[i - k - 1].close) { down = false; break; }
    }
    if (!down) continue;
    hits++;
    if (bars[i + 1].close > bars[i].close) up++;
  }
  const rate = hits ? up / hits : 0;
  return {
    key: 'streak',
    label: `Bounce after ${streakLen} down days`,
    value: hits < 10 ? null : pct(rate),
    samples: hits,
    confidence: confidenceFor(hits),
    read:
      hits < 10
        ? `Only ${hits} occurrences of ${streakLen} consecutive down days — nothing to lean on.`
        : rate >= 0.6
          ? `Bounced the next session ${pct(rate)} of the time across ${hits} occurrences. A real mean-reversion tendency in this name.`
          : rate <= 0.4
            ? `Kept falling ${pct(1 - rate)} of the time. Selling into weakness has worked better here than buying it.`
            : `Roughly a coin flip across ${hits} occurrences — no edge either way.`,
  };
}

/**
 * ATR REALIZATION — does this name actually travel its average range?
 * A ticker that chronically closes inside its ATR will not reach an ATR-derived
 * target in the time an option has, which is a silent killer of otherwise correct
 * directional calls.
 */
function atrRealization(bars: Bar[], window = 14): BaseRate {
  if (bars.length < window + 30) {
    return { key: 'atr', label: 'ATR realization', value: null, samples: 0, confidence: 'none',
      read: 'Not enough history.' };
  }
  let reached = 0, n = 0;
  for (let i = window; i < bars.length; i++) {
    let tr = 0;
    for (let k = i - window; k < i; k++) {
      const h = bars[k].high, l = bars[k].low, pc = bars[k - 1]?.close ?? bars[k].open;
      tr += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    const atr = tr / window;
    if (!(atr > 0)) continue;
    const range = bars[i].high - bars[i].low;
    n++;
    if (range >= atr) reached++;
  }
  const rate = n ? reached / n : 0;
  return {
    key: 'atr',
    label: 'Days that travel their ATR',
    value: n < 30 ? null : pct(rate),
    samples: n,
    confidence: confidenceFor(n),
    read:
      n < 30
        ? 'Not enough sessions.'
        : rate >= 0.5
          ? `Covers its average range ${pct(rate)} of sessions — ATR-based targets are reachable here.`
          : `Only ${pct(rate)} of sessions cover the average range. ATR-derived targets will often sit outside what this name actually travels in the time an option has.`,
  };
}

/**
 * ROUND-NUMBER PINNING — how often does it close within 0.5% of a whole dollar
 * (or a $5 level on higher-priced names)? Relevant because pinning near a strike
 * is where short-dated options die.
 */
function roundNumberPin(bars: Bar[]): BaseRate {
  const recent = bars.slice(-250);
  if (recent.length < 60) {
    return { key: 'pin', label: 'Round-number pinning', value: null, samples: 0, confidence: 'none', read: 'Not enough history.' };
  }
  const step = recent[recent.length - 1].close >= 100 ? 5 : 1;
  let pinned = 0;
  for (const b of recent) {
    const nearest = Math.round(b.close / step) * step;
    if (nearest > 0 && Math.abs(b.close - nearest) / b.close <= 0.005) pinned++;
  }
  const rate = pinned / recent.length;
  const expected = step === 1 ? 0.0 : 0.0; // reported vs the reader's own judgement
  return {
    key: 'pin',
    label: `Closes near a $${step} level`,
    value: pct(rate),
    samples: recent.length,
    confidence: confidenceFor(recent.length),
    read:
      rate >= 0.25
        ? `Closes within 0.5% of a $${step} level ${pct(rate)} of sessions — strikes at those levels act as magnets, which matters most in the last week of an option's life.`
        : `Closes near a $${step} level only ${pct(rate)} of sessions — no strong pinning behaviour.`,
  };
}

export interface BaseRateReport {
  symbol: string;
  spot: number;
  sessions: number;
  rates: BaseRate[];
  note: string;
}

export function computeBaseRates(bars: Bar[], symbol?: string): BaseRateReport | null {
  if (!bars || bars.length < 60) return null;
  const rates = [
    overnightSplit(bars),
    streakReversion(bars, 3),
    atrRealization(bars),
    roundNumberPin(bars),
  ];
  return {
    symbol: symbol ?? '',
    spot: bars[bars.length - 1].close,
    sessions: bars.length,
    rates,
    note:
      'Measured from this ticker’s own history, not from a general rule. Every rate shows its sample count, and a rate computed on fewer than ten observations is withheld rather than printed — a 100% rate on four samples is a coincidence, not a tendency.',
  };
}

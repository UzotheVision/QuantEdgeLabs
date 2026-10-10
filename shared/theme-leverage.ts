/**
 * THEME LEVERAGE — find the highest-torque expression of a macro driver, and the
 * one that has not caught up yet.
 *
 * This is an attempt to reverse-engineer the PROCESS behind calls like "HYMC:
 * $10B post-tax NPV against a $1B market cap, and every $100 on gold adds ~$300M
 * to NPV." Read as a stock tip that is unusable. Read as a method it decomposes
 * into four steps, and every one of them is computable:
 *
 *   1. NAME THE DRIVER.        Gold. Bitcoin. Semis. Rates. One series.
 *   2. MEASURE THE LEVERAGE.   Regress each candidate on the driver. Beta IS the
 *                              "every $100 adds $300M" claim, in price terms,
 *                              and it comes out of returns without needing a
 *                              reserve statement or an NPV model.
 *   3. CHECK IT ACTUALLY TRACKS. High beta with low R-squared is not leverage,
 *                              it is an unrelated volatile stock. This is the
 *                              step that separates a levered play from a lottery
 *                              ticket, and it is the one usually skipped.
 *   4. FIND WHAT HAS LAGGED.   Among names that genuinely track, which has NOT
 *                              yet delivered its beta? That residual is the
 *                              setup — the same shape as "MRNA outperformed QQQ
 *                              5x," just pointed the other way.
 *
 * What comes out is not a ticker list copied from someone else. It is the screen
 * that produced theirs, which means it keeps working after their book changes,
 * and it runs on any driver you can name — including ones they are not watching.
 *
 * Deliberately price-only. Fundamentals would sharpen step 2, but requiring them
 * would mean building nothing today, and the price relationship is the part that
 * actually has to hold for the trade to work.
 */

export interface LeverageInput {
  symbol: string;
  /** Aligned, same-length daily closes as the driver. */
  closes: number[];
}

export interface LeverageResult {
  symbol: string;
  /** Move per 1% of driver move. 3.0 = three-times torque. */
  beta: number;
  /** 0-1. How much of this name is explained by the driver. */
  rSquared: number;
  /** Driver's own move over the window, percent. */
  driverMovePct: number;
  /** This name's actual move, percent. */
  actualMovePct: number;
  /** What beta says it should have done, percent. */
  impliedMovePct: number;
  /** actual − implied. Negative = has not delivered its leverage yet. */
  residualPct: number;
  /** Which side the driver's own trend makes this a candidate for. */
  side: 'long' | 'short' | 'none';
  /**
   * Is the gap to the driver WIDENING or closing? This is what separates a name
   * that has merely lagged from one that is genuinely decoupling.
   */
  residualTrend: 'widening' | 'converging' | 'flat';
  /** True when the name is RISING against a falling driver, and pulling away. */
  decoupling: boolean;
  /** True when a rising driver is leaving this name behind — explicitly not a long. */
  breakingDown: boolean;
  /**
   * Composite 0-100, and it only means something WITH `side`. High = tracks the
   * driver, carries real torque, and has not yet delivered the move the driver
   * has already made.
   */
  catchUpScore: number;
  read: string;
}

function pctReturns(v: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < v.length; i++) {
    if (v[i - 1] > 0) out.push((v[i] - v[i - 1]) / v[i - 1]);
  }
  return out;
}

/**
 * Below this return standard deviation a series carries no usable variation and
 * any regression on it is noise amplified by division. The case that matters is
 * not a genuinely calm stock — it is a STALE FEED. Repeated prices from a frozen
 * quote produce near-zero variance, and this platform has had frozen prices, so
 * the failure is live rather than theoretical. Guarding on `sxx === 0` did not
 * catch it: a variance of 2e-33 is not zero, and it sailed through to produce a
 * confident, meaningless beta.
 */
export const MIN_RETURN_STDDEV = 1e-5;

/** Fraction of consecutive bars allowed to repeat before a series is called stale. */
export const MAX_REPEAT_FRAC = 0.5;

/** True when a series looks frozen rather than merely quiet. */
export function isStale(v: number[]): boolean {
  if (v.length < 5) return true;
  let repeats = 0;
  for (let i = 1; i < v.length; i++) if (v[i] === v[i - 1]) repeats++;
  return repeats / (v.length - 1) > MAX_REPEAT_FRAC;
}

/** OLS slope and R² of y on x. Rejects degenerate inputs rather than fitting them. */
function regress(x: number[], y: number[]): { beta: number; r2: number } {
  const n = Math.min(x.length, y.length);
  if (n < 20) return { beta: NaN, r2: NaN };
  const xs = x.slice(-n), ys = y.slice(-n);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;

  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  // Reject on standard deviation, not on exact zero — see MIN_RETURN_STDDEV.
  const sdx = Math.sqrt(sxx / n), sdy = Math.sqrt(syy / n);
  if (!(sdx > MIN_RETURN_STDDEV) || !(sdy > MIN_RETURN_STDDEV)) return { beta: NaN, r2: NaN };
  const beta = sxy / sxx;
  const r = sxy / Math.sqrt(sxx * syy);
  return { beta, r2: r * r };
}

/** Minimum R² below which "leverage" is really just unrelated volatility. */
export const MIN_TRACKING_R2 = 0.25;

/** Below this the driver has no trend worth levering into, either way. */
export const MIN_DRIVER_MOVE_PCT = 3;

export function measureLeverage(
  driverCloses: number[],
  candidates: LeverageInput[],
): LeverageResult[] {
  const dRet = pctReturns(driverCloses);
  // A frozen driver cannot be levered to, and quietly returning betas against one
  // is worse than returning nothing.
  if (dRet.length < 20 || isStale(driverCloses)) return [];

  const driverMovePct =
    driverCloses[0] > 0
      ? ((driverCloses[driverCloses.length - 1] - driverCloses[0]) / driverCloses[0]) * 100
      : 0;

  const out: LeverageResult[] = [];

  for (const c of candidates) {
    const cRet = pctReturns(c.closes);
    const n = Math.min(dRet.length, cRet.length);
    if (n < 20 || isStale(c.closes)) continue;

    const { beta, r2 } = regress(dRet.slice(-n), cRet.slice(-n));
    if (!Number.isFinite(beta) || !Number.isFinite(r2)) continue;

    const first = c.closes[c.closes.length - n - 1] ?? c.closes[0];
    const last = c.closes[c.closes.length - 1];
    const actualMovePct = first > 0 ? ((last - first) / first) * 100 : 0;
    const impliedMovePct = driverMovePct * beta;
    const residualPct = actualMovePct - impliedMovePct;

    // Torque only counts when the relationship is real, so beta is gated on R².
    const tracks = r2 >= MIN_TRACKING_R2;
    const torque = tracks ? Math.min(1, Math.abs(beta) / 3) : 0;

    // DIRECTION FIRST. Torque is not a virtue on its own — high beta to a FALLING
    // driver is the worst thing to own, not the best. The driver's own trend
    // decides which side is even on the table, and an undecided driver offers
    // neither. Getting this wrong ranked the most-levered name in a sinking
    // sector as the top idea, which is exactly backwards.
    const side: LeverageResult['side'] =
      !tracks || Math.abs(driverMovePct) < MIN_DRIVER_MOVE_PCT ? 'none'
      : driverMovePct > 0 ? 'long' : 'short';

    // "Has not caught up" also flips with the driver. In a RISING driver the
    // laggard has under-delivered (residual < 0). In a FALLING driver the name
    // that has not yet fallen (residual > 0) is the one with room left to give.
    const dislocation =
      side === 'long' ? Math.max(0, -residualPct)
      : side === 'short' ? Math.max(0, residualPct)
      : 0;
    const lag = Math.min(1, dislocation / 30);

    // Is the residual widening or closing? Walk the cumulative gap and regress it
    // on time. A LAGGARD's gap is stable or closing — it will catch up, so fade
    // it. A DECOUPLER's gap widens — the relationship is breaking down and the
    // name is going its own way, which is the "most of crypto struggled, this one
    // stood out" setup and is a reason to be WITH it, not against it. Without
    // this the two are arithmetically identical and get opposite treatment.
    const gapSeries: number[] = [];
    {
      let cd = 1, cc = 1;
      const dr = dRet.slice(-n), cr = cRet.slice(-n);
      for (let t = 0; t < n; t++) {
        cd *= 1 + dr[t];
        cc *= 1 + cr[t];
        gapSeries.push((cc - 1) * 100 - (cd - 1) * 100 * beta);
      }
    }
    const half = Math.floor(gapSeries.length / 2);
    const gapEarly = gapSeries.slice(0, half).reduce((s2, v) => s2 + v, 0) / Math.max(1, half);
    const gapLate = gapSeries.slice(half).reduce((s2, v) => s2 + v, 0) / Math.max(1, gapSeries.length - half);
    const gapDelta = Math.abs(gapLate) - Math.abs(gapEarly);
    const residualTrend: LeverageResult['residualTrend'] =
      gapDelta > 3 ? 'widening' : gapDelta < -3 ? 'converging' : 'flat';

    // Holding up against a falling driver, and pulling further away as it falls.
    // DECOUPLING requires the name to be genuinely going the other way, not merely
    // falling more slowly. A miner down 6.8% while gold is down 12% is still a
    // miner going down; calling that a long because it "outperformed" is how you
    // buy the best-looking thing in a bear market. The Hyperliquid shape — most
    // of the sector struggling while ONE name rises — needs actual strength.
    const decoupling =
      tracks && driverMovePct < 0 && residualPct > 8
      && residualTrend === 'widening' && actualMovePct > 0;

    // And the mirror image, which is the same error pointed the other way: a
    // WIDENING negative gap against a RISING driver is a name breaking down, not
    // a laggard about to catch up. MSTR down 3.6% while its driver rose 19.5%,
    // gap widening, was scoring as the top long. A catch-up trade is a bet on
    // convergence, so it may only be taken when the gap is actually converging.
    const breakingDown = tracks && driverMovePct > 0 && residualPct < -8 && residualTrend === 'widening';

    // Tracking now outweighs raw torque; a levered name you cannot rely on to
    // follow the driver is not a levered play on the driver.
    const catchUpScore = side === 'none' || breakingDown
      ? 0
      : decoupling
        // Scored on the strength of the divergence from its sector, not on
        // unspent move — there is no reversion being bet on here.
        ? Math.round((r2 * 0.3 + torque * 0.15 + Math.min(1, residualPct / 40) * 0.55) * 100)
        // A catch-up is a bet on convergence, so a widening gap forfeits it.
        : residualTrend === 'widening'
          ? Math.round((r2 * 0.45 + torque * 0.2) * 100 * 0.4)
          : Math.round((r2 * 0.45 + torque * 0.2 + lag * 0.35) * 100);


    const read = !tracks
      ? `Does not track the driver (R² ${r2.toFixed(2)}). A ${beta.toFixed(1)}x beta here is unrelated volatility, not leverage.`
      : breakingDown
        ? `Driver ${driverMovePct.toFixed(0)}% and rising, but this did ${actualMovePct.toFixed(0)}% and the gap is `
          + `WIDENING. This is not a laggard waiting to catch up — the relationship is breaking down and it is `
          + `being left behind. Not a long.`
      : decoupling
        ? `Driver ${driverMovePct.toFixed(0)}% and falling, but this did ${actualMovePct.toFixed(0)}% against `
          + `${impliedMovePct.toFixed(0)}% implied and the gap is WIDENING. Not a laggard — it is decoupling. `
          + `Relative strength against its own sector is a reason to be with it, not to fade it.`
      : side === 'none'
        ? `Tracks at ${beta.toFixed(1)}x, but the driver has only moved ${driverMovePct.toFixed(1)}% — `
          + `there is no trend to be levered to yet.`
        : dislocation > 8
          ? `${beta.toFixed(1)}x and tracking (R² ${r2.toFixed(2)}). Driver ${driverMovePct.toFixed(0)}%, `
            + `this did ${actualMovePct.toFixed(0)}% against ${impliedMovePct.toFixed(0)}% implied — `
            + `${dislocation.toFixed(0)} points of the move still unspent, on the ${side} side.`
          : `${beta.toFixed(1)}x and tracking, but it has already delivered its leverage `
            + `(${actualMovePct.toFixed(0)}% vs ${impliedMovePct.toFixed(0)}% implied). The move has been made.`;

    out.push({
      symbol: c.symbol,
      beta: Math.round(beta * 100) / 100,
      rSquared: Math.round(r2 * 100) / 100,
      driverMovePct: Math.round(driverMovePct * 10) / 10,
      actualMovePct: Math.round(actualMovePct * 10) / 10,
      impliedMovePct: Math.round(impliedMovePct * 10) / 10,
      residualPct: Math.round(residualPct * 10) / 10,
      side: decoupling ? 'long' : side,
      residualTrend, decoupling, breakingDown,
      catchUpScore, read,
    });
  }

  return out.sort((a, b) => b.catchUpScore - a.catchUpScore);
}

/**
 * Drivers worth pointing this at. The value is that it works on ANY series —
 * these are a starting set, not a limit.
 */
export const DRIVERS: Record<string, { proxy: string; label: string }> = {
  gold:     { proxy: 'GLD',  label: 'Gold' },
  silver:   { proxy: 'SLV',  label: 'Silver' },
  bitcoin:  { proxy: 'IBIT', label: 'Bitcoin' },
  semis:    { proxy: 'SMH',  label: 'Semiconductors' },
  software: { proxy: 'IGV',  label: 'Software' },
  biotech:  { proxy: 'XBI',  label: 'Biotech' },
  energy:   { proxy: 'XLE',  label: 'Energy' },
  uranium:  { proxy: 'URA',  label: 'Uranium' },
};

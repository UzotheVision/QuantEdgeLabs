/**
 * Defined-risk debit-spread planner.
 *
 * This is deliberately a two-leg planner, not a renamed long option. It prices
 * a conservative opening debit (buy at ask, sell at bid), then reports the
 * contractual maximum loss and maximum gain. It does NOT promise the gain:
 * both legs still have to be tradable and the underlying still has to reach
 * the short strike before expiry.
 */

import { getCBOEOptionsChain } from './cboe-options-fallback';

export interface DebitSpreadPlan {
  symbol: string;
  direction: 'long' | 'short';
  structure: 'call_debit_spread' | 'put_debit_spread';
  expiryDate: string;
  dte: number;
  buy: { type: 'call' | 'put'; strike: number; bid: number; ask: number; openInterest: number; volume: number };
  sell: { type: 'call' | 'put'; strike: number; bid: number; ask: number; openInterest: number; volume: number };
  width: number;
  debit: number;
  maxLoss: number;
  maxGain: number;
  breakeven: number;
  returnOnRisk: number;
  targetPrice: number | null;
  dataSource: 'cboe_delayed';
  caveat: string;
}

type OptionRow = {
  strike: number;
  bid: number;
  ask: number;
  openInterest: number;
  volume: number;
  expirationDate: string;
  type: 'call' | 'put';
};

const DAY_MS = 86_400_000;

function daysToExpiry(expiryDate: string): number {
  const [year, month, day] = expiryDate.split('-').map(Number);
  const expiry = Date.UTC(year, month - 1, day);
  const today = new Date();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((expiry - now) / DAY_MS);
}

function rounded(n: number) { return Math.round(n * 100) / 100; }

function liquidRows(options: any[], type: 'call' | 'put'): OptionRow[] {
  return options.map((option) => ({
    strike: Number(option.strike), bid: Number(option.bid) || 0, ask: Number(option.ask) || 0,
    openInterest: Number(option.open_interest) || 0, volume: Number(option.volume) || 0,
    expirationDate: String(option.expiration_date).slice(0, 10),
    type: String(option.option_type).toLowerCase() as 'call' | 'put',
  })).filter((option) => {
    if (option.type !== type || option.bid <= 0 || option.ask <= 0 || option.ask < option.bid) return false;
    const mid = (option.ask + option.bid) / 2;
    const spreadPct = (option.ask - option.bid) / mid;
    return spreadPct <= 0.20 && (option.openInterest >= 100 || option.volume >= 25);
  });
}

/**
 * Build the tightest liquid vertical around a real Oracle target. `targetPrice`
 * is not an assumption: callers should supply the signal's underlying T1.
 */
export async function planDebitSpread(args: {
  symbol: string;
  direction: 'long' | 'short';
  targetPrice?: number | null;
  minDte?: number;
  maxDte?: number;
  /** Per-spread dollar loss budget (one contract). Omit only for research. */
  maxRiskDollars?: number;
}): Promise<DebitSpreadPlan | null> {
  const chain = await getCBOEOptionsChain(args.symbol);
  if (!chain) return null;
  const type = args.direction === 'long' ? 'call' : 'put';
  const minDte = Math.max(1, args.minDte ?? 7);
  const maxDte = Math.max(minDte, args.maxDte ?? 45);
  const target = args.targetPrice && args.targetPrice > 0 ? args.targetPrice : null;
  const options = liquidRows(chain.options, type).filter((option) => {
    const dte = daysToExpiry(option.expirationDate);
    return dte >= minDte && dte <= maxDte;
  });
  if (!options.length) return null;

  const expiries = [...new Set(options.map((option) => option.expirationDate))]
    .sort((a, b) => Math.abs(daysToExpiry(a) - 21) - Math.abs(daysToExpiry(b) - 21));

  for (const expiryDate of expiries) {
    const sameExpiry = options.filter((option) => option.expirationDate === expiryDate);
    const buys = sameExpiry.slice().sort((a, b) => Math.abs(a.strike - chain.spotPrice) - Math.abs(b.strike - chain.spotPrice));
    const idealShort = target ?? (args.direction === 'long' ? chain.spotPrice * 1.04 : chain.spotPrice * 0.96);
    for (const buy of buys) {
      const shortCandidates = sameExpiry.filter((option) =>
        args.direction === 'long' ? option.strike > buy.strike : option.strike < buy.strike,
      );
      if (!shortCandidates.length) continue;
      const sell = shortCandidates.slice().sort((a, b) => Math.abs(a.strike - idealShort) - Math.abs(b.strike - idealShort))[0];
      const width = Math.abs(sell.strike - buy.strike);
      const debit = buy.ask - sell.bid; // conservative executable opening cost
      if (width <= 0 || debit <= 0 || debit >= width) continue;
      const maxLoss = debit * 100;
      if (args.maxRiskDollars != null && maxLoss > args.maxRiskDollars) continue;
      const maxGain = (width - debit) * 100;
      const breakeven = args.direction === 'long' ? buy.strike + debit : buy.strike - debit;
      return {
        symbol: args.symbol.toUpperCase(), direction: args.direction,
        structure: args.direction === 'long' ? 'call_debit_spread' : 'put_debit_spread',
        expiryDate, dte: daysToExpiry(expiryDate), buy, sell, width: rounded(width), debit: rounded(debit),
        maxLoss: rounded(maxLoss), maxGain: rounded(maxGain), breakeven: rounded(breakeven),
        returnOnRisk: rounded(maxGain / maxLoss), targetPrice: target, dataSource: 'cboe_delayed',
        caveat: 'Max loss and max gain are contractual at expiry. They are not guaranteed: fills use delayed CBOE quotes and the underlying must reach the short strike for max gain.',
      };
    }
  }
  return null;
}

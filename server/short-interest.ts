/**
 * Short interest — the squeeze-fuel read the operator asked for ("important
 * for blowing shit up"). Source: Yahoo's key statistics (exchange-reported,
 * updated on the exchanges' twice-monthly cycle — DISCLOSED as such, this is
 * not live positioning). Cached 12h per symbol; a miss returns nulls, never
 * an invented percentage.
 *
 * squeezeContext is a plain-language read, not a signal: HIGH fuel needs
 * >=15% of float short, ELEVATED >=8%, plus days-to-cover coloring. The
 * pattern engine and workup consume it as context; nothing trades on it
 * directly.
 */
import { logger } from './logger';

export interface ShortInterest {
  symbol: string;
  shortPercentOfFloat: number | null;  // 0-1 fraction as Yahoo reports it
  sharesShort: number | null;
  shortRatio: number | null;           // days to cover
  floatShares: number | null;
  asOf: string;
  squeezeContext: 'high fuel' | 'elevated' | 'normal' | 'thin' | 'unknown';
}

const cache = new Map<string, { at: number; data: ShortInterest }>();
const TTL = 12 * 60 * 60 * 1000;

function context(pct: number | null, dtc: number | null): ShortInterest['squeezeContext'] {
  if (pct == null) return 'unknown';
  if (pct >= 0.15) return 'high fuel';
  if (pct >= 0.08) return 'elevated';
  if (pct >= 0.03) return 'normal';
  return 'thin';
}

export async function getShortInterest(symbol: string): Promise<ShortInterest> {
  const sym = symbol.toUpperCase();
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  let data: ShortInterest = {
    symbol: sym, shortPercentOfFloat: null, sharesShort: null, shortRatio: null,
    floatShares: null, asOf: new Date().toISOString(), squeezeContext: 'unknown',
  };
  try {
    const { getYahooFinance } = await import('./yahoo-finance-service');
    const yf = await getYahooFinance();
    const r = await yf.quoteSummary(sym, { modules: ['defaultKeyStatistics'] });
    const k = (r as any)?.defaultKeyStatistics ?? {};
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    data = {
      symbol: sym,
      shortPercentOfFloat: num(k.shortPercentOfFloat),
      sharesShort: num(k.sharesShort),
      shortRatio: num(k.shortRatio),
      floatShares: num(k.floatShares),
      asOf: new Date().toISOString(),
      squeezeContext: context(num(k.shortPercentOfFloat), num(k.shortRatio)),
    };
  } catch (err: any) {
    logger.warn(`[SHORT-INT] ${sym} fetch failed: ${err?.message}`);
  }
  cache.set(sym, { at: Date.now(), data });
  return data;
}

/**
 * MARKET DATA FALLBACK — one place the scorers can ask for bars and quotes
 * without depending on a single provider that is currently down.
 *
 * WHY
 * Five of the universal engine's seven scorers were returning their default 50
 * because every one of them called yahoo-finance2 directly and Yahoo has been
 * answering 429. Measured on ADSK:
 *
 *   technical     58   ← the only scorer with live data
 *   fundamental   50   default
 *   quantitative  50   "Data unavailable"
 *   ml            50   not implemented
 *   orderFlow     50   "Order flow data unavailable"
 *   sentiment     54   no analyst data
 *   catalysts     50   "No upcoming earnings data"  ← on a stock reporting that night
 *   ─────────────────
 *   OVERALL       57   presented as a considered grade
 *
 * A score built from one real reading and six placeholders is worse than no
 * score, because it looks deliberate. This does not fix every scorer, but it
 * removes the single shared cause: no working source for bars and quotes.
 *
 * ORDER
 *   bars    Polygon grouped-daily (via liquid-universe) → Yahoo
 *   quote   Finnhub → Yahoo
 *
 * Polygon leads for bars because one request per session covers 2000+ names and
 * it is the same series every backtest in research/ uses — so the scorers and
 * the research finally read identical data. They did not before, which means a
 * rule validated offline could behave differently live.
 */
import { logger } from './logger';

export interface Bar { date: Date; open: number; high: number; low: number; close: number; volume: number }

/** Daily bars, newest last. Returns [] rather than throwing — callers degrade. */
export async function getBars(symbol: string, days = 130): Promise<Bar[]> {
  const sym = symbol.toUpperCase();

  try {
    const { getUniverseBars, getLiquidSymbols, loadLiquidUniverseFromDisk } = await import('./liquid-universe');
    if (getLiquidSymbols().length === 0) await loadLiquidUniverseFromDisk();
    const all = await getUniverseBars(Math.max(days, 60));
    const ub = all.get(sym);
    if (ub && ub.length >= 30) {
      return ub.map((b: any) => ({
        date: new Date(b.time * 1000),
        open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
    }
  } catch (e: any) {
    logger.debug(`[MKT-FALLBACK] universe bars miss for ${sym}: ${e?.message ?? e}`);
  }

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance();
    const start = new Date(); start.setDate(start.getDate() - Math.ceil(days * 1.5));
    const h: any[] = await yf.historical(sym, { period1: start, period2: new Date(), interval: '1d' });
    if (h?.length) {
      return h.map((b) => ({
        date: new Date(b.date), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
    }
  } catch (e: any) {
    logger.debug(`[MKT-FALLBACK] yahoo historical failed for ${sym}: ${e?.message ?? e}`);
  }

  return [];
}

/** Last price + day change. Null when no source answers. */
export async function getQuote(symbol: string): Promise<{ price: number; changePct: number; prevClose: number } | null> {
  const sym = symbol.toUpperCase();

  try {
    const { getFinnhubQuote } = await import('./finnhub-adapter');
    const q = await getFinnhubQuote(sym);
    if (q?.price) {
      const prev = q.changePct !== 0 ? q.price / (1 + q.changePct / 100) : q.price;
      return { price: q.price, changePct: q.changePct, prevClose: prev };
    }
  } catch { /* next */ }

  try {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance();
    const q: any = await yf.quote(sym);
    if (q?.regularMarketPrice) {
      return {
        price: q.regularMarketPrice,
        changePct: q.regularMarketChangePercent ?? 0,
        prevClose: q.regularMarketPreviousClose ?? q.regularMarketPrice,
      };
    }
  } catch { /* fall through */ }

  // Last resort: derive from the bars we may already have.
  const bars = await getBars(sym, 5);
  if (bars.length >= 2) {
    const c = bars[bars.length - 1].close, p = bars[bars.length - 2].close;
    return { price: c, changePct: p > 0 ? ((c - p) / p) * 100 : 0, prevClose: p };
  }
  return null;
}

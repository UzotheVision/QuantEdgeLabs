/**
 * EXTENDED-HOURS WATCH — after-hours and pre-market tracking for the
 * operator's favorites (META first). Operator 2026-09-23: "track META and
 * stocks after-hours / premarket, this is important." Two sweeps a day
 * (17:15 CT post-close, 7:45 CT pre-open) read Yahoo's extended quotes and
 * pulse any mover >= the threshold into the ORACLE feed; the endpoint
 * serves the full read for the UI.
 */
import { logger } from './logger';
import { FAVORITE_TICKERS } from '@shared/leadership-universe';

const MOVE_MIN = 1.5; // percent

export interface ExtendedRead {
  symbol: string;
  last: number | null;
  regularClose: number | null;
  extendedPrice: number | null;
  extendedPct: number | null;
  session: 'pre' | 'post' | 'regular' | 'closed';
}

export async function readExtendedFavorites(): Promise<ExtendedRead[]> {
  const YahooFinance = (await import('yahoo-finance2')).default as any;
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const syms = Array.from(FAVORITE_TICKERS);
  const out: ExtendedRead[] = [];
  let quotes: any[] = [];
  try {
    quotes = await yf.quote(syms);
  } catch {
    // batch failed — serial best-effort
    for (const s of syms) { try { quotes.push(await yf.quote(s)); } catch { /* skip */ } }
  }
  for (const q of quotes) {
    if (!q?.symbol) continue;
    const state = String(q.marketState ?? '').toUpperCase();
    const session: ExtendedRead['session'] =
      state === 'PRE' ? 'pre' : state.startsWith('POST') ? 'post' : state === 'REGULAR' ? 'regular' : 'closed';
    const extendedPrice = session === 'pre' ? q.preMarketPrice : session === 'post' || session === 'closed' ? q.postMarketPrice : null;
    const extendedPct = session === 'pre' ? q.preMarketChangePercent : session === 'post' || session === 'closed' ? q.postMarketChangePercent : null;
    out.push({
      symbol: q.symbol,
      last: Number(q.regularMarketPrice) || null,
      regularClose: Number(q.regularMarketPreviousClose) || null,
      extendedPrice: Number.isFinite(extendedPrice) ? Number(extendedPrice) : null,
      extendedPct: Number.isFinite(extendedPct) ? Number(Number(extendedPct).toFixed(2)) : null,
      session,
    });
  }
  return out;
}

export async function runExtendedHoursSweep(): Promise<void> {
  try {
    const reads = await readExtendedFavorites();
    const movers = reads.filter((r) => r.extendedPct != null && Math.abs(r.extendedPct) >= MOVE_MIN)
      .sort((a, b) => Math.abs(b.extendedPct!) - Math.abs(a.extendedPct!));
    if (!movers.length) {
      logger.info('[EXT-HOURS] favorites quiet in extended trading');
      return;
    }
    const line = movers.slice(0, 6).map((m) => `${m.symbol} ${m.extendedPct! > 0 ? '+' : ''}${m.extendedPct}%`).join(' · ');
    logger.info(`[EXT-HOURS] extended movers: ${line}`);
    try {
      const { pulse } = await import('./system-pulse');
      pulse('flow', `Extended-hours movers among favorites: ${line}`);
    } catch { /* decoration */ }
  } catch (err: any) {
    logger.warn(`[EXT-HOURS] sweep failed: ${err?.message ?? err}`);
  }
}

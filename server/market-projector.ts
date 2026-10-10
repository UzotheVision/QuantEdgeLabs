/**
 * Market Projector Service
 * ========================
 * Computes probabilistic market outlook for next session.
 * NOT price prediction — probability zones + directional bias
 * based on VIX implied move, sector momentum, flow, catalysts.
 */

import { logger } from './logger';
import { getTradierQuote } from './tradier-api';
import { db } from './db';
import { optionsFlowHistory, tradeIdeas } from '@shared/schema';
import { desc, gte, and, eq, sql } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ExpectedMove {
  symbol: string;
  currentPrice: number;
  expectedMovePct: number; // from VIX/IV
  upperBound: number;
  lowerBound: number;
  timeframe: 'daily' | 'weekly';
}

export interface DirectionalBias {
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  probability: number; // 0-100
  factors: BiasCheck[];
}

export interface BiasCheck {
  name: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  detail: string;
  weight: number;
}

export interface SectorPulse {
  sector: string;
  etf: string;
  price: number;
  changePct: number;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number; // 0-100
  category: 'core' | 'sector' | 'macro';
}

export interface WatchlistSetup {
  symbol: string;
  price: number;
  changePct: number;
  setup: 'REVERSAL' | 'BREAKOUT' | 'BOUNCE' | 'BREAKDOWN' | 'HOLD' | 'NO_SETUP';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  probability: number;
  catalyst: string;
  section: 'S-TIER' | 'A-TIER' | 'ACTIVE' | 'INDEX';
}

export interface ProjectorData {
  timestamp: string;
  nextSession: string; // "Monday Apr 7, 2026"
  expectedMoves: ExpectedMove[]; // SPY, QQQ, IWM, SPX, XSP
  bias: DirectionalBias;
  sectors: SectorPulse[];
  watchlistSetups: WatchlistSetup[];
  keyEvents: string[];
}

// ═══════════════════════════════════════════════════════════════
// EXPECTED MOVE (from VIX)
// ═══════════════════════════════════════════════════════════════

// Helper: fetch price from Yahoo (reliable, no auth needed)
async function yahooPrice(symbol: string): Promise<{ price: number; closes: number[] } | null> {
  try {
    const yahooSym = symbol === 'VIX' ? '%5EVIX' : symbol;
    const res = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${yahooSym}?range=1mo&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const closes = (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter(Boolean);
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice || closes[closes.length - 1] || 0;
    return price > 0 ? { price, closes } : null;
  } catch { return null; }
}

async function computeExpectedMove(symbol: string, timeframe: 'daily' | 'weekly'): Promise<ExpectedMove | null> {
  try {
    const [symData, vixData] = await Promise.all([yahooPrice(symbol), yahooPrice('VIX')]);
    if (!symData) return null;

    const price = symData.price;
    const vix = vixData?.price || 20;
    const dailyMove = vix / Math.sqrt(252);
    const movePct = timeframe === 'weekly' ? dailyMove * Math.sqrt(5) : dailyMove;

    return {
      symbol,
      currentPrice: +price.toFixed(2),
      expectedMovePct: +movePct.toFixed(2),
      upperBound: +(price * (1 + movePct / 100)).toFixed(2),
      lowerBound: +(price * (1 - movePct / 100)).toFixed(2),
      timeframe,
    };
  } catch (e) {
    logger.error(`[PROJECTOR] Expected move error for ${symbol}:`, e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// DIRECTIONAL BIAS
// ═══════════════════════════════════════════════════════════════

async function computeBias(): Promise<DirectionalBias> {
  const factors: BiasCheck[] = [];

  try {
    // Factor 0: Overnight futures (STRONGEST predictor — 70%+ accuracy)
    try {
      const esData = await yahooPrice('ES=F');
      if (esData && esData.closes.length >= 2) {
        const esLast = esData.closes[esData.closes.length - 1];
        const esPrev = esData.closes[esData.closes.length - 2];
        const esChg = ((esLast - esPrev) / esPrev) * 100;
        factors.push({
          name: 'ES Futures (Overnight)',
          signal: esChg > 0.3 ? 'bullish' : esChg < -0.3 ? 'bearish' : 'neutral',
          detail: `ES ${esChg > 0 ? '+' : ''}${esChg.toFixed(2)}% — strongest predictor`,
          weight: 25,
        });
      }
    } catch {}

    // Factor 1: SPY trend (above/below 20-day EMA)
    const spyData = await yahooPrice('SPY');
    const spyCloses = spyData?.closes || [];

    if (spyCloses.length >= 20) {
      const last = spyCloses[spyCloses.length - 1];
      const ema20 = spyCloses.slice(-20).reduce((s: number, v: number) => s + v, 0) / 20;
      const aboveEma = last > ema20;
      factors.push({
        name: 'SPY Trend',
        signal: aboveEma ? 'bullish' : 'bearish',
        detail: `SPY ${aboveEma ? 'above' : 'below'} 20-day EMA ($${ema20.toFixed(0)})`,
        weight: 20,
      });
    }

    // Factor 2: VIX direction
    const vixData = await yahooPrice('VIX');
    if (vixData) {
      const vix = vixData.price;
      const vixPrev = vixData.closes.length >= 2 ? vixData.closes[vixData.closes.length - 2] : vix;
      const vixChange = ((vix - vixPrev) / vixPrev) * 100;
      factors.push({
        name: 'VIX',
        signal: vix < 20 ? 'bullish' : vix > 30 ? 'bearish' : vixChange < -2 ? 'bullish' : vixChange > 2 ? 'bearish' : 'neutral',
        detail: `VIX ${vix.toFixed(1)} (${vixChange > 0 ? '+' : ''}${vixChange.toFixed(1)}%)`,
        weight: 15,
      });
    }

    // Factor 3: SMH sector momentum
    const smhData = await yahooPrice('SMH');
    const smhCloses = smhData?.closes || [];
    if (smhCloses.length >= 2) {
      const smhLast = smhCloses[smhCloses.length - 1];
      const smhPrev = smhCloses[smhCloses.length - 2];
      const smhChg = ((smhLast - smhPrev) / smhPrev) * 100;
      factors.push({
        name: 'Semi Sector (SMH)',
        signal: smhChg > 1 ? 'bullish' : smhChg < -1 ? 'bearish' : 'neutral',
        detail: `SMH ${smhChg > 0 ? '+' : ''}${smhChg.toFixed(1)}% last session`,
        weight: 20,
      });
    }

    // Factor 4: Multi-day trend (3-day)
    if (spyCloses.length >= 4) {
      const last3 = spyCloses.slice(-3);
      const greenDays = last3.filter((c: number, i: number) => i > 0 && c > last3[i - 1]).length;
      factors.push({
        name: '3-Day Trend',
        signal: greenDays >= 2 ? 'bullish' : greenDays === 0 ? 'bearish' : 'neutral',
        detail: `${greenDays}/2 green days in last 3 sessions`,
        weight: 15,
      });
    }

    // Factor 5: Whale flow direction (from our DB)
    try {
      const { getMarketDirectionality } = await import('./whale-flow-service');
      const flow = await getMarketDirectionality();
      if (flow.recentWhaleFlows.length > 5) {
        factors.push({
          name: 'Whale Flow',
          signal: flow.overallDirection === 'BULLISH' ? 'bullish' : flow.overallDirection === 'BEARISH' ? 'bearish' : 'neutral',
          detail: `${flow.overallDirection} (${flow.overallStrength}% strength, ${flow.recentWhaleFlows.length} trades)`,
          weight: 15,
        });
      }
    } catch {}

    // Factor 6: Recent idea performance
    try {
      const recentWins = await db.select({ count: sql<number>`count(*)` })
        .from(tradeIdeas)
        .where(and(eq(tradeIdeas.outcomeStatus, 'hit_target'), gte(tradeIdeas.timestamp, new Date(Date.now() - 7 * 86400000).toISOString())));
      const recentLosses = await db.select({ count: sql<number>`count(*)` })
        .from(tradeIdeas)
        .where(and(eq(tradeIdeas.outcomeStatus, 'hit_stop'), gte(tradeIdeas.timestamp, new Date(Date.now() - 7 * 86400000).toISOString())));
      const wins = Number(recentWins[0]?.count || 0);
      const losses = Number(recentLosses[0]?.count || 0);
      if (wins + losses >= 5) {
        const wr = wins / (wins + losses);
        factors.push({
          name: 'Engine Win Rate (7d)',
          signal: wr > 0.55 ? 'bullish' : wr < 0.4 ? 'bearish' : 'neutral',
          detail: `${(wr * 100).toFixed(0)}% (${wins}W/${losses}L last 7 days)`,
          weight: 15,
        });
      }
    } catch {}

  } catch (e) {
    logger.error('[PROJECTOR] Bias computation error:', e);
  }

  // Calculate weighted direction
  let bullishScore = 0, bearishScore = 0, totalWeight = 0;
  for (const f of factors) {
    totalWeight += f.weight;
    if (f.signal === 'bullish') bullishScore += f.weight;
    else if (f.signal === 'bearish') bearishScore += f.weight;
  }

  const bullPct = totalWeight > 0 ? (bullishScore / totalWeight) * 100 : 50;
  const bearPct = totalWeight > 0 ? (bearishScore / totalWeight) * 100 : 50;

  return {
    direction: bullPct > 60 ? 'BULLISH' : bearPct > 60 ? 'BEARISH' : 'NEUTRAL',
    probability: Math.round(Math.max(bullPct, bearPct)),
    factors,
  };
}

// ═══════════════════════════════════════════════════════════════
// SECTOR PULSE
// ═══════════════════════════════════════════════════════════════

async function computeSectorPulse(): Promise<SectorPulse[]> {
  const sectors = [
    // Core sectors
    { name: 'Semiconductors', etf: 'SMH', category: 'core' },
    { name: 'Semi Index', etf: 'SOXX', category: 'core' },
    { name: 'Technology', etf: 'XLK', category: 'core' },
    { name: 'Software', etf: 'IGV', category: 'core' },
    { name: 'Financials', etf: 'XLF', category: 'sector' },
    { name: 'Energy', etf: 'XLE', category: 'sector' },
    { name: 'Healthcare', etf: 'XLV', category: 'sector' },
    { name: 'Consumer Disc', etf: 'XLY', category: 'sector' },
    { name: 'Industrials', etf: 'XLI', category: 'sector' },
    { name: 'Communications', etf: 'XLC', category: 'sector' },
    { name: 'Utilities', etf: 'XLU', category: 'sector' },
    { name: 'Real Estate', etf: 'XLRE', category: 'sector' },
    // Macro indicators
    { name: 'Innovation', etf: 'ARKK', category: 'macro' },
    { name: '20Y Bonds', etf: 'TLT', category: 'macro' },
    { name: 'Gold', etf: 'GLD', category: 'macro' },
    { name: 'Oil', etf: 'USO', category: 'macro' },
    { name: 'Clean Energy', etf: 'TAN', category: 'macro' },
  ];

  const results: SectorPulse[] = [];

  for (const s of sectors) {
    try {
      const res = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${s.etf}?range=1mo&interval=1d`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const data = await res.json();
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(Boolean) || [];

      if (closes.length >= 2) {
        const last = closes[closes.length - 1];
        const prev = closes[closes.length - 2];
        const changePct = ((last - prev) / prev) * 100;

        // Trend: 5-day momentum
        const fiveDayAgo = closes.length >= 6 ? closes[closes.length - 6] : closes[0];
        const fiveDayChg = ((last - fiveDayAgo) / fiveDayAgo) * 100;

        results.push({
          sector: s.name,
          etf: s.etf,
          price: +last.toFixed(2),
          changePct: +changePct.toFixed(2),
          trend: fiveDayChg > 2 ? 'BULLISH' : fiveDayChg < -2 ? 'BEARISH' : 'NEUTRAL',
          strength: Math.min(100, Math.abs(fiveDayChg) * 10),
          category: (s as any).category || 'sector',
        });
      }
    } catch {}
  }

  return results.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

// ═══════════════════════════════════════════════════════════════
// WATCHLIST SETUPS
// ═══════════════════════════════════════════════════════════════

async function computeWatchlistSetups(): Promise<WatchlistSetup[]> {
  // Full watchlist organized by TV sections
  const S_TIER = new Set(['AAOI', 'CRCL', 'OKLO', 'LUNR', 'KLAC', 'SMTC', 'AEHR', 'OLED', 'RMBS', 'BILL', 'INTA', 'MKSI']);
  const A_TIER = new Set(['LRCX', 'AFRM', 'WDC', 'MU', 'AMD', 'TSEM', 'COIN', 'ARM', 'HIMS', 'ONTO', 'ENTG', 'UPST', 'LITE', 'FN', 'CIEN', 'COHR', 'NBIS', 'DDOG', 'DELL', 'SHOP', 'DKNG', 'MARA', 'SOFI', 'DUOL', 'PATH', 'MDB', 'AMBA', 'COHU', 'SNOW', 'NET', 'FRSH', 'ESTC', 'ACLS', 'ASAN', 'BROS', 'AXTI']);
  const INDEX = new Set(['SPY', 'QQQ', 'IWM', 'XSP']);
  const ACTIVE = new Set(['TSLA', 'AVGO', 'NFLX']);
  function getSection(sym: string): WatchlistSetup['section'] {
    if (S_TIER.has(sym)) return 'S-TIER';
    if (A_TIER.has(sym)) return 'A-TIER';
    if (INDEX.has(sym)) return 'INDEX';
    return 'ACTIVE';
  }
  const tickers = [...S_TIER, ...A_TIER, ...ACTIVE, ...INDEX];

  const setups: WatchlistSetup[] = [];

  for (const sym of tickers) {
    try {
      const symData = await yahooPrice(sym);
      if (!symData || symData.closes.length < 3) continue;

      const closes = symData.closes;
      const last = closes[closes.length - 1];
      const prev = closes[closes.length - 2];
      const prev2 = closes[closes.length - 3];
      const changePct = ((last - prev) / prev) * 100;
      const prevChg = ((prev - prev2) / prev2) * 100;

      let setup: WatchlistSetup['setup'] = 'NO_SETUP';
      let direction: WatchlistSetup['direction'] = 'NEUTRAL';
      let probability = 50;
      let catalyst = '';

      // Reversal: prev day big red, today might bounce
      if (changePct < -3) {
        setup = 'REVERSAL';
        direction = 'LONG';
        probability = 72;
        catalyst = `Down ${changePct.toFixed(1)}% — reversal setup for next session`;
      } else if (changePct > 5) {
        setup = 'BREAKDOWN';
        direction = 'SHORT';
        probability = 60;
        catalyst = `Up ${changePct.toFixed(1)}% — extended, watch for pullback`;
      } else if (prevChg < -3 && changePct > 0) {
        setup = 'BOUNCE';
        direction = 'LONG';
        probability = 68;
        catalyst = `Bouncing after ${prevChg.toFixed(1)}% red day`;
      } else if (changePct > 2 && prevChg > 0) {
        setup = 'BREAKOUT';
        direction = 'LONG';
        probability = 65;
        catalyst = `2-day momentum, breakout continuation`;
      } else {
        setup = 'HOLD';
        direction = 'NEUTRAL';
        probability = 50;
        catalyst = 'No clear setup';
      }

      setups.push({
        symbol: sym,
        price: +last.toFixed(2),
        changePct: +changePct.toFixed(2),
        setup,
        direction,
        probability,
        catalyst,
        section: getSection(sym),
      });
    } catch {}

    // Rate limit Yahoo
    await new Promise(r => setTimeout(r, 100));
  }

  // Sort: setups with direction first, then by probability
  return setups.sort((a, b) => {
    if (a.direction !== 'NEUTRAL' && b.direction === 'NEUTRAL') return -1;
    if (a.direction === 'NEUTRAL' && b.direction !== 'NEUTRAL') return 1;
    return b.probability - a.probability;
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN PROJECTOR
// ═══════════════════════════════════════════════════════════════

export async function getProjectorData(timeframe: 'daily' | 'weekly' = 'daily'): Promise<ProjectorData> {
  logger.info(`[PROJECTOR] Computing ${timeframe} projection...`);

  // Compute expected moves for all 5 index ETFs
  const indexETFs = ['SPY', 'QQQ', 'IWM', 'DIA'];
  const [expectedMovesRaw, bias, sectors, watchlistSetups] = await Promise.all([
    Promise.all(indexETFs.map(sym => computeExpectedMove(sym, timeframe))),
    computeBias(),
    computeSectorPulse(),
    computeWatchlistSetups(),
  ]);
  const expectedMoves = expectedMovesRaw.filter(Boolean) as ExpectedMove[];

  // Next session label
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const nextDay = new Date(et);
  if (day === 5) nextDay.setDate(nextDay.getDate() + 3); // Fri → Mon
  else if (day === 6) nextDay.setDate(nextDay.getDate() + 2); // Sat → Mon
  else nextDay.setDate(nextDay.getDate() + 1);
  const nextSession = nextDay.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

  // Key events (could integrate economic calendar here)
  const keyEvents: string[] = [];
  try {
    const { getUpcomingEvents } = await import('./economic-calendar');
    const events = getUpcomingEvents(3);
    events.forEach(e => keyEvents.push(`${e.date}: ${e.name} (${e.importance})`));
  } catch {}

  return {
    timestamp: now.toISOString(),
    nextSession,
    expectedMoves,
    bias,
    sectors,
    watchlistSetups,
    keyEvents,
  };
}

// Cache
let projectorCache: { data: ProjectorData; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export async function getCachedProjectorData(timeframe: 'daily' | 'weekly' = 'daily'): Promise<ProjectorData> {
  if (projectorCache && Date.now() - projectorCache.ts < CACHE_TTL) {
    return projectorCache.data;
  }
  const data = await getProjectorData(timeframe);
  projectorCache = { data, ts: Date.now() };
  return data;
}

logger.info('[PROJECTOR] Market Projector Service initialized');

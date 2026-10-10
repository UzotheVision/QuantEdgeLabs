/**
 * FLOW HEATMAP SERVICE
 * ====================
 * Powers the MomoEdge-style Live Flow Heatmap.
 *
 * Returns sector-grouped tickers with:
 *   - Flow $ amount (proxied from option volume × premium)
 *   - Bull/Bear split
 *   - Sentiment score
 *   - Sweeps / Whales / Unusual counts
 *   - Flow Intensity 1-10
 *   - Badges (🐋 whale, 🔥 hot, ⚡ unusual)
 *
 * KPI bar: BREADTH | NET FLOW | SWEEPS | WHALES
 *
 * Reuses existing services where possible (no duplication).
 */

import { logger } from './logger';
import { SECTOR_HOLDINGS } from './market-pulse';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface FlowHeatmapTicker {
  symbol: string;
  flowPremium: number;        // total option premium $ (call_vol*price + put_vol*price)
  flowPremiumDisplay: string; // e.g. "$59.8M"
  bullPremium: number;
  bearPremium: number;
  bullPct: number;
  sentiment: number;          // -100 to +100
  sweeps: number;
  whales: number;             // count of single trades > $1M premium
  unusualCount: number;       // OI surges
  flowIntensity: number;      // 1-10
  bearBullRatio: number;
  badges: string[];           // ['🐋', '🔥', '⚡']
  divergence: 'Aligned' | 'Divergent' | 'Neutral';
  avgDTE: number;
  callVol: number;
  putVol: number;
  callOI: number;
  putOI: number;
  iv: number;
  price: number;
  changePct: number;
  rank: number;               // rank within sector
  sector: string;
}

export interface FlowHeatmapSector {
  symbol: string;
  name: string;
  greenCount: number;
  totalCount: number;
  netFlowPct: number;
  tickers: FlowHeatmapTicker[];
}

export interface FlowHeatmap {
  asOf: string;
  kpi: {
    breadth: number;          // % sectors green
    netFlow: number;          // $B
    netFlowDisplay: string;
    sweeps: number;
    whales: number;
  };
  sectors: FlowHeatmapSector[];
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function fmtMoney(num: number): string {
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function fmtMoneyShort(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return `${num.toFixed(0)}`;
}

async function fetchTickerFlow(symbol: string): Promise<FlowHeatmapTicker | null> {
  try {
    // Use CBOE chain (free, real data) — same source we used for discovery
    const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${symbol}.json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    const data = j?.data;
    if (!data?.current_price) return null;

    const spot = data.current_price;
    const opts = data.options || [];

    let callPremium = 0, putPremium = 0;
    let callVol = 0, putVol = 0;
    let callOI = 0, putOI = 0;
    let sweeps = 0, whales = 0, unusual = 0;
    let dteSum = 0, dteCnt = 0;
    let ivSum = 0, ivCnt = 0;

    const slen = symbol.length;
    const today = Date.now();

    for (const o of opts) {
      const s = o.option || '';
      try {
        const base = s.slice(slen);
        const cp = base[6];
        const strike = parseInt(base.slice(7)) / 1000;
        const y = 2000 + parseInt(base.slice(0, 2));
        const mm = parseInt(base.slice(2, 4));
        const dd = parseInt(base.slice(4, 6));
        const exp = new Date(y, mm - 1, dd).getTime();
        const dte = Math.floor((exp - today) / 86400000);
        if (dte < 0) continue;

        const vol = o.volume || 0;
        const oi = o.open_interest || 0;
        const last = o.last_trade_price || 0;
        const iv = o.iv || 0;

        const premium = vol * last * 100;

        if (cp === 'C') {
          callPremium += premium;
          callVol += vol;
          callOI += oi;
        } else {
          putPremium += premium;
          putVol += vol;
          putOI += oi;
        }

        if (premium > 1e6) whales++;             // single trade > $1M
        if (vol > 0 && oi > 0 && vol / oi > 1.5) unusual++;  // vol/OI surge
        if (vol > 500) sweeps++;                  // big sweeps proxy

        if (dte > 0 && dte < 365) { dteSum += dte * vol; dteCnt += vol; }
        if (Math.abs(strike - spot) / spot < 0.05 && iv > 0) { ivSum += iv; ivCnt++; }
      } catch {}
    }

    const totalPremium = callPremium + putPremium;
    const bullPct = totalPremium > 0 ? (callPremium / totalPremium) * 100 : 50;
    const sentiment = Math.round((bullPct - 50) * 2); // -100 to +100
    const bearBullRatio = callPremium > 0 ? putPremium / callPremium : 0;
    const avgDTE = dteCnt > 0 ? Math.round(dteSum / dteCnt) : 0;
    const ivATM = ivCnt > 0 ? (ivSum / ivCnt) * 100 : 0;

    // Flow intensity 1-10
    let flowIntensity = 1;
    if (totalPremium > 100e6) flowIntensity = 10;
    else if (totalPremium > 50e6) flowIntensity = 9;
    else if (totalPremium > 25e6) flowIntensity = 8;
    else if (totalPremium > 10e6) flowIntensity = 7;
    else if (totalPremium > 5e6) flowIntensity = 6;
    else if (totalPremium > 2.5e6) flowIntensity = 5;
    else if (totalPremium > 1e6) flowIntensity = 4;
    else if (totalPremium > 500e3) flowIntensity = 3;
    else if (totalPremium > 100e3) flowIntensity = 2;

    // Badges
    const badges: string[] = [];
    if (whales >= 3) badges.push('🐋');
    if (flowIntensity >= 7) badges.push('🔥');
    if (unusual >= 5) badges.push('⚡');

    // Price change
    const changePct = data.percent_change || 0;

    // Divergence: are price and flow aligned?
    let divergence: 'Aligned' | 'Divergent' | 'Neutral' = 'Neutral';
    if ((changePct > 0.5 && bullPct > 60) || (changePct < -0.5 && bullPct < 40)) divergence = 'Aligned';
    else if ((changePct > 0.5 && bullPct < 40) || (changePct < -0.5 && bullPct > 60)) divergence = 'Divergent';

    return {
      symbol,
      flowPremium: totalPremium,
      flowPremiumDisplay: fmtMoneyShort(totalPremium),
      bullPremium: callPremium,
      bearPremium: putPremium,
      bullPct: +bullPct.toFixed(1),
      sentiment,
      sweeps,
      whales,
      unusualCount: unusual,
      flowIntensity,
      bearBullRatio: +bearBullRatio.toFixed(2),
      badges,
      divergence,
      avgDTE,
      callVol,
      putVol,
      callOI,
      putOI,
      iv: +ivATM.toFixed(1),
      price: spot,
      changePct: +changePct.toFixed(2),
      rank: 0,
      sector: ''
    };
  } catch (e: any) {
    logger.warn(`[flow-heatmap] failed ${symbol}: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

const SECTOR_NAMES: Record<string, string> = {
  XLK: 'TECH',
  SMH: 'SEMI',
  XLF: 'FIN',
  XLV: 'HEALTH',
  XLE: 'ENERGY',
  XLI: 'INDUSTRIALS',
  XLY: 'CONS DISC',
  XLP: 'CONS STAPLES',
  XLU: 'UTILITIES',
  XLRE: 'REAL ESTATE',
  XLB: 'MATERIALS',
  XLC: 'COMM',
  ARKK: 'INNOVATION'
};

export async function getFlowHeatmap(opts: { sectors?: string[]; topNPerSector?: number } = {}): Promise<FlowHeatmap> {
  const targetSectors = opts.sectors?.length
    ? opts.sectors.filter(s => SECTOR_HOLDINGS[s])
    : ['XLK', 'XLC', 'XLY', 'XLF', 'XLV', 'XLE', 'XLI'];
  const topN = opts.topNPerSector ?? 6;

  const sectorResults: FlowHeatmapSector[] = [];
  let totalNetFlow = 0;
  let totalSweeps = 0;
  let totalWhales = 0;

  for (const sectorSym of targetSectors) {
    const components = (SECTOR_HOLDINGS[sectorSym] || []).slice(0, topN);
    const tickerData: FlowHeatmapTicker[] = [];

    for (const sym of components) {
      const t = await fetchTickerFlow(sym);
      if (t) {
        t.sector = sectorSym;
        tickerData.push(t);
      }
    }

    // Rank within sector by flow premium
    tickerData.sort((a, b) => b.flowPremium - a.flowPremium);
    tickerData.forEach((t, i) => { t.rank = i + 1; });

    const greenCount = tickerData.filter(t => t.changePct > 0).length;
    const sectorFlow = tickerData.reduce((sum, t) => sum + t.flowPremium, 0);
    const netFlowPct = tickerData.length > 0
      ? (tickerData.reduce((sum, t) => sum + (t.bullPct > 50 ? 1 : -1) * t.flowPremium, 0) / sectorFlow) * 100
      : 0;

    totalNetFlow += sectorFlow;
    totalSweeps += tickerData.reduce((s, t) => s + t.sweeps, 0);
    totalWhales += tickerData.reduce((s, t) => s + t.whales, 0);

    sectorResults.push({
      symbol: sectorSym,
      name: SECTOR_NAMES[sectorSym] || sectorSym,
      greenCount,
      totalCount: tickerData.length,
      netFlowPct: +netFlowPct.toFixed(0),
      tickers: tickerData
    });
  }

  // Breadth: % of sectors net positive
  const positiveSecCount = sectorResults.filter(s => s.netFlowPct > 0).length;
  const breadth = sectorResults.length > 0
    ? Math.round((positiveSecCount / sectorResults.length) * 100)
    : 0;

  return {
    asOf: new Date().toISOString(),
    kpi: {
      breadth,
      netFlow: +(totalNetFlow / 1e9).toFixed(2),
      netFlowDisplay: fmtMoney(totalNetFlow),
      sweeps: totalSweeps,
      whales: totalWhales
    },
    sectors: sectorResults
  };
}

export async function getTickerFlowDetail(symbol: string): Promise<FlowHeatmapTicker | null> {
  return fetchTickerFlow(symbol);
}

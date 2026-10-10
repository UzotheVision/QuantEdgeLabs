/**
 * MARKET PULSE
 * ============
 * The "is the market red or green today?" service.
 * Powers the dashboard's morning context view.
 *
 * Returns:
 *   - Index state (SPY/QQQ/DIA/IWM + futures pre-market)
 *   - Sector rotation (which sectors leading/lagging)
 *   - Macro context (VIX, 10Y, DXY, BTC)
 *   - Market regime (risk-on/risk-off/chop)
 *   - User watchlist movers (top gainers/decliners)
 */

import { logger } from './logger';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface MarketPulse {
  asOf: string;
  marketState: 'PRE' | 'OPEN' | 'AFTER' | 'CLOSED';
  indices: IndexQuote[];
  sectors: SectorRotation[];
  macro: MacroContext;
  regime: MarketRegime;
  topMovers: { gainers: TickerMove[]; decliners: TickerMove[] };
  marketColor: 'GREEN' | 'RED' | 'MIXED';
  narrative: string;
  // ─── DEEP CONTEXT (MomoEdge-tier additions) ────────────────
  breadth?: BreadthSignals;           // advance/decline, %above 50DMA
  optionsContext?: OptionsContext;    // put/call ratio, vol surge
  gexLevels?: GEXLevelsSummary;       // SPY/QQQ flip + walls
  fearGreed?: FearGreedSignal;        // composite from VIX + breadth + flow
  futures?: FuturesSnapshot[];        // ES, NQ, RTY pre-market
  preMarketMovers?: PreMarketMovers;  // overnight gappers
}

interface BreadthSignals {
  advanceDeclineRatio: number;          // SPY components A/D
  pctAbove50DMA: number;                // % of S&P above 50DMA
  newHighsLowsRatio: number;            // 52w highs vs lows
  spyTrend: 'STRONG_UP' | 'UP' | 'NEUTRAL' | 'DOWN' | 'STRONG_DOWN';
}

interface OptionsContext {
  putCallRatio: number;                 // 0-2 typically
  pcrLabel: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  spyOptionsVolumeSurge: number;        // x avg
  smartMoneyDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
}

interface GEXLevelsSummary {
  spy: { spot: number; flip: number; callWall: number; putWall: number; regime: 'POSITIVE' | 'NEGATIVE' };
  qqq: { spot: number; flip: number; callWall: number; putWall: number; regime: 'POSITIVE' | 'NEGATIVE' };
}

interface FearGreedSignal {
  value: number;                        // 0-100
  label: 'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED';
  components: { vix: number; breadth: number; pcr: number; momentum: number };
}

interface FuturesSnapshot {
  symbol: string;          // ES=F, NQ=F, RTY=F
  name: string;
  price: number;
  change: number;
}

interface PreMarketMovers {
  gainers: { symbol: string; change: number; price: number }[];
  decliners: { symbol: string; change: number; price: number }[];
}

interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  preMarketChange: number | null;
}

interface SectorRotation {
  symbol: string;
  name: string;
  change: number;
  rank: number;
}

interface MacroContext {
  vix: number;
  vixState: 'CALM' | 'NORMAL' | 'ELEVATED' | 'PANIC';
  yield10Y: number;
  yieldDirection: 'RISING' | 'FALLING';
  dxy: number;
  btc: { price: number; change: number };
  riskTone: 'RISK-ON' | 'RISK-OFF' | 'NEUTRAL';
}

interface MarketRegime {
  label: 'BULL_TREND' | 'BULL_PULLBACK' | 'CHOP' | 'BEAR_BOUNCE' | 'BEAR_TREND';
  confidence: number;
  description: string;
}

interface TickerMove {
  symbol: string;
  price: number;
  change: number;
}

// ═══════════════════════════════════════════════════════════════
// SECTOR HOLDINGS — top components for drill-down
// ═══════════════════════════════════════════════════════════════

export const SECTOR_HOLDINGS: Record<string, string[]> = {
  XLK: ['NVDA','AAPL','MSFT','AVGO','ORCL','CRM','CSCO','ADBE','ACN','TXN','INTC','AMD','IBM','NOW','INTU','QCOM','PLTR','PANW','CRWD','KLAC'],
  SMH: ['NVDA','TSM','AVGO','AMD','ASML','QCOM','TXN','LRCX','KLAC','AMAT','ADI','MU','ARM','MRVL','MCHP','NXPI','ON','SWKS','QRVO'],
  XLF: ['JPM','BRK.B','BAC','WFC','GS','MS','C','BLK','SPGI','AXP','SCHW','PGR','CB','MMC','ICE','CME','PNC','TRV','USB','COF'],
  XLV: ['LLY','UNH','JNJ','MRK','ABBV','PFE','TMO','ABT','DHR','ISRG','BMY','AMGN','GILD','VRTX','REGN','ELV','CVS','MDT','HUM','CI'],
  XLE: ['XOM','CVX','COP','SLB','EOG','OXY','PSX','MPC','VLO','HES','FANG','BKR','HAL','DVN','APA','TRGP','WMB','KMI','OKE','LNG'],
  XLI: ['CAT','GE','RTX','HON','UNP','LMT','UPS','BA','DE','ETN','TT','GD','EMR','NOC','CSX','NSC','ITW','FDX','WM','PH'],
  XLY: ['AMZN','TSLA','HD','MCD','NKE','LOW','TJX','SBUX','BKNG','DIS','CMG','ABNB','ROST','LULU','GM','F','MAR','HLT','DRI','ORLY'],
  XLP: ['PG','COST','KO','WMT','PM','PEP','MO','CL','MDLZ','TGT','KMB','GIS','SYY','KHC','MNST','STZ','EL','HSY','KR','ADM'],
  XLU: ['NEE','SO','DUK','CEG','SRE','AEP','D','PCG','VST','XEL','EXC','PEG','ED','EIX','WEC','AWK','ETR','ES','DTE','CMS'],
  XLRE: ['PLD','AMT','EQIX','WELL','CCI','PSA','SPG','O','DLR','VICI','EXR','AVB','EQR','WY','CBRE','SBAC','IRM','MAA','ARE','UDR'],
  XLB: ['LIN','SHW','ECL','APD','FCX','NEM','CTVA','NUE','DD','PPG','VMC','MLM','DOW','IFF','LYB','ALB','MOS','CF','EMN','AVY'],
  XLC: ['META','GOOGL','GOOG','NFLX','TMUS','VZ','T','DIS','CHTR','EA','TTWO','OMC','LYV','PINS','MTCH','PARA','WBD','FOXA','IPG','NWSA'],
  ARKK: ['TSLA','COIN','RBLX','HOOD','ROKU','PATH','RXRX','EXAS','TDOC','ZM','SHOP','TWLO','PLTR','U','DKNG','SOFI','BEAM','CRSP','NTLA','VEEV'],
  GLD: ['GOLD'], // ETF for gold itself
  USO: ['CL=F'], // ETF for oil futures
};

// ═══════════════════════════════════════════════════════════════
// INDEX/SECTOR/MACRO UNIVERSE
// ═══════════════════════════════════════════════════════════════

const INDEXES = [
  { symbol: 'SPY', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'Nasdaq 100' },
  { symbol: 'DIA', name: 'Dow' },
  { symbol: 'IWM', name: 'Russell 2000' }
];

const SECTOR_ETFS = [
  { symbol: 'XLK', name: 'Technology' },
  { symbol: 'XLF', name: 'Financials' },
  { symbol: 'XLV', name: 'Healthcare' },
  { symbol: 'XLE', name: 'Energy' },
  { symbol: 'XLI', name: 'Industrials' },
  { symbol: 'XLY', name: 'Consumer Discretionary' },
  { symbol: 'XLP', name: 'Consumer Staples' },
  { symbol: 'XLU', name: 'Utilities' },
  { symbol: 'XLRE', name: 'Real Estate' },
  { symbol: 'XLB', name: 'Materials' },
  { symbol: 'XLC', name: 'Communications' },
  { symbol: 'SMH', name: 'Semiconductors' },
  { symbol: 'ARKK', name: 'Innovation' },
  { symbol: 'GLD', name: 'Gold' },
  { symbol: 'USO', name: 'Oil' }
];

// ═══════════════════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════════════════

async function fetchYahoo(symbol: string): Promise<{
  price: number; change: number; marketState: string; preMarket: number | null
} | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=2d&interval=1d&includePrePost=true`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const m = res.meta;
    const closes = res.indicators?.quote?.[0]?.close || [];
    let li = closes.length - 1;
    while (li >= 0 && closes[li] == null) li--;
    const last = closes[li];
    const prev = m.chartPreviousClose;
    return {
      price: +last.toFixed(2),
      change: +((last - prev) / prev * 100).toFixed(2),
      marketState: m.marketState || 'CLOSED',
      preMarket: m.preMarketPrice
        ? +(((m.preMarketPrice - last) / last) * 100).toFixed(2)
        : null
    };
  } catch (e) {
    logger.warn(`[market-pulse] failed ${symbol}: ${e}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyVix(vix: number): MacroContext['vixState'] {
  if (vix < 13) return 'CALM';
  if (vix < 20) return 'NORMAL';
  if (vix < 30) return 'ELEVATED';
  return 'PANIC';
}

function classifyRiskTone(vix: number, btcChange: number, gldChange: number): MacroContext['riskTone'] {
  // Risk-on: low VIX, BTC up, gold down
  // Risk-off: high VIX, BTC down, gold up
  let score = 0;
  if (vix < 16) score += 1;
  if (vix > 22) score -= 1;
  if (btcChange > 1) score += 1;
  if (btcChange < -1) score -= 1;
  if (gldChange < -0.5) score += 1;
  if (gldChange > 1) score -= 1;
  if (score >= 1) return 'RISK-ON';
  if (score <= -1) return 'RISK-OFF';
  return 'NEUTRAL';
}

function classifyRegime(spyChange: number, vix: number, breadth: number): MarketRegime {
  if (spyChange > 0.5 && vix < 16 && breadth > 0.6) {
    return { label: 'BULL_TREND', confidence: 80,
      description: 'Strong uptrend with low volatility and broad participation' };
  }
  if (spyChange < -0.5 && vix > 22) {
    return { label: 'BEAR_TREND', confidence: 75,
      description: 'Selloff with elevated fear — wait for reversal signals' };
  }
  if (spyChange > 0 && vix < 20) {
    return { label: 'BULL_PULLBACK', confidence: 65,
      description: 'Constructive tape, room for additions on dips' };
  }
  if (spyChange < 0 && vix < 22) {
    return { label: 'BEAR_BOUNCE', confidence: 55,
      description: 'Weak tape but no panic — defensive posture' };
  }
  return { label: 'CHOP', confidence: 50,
    description: 'No directional conviction — premium sellers winning' };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

/** Live VIX level (percent, e.g. 16.4) — the market's own 30-day implied vol
 *  for the S&P. Used to size a realistic weekly move. Null when unavailable. */
export async function getVixLevel(): Promise<number | null> {
  const q = await fetchYahoo('^VIX');
  return q?.price != null && q.price > 5 && q.price < 150 ? q.price : null;
}

export async function getMarketPulse(watchlist: string[] = []): Promise<MarketPulse> {
  // Pull all data in parallel
  const [indexData, sectorData, macroData, watchlistData] = await Promise.all([
    Promise.all(INDEXES.map(async i => ({ ...i, ...(await fetchYahoo(i.symbol)) }))),
    Promise.all(SECTOR_ETFS.map(async s => ({ ...s, ...(await fetchYahoo(s.symbol)) }))),
    Promise.all([
      fetchYahoo('^VIX'),
      fetchYahoo('^TNX'),
      fetchYahoo('DX-Y.NYB'),
      fetchYahoo('BTC-USD'),
      fetchYahoo('GLD')
    ]),
    Promise.all(watchlist.map(async s => ({ symbol: s, ...(await fetchYahoo(s)) })))
  ]);

  // Build indices
  const indices: IndexQuote[] = indexData
    .filter((d): d is typeof d & { price: number; change: number } => d?.price !== undefined && d?.price !== null)
    .map(d => ({
      symbol: d.symbol,
      name: d.name,
      price: d.price,
      change: d.change,
      preMarketChange: d.preMarket ?? null
    }));

  // Build sector rotation
  const sectors: SectorRotation[] = sectorData
    .filter(d => d.change !== undefined)
    .map(d => ({
      symbol: d.symbol,
      name: d.name,
      change: d.change!,
      rank: 0
    }))
    .sort((a, b) => b.change - a.change)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  // Macro context
  const [vix, tnx, dxy, btc, gld] = macroData;
  const macro: MacroContext = {
    vix: vix?.price || 0,
    vixState: classifyVix(vix?.price || 16),
    yield10Y: tnx?.price || 0,
    yieldDirection: (tnx?.change || 0) > 0 ? 'RISING' : 'FALLING',
    dxy: dxy?.price || 0,
    btc: { price: btc?.price || 0, change: btc?.change || 0 },
    riskTone: classifyRiskTone(vix?.price || 16, btc?.change || 0, gld?.change || 0)
  };

  // Regime
  const spy = indices.find(i => i.symbol === 'SPY');
  const greenSectors = sectors.filter(s => s.change > 0).length / sectors.length;
  const regime = classifyRegime(spy?.change || 0, macro.vix, greenSectors);

  // Watchlist movers
  const moves: TickerMove[] = watchlistData
    .filter(d => d.change !== undefined)
    .map(d => ({ symbol: d.symbol, price: d.price!, change: d.change! }));
  const gainers = moves.filter(m => m.change > 0).sort((a, b) => b.change - a.change).slice(0, 8);
  const decliners = moves.filter(m => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 8);

  // Market color
  let marketColor: MarketPulse['marketColor'] = 'MIXED';
  const spyChg = spy?.change || 0;
  const qqqChg = indices.find(i => i.symbol === 'QQQ')?.change || 0;
  if (spyChg > 0.3 && qqqChg > 0.3) marketColor = 'GREEN';
  else if (spyChg < -0.3 && qqqChg < -0.3) marketColor = 'RED';

  // Narrative
  const topSector = sectors[0];
  const bottomSector = sectors[sectors.length - 1];
  const narrative = `Market ${marketColor === 'GREEN' ? '🟢' : marketColor === 'RED' ? '🔴' : '🟡'}. ` +
    `${topSector.name} leading (+${topSector.change}%), ${bottomSector.name} lagging (${bottomSector.change}%). ` +
    `VIX ${macro.vix.toFixed(1)} ${macro.vixState.toLowerCase()}, ${macro.riskTone}. ` +
    `Regime: ${regime.label.replace('_', ' ').toLowerCase()}.`;

  // ───── DEEP CONTEXT — pulled in parallel with the rest ─────
  const [breadth, optionsContext, gexLevels, futures, preMarketMovers] = await Promise.all([
    computeBreadth().catch(() => undefined),
    computeOptionsContext().catch(() => undefined),
    computeGEXLevels().catch(() => undefined),
    fetchFutures().catch(() => undefined),
    computePreMarketMovers(watchlist).catch(() => undefined)
  ]);

  // Fear & Greed composite (derived)
  const fearGreed = computeFearGreed({
    vix: macro.vix,
    breadthScore: breadth ? breadth.pctAbove50DMA : 50,
    pcr: optionsContext?.putCallRatio ?? 1.0,
    spyChange: spy?.change || 0
  });

  return {
    asOf: new Date().toISOString(),
    marketState: (spy as any)?.marketState || 'CLOSED',
    indices,
    sectors,
    macro,
    regime,
    topMovers: { gainers, decliners },
    marketColor,
    narrative,
    breadth,
    optionsContext,
    gexLevels,
    fearGreed,
    futures,
    preMarketMovers
  };
}

// ═══════════════════════════════════════════════════════════════
// DEEP CONTEXT COMPUTATION
// ═══════════════════════════════════════════════════════════════

async function computeBreadth(): Promise<BreadthSignals | undefined> {
  // SPY top 30 components — quick advance/decline + 50DMA proxy
  const sp30 = ['NVDA','MSFT','AAPL','AMZN','META','GOOGL','TSLA','AVGO','BRK.B','LLY',
                'JPM','V','UNH','XOM','MA','PG','HD','COST','JNJ','WMT',
                'BAC','ORCL','NFLX','ABBV','CRM','MRK','CVX','KO','PEP','ADBE'];
  const data = await Promise.all(sp30.map(async s => {
    try {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${s}?range=3mo&interval=1d`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j: any = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res) return null;
      const closes = (res.indicators?.quote?.[0]?.close || []).filter((c: any) => c != null);
      if (closes.length < 50) return null;
      const last = closes[closes.length - 1];
      const prev = res.meta?.chartPreviousClose;
      const ma50 = closes.slice(-50).reduce((a: number, b: number) => a + b, 0) / 50;
      const hi52 = res.meta?.fiftyTwoWeekHigh || 0;
      const lo52 = res.meta?.fiftyTwoWeekLow || 0;
      return { advance: last > prev, above50: last > ma50, near52High: last >= hi52 * 0.98, near52Low: last <= lo52 * 1.02 };
    } catch { return null; }
  }));
  const valid = data.filter((d): d is NonNullable<typeof d> => d !== null);
  if (!valid.length) return undefined;
  const advances = valid.filter(d => d.advance).length;
  const declines = valid.length - advances;
  const above50 = valid.filter(d => d.above50).length;
  const newHighs = valid.filter(d => d.near52High).length;
  const newLows = valid.filter(d => d.near52Low).length;

  const pctAbove50 = (above50 / valid.length) * 100;
  let trend: BreadthSignals['spyTrend'] = 'NEUTRAL';
  if (pctAbove50 > 75 && advances > declines) trend = 'STRONG_UP';
  else if (pctAbove50 > 60) trend = 'UP';
  else if (pctAbove50 < 25 && declines > advances) trend = 'STRONG_DOWN';
  else if (pctAbove50 < 40) trend = 'DOWN';

  return {
    advanceDeclineRatio: declines > 0 ? +(advances / declines).toFixed(2) : advances,
    pctAbove50DMA: +pctAbove50.toFixed(0),
    newHighsLowsRatio: newLows > 0 ? +(newHighs / newLows).toFixed(2) : newHighs,
    spyTrend: trend
  };
}

async function computeOptionsContext(): Promise<OptionsContext | undefined> {
  // Pull SPY options chain for put/call ratio
  try {
    const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/SPY.json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    const opts = j?.data?.options || [];
    let callVol = 0, putVol = 0;
    for (const o of opts) {
      const cp = o.option?.match(/SPY\d{6}([CP])/)?.[1];
      const v = o.volume || 0;
      if (cp === 'C') callVol += v;
      else if (cp === 'P') putVol += v;
    }
    if (callVol === 0) return undefined;
    const pcr = putVol / callVol;
    const pcrLabel = pcr > 1.2 ? 'BEARISH' : pcr < 0.7 ? 'BULLISH' : 'NEUTRAL';
    const totalVol = callVol + putVol;
    return {
      putCallRatio: +pcr.toFixed(2),
      pcrLabel,
      spyOptionsVolumeSurge: 1.0,  // would need historical avg to compute
      smartMoneyDirection: pcr > 1.2 ? 'BEAR' : pcr < 0.7 ? 'BULL' : 'NEUTRAL'
    };
  } catch { return undefined; }
}

async function computeGEXLevels(): Promise<GEXLevelsSummary | undefined> {
  const fetchGEX = async (sym: string) => {
    try {
      const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${sym}.json`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j: any = await r.json();
      const data = j?.data;
      if (!data?.current_price) return null;
      const spot = data.current_price;
      const opts = data.options || [];
      let totalGEX = 0;
      const callOI: Record<number, number> = {};
      const putOI: Record<number, number> = {};
      const slen = sym.length;
      for (const o of opts) {
        const s = o.option || '';
        try {
          const base = s.slice(slen);
          const cp = base[6];
          const strike = parseInt(base.slice(7)) / 1000;
          const oi = o.open_interest || 0;
          const gamma = o.gamma || 0;
          const sign = cp === 'C' ? 1 : -1;
          totalGEX += oi * gamma * spot * spot * 100 * sign;
          if (cp === 'C') callOI[strike] = (callOI[strike] || 0) + oi;
          else putOI[strike] = (putOI[strike] || 0) + oi;
        } catch {}
      }
      let callWall = 0, callWallOI = 0, putWall = 0, putWallOI = 0;
      for (const k in callOI) { const sk = parseFloat(k); if (sk > spot && callOI[k] > callWallOI) { callWall = sk; callWallOI = callOI[k]; }}
      for (const k in putOI) { const sk = parseFloat(k); if (sk < spot && putOI[k] > putWallOI) { putWall = sk; putWallOI = putOI[k]; }}
      const flip = (callWall + putWall) / 2;  // approximation
      return { spot, flip, callWall, putWall, regime: totalGEX > 0 ? 'POSITIVE' as const : 'NEGATIVE' as const };
    } catch { return null; }
  };
  const [spy, qqq] = await Promise.all([fetchGEX('SPY'), fetchGEX('QQQ')]);
  if (!spy || !qqq) return undefined;
  return { spy, qqq };
}

function computeFearGreed(input: { vix: number; breadthScore: number; pcr: number; spyChange: number }): FearGreedSignal {
  // Composite 0-100 (greedy)
  const vixScore = Math.max(0, 100 - (input.vix - 12) * 5);     // 12=100, 32=0
  const breadthScore = input.breadthScore;
  const pcrScore = Math.max(0, 100 - (input.pcr - 0.7) * 100);  // 0.7=100, 1.7=0
  const momentumScore = Math.max(0, Math.min(100, 50 + input.spyChange * 50));

  const value = Math.round((vixScore + breadthScore + pcrScore + momentumScore) / 4);
  const label =
    value >= 75 ? 'EXTREME_GREED' :
    value >= 55 ? 'GREED' :
    value >= 45 ? 'NEUTRAL' :
    value >= 25 ? 'FEAR' :
    'EXTREME_FEAR';

  return {
    value,
    label,
    components: {
      vix: Math.round(vixScore),
      breadth: Math.round(breadthScore),
      pcr: Math.round(pcrScore),
      momentum: Math.round(momentumScore)
    }
  };
}

async function fetchFutures(): Promise<FuturesSnapshot[] | undefined> {
  const futs = [
    { symbol: 'ES=F', name: 'S&P 500 Futures' },
    { symbol: 'NQ=F', name: 'Nasdaq 100 Futures' },
    { symbol: 'RTY=F', name: 'Russell 2000 Futures' },
    { symbol: 'YM=F', name: 'Dow Futures' }
  ];
  const data = await Promise.all(futs.map(async f => {
    const q = await fetchYahoo(f.symbol);
    return q ? { symbol: f.symbol, name: f.name, price: q.price, change: q.change } : null;
  }));
  return data.filter((x): x is FuturesSnapshot => x !== null);
}

async function computePreMarketMovers(watchlist: string[]): Promise<PreMarketMovers | undefined> {
  // Re-use watchlist with pre-market data
  const data = await Promise.all(watchlist.map(async s => {
    try {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${s}?range=2d&interval=1d&includePrePost=true`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const j: any = await r.json();
      const m = j?.chart?.result?.[0]?.meta;
      if (!m?.preMarketPrice || !m?.regularMarketPrice) return null;
      const change = ((m.preMarketPrice - m.regularMarketPrice) / m.regularMarketPrice) * 100;
      return { symbol: s, change: +change.toFixed(2), price: m.preMarketPrice };
    } catch { return null; }
  }));
  const valid = data.filter((d): d is NonNullable<typeof d> => d !== null);
  if (!valid.length) return undefined;
  const gainers = valid.filter(v => v.change > 0).sort((a, b) => b.change - a.change).slice(0, 6);
  const decliners = valid.filter(v => v.change < 0).sort((a, b) => a.change - b.change).slice(0, 6);
  return { gainers, decliners };
}

// ═══════════════════════════════════════════════════════════════
// SECTOR DEEP DIVE — drill into a sector ETF's components
// ═══════════════════════════════════════════════════════════════

export interface SectorDeepDive {
  symbol: string;
  name: string;
  etfChange: number;
  topGainers: TickerMove[];
  topDecliners: TickerMove[];
  allComponents: TickerMove[];
}

const SECTOR_NAMES: Record<string, string> = {
  XLK: 'Technology', SMH: 'Semiconductors', XLF: 'Financials', XLV: 'Healthcare',
  XLE: 'Energy', XLI: 'Industrials', XLY: 'Consumer Discretionary', XLP: 'Consumer Staples',
  XLU: 'Utilities', XLRE: 'Real Estate', XLB: 'Materials', XLC: 'Communications',
  ARKK: 'Innovation'
};

export async function getSectorDeepDive(sectorSymbol: string): Promise<SectorDeepDive | null> {
  const symbol = sectorSymbol.toUpperCase();
  const components = SECTOR_HOLDINGS[symbol];
  if (!components) return null;

  const [etfData, ...componentsData] = await Promise.all([
    fetchYahoo(symbol),
    ...components.map(c => fetchYahoo(c).then(d => ({ symbol: c, data: d })))
  ]);

  const allComponents: TickerMove[] = componentsData
    .filter(c => c.data?.price !== undefined)
    .map(c => ({
      symbol: c.symbol,
      price: c.data!.price,
      change: c.data!.change
    }))
    .sort((a, b) => b.change - a.change);

  return {
    symbol,
    name: SECTOR_NAMES[symbol] || symbol,
    etfChange: etfData?.change || 0,
    topGainers: allComponents.filter(c => c.change > 0).slice(0, 10),
    topDecliners: allComponents.filter(c => c.change < 0).reverse().slice(0, 10),
    allComponents
  };
}

// ═══════════════════════════════════════════════════════════════
// REGIME CHANGE DETECTION — for Discord alerts
// ═══════════════════════════════════════════════════════════════

let lastKnownRegime: { label: string; color: string; vix: number; ts: number } | null = null;

export interface RegimeChange {
  changed: boolean;
  previous?: { label: string; color: string };
  current: { label: string; color: string; vix: number };
  message: string;
}

export async function detectRegimeChange(): Promise<RegimeChange> {
  const pulse = await getMarketPulse([]);
  const current = {
    label: pulse.regime.label,
    color: pulse.marketColor,
    vix: pulse.macro.vix,
    ts: Date.now()
  };

  // First scan or stale (>4 hours) — initialize
  if (!lastKnownRegime || (Date.now() - lastKnownRegime.ts) > 4 * 3600 * 1000) {
    lastKnownRegime = current;
    return {
      changed: false,
      current,
      message: `Initialized: ${current.label} (${current.color}), VIX ${current.vix.toFixed(1)}`
    };
  }

  const labelChanged = current.label !== lastKnownRegime.label;
  const colorChanged = current.color !== lastKnownRegime.color;
  const vixSpike = Math.abs(current.vix - lastKnownRegime.vix) > 2;

  if (labelChanged || colorChanged || vixSpike) {
    const previous = { label: lastKnownRegime.label, color: lastKnownRegime.color };
    const reasons: string[] = [];
    if (labelChanged) reasons.push(`Regime: ${previous.label} → ${current.label}`);
    if (colorChanged) reasons.push(`Tape: ${previous.color} → ${current.color}`);
    if (vixSpike) reasons.push(`VIX: ${lastKnownRegime.vix.toFixed(1)} → ${current.vix.toFixed(1)}`);
    lastKnownRegime = current;
    return {
      changed: true,
      previous,
      current,
      message: `🚨 REGIME CHANGE\n${reasons.join('\n')}\nNarrative: ${pulse.narrative}`
    };
  }

  return {
    changed: false,
    current,
    message: `No change: ${current.label} (${current.color}), VIX ${current.vix.toFixed(1)}`
  };
}

/**
 * MULTI-SIGNAL DISCOVERY ENGINE
 * ==============================
 * Unifies existing engines into ONE 0-100 ranked output:
 *   - squeeze-detection.ts (BB squeeze)
 *   - gamma-exposure.ts (GEX alignment)
 *   - cboe-options-fallback.ts (IV percentile, options chain)
 *   - catalyst-intelligence-service.ts (catalyst proximity)
 *
 * Designed to find ARM/QCOM/AEHR-tier setups BEFORE the move.
 * Score >= 70 = elite setup.
 *
 * Usage:
 *   const top = await runDiscoveryScan(['semis_megacap', 'ai_data_center_power']);
 *   const elite = await findEliteSetups();
 *   const sectorOnly = await getDiscoveryFeed({ sector: 'nuclear_uranium' });
 */

import { logger } from './logger';
import { classifySqueeze } from './squeeze-detection';
import { calculateAggregateGammaExposure } from './gamma-exposure';
import { getCBOEOptionsChain } from './cboe-options-fallback';
import { getCatalystsForSymbol } from './catalyst-intelligence-service';

// ═══════════════════════════════════════════════════════════════
// EXPANDED UNIVERSE — segmented by theme (~250 tickers)
// ═══════════════════════════════════════════════════════════════

export const DISCOVERY_UNIVERSE = {
  semis_megacap: ["NVDA","AVGO","AMD","ARM","MU","ORCL","TSM","ASML","QCOM","TXN","ADI","NXPI","ON","MCHP","SWKS","QRVO","MRVL","INTC","SMCI","DELL","HPE","MPWR","TER","GFS","LSCC","WOLF","SITM","RMBS"],
  semis_cap_equipment: ["KLAC","LRCX","AMAT","ENTG","UCTT","ICHR","ACMR","CAMT","ONTO","AEHR","AMKR","KLIC","COHU","ACLS","FORM"],
  ai_infrastructure: ["DLR","EQIX","COR","AMT","CRWV","NBIS","ALAB","CRDO","ANET","NTAP", "PSTG","VRT","MOD","TT","IRM","MSFT","GOOGL","AMZN","META"],
  ai_data_center_power: ["BE","GEV","ETN","POWL","PSIX","CMI","GNRC","MTZ","PRIM","STRL","EME","NVT","HUBB","ROK","EMR","DOV","PH","ITT","CARR","JCI"],
  nuclear_uranium: ["SMR","OKLO","NNE","CEG","VST","TLN","NEE","CCJ","UEC","UUUU","DNN","URG","NXE","BWXT","LEU","ASPI"],
  voice_ai_software: ["SOUN","AI","PATH","APPN","PLTR","RDDT","TEM","RXRX","ABCL","ABSI","NOW","DDOG","CRM","SNOW","DUOL","MDB","NET","CRWD","PANW","ZS","AAPL","TSLA","NFLX"],
  consumer_coils: ["KO","SBUX","QSR","MO","TGT","WMT","COST","DG","TJX","ROST","NKE","LULU","DECK"],
  fintech_stablecoin: ["JPM","V","MA","HOOD","COIN","CRCL","SOFI","UPST","GLXY","MSTR","XYZ","PYPL"],
  biotech_catalysts: ["SMMT","VKTX","NTLA","BEAM","CRSP","RXRX","ABCL","BMY","TEM","HIMS","BHVN","EDIT","PRME","CGEM","IMVT"],
  energy_lng: ["XOM","CVX","FANG","DVN","OXY","EOG","SLB","HAL","LNG","FLNG","ENB","ET","MPC","VLO","TTE"],
  materials_critical: ["MP","UAMY","USAR","LAC","SGML","FCX","SCCO","TECK","NEM","GOLD","AEM","CCJ"],
  industrials_defense: ["CAT","DE","URI","WAB","TXT","RTX","NOC","LMT","HEI","TDG","KTOS","HII","AVAV","RCAT","AXON"],
  insurance: ["ALL","TRV","PGR","CB","AIG","MET","PRU","HIG","AFL"],
  rate_cut_homebuilders: ["DHI", "TPH","LEN","KBH","TOL","HD","LOW","BLDR","NVR","PHM"],
  crypto_ai_pivot: ["MSTR","HUT","IREN","WULF","CIFR","MARA","RIOT","CLSK","BTDR","HIVE"],
  space_drones: ["RKLB","ASTS","LUNR","RDW","PL","BKSY","KTOS","AVAV","RCAT","ONDS","SATL","SIDU"],
  china_adrs: ["BABA","BIDU","JD","PDD","NIO","XPEV","LI","KC","ZTO","MOMO","FUTU","TIGR"],
  evtol_autonomy: ["ACHR","JOBY","AUR","PONY","WRD","MBLY","RIVN","LCID","UBER","LYFT"],
  quantum_photonics: ["IONQ","RGTI","QBTS","QUBT","ARQQ","LWLG","POET","PLAB","COHR","LITE"],
  // Index and sector ETFs. Deliberately their own group: they are not a "sector"
  // to rotate into, they are the most liquid options books listed — which is
  // exactly what a small account wants, because spread is a bigger drag on a
  // one-contract position than on a hundred.
  // Large-cap pharma and healthcare. Distinct from biotech_catalysts, which is
  // binary-event driven small caps — these are liquid, optionable names that
  // trend and rotate, and they were absent entirely apart from BMY.
  pharma_large_cap: ["LLY","MRK","PFE","ABBV","AMGN","GILD","VRTX","REGN","BIIB","ZTS","JNJ"],
  healthcare_services: ["UNH","ELV","CI","HCA","MCK","ISRG","DXCM","IDXX"],
  index_and_vol: ["SPY","QQQ","IWM","DIA","SMH","SOXL","XLK","TLT","GLD"],
  telecom_ai: ["NOK","ERIC","T","VZ","TMUS","CSCO","AKAM","CCI"],
};

export type DiscoverySector = keyof typeof DISCOVERY_UNIVERSE;

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface MultiSignalScore {
  ticker: string;
  spot: number;
  score: number;
  setupTier: 'A+' | 'A' | 'B+' | 'B' | 'C';
  signals: {
    squeeze: { ratio: number; firing: boolean };
    range: { tight2y: number; position: number };
    iv: { atm: number | null; cheap: boolean };
    gex: {
      regime: 'PINNED-DRIFT' | 'SQUEEZE-RISK' | 'MIXED';
      callWall: number | null;
      callRoom: number | null;
      hasNegativeGEX: boolean;
      flipPoint: number | null;
    };
    momentum4w: number;
    catalyst: { proximityDays: number | null; type: string | null };
  };
  bestContract?: {
    style: 'monthly_swing' | 'leaps' | 'lotto';
    expiry: string;
    strike: number;
    midPrice: number;
    delta: number;
    iv: number;
  };
  thesis: string;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function fetchYahooWeekly(symbol: string): Promise<{
  closes: number[]; highs: number[]; lows: number[]; spot: number;
} | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1wk`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const closes: number[] = (res.indicators?.quote?.[0]?.close || []).filter((x: any) => x != null);
    const highs: number[] = (res.indicators?.quote?.[0]?.high || []).filter((x: any) => x != null);
    const lows: number[] = (res.indicators?.quote?.[0]?.low || []).filter((x: any) => x != null);
    if (closes.length < 50) return null;
    return { closes, highs, lows, spot: closes[closes.length - 1] };
  } catch (e) {
    return null;
  }
}

function bbWidth(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  return (4 * Math.sqrt(variance)) / mean;
}

function computeBBSqueezeRatio(closes: number[]): { ratio: number; firing: boolean } {
  const current = bbWidth(closes.slice(-20));
  if (!current) return { ratio: 1, firing: false };
  let sum = 0, count = 0;
  for (let i = 20; i <= closes.length; i++) {
    const w = bbWidth(closes.slice(i - 20, i));
    if (w) { sum += w; count++; }
  }
  if (count === 0) return { ratio: 1, firing: false };
  const ratio = current / (sum / count);
  return { ratio, firing: ratio < 0.7 };
}

function computeRangeMetrics(closes: number[]): { tight2y: number; position: number } {
  const yr2 = closes.slice(-104);
  const hi = Math.max(...yr2);
  const lo = Math.min(...yr2);
  const tight2y = Math.max(0, 100 - ((hi - lo) / lo) * 100);
  const position = ((closes[closes.length - 1] - lo) / (hi - lo)) * 100;
  return { tight2y, position };
}

function computeMomentum4w(closes: number[]): number {
  const last = closes[closes.length - 1];
  const four = closes[Math.max(0, closes.length - 5)];
  return ((last - four) / four) * 100;
}

// ═══════════════════════════════════════════════════════════════
// CONTRACT PICKER
// ═══════════════════════════════════════════════════════════════

function pickBestContract(
  optionsChain: any,
  spot: number,
  signals: MultiSignalScore['signals']
): MultiSignalScore['bestContract'] {
  const calls = optionsChain?.calls || [];
  if (!calls.length) return undefined;

  // Target: 30-90 DTE, 5-12% OTM, OI > 100, premium 0.5-15
  const targetOTM = signals.gex.callRoom && signals.gex.callRoom > 0 && signals.gex.callRoom < 20
    ? signals.gex.callRoom * 0.7
    : 7;
  const targetStrike = spot * (1 + targetOTM / 100);
  const targetDTE = signals.catalyst.proximityDays && signals.catalyst.proximityDays < 30
    ? signals.catalyst.proximityDays + 30
    : 60;

  const candidates = calls.filter((o: any) => {
    const dte = o.dte || 0;
    const oi = o.openInterest || o.open_interest || 0;
    const mid = o.midPrice || ((o.bid + o.ask) / 2) || 0;
    return dte >= 30 && dte <= 120 && oi > 100 && mid > 0.4 && mid < 15
      && Math.abs(o.strike - targetStrike) / spot < 0.06;
  });

  if (!candidates.length) return undefined;

  candidates.sort((a: any, b: any) => {
    const oiDelta = (b.openInterest || b.open_interest || 0) - (a.openInterest || a.open_interest || 0);
    if (Math.abs(oiDelta) > 200) return oiDelta;
    return Math.abs(a.dte - targetDTE) - Math.abs(b.dte - targetDTE);
  });

  const best = candidates[0];
  let style: 'monthly_swing' | 'leaps' | 'lotto' = 'monthly_swing';
  if (best.dte > 180) style = 'leaps';
  else if ((best.delta || 0) < 0.20) style = 'lotto';

  return {
    style,
    expiry: best.expiry || best.expiration,
    strike: best.strike,
    midPrice: best.midPrice || ((best.bid + best.ask) / 2),
    delta: best.delta || 0,
    iv: (best.iv || best.impliedVolatility || 0) * 100
  };
}

// ═══════════════════════════════════════════════════════════════
// SCORE COMPUTATION
// ═══════════════════════════════════════════════════════════════

function computeCompositeScore(s: MultiSignalScore['signals']): number {
  let score = 0;

  // SQUEEZE — 15%
  if (s.squeeze.firing) score += 15;
  else score += Math.max(0, (1 - s.squeeze.ratio)) * 15;

  // RANGE TIGHTNESS + POSITION — 15%
  score += s.range.tight2y * 0.075;
  score += s.range.position * 0.075;

  // IV CHEAPNESS — 20% (the QCOM/JPM signal)
  if (s.iv.atm !== null) {
    if (s.iv.atm < 30) score += 20;
    else if (s.iv.atm < 45) score += 12;
    else if (s.iv.atm < 60) score += 5;
  }

  // GEX ALIGNMENT — 25%
  let gexScore = 0;
  if (s.gex.regime === 'PINNED-DRIFT') gexScore += 10;
  if (s.gex.regime === 'SQUEEZE-RISK') gexScore += 15;
  if (s.gex.callRoom && s.gex.callRoom > 5 && s.gex.callRoom < 20) gexScore += 10;
  score += gexScore;

  // MOMENTUM (capped, penalize chasers) — 15%
  if (s.momentum4w > 0 && s.momentum4w < 35) score += s.momentum4w * 0.4;
  else if (s.momentum4w >= 35) score += 5; // chasing — minimal credit

  // CATALYST PROXIMITY — 10% bonus
  if (s.catalyst.proximityDays !== null) {
    if (s.catalyst.proximityDays <= 14) score += 10;
    else if (s.catalyst.proximityDays <= 30) score += 7;
    else if (s.catalyst.proximityDays <= 60) score += 4;
  }

  return Math.min(100, Math.round(score));
}

function getSetupTier(score: number): MultiSignalScore['setupTier'] {
  if (score >= 80) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 60) return 'B+';
  if (score >= 50) return 'B';
  return 'C';
}

function generateThesis(
  ticker: string, signals: MultiSignalScore['signals'], score: number
): string {
  const tags: string[] = [];
  if (signals.squeeze.firing) tags.push(`squeeze firing (${signals.squeeze.ratio.toFixed(2)})`);
  if (signals.range.position > 90) tags.push('breaking 2yr highs');
  if (signals.iv.cheap) tags.push(`cheap IV (${signals.iv.atm?.toFixed(0)}%)`);
  if (signals.gex.regime === 'SQUEEZE-RISK') tags.push('negative GEX squeeze');
  if (signals.gex.callRoom && signals.gex.callRoom < 18 && signals.gex.callRoom > 3)
    tags.push(`call wall +${signals.gex.callRoom.toFixed(1)}%`);
  if (signals.catalyst.proximityDays !== null && signals.catalyst.proximityDays < 30)
    tags.push(`${signals.catalyst.type || 'catalyst'} in ${signals.catalyst.proximityDays}d`);
  if (signals.momentum4w > 5 && signals.momentum4w < 30)
    tags.push(`+${signals.momentum4w.toFixed(0)}% MTD`);
  return `${ticker} ${getSetupTier(score)} (${score}): ${tags.join(' + ') || 'neutral'}`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: scoreTicker
// ═══════════════════════════════════════════════════════════════

async function scoreTicker(ticker: string): Promise<MultiSignalScore | null> {
  try {
    const [chart, gex, options, catalysts] = await Promise.all([
      fetchYahooWeekly(ticker),
      calculateAggregateGammaExposure(ticker).catch(() => null),
      getCBOEOptionsChain(ticker).catch(() => null),
      getCatalystsForSymbol(ticker, 5).catch(() => [])
    ]);

    if (!chart) return null;
    const spot = chart.spot;

    // BB squeeze
    const squeeze = computeBBSqueezeRatio(chart.closes);
    // 2yr range
    const range = computeRangeMetrics(chart.closes);
    // 4w momentum
    const mom4 = computeMomentum4w(chart.closes);

    // IV ATM (rough proxy from chain)
    let ivATM: number | null = null;
    if (options?.calls) {
      const atmCalls = options.calls.filter((c: any) =>
        Math.abs(c.strike - spot) / spot < 0.06 && c.dte > 30 && c.dte < 90
      );
      if (atmCalls.length) {
        const ivs = atmCalls.map((c: any) => c.iv || c.impliedVolatility || 0).filter((x: number) => x > 0);
        if (ivs.length) ivATM = (ivs.reduce((a: number, b: number) => a + b, 0) / ivs.length) * 100;
      }
    }

    // GEX signals
    let gexSignal: MultiSignalScore['signals']['gex'] = {
      regime: 'MIXED',
      callWall: null,
      callRoom: null,
      hasNegativeGEX: false,
      flipPoint: null
    };
    if (gex) {
      const callWall = gex.callWall || gex.maxCallStrike || null;
      const callRoom = callWall ? ((callWall - spot) / spot) * 100 : null;
      const totalGEX = gex.totalNetGEX || gex.netGEX || 0;
      const hasNeg = totalGEX < 0 || (gex.byExpiry && Object.values(gex.byExpiry).some((g: any) => (g.totalGEX || 0) < 0));
      gexSignal = {
        regime: hasNeg ? 'SQUEEZE-RISK' : (totalGEX > 0 ? 'PINNED-DRIFT' : 'MIXED'),
        callWall, callRoom,
        hasNegativeGEX: hasNeg,
        flipPoint: gex.flipPoint || null
      };
    }

    // Catalyst proximity
    let catalystInfo: MultiSignalScore['signals']['catalyst'] = { proximityDays: null, type: null };
    if (catalysts && catalysts.length > 0) {
      const next = catalysts[0];
      const date = new Date(next.date || next.eventDate || Date.now());
      catalystInfo = {
        proximityDays: Math.floor((date.getTime() - Date.now()) / 86400000),
        type: next.type || next.category || 'event'
      };
    }

    const signals: MultiSignalScore['signals'] = {
      squeeze: { ratio: squeeze.ratio, firing: squeeze.firing },
      range,
      iv: { atm: ivATM, cheap: ivATM !== null && ivATM < 30 },
      gex: gexSignal,
      momentum4w: mom4,
      catalyst: catalystInfo
    };

    const score = computeCompositeScore(signals);
    const bestContract = pickBestContract(options, spot, signals);
    const thesis = generateThesis(ticker, signals, score);

    return { ticker, spot, score, setupTier: getSetupTier(score), signals, bestContract, thesis };
  } catch (e) {
    logger.warn(`[DISCOVERY] Failed ${ticker}:`, e as any);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export async function runDiscoveryScan(
  sectors?: DiscoverySector[]
): Promise<MultiSignalScore[]> {
  const target = sectors?.length ? sectors : (Object.keys(DISCOVERY_UNIVERSE) as DiscoverySector[]);
  const tickers = Array.from(new Set(target.flatMap(s => DISCOVERY_UNIVERSE[s])));
  logger.info(`[DISCOVERY] Scanning ${tickers.length} tickers across ${target.length} sectors`);

  const results: MultiSignalScore[] = [];
  const BATCH = 8;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    const r = await Promise.all(batch.map(scoreTicker));
    results.push(...r.filter((x): x is MultiSignalScore => x !== null));
  }
  return results.sort((a, b) => b.score - a.score);
}

export async function findEliteSetups(): Promise<MultiSignalScore[]> {
  const all = await runDiscoveryScan();
  return all.filter(s => s.score >= 70);
}

export async function getDiscoveryFeed(opts: {
  sector?: DiscoverySector;
  minScore?: number;
  limit?: number;
} = {}): Promise<MultiSignalScore[]> {
  const sectors = opts.sector ? [opts.sector] : undefined;
  const all = await runDiscoveryScan(sectors);
  const filtered = all.filter(s => s.score >= (opts.minScore ?? 50));
  return filtered.slice(0, opts.limit ?? 20);
}

export async function scoreSingleTicker(ticker: string): Promise<MultiSignalScore | null> {
  return scoreTicker(ticker.toUpperCase());
}

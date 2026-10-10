/**
 * Macro Signals Service
 * 
 * Provides institutional-grade macro context:
 * - VIX Regime Detection (risk-on/risk-off)
 * - Fed Calendar & Rate Expectations
 * - Sector Rotation Analysis
 * - Market Breadth Indicators
 * 
 * Integrates with Command Center and Trade Desk
 */

import { logger } from './logger';

export interface VIXRegime {
  level: number;
  regime: 'extreme_fear' | 'fear' | 'neutral' | 'complacency' | 'extreme_complacency';
  percentile: number;
  tradingImplication: string;
  optionsStrategy: string;
}

export interface SectorStrength {
  sector: string;
  symbol: string;
  performance1d: number;
  performance5d: number;
  performance1m: number;
  relativeStrength: number;
  flow: 'inflow' | 'outflow' | 'neutral';
  recommendation: string;
}

export interface MacroContext {
  timestamp: string;
  vixRegime: VIXRegime;
  marketBreadth: {
    advanceDecline: number;
    newHighsLows: number;
    percentAbove200MA: number;
    interpretation: string;
  };
  sectorRotation: SectorStrength[];
  riskAppetite: 'risk_on' | 'risk_off' | 'mixed';
  tradingRecommendation: string;
}

const VIX_THRESHOLDS = {
  extreme_fear: { min: 30, max: 100 },
  fear: { min: 20, max: 30 },
  neutral: { min: 15, max: 20 },
  complacency: { min: 12, max: 15 },
  extreme_complacency: { min: 0, max: 12 },
};

const SECTOR_ETFS = [
  { sector: 'Technology', symbol: 'XLK' },
  { sector: 'Healthcare', symbol: 'XLV' },
  { sector: 'Financials', symbol: 'XLF' },
  { sector: 'Energy', symbol: 'XLE' },
  { sector: 'Consumer Discretionary', symbol: 'XLY' },
  { sector: 'Consumer Staples', symbol: 'XLP' },
  { sector: 'Industrials', symbol: 'XLI' },
  { sector: 'Materials', symbol: 'XLB' },
  { sector: 'Utilities', symbol: 'XLU' },
  { sector: 'Real Estate', symbol: 'XLRE' },
  { sector: 'Communication Services', symbol: 'XLC' },
];

/**
 * Analyze VIX regime and trading implications
 */
export function analyzeVIXRegime(vixLevel: number): VIXRegime {
  let regime: VIXRegime['regime'] = 'neutral';
  let tradingImplication = '';
  let optionsStrategy = '';
  
  const historicalVixMean = 19.5;
  const historicalVixStd = 8.5;
  const percentile = Math.round(
    100 * (1 - Math.exp(-Math.pow((vixLevel - 12) / 15, 2)))
  );

  if (vixLevel >= VIX_THRESHOLDS.extreme_fear.min) {
    regime = 'extreme_fear';
    tradingImplication = 'Extreme volatility - reduce position sizes 50%, avoid overnight holds, focus on liquid names only';
    optionsStrategy = 'Sell put spreads on quality names (IV crush opportunity), avoid buying premium';
  } else if (vixLevel >= VIX_THRESHOLDS.fear.min) {
    regime = 'fear';
    tradingImplication = 'Elevated risk - tighten stops, favor defensive sectors, scale into positions';
    optionsStrategy = 'Consider selling puts on stocks you want to own, use wider spreads';
  } else if (vixLevel >= VIX_THRESHOLDS.neutral.min) {
    regime = 'neutral';
    tradingImplication = 'Normal market conditions - standard risk parameters apply';
    optionsStrategy = 'Balanced approach - both buying and selling premium viable';
  } else if (vixLevel >= VIX_THRESHOLDS.complacency.min) {
    regime = 'complacency';
    tradingImplication = 'Low volatility - consider hedges, market may be underpricing risk';
    optionsStrategy = 'Buy cheap hedges (VIX calls, put spreads), reduce naked short premium';
  } else {
    regime = 'extreme_complacency';
    tradingImplication = 'Extreme low volatility - historically precedes vol expansion, prioritize capital preservation';
    optionsStrategy = 'Buy long-dated VIX calls, calendar spreads to benefit from vol expansion';
  }

  return {
    level: vixLevel,
    regime,
    percentile: Math.min(99, Math.max(1, percentile)),
    tradingImplication,
    optionsStrategy,
  };
}

/**
 * Calculate market breadth indicators
 */
export function calculateMarketBreadth(data: {
  advances: number;
  declines: number;
  newHighs: number;
  newLows: number;
  stocksAbove200MA: number;
  totalStocks: number;
}): MacroContext['marketBreadth'] {
  const advanceDecline = data.advances - data.declines;
  const newHighsLows = data.newHighs - data.newLows;
  const percentAbove200MA = (data.stocksAbove200MA / data.totalStocks) * 100;

  let interpretation = '';
  
  if (advanceDecline > 500 && newHighsLows > 50 && percentAbove200MA > 60) {
    interpretation = 'Strong breadth - broad market participation, bullish confirmation';
  } else if (advanceDecline < -500 && newHighsLows < -50 && percentAbove200MA < 40) {
    interpretation = 'Weak breadth - selling pressure widespread, bearish confirmation';
  } else if (advanceDecline > 0 && newHighsLows < 0) {
    interpretation = 'Divergence warning - price rising but breadth deteriorating';
  } else if (advanceDecline < 0 && newHighsLows > 0) {
    interpretation = 'Divergence warning - price falling but breadth improving';
  } else {
    interpretation = 'Mixed breadth - no clear directional signal';
  }

  return {
    advanceDecline,
    newHighsLows,
    percentAbove200MA,
    interpretation,
  };
}

/**
 * Analyze sector rotation patterns
 */
export function analyzeSectorRotation(
  sectorPerformance: Map<string, { perf1d: number; perf5d: number; perf1m: number; volume: number }>
): SectorStrength[] {
  const spyPerf = sectorPerformance.get('SPY') || { perf1d: 0, perf5d: 0, perf1m: 0, volume: 0 };
  
  const results: SectorStrength[] = [];
  
  for (const sector of SECTOR_ETFS) {
    const perf = sectorPerformance.get(sector.symbol);
    if (!perf) continue;

    const relativeStrength = perf.perf5d - spyPerf.perf5d;
    
    let flow: SectorStrength['flow'] = 'neutral';
    if (relativeStrength > 1) flow = 'inflow';
    else if (relativeStrength < -1) flow = 'outflow';

    let recommendation = '';
    if (relativeStrength > 2 && perf.perf1d > 0) {
      recommendation = 'Strong relative strength - overweight sector, look for breakout setups';
    } else if (relativeStrength < -2 && perf.perf1d < 0) {
      recommendation = 'Weak relative strength - underweight sector, avoid new longs';
    } else if (relativeStrength > 0 && perf.perf1m < 0) {
      recommendation = 'Recovery rotation - sector improving after weakness, selective longs';
    } else {
      recommendation = 'Neutral - follow individual stock signals';
    }

    results.push({
      sector: sector.sector,
      symbol: sector.symbol,
      performance1d: perf.perf1d,
      performance5d: perf.perf5d,
      performance1m: perf.perf1m,
      relativeStrength,
      flow,
      recommendation,
    });
  }

  return results.sort((a, b) => b.relativeStrength - a.relativeStrength);
}

/**
 * Generate comprehensive macro context
 */
export async function generateMacroContext(
  vixLevel: number,
  breadthData?: {
    advances: number;
    declines: number;
    newHighs: number;
    newLows: number;
    stocksAbove200MA: number;
    totalStocks: number;
  },
  sectorData?: Map<string, { perf1d: number; perf5d: number; perf1m: number; volume: number }>
): Promise<MacroContext> {
  const vixRegime = analyzeVIXRegime(vixLevel);
  
  const marketBreadth = breadthData 
    ? calculateMarketBreadth(breadthData)
    : {
        advanceDecline: 0,
        newHighsLows: 0,
        percentAbove200MA: 50,
        interpretation: 'Breadth data not available',
      };

  const sectorRotation = sectorData 
    ? analyzeSectorRotation(sectorData)
    : [];

  let riskAppetite: MacroContext['riskAppetite'] = 'mixed';
  if (vixRegime.regime === 'complacency' || vixRegime.regime === 'extreme_complacency') {
    if (marketBreadth.percentAbove200MA > 60) {
      riskAppetite = 'risk_on';
    }
  } else if (vixRegime.regime === 'fear' || vixRegime.regime === 'extreme_fear') {
    riskAppetite = 'risk_off';
  }

  const tradingRecommendation = generateMacroRecommendation(
    vixRegime,
    marketBreadth,
    sectorRotation,
    riskAppetite
  );

  return {
    timestamp: new Date().toISOString(),
    vixRegime,
    marketBreadth,
    sectorRotation,
    riskAppetite,
    tradingRecommendation,
  };
}

function generateMacroRecommendation(
  vix: VIXRegime,
  breadth: MacroContext['marketBreadth'],
  sectors: SectorStrength[],
  risk: MacroContext['riskAppetite']
): string {
  const parts: string[] = [];

  parts.push(`VIX at ${vix.level.toFixed(1)} (${vix.regime.replace('_', ' ')}) - ${vix.tradingImplication.split(',')[0]}`);

  if (breadth.interpretation && !breadth.interpretation.includes('not available')) {
    parts.push(breadth.interpretation.split(' - ')[0]);
  }

  const topSector = sectors[0];
  const bottomSector = sectors[sectors.length - 1];
  if (topSector && bottomSector) {
    parts.push(`Rotation: ${topSector.sector} leading (+${topSector.relativeStrength.toFixed(1)}% RS), ${bottomSector.sector} lagging (${bottomSector.relativeStrength.toFixed(1)}% RS)`);
  }

  if (risk === 'risk_on') {
    parts.push('Overall: Risk-on environment - favor growth, momentum strategies');
  } else if (risk === 'risk_off') {
    parts.push('Overall: Risk-off environment - favor quality, defensive strategies');
  } else {
    parts.push('Overall: Mixed signals - selective positioning recommended');
  }

  return parts.join('. ');
}

/**
 * Get simplified macro regime for quick decisions
 */
export function getQuickMacroRegime(vixLevel: number): {
  regime: 'bullish' | 'neutral' | 'bearish';
  positionSizeMultiplier: number;
  stopLossMultiplier: number;
} {
  if (vixLevel < 15) {
    return {
      regime: 'bullish',
      positionSizeMultiplier: 1.0,
      stopLossMultiplier: 1.0,
    };
  } else if (vixLevel < 25) {
    return {
      regime: 'neutral',
      positionSizeMultiplier: 0.8,
      stopLossMultiplier: 1.2,
    };
  } else {
    return {
      regime: 'bearish',
      positionSizeMultiplier: 0.5,
      stopLossMultiplier: 1.5,
    };
  }
}

export const MacroSignals = {
  analyzeVIXRegime,
  calculateMarketBreadth,
  analyzeSectorRotation,
  generateMacroContext,
  getQuickMacroRegime,
};

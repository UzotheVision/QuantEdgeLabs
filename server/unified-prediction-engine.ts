/**
 * Unified Market Prediction Engine
 * ==================================
 * Correlates ALL available signals into a single swing/day-to-day projection:
 *   - GEX + VEX targets (dealer hedging walls, vanna magnets)
 *   - Geopolitical scenario overlay (active scenarios affecting assets)
 *   - Psych Levels (key support/resistance from expected moves + GEX walls)
 *   - Technical signals (RSI, EMA, momentum regime)
 *   - VIX regime & term structure
 *   - Sector correlation
 *
 * Output: A unified prediction with direction, confidence, key levels,
 *         and a correlated narrative explaining how signals align.
 */

import { logger } from './logger';
import { getCachedProjection, type ProjectorResult, type ProjectionRange } from './gex-vex-projector';
import { getScenarioMatrix, type ScenarioMatrix, type Scenario } from './geopolitical-matrix';
import { recordProjection } from './projection-validator';

// ─── Types ───────────────────────────────────────────────────

export interface PsychLevel {
  price: number;
  type: 'RESISTANCE' | 'SUPPORT' | 'PIVOT' | 'PSYCH_ROUND';
  source: string;           // 'GEX_WALL' | 'VEX_MAGNET' | 'EXPECTED_MOVE' | 'ROUND_NUMBER' | 'FLIP_ZONE'
  strength: number;         // 0-100
  label: string;
}

export interface SignalCorrelation {
  signal: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  weight: number;           // contribution to final score
  detail: string;
}

export interface TradeSetup {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  timeframe: 'SCALP' | 'DAY' | 'SWING';
  entry: number;
  target: number;
  stop: number;
  riskReward: string;
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';
  rules: string[];
}

export interface UnifiedPrediction {
  symbol: string;
  spotPrice: number;
  timestamp: string;

  // Data freshness — so the user knows what they can rely on
  dataFreshness?: {
    priceSource: 'CHART_CANDLE' | 'QUOTE' | 'TRADIER' | 'STALE';
    priceAge: string;           // "< 1 min" or "2 hours stale"
    gexSource: 'TRADIER' | 'YAHOO' | 'NONE';
    vixLive: boolean;
    lastUpdate: string;         // ISO timestamp
    nextUpdate: string;         // "~2 min" auto-refresh
  };

  // Overall prediction
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;        // 0-100
  predictionText: string;    // "SPY likely to test $665 resistance before pulling back to $655"

  // Psych Levels — the key levels that matter
  psychLevels: PsychLevel[];
  t1Resist: PsychLevel | null;
  t1Support: PsychLevel | null;

  // Signal breakdown — what's agreeing/disagreeing
  signals: SignalCorrelation[];
  signalAlignment: number;   // -100 (all bearish) to +100 (all bullish)

  // Trade setups derived from correlated signals
  setups: TradeSetup[];

  // GEX/VEX data (forwarded from projector)
  gexVex: {
    regime: string;
    gexAnchor: number | null;
    gexFlip: number | null;
    vexAnchor: number | null;
    vexFlip: number | null;
    callWalls: number[];
    putWalls: number[];
    upsideTarget: number | null;
    downsideTarget: number | null;
    projectionRange: ProjectionRange | null;
    regimeStrength: number;
    gammaConcentration: { strike: number; percent: number; netGEX: number }[];
  } | null;

  // Active geopolitical scenarios
  activeScenarios: {
    id: string;
    name: string;
    icon: string;
    likelihood: string;
    impact: string;          // "SPY +1.5% if triggered"
  }[];

  // VIX-derived expected move context
  expectedMove: {
    daily: number;           // ±$ daily expected move (1σ)
    weekly: number;          // ±$ weekly expected move (1σ)
    vixLevel: number;
    vixChange: number;       // daily VIX change in points
    vixRegime: 'EXTREME_FEAR' | 'FEAR' | 'ELEVATED' | 'NORMAL' | 'COMPLACENT';
    impliedDailyRange: { low: number; high: number };
    impliedWeeklyRange: { low: number; high: number };
  } | null;

  // Correlation narrative — how all signals connect
  narrative: string;

  // Multi-horizon outlook — separate projections for different time horizons
  horizonOutlook?: HorizonOutlook;

  // Options flow data
  flowData?: {
    putCallRatio: number;
    volumePCR: number;
    flowBias: 'CALL_HEAVY' | 'PUT_HEAVY' | 'BALANCED';
    totalCallOI: number;
    totalPutOI: number;
  };
}

export interface LevelProbability {
  price: number;
  label: string;                // "Call Wall $680" or "GEX Anchor $675"
  probability: number;          // 0-100 probability of price reaching this level
  gammaPercent: number;         // gamma concentration % at this level
  type: 'CALL_WALL' | 'PUT_WALL' | 'GEX_ANCHOR' | 'GAMMA_FLIP' | 'VEX_MAGNET' | 'EM_BOUND' | 'ROUND';
  direction: 'UPSIDE' | 'DOWNSIDE';
}

export interface HorizonProjection {
  horizon: 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH';
  label: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  target: number;
  emRange: { low: number; high: number };
  keyDriver: string;
  signals: string[];
  // New: probability-weighted level analysis
  levelProbabilities?: LevelProbability[];
  bullishProbability?: number;   // 0-100 overall probability of upside
  bearishProbability?: number;   // 0-100 overall probability of downside
  neutralProbability?: number;   // 0-100 probability of rangebound
  mostLikelyPath?: string;       // "67% → $680 (call wall) then fade to $675 (anchor)"
}

export interface SynthesizedPrediction {
  /** Final synthesized target across all horizons */
  finalTarget: number;
  /** Probability of reaching final target */
  finalProbability: number;
  /** Direction with highest probability */
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  /** Breakdown: probability of each outcome */
  probabilities: { bullish: number; bearish: number; neutral: number };
  /** The most likely path price takes through levels */
  path: string;
  /** Key inflection levels — if price breaks these, thesis changes */
  inflectionLevels: { price: number; label: string; breakAbove: string; breakBelow: string }[];
}

export interface HorizonOutlook {
  today: HorizonProjection;
  thisWeek: HorizonProjection;
  thisMonth: HorizonProjection;
  /** Synthesized prediction combining all horizons */
  synthesized?: SynthesizedPrediction;
}

// ─── Signal Weights ──────────────────────────────────────────

const SIGNAL_WEIGHTS = {
  gexRegime: 25,       // Gamma regime is the strongest mechanical force
  vexBias: 15,         // Vanna adds directional overlay
  momentum: 20,        // RSI + EMA alignment
  vixRegime: 15,       // Fear/greed context
  flowBias: 10,        // Options flow direction
  geopolitical: 10,    // Active scenario bias
  sectorCorr: 5,       // Sector rotation signal
};

// ─── Main Engine ─────────────────────────────────────────────

export async function computeUnifiedPrediction(
  symbol: string,
  intelData?: any,
  projectorData?: any,
  timeframe?: string,
): Promise<UnifiedPrediction | null> {
  try {
    logger.info(`[UNIFIED] Computing prediction for ${symbol}...`);

    // ── 1. Gather all data sources in parallel ──
    // Fetch VIX for context-aware projection
    let vixLevel = 0;
    let vixChange = 0;
    try {
      const { safeQuote, getBestPrice } = await import('./yahoo-finance-service');
      const vixQuote = await safeQuote('^VIX');
      vixLevel = getBestPrice(vixQuote) || vixQuote?.regularMarketPrice || 0;
      vixChange = vixQuote?.regularMarketChange || 0;
    } catch {}

    // Compute days to nearest Friday (weekly OpEx)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 5=Fri
    const daysToExpiry = dayOfWeek <= 5 ? (5 - dayOfWeek) : (5 + 7 - dayOfWeek);

    const projCtx = { vixLevel, vixChange, daysToExpiry };

    const [gexVexResult, geoMatrix] = await Promise.all([
      getCachedProjection(symbol, projCtx, timeframe).catch(() => null),
      getScenarioMatrix().catch(() => null),
    ]);

    // Get the freshest price — cross-validate sources to avoid stale/bad data
    const gexSpot = gexVexResult?.spotPrice || 0;
    const intelSpot = intelData?.spotPrice || 0;
    const projSpot = projectorData?.expectedMoves?.find((em: any) => em.symbol === symbol)?.currentPrice || 0;
    let spot = gexSpot || intelSpot || projSpot;

    let priceSource: 'CHART_CANDLE' | 'QUOTE' | 'TRADIER' | 'STALE' = 'STALE';
    let priceAge = 'unknown';
    try {
      const { safeQuote, getBestPrice, getChartLastPrice } = await import('./yahoo-finance-service');

      // Fetch quote AND chart last price in parallel for cross-validation
      const [freshQuote, chartPrice] = await Promise.all([
        safeQuote(symbol),
        getChartLastPrice(symbol),
      ]);
      const quotePrice = getBestPrice(freshQuote);

      // Chart candle data is ground truth — regularMarketPrice can be stale by hours
      if (chartPrice > 0 && quotePrice > 0) {
        const divergence = Math.abs(chartPrice - quotePrice) / quotePrice;
        if (divergence > 0.01) {
          logger.warn(`[UNIFIED] Quote stale: quote $${quotePrice.toFixed(2)} vs chart $${chartPrice.toFixed(2)} (${(divergence * 100).toFixed(1)}%). Using chart price.`);
          spot = chartPrice;
          priceSource = 'CHART_CANDLE';
          priceAge = '< 1 min';
        } else {
          spot = quotePrice;
          priceSource = 'QUOTE';
          priceAge = '< 1 min';
        }
      } else if (chartPrice > 0) {
        spot = chartPrice;
        priceSource = 'CHART_CANDLE';
        priceAge = '< 1 min';
      } else if (quotePrice > 0) {
        spot = quotePrice;
        priceSource = 'QUOTE';
        priceAge = '< 5 min';
      }

      // If still no price, try GEX chain spot or regular close
      if (spot === 0 && gexSpot > 0) { spot = gexSpot; priceSource = 'TRADIER'; priceAge = '< 15 min'; }
      if (spot === 0 && freshQuote?.regularMarketPrice > 0) { spot = freshQuote.regularMarketPrice; priceSource = 'STALE'; priceAge = 'possibly stale'; }
    } catch {}

    if (spot === 0) {
      logger.warn(`[UNIFIED] No spot price for ${symbol}`);
      return null;
    }

    // ── 1b. VIX-derived expected move (sizes EVERYTHING) ──
    const dailyEM = vixLevel > 0 ? spot * (vixLevel / 100) / Math.sqrt(252) : spot * 0.01;
    const weeklyEM = vixLevel > 0 ? spot * (vixLevel / 100) * Math.sqrt(5) / Math.sqrt(252) : spot * 0.03;

    // Scale EM by timeframe using √time rule for the projection horizon
    const emScaleMap: Record<string, number> = {
      '5m': Math.sqrt(1 / 78),    // ~0.11×
      '15m': Math.sqrt(3 / 78),   // ~0.20×
      '1h': Math.sqrt(1 / 6.5),   // ~0.39×
      '4h': Math.sqrt(4 / 6.5),   // ~0.78×
      '1d': 1,
      '1w': Math.sqrt(5),          // ~2.24×
    };
    const tfScale = emScaleMap[timeframe || '1d'] || 1;
    const tfEM = dailyEM * tfScale;
    const tfLabel: Record<string, string> = {
      '5m': '5min', '15m': '15min', '1h': 'hourly', '4h': '4hr', '1d': 'daily', '1w': 'weekly',
    };

    const vixRegime: 'EXTREME_FEAR' | 'FEAR' | 'ELEVATED' | 'NORMAL' | 'COMPLACENT' =
      vixLevel >= 35 ? 'EXTREME_FEAR' :
      vixLevel >= 25 ? 'FEAR' :
      vixLevel >= 18 ? 'ELEVATED' :
      vixLevel >= 13 ? 'NORMAL' : 'COMPLACENT';

    const expectedMoveData = vixLevel > 0 ? {
      daily: Math.round(dailyEM * 100) / 100,
      weekly: Math.round(weeklyEM * 100) / 100,
      timeframeEM: Math.round(tfEM * 100) / 100,
      timeframeLabel: tfLabel[timeframe || '1d'] || 'daily',
      vixLevel,
      vixChange,
      vixRegime,
      impliedDailyRange: { low: Math.round((spot - dailyEM) * 100) / 100, high: Math.round((spot + dailyEM) * 100) / 100 },
      impliedWeeklyRange: { low: Math.round((spot - weeklyEM) * 100) / 100, high: Math.round((spot + weeklyEM) * 100) / 100 },
      impliedTfRange: { low: Math.round((spot - tfEM) * 100) / 100, high: Math.round((spot + tfEM) * 100) / 100 },
    } : null;

    // ── 2. Build Psych Levels from all sources ──
    const psychLevels = buildPsychLevels(symbol, spot, gexVexResult, intelData);

    // Sort by distance from spot
    psychLevels.sort((a, b) => Math.abs(a.price - spot) - Math.abs(b.price - spot));

    // Find T1 Support & T1 Resistance (closest strong levels)
    const t1Resist = psychLevels
      .filter(l => l.type === 'RESISTANCE' && l.price > spot && l.strength >= 40)
      .sort((a, b) => a.price - b.price)[0] || null;
    const t1Support = psychLevels
      .filter(l => l.type === 'SUPPORT' && l.price < spot && l.strength >= 40)
      .sort((a, b) => b.price - a.price)[0] || null;

    // ── 3. Correlate all signals ──
    const signals = correlateSignals(symbol, spot, gexVexResult, geoMatrix, intelData);

    // Calculate signal alignment (-100 to +100)
    let bullishWeight = 0;
    let bearishWeight = 0;
    let totalWeight = 0;
    for (const sig of signals) {
      totalWeight += sig.weight;
      if (sig.direction === 'BULLISH') bullishWeight += sig.weight;
      else if (sig.direction === 'BEARISH') bearishWeight += sig.weight;
    }
    const signalAlignment = totalWeight > 0
      ? Math.round(((bullishWeight - bearishWeight) / totalWeight) * 100)
      : 0;

    // ── 4. Determine direction ──
    const direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
      signalAlignment > 20 ? 'BULLISH' :
      signalAlignment < -20 ? 'BEARISH' :
      'NEUTRAL';

    // ── 5. Confidence (how aligned are signals) ──
    const alignmentStrength = Math.abs(signalAlignment);
    const signalCount = signals.filter(s => s.direction !== 'NEUTRAL').length;
    const agreementRatio = signals.length > 0
      ? signals.filter(s => s.direction === direction).length / signals.length
      : 0;
    let confidence = Math.round(
      alignmentStrength * 0.5 +
      agreementRatio * 40 +
      Math.min(signalCount * 5, 20)
    );
    confidence = Math.max(15, Math.min(90, confidence));

    // ── 6. Build trade setups ──
    const setups = buildTradeSetups(spot, direction, t1Support, t1Resist, gexVexResult, confidence, dailyEM);

    // ── 7. Active geopolitical scenarios ──
    const activeScenarios = getActiveScenarios(symbol, geoMatrix);

    // ── 8. Build narrative ──
    const narrative = buildCorrelationNarrative(symbol, spot, direction, confidence, signals, t1Support, t1Resist, gexVexResult, activeScenarios);

    // ── 9. Prediction text (the headline) ──
    const predictionText = buildPredictionText(symbol, spot, direction, t1Support, t1Resist, gexVexResult, expectedMoveData);

    const gexSource = gexVexResult ? (gexVexResult.narrative?.includes('Yahoo') ? 'YAHOO' : 'TRADIER') : 'NONE';
    const result: UnifiedPrediction = {
      symbol,
      spotPrice: spot,
      timestamp: new Date().toISOString(),
      dataFreshness: {
        priceSource,
        priceAge,
        gexSource: gexSource as any,
        vixLive: vixLevel > 0,
        lastUpdate: new Date().toISOString(),
        nextUpdate: '~2 min (auto)',
      },
      direction,
      confidence,
      predictionText,
      psychLevels: psychLevels.slice(0, 12), // Top 12 levels
      t1Resist,
      t1Support,
      signals,
      signalAlignment,
      setups,
      gexVex: gexVexResult ? {
        regime: gexVexResult.regime.type,
        gexAnchor: gexVexResult.levels.gexAnchor,
        gexFlip: gexVexResult.levels.gexFlip,
        vexAnchor: gexVexResult.levels.vexAnchor,
        vexFlip: gexVexResult.levels.vexFlip,
        callWalls: gexVexResult.levels.callWalls,
        putWalls: gexVexResult.levels.putWalls,
        gammaConcentration: gexVexResult.levels.gammaConcentration || [],
        // Upside/downside targets: pick the REAL level traders watch
        // Priority: call wall > round psych level > T1 resist > projection bound
        upsideTarget: (() => {
          const minDist = spot * 0.005; // at least 0.5% from spot to be a real target
          const maxDist = tfEM * 2.5;   // within 2.5× EM to be reachable
          const roundStep = spot > 200 ? 5 : spot > 50 ? 2.5 : 1;
          const walls = gexVexResult.levels.callWalls.filter((w: number) => w > spot + minDist && w <= spot + maxDist);
          // Next major round number above spot (e.g. $680 when at $675)
          const nextRound = Math.ceil((spot + minDist) / roundStep) * roundStep;
          // If a call wall is within $2 of the round number → snap to round (confluence)
          const hasNearbyWall = walls.some((w: number) => Math.abs(w - nextRound) <= 2);
          if (nextRound <= spot + maxDist) {
            if (hasNearbyWall) return nextRound;  // Round + wall confluence = best target
            if (walls.length === 0 || nextRound < walls[0]) return nextRound;
          }
          if (walls.length > 0) return walls[0];
          if (t1Resist && t1Resist.price > spot + minDist && t1Resist.price <= spot + maxDist) return t1Resist.price;
          if (gexVexResult.projectionRange?.upperBound > spot + minDist) {
            return Math.round(gexVexResult.projectionRange.upperBound * 100) / 100;
          }
          return gexVexResult.targets.primaryUpside?.price || null;
        })(),
        downsideTarget: (() => {
          const minDist = spot * 0.005;
          const maxDist = tfEM * 2.5;
          const roundStep = spot > 200 ? 5 : spot > 50 ? 2.5 : 1;
          const walls = gexVexResult.levels.putWalls.filter((w: number) => w < spot - minDist && w >= spot - maxDist);
          const prevRound = Math.floor((spot - minDist) / roundStep) * roundStep;
          const hasNearbyWall = walls.some((w: number) => Math.abs(w - prevRound) <= 2);
          if (prevRound >= spot - maxDist) {
            if (hasNearbyWall) return prevRound;
            if (walls.length === 0 || prevRound > walls[0]) return prevRound;
          }
          if (walls.length > 0) return walls[0];
          if (t1Support && t1Support.price < spot - minDist && t1Support.price >= spot - maxDist) return t1Support.price;
          if (gexVexResult.projectionRange?.lowerBound < spot - minDist) {
            return Math.round(gexVexResult.projectionRange.lowerBound * 100) / 100;
          }
          return gexVexResult.targets.primaryDownside?.price || null;
        })(),
        projectionRange: gexVexResult.projectionRange || null,
        regimeStrength: gexVexResult.regime.strength || 0,
      } : null,
      activeScenarios,
      expectedMove: expectedMoveData,
      narrative,
      horizonOutlook: computeHorizonOutlook(spot, dailyEM, vixLevel, vixChange, vixRegime, gexVexResult, geoMatrix, signals, symbol),
      flowData: gexVexResult?.flowData ? {
        putCallRatio: gexVexResult.flowData.putCallRatio,
        volumePCR: gexVexResult.flowData.volumePCR,
        flowBias: gexVexResult.flowData.flowBias,
        totalCallOI: gexVexResult.flowData.totalCallOI,
        totalPutOI: gexVexResult.flowData.totalPutOI,
      } : undefined,
    };

    const ho = result.horizonOutlook;
    logger.info(`[UNIFIED] ${symbol}: ${direction} (${confidence}% conf, alignment ${signalAlignment}, VIX ${vixLevel}, EM ±$${dailyEM.toFixed(1)}/day) UP=$${result.gexVex?.upsideTarget} DN=$${result.gexVex?.downsideTarget} price=${priceSource}`);
    if (ho) {
      logger.info(`[UNIFIED] ${symbol} horizons: TODAY=${ho.today.direction}(${ho.today.confidence}%) WEEK=${ho.thisWeek.direction}(${ho.thisWeek.confidence}%) MONTH=${ho.thisMonth.direction}(${ho.thisMonth.confidence}%)`);
    }

    // Record projection for accuracy tracking
    if (gexVexResult) {
      try { recordProjection(symbol, gexVexResult, spot, vixLevel); } catch {};
    }

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : '';
    logger.error(`[UNIFIED] Prediction error for ${symbol}: ${msg}`, { stack });
    return null;
  }
}

// ─── Psych Level Builder ─────────────────────────────────────

function buildPsychLevels(
  symbol: string,
  spot: number,
  gexVex: ProjectorResult | null,
  intel: any,
): PsychLevel[] {
  const levels: PsychLevel[] = [];

  // Round numbers (psych levels every $5 within 3% of spot)
  const range = spot * 0.03;
  const roundStep = spot > 200 ? 5 : spot > 50 ? 2.5 : 1;
  const low = Math.floor((spot - range) / roundStep) * roundStep;
  const high = Math.ceil((spot + range) / roundStep) * roundStep;
  for (let p = low; p <= high; p += roundStep) {
    if (Math.abs(p - spot) < roundStep * 0.1) continue; // Skip if too close to spot
    levels.push({
      price: p,
      type: p > spot ? 'RESISTANCE' : 'SUPPORT',
      source: 'ROUND_NUMBER',
      strength: p % (roundStep * 2) === 0 ? 50 : 30, // Bigger rounds are stronger
      label: `$${p} psych level`,
    });
  }

  // GEX walls → strongest support/resistance
  if (gexVex) {
    for (const wall of gexVex.levels.callWalls) {
      levels.push({
        price: wall,
        type: 'RESISTANCE',
        source: 'GEX_WALL',
        strength: 80,
        label: `$${wall} call wall (gamma resistance)`,
      });
    }
    for (const wall of gexVex.levels.putWalls) {
      levels.push({
        price: wall,
        type: 'SUPPORT',
        source: 'GEX_WALL',
        strength: 80,
        label: `$${wall} put wall (gamma support)`,
      });
    }

    // GEX flip → pivot zone
    if (gexVex.levels.gexFlip) {
      levels.push({
        price: gexVex.levels.gexFlip,
        type: 'PIVOT',
        source: 'FLIP_ZONE',
        strength: 90,
        label: `$${gexVex.levels.gexFlip} gamma flip — regime change`,
      });
    }

    // VEX magnets
    for (const mag of gexVex.levels.vannaAttractors) {
      levels.push({
        price: mag,
        type: mag > spot ? 'RESISTANCE' : 'SUPPORT',
        source: 'VEX_MAGNET',
        strength: 65,
        label: `$${mag} vanna magnet (IV compression pull)`,
      });
    }

    // VEX flip
    if (gexVex.levels.vexFlip) {
      levels.push({
        price: gexVex.levels.vexFlip,
        type: 'PIVOT',
        source: 'FLIP_ZONE',
        strength: 75,
        label: `$${gexVex.levels.vexFlip} vanna flip — IV sensitivity shift`,
      });
    }
  }

  // Expected move bounds → natural support/resistance
  if (intel?.expectedMove) {
    const em = intel.expectedMove;
    if (em.upperBound) {
      levels.push({
        price: em.upperBound,
        type: 'RESISTANCE',
        source: 'EXPECTED_MOVE',
        strength: 70,
        label: `$${em.upperBound.toFixed(0)} expected move upper bound`,
      });
    }
    if (em.lowerBound) {
      levels.push({
        price: em.lowerBound,
        type: 'SUPPORT',
        source: 'EXPECTED_MOVE',
        strength: 70,
        label: `$${em.lowerBound.toFixed(0)} expected move lower bound`,
      });
    }
  }

  // Deduplicate: merge levels within 0.3% of each other
  return deduplicateLevels(levels, spot);
}

function deduplicateLevels(levels: PsychLevel[], spot: number): PsychLevel[] {
  const threshold = spot * 0.003; // 0.3%
  const merged: PsychLevel[] = [];

  const sorted = [...levels].sort((a, b) => a.price - b.price);
  for (const lvl of sorted) {
    const existing = merged.find(m => Math.abs(m.price - lvl.price) < threshold);
    if (existing) {
      // Keep the stronger one, boost strength
      if (lvl.strength > existing.strength) {
        existing.price = lvl.price;
        existing.label = lvl.label;
        existing.source = lvl.source;
      }
      existing.strength = Math.min(100, existing.strength + 15); // Confluence bonus
    } else {
      merged.push({ ...lvl });
    }
  }

  return merged;
}

// ─── Signal Correlator ───────────────────────────────────────

function correlateSignals(
  symbol: string,
  spot: number,
  gexVex: ProjectorResult | null,
  geoMatrix: ScenarioMatrix | null,
  intel: any,
): SignalCorrelation[] {
  const signals: SignalCorrelation[] = [];

  // 1. GEX Regime
  if (gexVex) {
    const regime = gexVex.regime.type;
    const gexDir = regime === 'POSITIVE' ? 'BULLISH' : regime === 'NEGATIVE' ? 'BEARISH' : 'NEUTRAL';
    signals.push({
      signal: 'GEX Regime',
      direction: gexDir,
      weight: SIGNAL_WEIGHTS.gexRegime,
      detail: regime === 'POSITIVE'
        ? `Positive gamma — dealers dampen moves, mean-revert to $${gexVex.levels.gexAnchor || '?'}`
        : regime === 'NEGATIVE'
        ? `Negative gamma — dealers amplify moves, momentum environment`
        : 'Neutral gamma — no clear dealer bias',
    });
  }

  // 2. VEX Bias
  if (gexVex?.levels.vexAnchor) {
    const vexDir = gexVex.levels.vexAnchor > spot ? 'BULLISH' : 'BEARISH';
    signals.push({
      signal: 'Vanna Exposure',
      direction: vexDir,
      weight: SIGNAL_WEIGHTS.vexBias,
      detail: `VEX magnet at $${gexVex.levels.vexAnchor} — if IV compresses, price pulls toward this level`,
    });
  }

  // 3. Momentum (RSI + EMA from intel)
  if (intel?.momentum) {
    const m = intel.momentum;
    const momDir = m.regime === 'bullish' || m.emaAlignment === 'bullish'
      ? 'BULLISH'
      : m.regime === 'bearish' || m.emaAlignment === 'bearish'
      ? 'BEARISH'
      : 'NEUTRAL';
    signals.push({
      signal: 'Momentum',
      direction: momDir,
      weight: SIGNAL_WEIGHTS.momentum,
      detail: `RSI ${m.rsi?.toFixed(0) || '?'} | EMA ${m.emaAlignment || '?'} | ${m.tradingAdvice || m.regime}`,
    });
  }

  // 4. VIX Regime
  if (intel?.vixRegime) {
    const v = intel.vixRegime;
    const vixDir = v.regime?.regime === 'complacency' ? 'BULLISH'
      : v.regime?.regime === 'fear' || v.regime?.regime === 'panic' ? 'BEARISH'
      : 'NEUTRAL';
    signals.push({
      signal: 'VIX Regime',
      direction: vixDir,
      weight: SIGNAL_WEIGHTS.vixRegime,
      detail: `VIX ${v.vix?.toFixed(1)} (${v.regime?.regime || 'unknown'}) | ${v.termStructure || ''}`,
    });
  }

  // 5. Unified Score (if available)
  if (intel?.unifiedScore) {
    const u = intel.unifiedScore;
    const scoreDir = u.direction?.toUpperCase() === 'BULLISH' ? 'BULLISH'
      : u.direction?.toUpperCase() === 'BEARISH' ? 'BEARISH'
      : 'NEUTRAL';
    signals.push({
      signal: 'Intelligence Score',
      direction: scoreDir,
      weight: SIGNAL_WEIGHTS.flowBias,
      detail: `Score ${u.score}/100 — ${u.thesis || ''}`,
    });
  }

  // 6. PCR
  if (intel?.pcr) {
    const pcr = intel.pcr;
    const pcrDir = pcr.volumeRatio < 0.8 ? 'BULLISH'
      : pcr.volumeRatio > 1.2 ? 'BEARISH'
      : 'NEUTRAL';
    signals.push({
      signal: 'Put/Call Ratio',
      direction: pcrDir,
      weight: 5,
      detail: `PCR ${pcr.volumeRatio?.toFixed(2)} — ${pcr.interpretation || ''}`,
    });
  }

  // 7. Geopolitical overlay
  if (geoMatrix?.currentConditions) {
    const active = geoMatrix.currentConditions.activeScenarios;
    const risk = geoMatrix.currentConditions.geopoliticalRisk;
    if (active.length > 0) {
      const activeScenarios = geoMatrix.scenarios.filter(s => active.includes(s.id));
      // Check net impact on this symbol's asset class
      let netGeoImpact = 0;
      for (const scenario of activeScenarios) {
        const assetReaction = scenario.reactions.find(r => r.asset === symbol);
        if (assetReaction) {
          netGeoImpact += assetReaction.move24h;
        }
      }
      const geoDir = netGeoImpact > 0.3 ? 'BULLISH' : netGeoImpact < -0.3 ? 'BEARISH' : 'NEUTRAL';
      signals.push({
        signal: 'Geopolitical',
        direction: geoDir,
        weight: SIGNAL_WEIGHTS.geopolitical,
        detail: `${active.length} active scenario(s), risk: ${risk}. Net ${symbol} impact: ${netGeoImpact > 0 ? '+' : ''}${netGeoImpact.toFixed(1)}%`,
      });
    }
  }

  return signals;
}

// ─── Trade Setup Builder ─────────────────────────────────────

function buildTradeSetups(
  spot: number,
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  support: PsychLevel | null,
  resist: PsychLevel | null,
  gexVex: ProjectorResult | null,
  confidence: number,
  dailyEM: number = spot * 0.01,
): TradeSetup[] {
  const setups: TradeSetup[] = [];

  // Grade based on confidence + signal alignment
  function gradeFromConf(c: number): TradeSetup['grade'] {
    if (c >= 80) return 'A+';
    if (c >= 65) return 'A';
    if (c >= 50) return 'B+';
    if (c >= 35) return 'B';
    if (c >= 20) return 'C';
    return 'D';
  }

  // Minimum thresholds to avoid noise setups
  const minTargetDist = dailyEM * 0.4;    // Target must be at least 0.4× daily EM from entry
  const MIN_RR = 1.5;                      // Don't show any setup worse than 1.5:1 R:R

  // Day trade setup — skip if T1 is too close to spot (noise)
  if (direction === 'BULLISH' && resist) {
    // If T1 resist is too close to spot, extend target to next meaningful level
    let target = resist.price;
    if (Math.abs(target - spot) < minTargetDist) {
      // Use spot + 0.5× daily EM as minimum meaningful target
      target = spot + dailyEM * 0.5;
    }
    const stop = support ? support.price : spot - dailyEM * 0.5;
    const reward = target - spot;
    const risk = spot - stop;
    const rrNum = risk > 0 ? reward / risk : 0;
    if (rrNum >= MIN_RR) {
      setups.push({
        direction: 'LONG',
        timeframe: 'DAY',
        entry: spot,
        target: Math.round(target * 100) / 100,
        stop: Math.round(stop * 100) / 100,
        riskReward: `${rrNum.toFixed(1)}:1`,
        grade: gradeFromConf(confidence),
        rules: [
          `Entry near $${spot.toFixed(0)}, target $${target.toFixed(0)}`,
          `Stop below $${stop.toFixed(0)} | R:R ${rrNum.toFixed(1)}:1`,
          `Target +${((target - spot) / spot * 100).toFixed(1)}%, Stop -${(risk / spot * 100).toFixed(1)}%`,
          'EOD exit if no momentum toward target',
        ],
      });
    }
  } else if (direction === 'BEARISH' && support) {
    let target = support.price;
    if (Math.abs(spot - target) < minTargetDist) {
      target = spot - dailyEM * 0.5;
    }
    const stop = resist ? resist.price : spot + dailyEM * 0.5;
    const reward = spot - target;
    const risk = stop - spot;
    const rrNum = risk > 0 ? reward / risk : 0;
    if (rrNum >= MIN_RR) {
      setups.push({
        direction: 'SHORT',
        timeframe: 'DAY',
        entry: spot,
        target: Math.round(target * 100) / 100,
        stop: Math.round(stop * 100) / 100,
        riskReward: `${rrNum.toFixed(1)}:1`,
        grade: gradeFromConf(confidence),
        rules: [
          `Entry near $${spot.toFixed(0)}, target $${target.toFixed(0)}`,
          `Stop above $${stop.toFixed(0)} | R:R ${rrNum.toFixed(1)}:1`,
          `Target +${((spot - target) / spot * 100).toFixed(1)}%, Stop -${(risk / spot * 100).toFixed(1)}%`,
          'EOD exit if no momentum toward target',
        ],
      });
    }
  }

  // Swing setup using GEX+VEX targets, scaled by expected move
  // If GEX target is within 0.3% of spot (noise), extend to at least 1× daily EM
  if (gexVex) {
    const upTarget = gexVex.targets.primaryUpside;
    const downTarget = gexVex.targets.primaryDownside;
    const minMoveUp = spot + dailyEM * 0.75;   // At least 0.75× daily EM for a meaningful target
    const minMoveDn = spot - dailyEM * 0.75;

    if (direction !== 'BEARISH' && upTarget) {
      // If GEX target is too close, use expected-move-scaled target
      const rawTarget = upTarget.price;
      const target = Math.abs(rawTarget - spot) < minTargetDist ? Math.max(minMoveUp, spot + dailyEM) : rawTarget;
      // Stop: tighten to 0.4× EM below entry for better R:R (vs old 0.5×)
      const swingStop = support ? Math.max(support.price, spot - dailyEM * 0.4) : spot - dailyEM * 0.4;
      const reward = target - spot;
      const risk = spot - swingStop;
      const rrNum = risk > 0 ? reward / risk : 0;
      if (rrNum >= MIN_RR) {
        setups.push({
          direction: 'LONG',
          timeframe: 'SWING',
          entry: spot,
          target: Math.round(target * 100) / 100,
          stop: Math.round(swingStop * 100) / 100,
          riskReward: `${rrNum.toFixed(1)}:1`,
          grade: gradeFromConf(Math.min(confidence, upTarget.strength)),
          rules: [
            `GEX+VEX target $${target.toFixed(0)} (${((target - spot) / spot * 100).toFixed(1)}% upside)`,
            `Gamma: ${gexVex.regime.type} — ${gexVex.regime.tradingBias}`,
            `EM ±$${dailyEM.toFixed(0)}/day | Stop $${swingStop.toFixed(0)}`,
          ],
        });
      }
    }

    if (direction !== 'BULLISH' && downTarget) {
      const rawTarget = downTarget.price;
      const target = Math.abs(rawTarget - spot) < minTargetDist ? Math.min(minMoveDn, spot - dailyEM) : rawTarget;
      const swingStop = resist ? Math.min(resist.price, spot + dailyEM * 0.4) : spot + dailyEM * 0.4;
      const reward = spot - target;
      const risk = swingStop - spot;
      const rrNum = risk > 0 ? reward / risk : 0;
      if (rrNum >= MIN_RR) {
        setups.push({
          direction: 'SHORT',
          timeframe: 'SWING',
          entry: spot,
          target: Math.round(target * 100) / 100,
          stop: Math.round(swingStop * 100) / 100,
          riskReward: `${rrNum.toFixed(1)}:1`,
          grade: gradeFromConf(Math.min(confidence, downTarget.strength)),
          rules: [
            `GEX+VEX target $${target.toFixed(0)} (${((spot - target) / spot * 100).toFixed(1)}% downside)`,
            `Gamma: ${gexVex.regime.type} — ${gexVex.regime.tradingBias}`,
            `EM ±$${dailyEM.toFixed(0)}/day | Stop $${swingStop.toFixed(0)}`,
          ],
        });
      }
    }
  }

  return setups;
}

// ─── Geopolitical Active Scenarios ───────────────────────────

function getActiveScenarios(
  symbol: string,
  geoMatrix: ScenarioMatrix | null,
): UnifiedPrediction['activeScenarios'] {
  if (!geoMatrix) return [];

  const activeIds = geoMatrix.currentConditions?.activeScenarios || [];
  return geoMatrix.scenarios
    .filter(s => activeIds.includes(s.id))
    .map(s => {
      const reaction = s.reactions.find(r => r.asset === symbol);
      const move = reaction ? reaction.move24h : 0;
      return {
        id: s.id,
        name: s.name,
        icon: s.icon,
        likelihood: s.likelihood,
        impact: reaction
          ? `${symbol} ${move > 0 ? '+' : ''}${move.toFixed(1)}% if triggered`
          : 'No direct impact modeled',
      };
    });
}

// ─── Narrative Builder ───────────────────────────────────────

function buildCorrelationNarrative(
  symbol: string,
  spot: number,
  direction: string,
  confidence: number,
  signals: SignalCorrelation[],
  support: PsychLevel | null,
  resist: PsychLevel | null,
  gexVex: ProjectorResult | null,
  activeScenarios: UnifiedPrediction['activeScenarios'],
): string {
  const parts: string[] = [];

  // Lead with direction
  const dirWord = direction === 'BULLISH' ? 'bullish' : direction === 'BEARISH' ? 'bearish' : 'neutral';
  const bullCount = signals.filter(s => s.direction === 'BULLISH').length;
  const bearCount = signals.filter(s => s.direction === 'BEARISH').length;
  parts.push(
    `${symbol} at $${spot.toFixed(2)} shows a ${dirWord} bias with ${confidence}% confidence. ` +
    `${bullCount} signal${bullCount !== 1 ? 's' : ''} bullish, ${bearCount} bearish out of ${signals.length} total.`
  );

  // Key levels
  if (resist && support) {
    parts.push(
      `Key range: $${support.price.toFixed(0)} support (${support.source}) to $${resist.price.toFixed(0)} resistance (${resist.source}).`
    );
  }

  // GEX context
  if (gexVex) {
    const regime = gexVex.regime;
    if (regime.type === 'POSITIVE') {
      parts.push(`Positive gamma environment — moves should be contained. Fade breakouts, buy dips near $${gexVex.levels.gexAnchor || '?'}.`);
    } else if (regime.type === 'NEGATIVE') {
      parts.push(`Negative gamma — momentum amplified. Trend-follow, don't fade. Watch flip at $${gexVex.levels.gexFlip || '?'}.`);
    }
  }

  // Geopolitical
  if (activeScenarios.length > 0) {
    parts.push(
      `Active geopolitical risks: ${activeScenarios.map(s => `${s.icon} ${s.name} (${s.impact})`).join(', ')}.`
    );
  }

  // Signal conflicts
  const conflicting = signals.filter(s => s.direction !== direction && s.direction !== 'NEUTRAL');
  if (conflicting.length > 0) {
    parts.push(
      `Conflicting signals: ${conflicting.map(s => `${s.signal} (${s.direction.toLowerCase()})`).join(', ')}. Reduce size or wait for resolution.`
    );
  }

  return parts.join(' ');
}

// ─── Prediction Text ─────────────────────────────────────────

function buildPredictionText(
  symbol: string,
  spot: number,
  direction: string,
  support: PsychLevel | null,
  resist: PsychLevel | null,
  gexVex: ProjectorResult | null,
  expectedMove?: { daily: number; timeframeEM?: number; timeframeLabel?: string; vixLevel: number; vixRegime: string } | null,
): string {
  const em = expectedMove?.timeframeEM || expectedMove?.daily || spot * 0.015;
  const tfLabel = expectedMove?.timeframeLabel || 'daily';
  const vixTag = expectedMove ? ` VIX ${expectedMove.vixLevel.toFixed(1)} → ±$${em.toFixed(1)}/${tfLabel}.` : '';
  const regime = gexVex?.regime.type;
  const proj = gexVex?.projectionRange;

  // Use projection range + psych levels for targets
  // Psych levels (round numbers, prior S/R) override pure EM bounds when they're within range
  if (direction === 'BULLISH') {
    // Upside target: prefer T1 resistance if within 2× EM, else use projection upper bound
    const projUp = proj ? proj.upperBound : spot + em;
    const resistTarget = resist && resist.price > spot && resist.price <= spot + em * 2 ? resist.price : null;
    const target = resistTarget || Math.min(projUp, spot + em * 2);
    // Pullback: T1 support or projection lower bound
    const pullback = support?.price || (proj ? proj.lowerBound : spot - em * 0.5);
    return `${symbol} bullish toward $${target.toFixed(0)}, buy dips near $${pullback.toFixed(0)}.` + vixTag +
      (regime === 'POSITIVE' ? ' Positive gamma dampens — fade failed breakouts.' : '');
  }
  if (direction === 'BEARISH') {
    // Downside target: prefer T1 support if within 2× EM, else use projection lower bound
    const projDn = proj ? proj.lowerBound : spot - em;
    const supportTarget = support && support.price < spot && support.price >= spot - em * 2 ? support.price : null;
    const target = supportTarget || Math.max(projDn, spot - em * 2);
    // Sell rips near: T1 resistance (where bulls try to push) or projection upper bound
    const bounce = resist?.price || (proj ? proj.upperBound : spot + em * 0.5);
    return `${symbol} bearish toward $${target.toFixed(0)}, sell rips near $${bounce.toFixed(0)}.` + vixTag +
      (regime === 'NEGATIVE' ? ' Negative gamma amplifies — momentum accelerates.' : '');
  }

  // NEUTRAL — use projection range to show the thesis
  if (proj) {
    const rangeStr = `$${proj.lowerBound.toFixed(0)}-$${proj.upperBound.toFixed(0)}`;
    if (regime === 'POSITIVE') {
      return `${symbol} pinned near $${proj.magnetPrice.toFixed(0)}, range ${rangeStr}.` + vixTag +
        ` Dealers dampen moves — fade extremes, mean-revert to anchor.`;
    }
    if (regime === 'NEGATIVE') {
      return `${symbol} momentum range ${rangeStr}, magnet $${proj.magnetPrice.toFixed(0)}.` + vixTag +
        ` Negative gamma — dealers amplify the trend.`;
    }
    return `${symbol} range-bound ${rangeStr}.` + vixTag + ` No strong directional bias — fade extremes or wait for breakout.`;
  }

  const lo = support?.price || spot - em;
  const hi = resist?.price || spot + em;
  return `${symbol} in a range between $${lo.toFixed(0)} and $${hi.toFixed(0)}.` + vixTag;
}

// ─── Multi-Horizon Probability Engine ────────────────────────
// Replaces simple directional scoring with a probability surface:
//   1. Build level map — every gamma level + round number + EM bound with gamma %
//   2. For each level, compute P(price reaches level) using distance/EM + signal bias
//   3. Signal weights shift the probability distribution (Bayesian-style)
//   4. Target = highest-probability reachable level (not EM × constant)
//   5. Synthesize all horizons into a final weighted prediction

/** Compute probability of price reaching a level within N days using log-normal assumption */
function levelReachProbability(spot: number, target: number, em: number, daysHorizon: number): number {
  if (em <= 0 || daysHorizon <= 0) return 0;
  const horizonEM = em * Math.sqrt(daysHorizon);
  if (horizonEM <= 0) return 0;
  const distance = Math.abs(target - spot);
  // Use complementary CDF of normal distribution (1 - Φ(z))
  // z = distance / horizonEM gives us how many standard deviations away
  const z = distance / horizonEM;
  // Approximate Φ(z) using Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.8212560 + t * 1.3302744))));
  // P(touch) for a random walk is ~2× the tail probability (reflection principle)
  const touchProb = Math.min(95, Math.max(2, p * 2 * 100));
  return Math.round(touchProb);
}

/** Build all candidate levels from GEX/VEX data + round numbers + EM bounds */
function buildCandidateLevels(
  spot: number,
  em: number,
  horizonDays: number,
  gexVexResult: any,
): LevelProbability[] {
  const levels: LevelProbability[] = [];
  const horizonEM = em * Math.sqrt(horizonDays);
  const gammaConc: { strike: number; percent: number; netGEX: number }[] =
    gexVexResult?.levels?.gammaConcentration || [];

  // Helper: find gamma % for a given strike
  function gammaAt(price: number): number {
    const entry = gammaConc.find(g => Math.abs(g.strike - price) < price * 0.002);
    return entry?.percent || 0;
  }

  if (gexVexResult) {
    // Call walls (upside resistance)
    for (const wall of (gexVexResult.levels?.callWalls || [])) {
      if (wall > spot && wall <= spot + horizonEM * 3) {
        levels.push({
          price: wall,
          label: `Call Wall $${wall}`,
          probability: levelReachProbability(spot, wall, em, horizonDays),
          gammaPercent: gammaAt(wall),
          type: 'CALL_WALL',
          direction: 'UPSIDE',
        });
      }
    }

    // Put walls (downside support)
    for (const wall of (gexVexResult.levels?.putWalls || [])) {
      if (wall < spot && wall >= spot - horizonEM * 3) {
        levels.push({
          price: wall,
          label: `Put Wall $${wall}`,
          probability: levelReachProbability(spot, wall, em, horizonDays),
          gammaPercent: gammaAt(wall),
          type: 'PUT_WALL',
          direction: 'DOWNSIDE',
        });
      }
    }

    // GEX anchor (magnet — where price gets pulled to)
    if (gexVexResult.levels?.gexAnchor) {
      const anchor = gexVexResult.levels.gexAnchor;
      levels.push({
        price: anchor,
        label: `GEX Anchor $${anchor}`,
        probability: levelReachProbability(spot, anchor, em, horizonDays),
        gammaPercent: gammaAt(anchor),
        type: 'GEX_ANCHOR',
        direction: anchor >= spot ? 'UPSIDE' : 'DOWNSIDE',
      });
    }

    // Gamma flip (regime change level)
    if (gexVexResult.levels?.gexFlip) {
      const flip = gexVexResult.levels.gexFlip;
      if (Math.abs(flip - spot) <= horizonEM * 3) {
        levels.push({
          price: flip,
          label: `Gamma Flip $${flip}`,
          probability: levelReachProbability(spot, flip, em, horizonDays),
          gammaPercent: gammaAt(flip),
          type: 'GAMMA_FLIP',
          direction: flip >= spot ? 'UPSIDE' : 'DOWNSIDE',
        });
      }
    }

    // VEX magnets
    for (const mag of (gexVexResult.levels?.vannaAttractors || [])) {
      if (Math.abs(mag - spot) <= horizonEM * 3) {
        levels.push({
          price: mag,
          label: `VEX Magnet $${mag}`,
          probability: levelReachProbability(spot, mag, em, horizonDays),
          gammaPercent: gammaAt(mag),
          type: 'VEX_MAGNET',
          direction: mag >= spot ? 'UPSIDE' : 'DOWNSIDE',
        });
      }
    }
  }

  // EM bounds (1σ expected move range)
  const emHigh = spot + horizonEM;
  const emLow = spot - horizonEM;
  levels.push({
    price: Math.round(emHigh * 100) / 100,
    label: `EM Upper $${emHigh.toFixed(0)}`,
    probability: 32, // ~32% probability of exceeding 1σ
    gammaPercent: gammaAt(emHigh),
    type: 'EM_BOUND',
    direction: 'UPSIDE',
  });
  levels.push({
    price: Math.round(emLow * 100) / 100,
    label: `EM Lower $${emLow.toFixed(0)}`,
    probability: 32,
    gammaPercent: gammaAt(emLow),
    type: 'EM_BOUND',
    direction: 'DOWNSIDE',
  });

  // Round numbers within range
  const roundStep = spot > 200 ? 5 : spot > 50 ? 2.5 : 1;
  const rangeLow = spot - horizonEM * 2;
  const rangeHigh = spot + horizonEM * 2;
  for (let p = Math.ceil(rangeLow / roundStep) * roundStep; p <= rangeHigh; p += roundStep) {
    if (Math.abs(p - spot) < roundStep * 0.3) continue; // Skip if too close to spot
    // Don't duplicate if already have a gamma level within 0.3%
    const alreadyHave = levels.some(l => Math.abs(l.price - p) < spot * 0.003);
    if (!alreadyHave) {
      levels.push({
        price: p,
        label: `$${p} Round`,
        probability: levelReachProbability(spot, p, em, horizonDays),
        gammaPercent: gammaAt(p),
        type: 'ROUND',
        direction: p >= spot ? 'UPSIDE' : 'DOWNSIDE',
      });
    }
  }

  return levels.sort((a, b) => b.probability - a.probability);
}

/** Apply signal biases to shift probabilities (Bayesian update) */
function applySignalBias(
  levels: LevelProbability[],
  signalBias: number, // -1 to +1 (bearish to bullish)
  regime: string,     // POSITIVE, NEGATIVE, NEUTRAL
  vixContext?: { level: number; change: number; regime: string },
): LevelProbability[] {
  return levels.map(l => {
    let adjusted = l.probability;

    // Signal bias shifts probabilities: bullish signals boost upside, reduce downside
    if (l.direction === 'UPSIDE') {
      adjusted *= (1 + signalBias * 0.4); // Up to ±40% shift
    } else {
      adjusted *= (1 - signalBias * 0.4);
    }

    // ── VIX Regime Effect ──
    // EXTREME_FEAR/FEAR: downside more likely, upside harder (fear = selling pressure)
    // COMPLACENT: upside more likely (low vol = grind higher)
    // VIX change: rising VIX = boost far targets (vol expanding), falling = tighten
    if (vixContext) {
      const { level: vix, change: vixChg, regime: vixReg } = vixContext;

      // VIX regime probability shift
      if (vixReg === 'EXTREME_FEAR' || vixReg === 'FEAR') {
        // Fear regimes: downside targets become 25-35% more likely, upside 15-25% less
        const fearMultiplier = vixReg === 'EXTREME_FEAR' ? 1.35 : 1.25;
        if (l.direction === 'DOWNSIDE') {
          adjusted *= fearMultiplier;
        } else {
          adjusted *= (2 - fearMultiplier); // inverse: 0.65 or 0.75
        }
      } else if (vixReg === 'COMPLACENT') {
        // Low vol grind: upside 20% more likely, downside 20% less
        if (l.direction === 'UPSIDE') adjusted *= 1.2;
        else adjusted *= 0.8;
      }
      // ELEVATED (18-25): slight downside bias
      else if (vixReg === 'ELEVATED' && vix > 20) {
        if (l.direction === 'DOWNSIDE') adjusted *= 1.1;
        else adjusted *= 0.95;
      }

      // VIX velocity: rising VIX = vol expansion → far targets more reachable
      // Falling VIX = vol compression → far targets less reachable
      if (Math.abs(vixChg) > 0.5) {
        // vixChg > 0 = VIX rising = more volatile
        // Far levels (high base probability already means close, so invert — low prob = far)
        const isFarLevel = l.probability < 50;
        if (vixChg > 1 && isFarLevel) {
          // Rising VIX: far levels become 10-20% more reachable
          adjusted *= (1 + Math.min(0.2, vixChg * 0.05));
        } else if (vixChg < -1 && isFarLevel) {
          // Falling VIX: far levels become 10-15% less reachable
          adjusted *= (1 + Math.max(-0.15, vixChg * 0.03));
        }
      }
    }

    // ── Gamma Regime Effect ──
    // POSITIVE gamma = mean-revert → boost anchor probability, reduce far targets
    // NEGATIVE gamma = momentum → boost far targets, reduce anchor
    if (regime === 'POSITIVE') {
      if (l.type === 'GEX_ANCHOR') {
        adjusted *= 1.4; // Anchor is 40% more likely in positive gamma
      } else if (l.type === 'CALL_WALL' || l.type === 'PUT_WALL') {
        adjusted *= 0.8; // Walls are harder to reach (dealers dampen)
      }
      // Gamma concentration acts as resistance — high gamma % = harder to break through
      if (l.gammaPercent > 15) {
        adjusted *= (1 - l.gammaPercent * 0.005);
      }
    } else if (regime === 'NEGATIVE') {
      if (l.type === 'GEX_ANCHOR') {
        adjusted *= 0.7; // Anchor less sticky in negative gamma
      } else if (l.type === 'CALL_WALL' || l.type === 'PUT_WALL') {
        adjusted *= 1.3; // Walls get blown through (dealers amplify)
      }
      if (l.gammaPercent > 15) {
        adjusted *= (1 + l.gammaPercent * 0.003);
      }
    }

    return { ...l, probability: Math.round(Math.max(1, Math.min(95, adjusted))) };
  }).sort((a, b) => b.probability - a.probability);
}

/** Compute a single horizon's outlook using probability surface */
function computeSingleHorizon(
  spot: number,
  dailyEM: number,
  horizonDays: number,
  horizonName: 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH',
  horizonLabel: string,
  signalWeights: { gex: number; vix: number; flow: number; geo: number; mom: number },
  gexVexResult: any,
  signals: {
    gexDir: number; vixDir: number; flowDir: number; geoDir: number; momDir: number;
    pcr: number; flowBias: string; vixLevel: number; vixChange: number; vixRegime: string;
  },
  symbol: string,
): HorizonProjection {
  // ── VIX-adjusted EM: rising VIX expands range, falling VIX compresses ──
  // VIX velocity adjustment: +5% EM per VIX point gained, -3% per point lost (asymmetric — fear expands faster)
  const vixVelocityMult = signals.vixChange > 0.5
    ? 1 + Math.min(0.25, signals.vixChange * 0.05)   // Rising: up to +25% EM expansion
    : signals.vixChange < -0.5
    ? 1 + Math.max(-0.15, signals.vixChange * 0.03)   // Falling: up to -15% EM compression
    : 1;
  const horizonEM = dailyEM * Math.sqrt(horizonDays) * vixVelocityMult;
  const regime = gexVexResult?.regime?.type || 'NEUTRAL';

  // Build candidate levels for this horizon
  const rawLevels = buildCandidateLevels(spot, dailyEM, horizonDays, gexVexResult);

  // Compute weighted signal bias (-1 to +1)
  const totalWeight = signalWeights.gex + signalWeights.vix + signalWeights.flow + signalWeights.geo + signalWeights.mom;
  const signalBias = totalWeight > 0 ? (
    signals.gexDir * signalWeights.gex +
    signals.vixDir * signalWeights.vix +
    signals.flowDir * signalWeights.flow +
    signals.geoDir * signalWeights.geo +
    signals.momDir * signalWeights.mom
  ) / totalWeight : 0;

  // Apply Bayesian signal bias + VIX regime to level probabilities
  const vixContext = { level: signals.vixLevel, change: signals.vixChange, regime: signals.vixRegime };
  const levels = applySignalBias(rawLevels, signalBias, regime, vixContext);

  // Separate upside/downside — EXCLUDE levels within 0.15% of spot (they're AT spot, not directional)
  const minDirDist = spot * 0.0015;
  const upsideLevels = levels.filter(l => l.direction === 'UPSIDE' && l.price - spot > minDirDist)
    .sort((a, b) => b.probability - a.probability);
  const downsideLevels = levels.filter(l => l.direction === 'DOWNSIDE' && spot - l.price > minDirDist)
    .sort((a, b) => b.probability - a.probability);

  // Compute directional probabilities from level reachability
  // Sum of top 3 upside vs downside probabilities, normalized
  const topUpProb = upsideLevels.slice(0, 3).reduce((s, l) => s + l.probability, 0);
  const topDownProb = downsideLevels.slice(0, 3).reduce((s, l) => s + l.probability, 0);
  const totalProb = topUpProb + topDownProb || 1;

  let bullishProb = Math.round((topUpProb / totalProb) * 100);
  let bearishProb = Math.round((topDownProb / totalProb) * 100);

  // ── PCR Override: Time-horizon aware ──
  // TODAY only: High PCR + positive gamma = contrarian bullish (intraday dealer unwind)
  // WEEK/MONTH: High PCR = genuine institutional hedging = BEARISH regardless of gamma
  // This is the key insight: PCR 1.95 on a daily basis is noise. Over a week/month, it's the real signal.
  if (signals.pcr > 1.5) {
    if (horizonName === 'TODAY' && regime === 'POSITIVE') {
      // Intraday contrarian: dealers will push price up short-term
      bullishProb = Math.min(80, bullishProb + 8);
      bearishProb = Math.max(15, bearishProb - 8);
    } else {
      // Week/month: extreme put positioning = institutional fear = BEARISH
      const pcrPenalty = signals.pcr > 1.8 ? 20 : signals.pcr > 1.5 ? 12 : 0;
      bearishProb = Math.min(85, bearishProb + pcrPenalty);
      bullishProb = Math.max(15, bullishProb - pcrPenalty);
    }
  } else if (signals.pcr < 0.7) {
    bullishProb = Math.min(80, bullishProb + 10);
    bearishProb = Math.max(15, bearishProb - 10);
  }

  // ── VIX Level Override: High VIX = bearish for longer horizons ──
  // VIX > 25 = FEAR zone — Week and Month should skew bearish even more
  if (signals.vixLevel >= 25 && horizonName !== 'TODAY') {
    const vixPenalty = signals.vixLevel >= 35 ? 15 : signals.vixLevel >= 30 ? 10 : 5;
    bearishProb = Math.min(85, bearishProb + vixPenalty);
    bullishProb = Math.max(15, bullishProb - vixPenalty);
  }

  // Ensure they sum to 100
  const neutralProb = Math.max(0, 100 - bullishProb - bearishProb);
  const probTotal = bullishProb + bearishProb + neutralProb;
  bullishProb = Math.round(bullishProb / probTotal * 100);
  bearishProb = Math.round(bearishProb / probTotal * 100);
  const neutralProbFinal = 100 - bullishProb - bearishProb;

  // Direction from probabilities (lowered threshold from 15 → 8 for clearer signals)
  const direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    bullishProb > bearishProb + 8 ? 'BULLISH' :
    bearishProb > bullishProb + 8 ? 'BEARISH' : 'NEUTRAL';

  // Target = highest-probability REAL level in the winning direction
  // Must be far enough from spot to be a meaningful target (scales with horizon)
  // Hard cap: NO target can exceed 3× horizon EM from spot (VIX-implied max move)
  const minTargetDist = horizonName === 'TODAY' ? Math.max(spot * 0.003, horizonEM * 0.3) :
                        horizonName === 'THIS_WEEK' ? horizonEM * 0.4 :
                        horizonEM * 0.5;
  const maxTargetDist = horizonEM * 3; // Hard cap: 3σ move is 99.7% boundary
  let target = spot;
  let mostLikelyPath = '';

  if (direction === 'BULLISH' && upsideLevels.length > 0) {
    // Filter: far enough from spot AND within VIX-implied max move (3σ hard cap)
    const reachable = upsideLevels.filter(l =>
      l.price - spot >= minTargetDist && l.price - spot <= maxTargetDist
    );
    // Prefer gamma levels over round numbers
    const gammaTargets = reachable.filter(l => l.type !== 'ROUND' && l.type !== 'EM_BOUND');
    const bestTarget = gammaTargets[0] || reachable[0];
    if (bestTarget) {
      target = bestTarget.price;
    } else {
      // No gamma level in range — use EM-scaled target
      const emScale = horizonName === 'TODAY' ? 0.5 : horizonName === 'THIS_WEEK' ? 0.6 : 0.5;
      target = spot + horizonEM * emScale;
      // Snap to nearest round number if within $2
      const roundStep = spot > 200 ? 5 : spot > 50 ? 2.5 : 1;
      const nearestRound = Math.round(target / roundStep) * roundStep;
      if (Math.abs(target - nearestRound) <= 2) target = nearestRound;
    }
    // Hard cap enforcement: never exceed 3× EM from spot
    target = Math.min(target, spot + maxTargetDist);
    // Path: describe the journey through the nearest reachable levels
    const pathLevels = upsideLevels.filter(l => l.price > spot && l.price <= spot + maxTargetDist)
      .sort((a, b) => a.price - b.price).slice(0, 3);
    const path = pathLevels.map(l =>
      `$${l.price} (${l.label.split(' ')[0]} ${l.label.split(' ')[1]}, ${l.probability}%)`
    );
    mostLikelyPath = `${bullishProb}% → ${path.join(' → ')}`;
  } else if (direction === 'BEARISH' && downsideLevels.length > 0) {
    const reachable = downsideLevels.filter(l =>
      spot - l.price >= minTargetDist && spot - l.price <= maxTargetDist
    );
    const gammaTargets = reachable.filter(l => l.type !== 'ROUND' && l.type !== 'EM_BOUND');
    const bestTarget = gammaTargets[0] || reachable[0];
    if (bestTarget) {
      target = bestTarget.price;
    } else {
      const emScale = horizonName === 'TODAY' ? 0.5 : horizonName === 'THIS_WEEK' ? 0.6 : 0.5;
      target = spot - horizonEM * emScale;
      const roundStep = spot > 200 ? 5 : spot > 50 ? 2.5 : 1;
      const nearestRound = Math.round(target / roundStep) * roundStep;
      if (Math.abs(target - nearestRound) <= 2) target = nearestRound;
    }
    // Hard cap enforcement
    target = Math.max(target, spot - maxTargetDist);
    const pathLevels = downsideLevels.filter(l => l.price < spot && spot - l.price <= maxTargetDist)
      .sort((a, b) => b.price - a.price).slice(0, 3);
    const path = pathLevels.map(l =>
      `$${l.price} (${l.label.split(' ')[0]} ${l.label.split(' ')[1]}, ${l.probability}%)`
    );
    mostLikelyPath = `${bearishProb}% → ${path.join(' → ')}`;
  } else {
    // Neutral: but check if it's "bearish-leaning neutral" or "bullish-leaning neutral"
    // If bearish prob > bullish prob even though neither crossed the +8 threshold,
    // lean target toward the downside (don't just pin to anchor/spot)
    const anchor = gexVexResult?.levels?.gexAnchor;
    if (bearishProb > bullishProb + 3 && downsideLevels.length > 0) {
      // Bearish-leaning neutral: target = halfway between spot and nearest downside level
      const nearDown = downsideLevels[0];
      target = nearDown ? Math.round(((spot + nearDown.price) / 2) * 100) / 100 : spot;
      mostLikelyPath = `${neutralProbFinal}% rangebound, leaning lower → $${target.toFixed(0)}`;
    } else if (bullishProb > bearishProb + 3 && upsideLevels.length > 0) {
      // Bullish-leaning neutral: target = halfway between spot and nearest upside level
      const nearUp = upsideLevels[0];
      target = nearUp ? Math.round(((spot + nearUp.price) / 2) * 100) / 100 : spot;
      mostLikelyPath = `${neutralProbFinal}% rangebound, leaning higher → $${target.toFixed(0)}`;
    } else {
      target = (anchor && Math.abs(anchor - spot) >= spot * 0.002) ? anchor : spot;
      mostLikelyPath = `${neutralProbFinal}% rangebound near $${target.toFixed(0)}`;
    }
  }

  // Confidence = how strong is the directional probability edge
  const probEdge = Math.abs(bullishProb - bearishProb);
  const confidence = Math.min(90, Math.max(15, probEdge + 10));

  // Build driver strings
  const drivers: string[] = [];
  if (regime !== 'NEUTRAL') drivers.push(`${regime} gamma (${regime === 'POSITIVE' ? 'dampens' : 'amplifies'} moves)`);
  if (signals.vixLevel > 0) drivers.push(`VIX ${signals.vixLevel.toFixed(0)} (${signals.vixRegime.toLowerCase()}) → ±$${horizonEM.toFixed(0)}/${horizonLabel.toLowerCase()}`);
  if (signals.flowBias !== 'BALANCED') drivers.push(`${signals.flowBias === 'CALL_HEAVY' ? 'Call' : 'Put'}-heavy flow (PCR ${signals.pcr.toFixed(2)})`);
  else if (signals.pcr !== 1) drivers.push(`PCR ${signals.pcr.toFixed(2)} (balanced)`);
  if (signals.geoDir !== 0) drivers.push(`Geo risk: ${signals.geoDir > 0 ? 'bullish' : 'bearish'}`);
  if (signals.momDir !== 0) drivers.push(`Momentum: ${signals.momDir > 0 ? 'bullish' : 'bearish'}`);

  return {
    horizon: horizonName,
    label: horizonLabel,
    direction,
    confidence,
    target: Math.round(target * 100) / 100,
    emRange: { low: Math.round((spot - horizonEM) * 100) / 100, high: Math.round((spot + horizonEM) * 100) / 100 },
    keyDriver: drivers[0] || 'No strong signal',
    signals: drivers,
    levelProbabilities: levels.slice(0, 10), // Top 10 levels by probability
    bullishProbability: bullishProb,
    bearishProbability: bearishProb,
    neutralProbability: neutralProbFinal,
    mostLikelyPath,
  };
}

function computeHorizonOutlook(
  spot: number,
  dailyEM: number,
  vixLevel: number,
  vixChange: number,
  vixRegime: string,
  gexVexResult: any,
  geoMatrix: any,
  signals: SignalCorrelation[],
  symbol: string,
): HorizonOutlook {
  // Extract signal directions as numeric values
  const gexSignal = signals.find(s => s.signal === 'GEX Regime');
  const vexSignal = signals.find(s => s.signal === 'Vanna Exposure');
  const momSignal = signals.find(s => s.signal === 'Momentum');
  const vixSignal = signals.find(s => s.signal === 'VIX Regime');
  const flowSignal = signals.find(s => s.signal === 'Put/Call Ratio') || signals.find(s => s.signal === 'Intelligence Score');
  const geoSignal = signals.find(s => s.signal === 'Geopolitical');

  const flowData = gexVexResult?.flowData;
  const pcr = flowData?.putCallRatio || 1;
  const flowBias = flowData?.flowBias || 'BALANCED';

  function dirNum(dir?: string): number {
    if (dir === 'BULLISH') return 1;
    if (dir === 'BEARISH') return -1;
    return 0;
  }

  // ── GEX Direction: CRITICAL FIX ──
  // Positive gamma ≠ BULLISH. It means dealers DAMPEN moves (mean-revert to anchor).
  // For TODAY: positive gamma = slightly bullish (buy dips, sell rips → supports price)
  // For WEEK/MONTH: positive gamma = NEUTRAL (just means low vol, no directional bias)
  // Negative gamma = directionally BEARISH (dealers amplify selling, momentum accelerates)
  const regime = gexVexResult?.regime?.type || 'NEUTRAL';
  const gexDirToday = regime === 'POSITIVE' ? 0.5 : regime === 'NEGATIVE' ? -1 : 0;
  const gexDirWeek = regime === 'POSITIVE' ? 0 : regime === 'NEGATIVE' ? -0.8 : 0;
  const gexDirMonth = regime === 'POSITIVE' ? 0 : regime === 'NEGATIVE' ? -0.5 : 0;

  // ── VIX Direction: Use actual level, not just regime label ──
  // VIX < 14 = complacent = bullish (+0.5)
  // VIX 14-17 = normal = neutral (0)
  // VIX 18-22 = elevated = mildly bearish (-0.3)
  // VIX 23-30 = fear = bearish (-0.7)
  // VIX > 30 = extreme fear = very bearish (-1)
  // VIX change: falling VIX = bullish (fear receding), rising = bearish
  const vixDirFromLevel = vixLevel >= 30 ? -1 : vixLevel >= 23 ? -0.7 :
    vixLevel >= 18 ? -0.3 : vixLevel >= 14 ? 0 : 0.5;
  const vixDirFromChange = vixChange < -2 ? 0.3 : vixChange < -0.5 ? 0.15 :
    vixChange > 2 ? -0.3 : vixChange > 0.5 ? -0.15 : 0;
  const vixDir = Math.max(-1, Math.min(1, vixDirFromLevel + vixDirFromChange));

  // ── PCR Flow Direction: More granular + extreme PCR override ──
  // PCR < 0.7 = strong call flow (+1)
  // PCR 0.7-0.9 = mild bullish (+0.5)
  // PCR 0.9-1.1 = neutral (0)
  // PCR 1.1-1.3 = mild bearish (-0.3)
  // PCR 1.3-1.7 = bearish (-0.6)
  // PCR > 1.7 = EXTREME put heavy (-1) — this is institutional hedging, very bearish
  const flowDir = pcr < 0.7 ? 1 : pcr < 0.9 ? 0.5 : pcr > 1.7 ? -1 :
    pcr > 1.3 ? -0.6 : pcr > 1.1 ? -0.3 : 0;

  // Build per-horizon signal objects (GEX direction differs by horizon)
  // ── Momentum: Time-horizon aware ──
  // A single-day relief rally (momentum BULLISH) should NOT carry into weekly/monthly outlook
  // when institutional fear signals (high PCR + high VIX) contradict it.
  // This is the "dead cat bounce" detector: if momentum is bullish but PCR > 1.3 and VIX > 20,
  // the rally is likely a short squeeze / relief bounce, not sustainable.
  const rawMomDir = dirNum(momSignal?.direction);
  const momDirToday = rawMomDir; // Intraday: momentum is momentum, respect it

  // Week: dampen bullish momentum when fear signals present (relief rally detection)
  // If momentum is bullish but PCR + VIX say fear → cap momentum at 0 (don't let bounce override fear)
  // If momentum is bearish → keep it (selloff momentum is real for weekly)
  const momDirWeek = (rawMomDir > 0 && pcr > 1.3 && vixLevel > 20)
    ? 0      // Relief rally: don't let single-day bounce override institutional positioning
    : (rawMomDir > 0 && pcr > 1.5 && vixLevel > 25)
    ? -0.3   // Extreme fear + bullish momentum = likely dead cat bounce → slight bearish bias
    : rawMomDir;

  // Month: even more conservative — single-day momentum is noise at monthly scale
  // Only respect momentum if it ALIGNS with flow direction (confirming trend, not counter-trend)
  const momDirMonth = (rawMomDir > 0 && flowDir < -0.3)
    ? 0      // Bullish momentum vs bearish flow → ignore momentum (noise)
    : (rawMomDir < 0 && flowDir < -0.3)
    ? rawMomDir * 1.2  // Bearish momentum + bearish flow → amplify (confirming trend, cap at -1)
    : rawMomDir * 0.5; // Otherwise halve it — monthly targets shouldn't swing on daily noise

  const todaySignals = {
    gexDir: gexDirToday, vixDir, flowDir,
    geoDir: dirNum(geoSignal?.direction),
    momDir: momDirToday,
    pcr, flowBias, vixLevel, vixChange, vixRegime,
  };
  const weekSignals = { ...todaySignals, gexDir: gexDirWeek, momDir: momDirWeek };
  const monthSignals = { ...todaySignals, gexDir: gexDirMonth, momDir: Math.max(-1, Math.min(1, momDirMonth)) };

  // ── Each horizon has different signal weights ──
  // TODAY: Gamma regime is king (intraday, dealer hedging dominates)
  // But gamma direction is only mildly bullish in POSITIVE, not a full +1
  const today = computeSingleHorizon(spot, dailyEM, 1, 'TODAY', 'Today',
    { gex: 40, vix: 15, flow: 25, geo: 5, mom: 15 },
    gexVexResult, todaySignals, symbol);

  // THIS WEEK: Flow/PCR is KING — institutional positioning dominates
  // GEX matters less because gamma can flip in a week
  const thisWeek = computeSingleHorizon(spot, dailyEM, 5, 'THIS_WEEK', 'This Week',
    { gex: 15, vix: 20, flow: 30, geo: 15, mom: 20 },
    gexVexResult, weekSignals, symbol);

  // THIS MONTH: Macro dominates — geo + VIX + institutional flow
  // GEX is almost irrelevant at monthly horizon
  const thisMonth = computeSingleHorizon(spot, dailyEM, 21, 'THIS_MONTH', 'This Month',
    { gex: 5, vix: 25, flow: 30, geo: 25, mom: 15 },
    gexVexResult, monthSignals, symbol);

  // ── Synthesize all horizons into final prediction ──
  // Weight: today 50%, week 30%, month 20% (nearer = more certain)
  const synthBullish = Math.round(
    (today.bullishProbability || 50) * 0.50 +
    (thisWeek.bullishProbability || 50) * 0.30 +
    (thisMonth.bullishProbability || 50) * 0.20
  );
  const synthBearish = Math.round(
    (today.bearishProbability || 50) * 0.50 +
    (thisWeek.bearishProbability || 50) * 0.30 +
    (thisMonth.bearishProbability || 50) * 0.20
  );
  const synthNeutral = Math.max(0, 100 - synthBullish - synthBearish);

  const synthDir: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    synthBullish > synthBearish + 10 ? 'BULLISH' :
    synthBearish > synthBullish + 10 ? 'BEARISH' : 'NEUTRAL';

  // Final target: use today's target weighted 60%, week 30%, month 10%
  const finalTarget = Math.round(
    (today.target * 0.60 + thisWeek.target * 0.30 + thisMonth.target * 0.10) * 100
  ) / 100;
  const finalProb = synthDir === 'BULLISH' ? synthBullish :
                    synthDir === 'BEARISH' ? synthBearish : synthNeutral;

  // Build path narrative
  const todayPath = today.mostLikelyPath || '';
  const weekPath = thisWeek.mostLikelyPath || '';
  const pathNarrative = `Today: ${todayPath}. Week: ${weekPath}`;

  // Inflection levels: gamma flip = thesis changer
  const inflectionLevels: SynthesizedPrediction['inflectionLevels'] = [];
  const gammaFlip = gexVexResult?.levels?.gexFlip;
  if (gammaFlip && Math.abs(gammaFlip - spot) < dailyEM * 3) {
    inflectionLevels.push({
      price: gammaFlip,
      label: `Gamma Flip $${gammaFlip}`,
      breakAbove: 'Positive gamma — dealers dampen moves, mean-revert bias',
      breakBelow: 'Negative gamma — dealers amplify moves, momentum bias',
    });
  }
  // Call wall = resistance inflection
  const topCallWall = (gexVexResult?.levels?.callWalls || [])[0];
  if (topCallWall && topCallWall > spot) {
    inflectionLevels.push({
      price: topCallWall,
      label: `Call Wall $${topCallWall}`,
      breakAbove: 'Gamma squeeze — dealer buying accelerates move up',
      breakBelow: 'Resistance holds — expect fade back to anchor',
    });
  }
  // Put wall = support inflection
  const topPutWall = (gexVexResult?.levels?.putWalls || [])[0];
  if (topPutWall && topPutWall < spot) {
    inflectionLevels.push({
      price: topPutWall,
      label: `Put Wall $${topPutWall}`,
      breakAbove: 'Support holds — bounce expected toward anchor',
      breakBelow: 'Support broken — accelerated selling toward next put wall',
    });
  }

  const synthesized: SynthesizedPrediction = {
    finalTarget,
    finalProbability: finalProb,
    direction: synthDir,
    probabilities: { bullish: synthBullish, bearish: synthBearish, neutral: synthNeutral },
    path: pathNarrative,
    inflectionLevels,
  };

  return { today, thisWeek, thisMonth, synthesized };
}

// ─── Cache ───────────────────────────────────────────────────

const predictionCache = new Map<string, { data: UnifiedPrediction; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min — options chain data doesn't change that fast

export async function getCachedUnifiedPrediction(
  symbol: string,
  intelData?: any,
  projectorData?: any,
  timeframe?: string,
): Promise<UnifiedPrediction | null> {
  const key = `${symbol}:${timeframe || '1d'}`;
  const cached = predictionCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const result = await computeUnifiedPrediction(symbol, intelData, projectorData, timeframe);
  if (result) predictionCache.set(key, { data: result, ts: Date.now() });
  return result;
}

logger.info('[UNIFIED] Prediction Engine loaded');

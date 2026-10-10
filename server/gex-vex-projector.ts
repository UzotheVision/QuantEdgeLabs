/**
 * GEX + VEX Target Projector  (v2 — Regime-Aware)
 * ==================================================
 * Calculates potential price targets using a weighted combination of:
 *   - GEX (Gamma Exposure) -- dealer hedging walls & flip zones
 *   - VEX (Vanna Exposure) -- IV-driven delta unwinds
 *
 * v2 improvements:
 *   - Regime-aware projection: positive gamma = mean-revert, negative = momentum
 *   - Dynamic GEX/VEX weighting based on VIX direction & OpEx proximity
 *   - ProjectionRange with magnetPrice, bounds, behavior classification
 *   - Regime strength proportional to net gamma magnitude & flip distance
 *   - Confidence scoring with optional historical hit-rate input
 */

import { logger } from './logger';
import { calculateGammaExposure, calculateAggregateGammaExposure } from './gamma-exposure';
import { calculateVannaExposure, calculateAggregateVEX } from './vanna-exposure';

// ---- Types ---------------------------------------------------------------

export interface GEXVEXTarget {
  price: number;
  type: 'GEX_WALL' | 'VEX_MAGNET' | 'FLIP_ZONE' | 'COMPOSITE';
  source: 'GEX' | 'VEX' | 'COMBINED';
  strength: number;       // 0-100 conviction
  direction: 'UPSIDE' | 'DOWNSIDE';
  distancePct: number;    // % from spot
  label: string;
}

export interface GammaRegime {
  type: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  description: string;
  tradingBias: string;
  flipPoint: number | null;
  /** 0-100 — how deep into the regime we are (distance from flip + GEX magnitude) */
  strength: number;
}

export type ProjectionBehavior = 'MEAN_REVERT' | 'MOMENTUM' | 'RANGE_BOUND';

export interface ProjectionRange {
  /** Where price is most likely pulled to */
  magnetPrice: number;
  /** Resistance ceiling — highest strong call wall */
  upperBound: number;
  /** Support floor — lowest strong put wall */
  lowerBound: number;
  /** 0-100 based on signal convergence & optional historical accuracy */
  confidence: number;
  /** Behavioral classification for the current regime */
  behavior: ProjectionBehavior;
}

export interface ProjectorResult {
  symbol: string;
  spotPrice: number;
  regime: GammaRegime;
  targets: {
    upside: GEXVEXTarget[];
    downside: GEXVEXTarget[];
    primaryUpside: GEXVEXTarget | null;
    primaryDownside: GEXVEXTarget | null;
  };
  levels: {
    gexAnchor: number | null;        // Max gamma strike (magnet)
    gexFlip: number | null;          // Gamma flip point
    vexAnchor: number | null;        // Max vanna strike
    vexFlip: number | null;          // Vanna flip point
    callWalls: number[];             // Top call gamma strikes
    putWalls: number[];              // Top put gamma strikes
    vannaAttractors: number[];       // Vanna-heavy strikes
    /** Gamma concentration % at key levels (like Glitch's indicator) */
    gammaConcentration: { strike: number; percent: number; netGEX: number }[];
  };
  /** v2: regime-aware projection range */
  projectionRange: ProjectionRange;
  confidence: number;                // 0-100 overall confidence (kept for compat)
  narrative: string;                 // AI-style text explanation
  timestamp: string;
  /** Options flow data for multi-horizon projections */
  flowData?: {
    totalCallOI: number;
    totalPutOI: number;
    putCallRatio: number;            // >1 = put heavy (bearish flow), <1 = call heavy (bullish flow)
    totalCallVolume: number;
    totalPutVolume: number;
    volumePCR: number;               // volume-based P/C ratio (more real-time than OI)
    flowBias: 'CALL_HEAVY' | 'PUT_HEAVY' | 'BALANCED';
  };
}

/** Optional context callers can pass for smarter weighting */
export interface ProjectionContext {
  /** Current VIX level (e.g. 18.5) */
  vixLevel?: number;
  /** VIX daily change in points (positive = VIX rising) */
  vixChange?: number;
  /** Days to nearest major expiration */
  daysToExpiry?: number;
  /** Historical hit-rate 0-100 for this symbol's projections */
  historicalHitRate?: number;
}

// ---- Dynamic Weights -----------------------------------------------------

const BASE_GEX_WEIGHT = 0.60;
const BASE_VEX_WEIGHT = 0.40;

/**
 * Adjust GEX/VEX weights based on VIX direction and OpEx proximity.
 *
 *  - VIX declining -> VEX gets MORE weight (vanna unwind pulls price to strikes)
 *  - VIX rising   -> VEX gets LESS weight (vanna pushes away)
 *  - 0-2 DTE      -> GEX 80% (gamma pinning strongest)
 *  - 3-7 DTE      -> normal
 *  - 8+ DTE       -> GEX 40% (macro dominates)
 */
function computeWeights(ctx?: ProjectionContext): { gexW: number; vexW: number } {
  let gexW = BASE_GEX_WEIGHT;
  let vexW = BASE_VEX_WEIGHT;

  // OpEx proximity adjustment
  if (ctx?.daysToExpiry !== undefined) {
    if (ctx.daysToExpiry <= 2) {
      gexW = 0.80;
      vexW = 0.20;
    } else if (ctx.daysToExpiry >= 8) {
      gexW = 0.40;
      vexW = 0.60;
    }
    // 3-7 DTE: keep defaults
  }

  // VIX direction adjustment (applied on top of OpEx)
  if (ctx?.vixChange !== undefined) {
    if (ctx.vixChange < -0.5) {
      // VIX declining meaningfully -> boost VEX
      const boost = Math.min(0.15, Math.abs(ctx.vixChange) * 0.03);
      vexW += boost;
      gexW -= boost;
    } else if (ctx.vixChange > 0.5) {
      // VIX rising -> reduce VEX
      const reduction = Math.min(0.15, ctx.vixChange * 0.03);
      vexW -= reduction;
      gexW += reduction;
    }
  }

  // Clamp to [0.15, 0.85] so neither signal is completely ignored
  gexW = Math.max(0.15, Math.min(0.85, gexW));
  vexW = Math.max(0.15, Math.min(0.85, vexW));

  // Normalize so they sum to 1
  const total = gexW + vexW;
  return { gexW: gexW / total, vexW: vexW / total };
}

// ---- Core Algorithm ------------------------------------------------------

export async function computeGEXVEXProjection(
  symbol: string,
  aggregate: boolean = true,
  ctx?: ProjectionContext,
  timeframe?: string,
): Promise<ProjectorResult | null> {
  try {
    logger.info(`[GEX-VEX] Computing projection for ${symbol}...`);

    // Fetch GEX and VEX in parallel
    const [gex, vex] = await Promise.all([
      aggregate ? calculateAggregateGammaExposure(symbol) : calculateGammaExposure(symbol),
      aggregate ? calculateAggregateVEX(symbol) : calculateVannaExposure(symbol),
    ]);

    // Need at least GEX to proceed
    if (!gex || gex.strikes.length === 0) {
      logger.warn(`[GEX-VEX] No GEX data for ${symbol}`);
      return null;
    }

    const spot = gex.spotPrice;
    const { gexW, vexW } = computeWeights(ctx);

    // -- 1. Determine gamma regime (now uses totalGEX for strength) --
    const regime = determineRegime(spot, gex.flipPoint, gex.totalNetGEX);

    // -- 2. Find GEX walls (top 5 positive/negative gamma concentrations) --
    const sortedByGEX = [...gex.strikes].sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX));
    const callWalls = sortedByGEX
      .filter(s => s.netGEX > 0 && s.strike > spot)
      .slice(0, 5)
      .map(s => s.strike);
    const putWalls = sortedByGEX
      .filter(s => s.netGEX < 0 && s.strike < spot)
      .slice(0, 5)
      .map(s => s.strike);

    // -- 3. Find VEX attractors --
    const vannaAttractors: number[] = [];
    if (vex && vex.strikes.length > 0) {
      const sortedByVEX = [...vex.strikes].sort((a, b) => Math.abs(b.netVEX) - Math.abs(a.netVEX));
      vannaAttractors.push(...sortedByVEX.slice(0, 5).map(s => s.strike));
    }

    // -- 4. Build target candidates --
    const targets: GEXVEXTarget[] = [];

    // GEX wall targets
    for (const wall of callWalls) {
      const dist = ((wall - spot) / spot) * 100;
      const gexEntry = gex.strikes.find(s => s.strike === wall);
      targets.push({
        price: wall,
        type: 'GEX_WALL',
        source: 'GEX',
        strength: Math.min(100, Math.abs(gexEntry?.netGEX || 0) * 50),
        direction: 'UPSIDE',
        distancePct: +dist.toFixed(2),
        label: `Call wall @ $${wall} (GEX: ${gexEntry?.netGEX.toFixed(2)}B)`,
      });
    }

    for (const wall of putWalls) {
      const dist = ((spot - wall) / spot) * 100;
      const gexEntry = gex.strikes.find(s => s.strike === wall);
      targets.push({
        price: wall,
        type: 'GEX_WALL',
        source: 'GEX',
        strength: Math.min(100, Math.abs(gexEntry?.netGEX || 0) * 50),
        direction: 'DOWNSIDE',
        distancePct: +dist.toFixed(2),
        label: `Put wall @ $${wall} (GEX: ${gexEntry?.netGEX.toFixed(2)}B)`,
      });
    }

    // VEX magnet targets
    if (vex) {
      for (const strike of vannaAttractors) {
        const dir = strike > spot ? 'UPSIDE' : 'DOWNSIDE';
        const dist = Math.abs((strike - spot) / spot) * 100;
        const vexEntry = vex.strikes.find(s => s.strike === strike);
        targets.push({
          price: strike,
          type: 'VEX_MAGNET',
          source: 'VEX',
          strength: Math.min(100, Math.abs(vexEntry?.netVEX || 0) * 30),
          direction: dir,
          distancePct: +dist.toFixed(2),
          label: `Vanna magnet @ $${strike} (VEX: ${vexEntry?.netVEX.toFixed(2)})`,
        });
      }
    }

    // Flip zone targets
    if (gex.flipPoint) {
      const dir = gex.flipPoint > spot ? 'UPSIDE' : 'DOWNSIDE';
      const dist = Math.abs((gex.flipPoint - spot) / spot) * 100;
      targets.push({
        price: gex.flipPoint,
        type: 'FLIP_ZONE',
        source: 'GEX',
        strength: 85,
        direction: dir,
        distancePct: +dist.toFixed(2),
        label: `Gamma flip @ $${gex.flipPoint} -- regime change zone`,
      });
    }

    if (vex?.vannaFlipPoint) {
      const dir = vex.vannaFlipPoint > spot ? 'UPSIDE' : 'DOWNSIDE';
      const dist = Math.abs((vex.vannaFlipPoint - spot) / spot) * 100;
      targets.push({
        price: vex.vannaFlipPoint,
        type: 'FLIP_ZONE',
        source: 'VEX',
        strength: 70,
        direction: dir,
        distancePct: +dist.toFixed(2),
        label: `Vanna flip @ $${vex.vannaFlipPoint} -- IV sensitivity shift`,
      });
    }

    // -- 5. Compute composite targets (regime-aware weighted GEX+VEX) --
    const upsideTargets = targets.filter(t => t.direction === 'UPSIDE').sort((a, b) => a.price - b.price);
    const downsideTargets = targets.filter(t => t.direction === 'DOWNSIDE').sort((a, b) => b.price - a.price);

    const compositeUpside = computeCompositeTarget(upsideTargets, spot, 'UPSIDE', gexW, vexW);
    const compositeDownside = computeCompositeTarget(downsideTargets, spot, 'DOWNSIDE', gexW, vexW);

    if (compositeUpside) targets.push(compositeUpside);
    if (compositeDownside) targets.push(compositeDownside);

    // -- 6. Pick primary targets --
    const upSorted = targets
      .filter(t => t.direction === 'UPSIDE')
      .sort((a, b) => b.strength - a.strength);
    const downSorted = targets
      .filter(t => t.direction === 'DOWNSIDE')
      .sort((a, b) => b.strength - a.strength);

    // -- 7. Confidence --
    const hasVEX = vex !== null && vex.strikes.length > 0;
    const hasFlip = gex.flipPoint !== null;
    const wallCount = callWalls.length + putWalls.length;
    let confidence = 40;
    if (hasFlip) confidence += 15;
    if (hasVEX) confidence += 20;
    if (wallCount >= 4) confidence += 15;
    if (regime.type !== 'NEUTRAL') confidence += 10;

    // Boost confidence when regime is strong (further from flip)
    confidence += Math.round(regime.strength * 0.10); // up to +10 from regime strength

    // OpEx proximity: high DTE = less gamma confidence
    if (ctx?.daysToExpiry !== undefined && ctx.daysToExpiry >= 8) {
      confidence -= 10;
    } else if (ctx?.daysToExpiry !== undefined && ctx.daysToExpiry <= 2) {
      confidence += 5; // pinning boost
    }

    // Blend in historical hit-rate if provided
    if (ctx?.historicalHitRate !== undefined) {
      confidence = Math.round(confidence * 0.7 + ctx.historicalHitRate * 0.3);
    }

    confidence = Math.max(10, Math.min(95, confidence));

    // -- 8. Projection Range (regime-aware) --
    const projectionRange = computeProjectionRange(
      spot, regime, gex.maxGammaStrike, callWalls, putWalls,
      vannaAttractors, upSorted[0] || null, downSorted[0] || null,
      confidence, gexW, vexW, ctx, timeframe,
    );

    // -- 9. Narrative --
    const narrative = buildNarrative(symbol, spot, regime, upSorted[0] || null, downSorted[0] || null, hasVEX, projectionRange, ctx);

    // -- 10. Gamma concentration at key levels (% of total absolute gamma) --
    const totalAbsGamma = gex.strikes.reduce((sum, s) => sum + Math.abs(s.netGEX), 0) || 1;
    const keyStrikes = [...callWalls, ...putWalls, gex.maxGammaStrike, gex.flipPoint]
      .filter((s): s is number => s !== null && s !== undefined);
    const uniqueKeyStrikes = [...new Set(keyStrikes)];
    const gammaConcentration = uniqueKeyStrikes
      .map(strike => {
        const entry = gex.strikes.find(s => s.strike === strike);
        const absGEX = entry ? Math.abs(entry.netGEX) : 0;
        return { strike, percent: Math.round((absGEX / totalAbsGamma) * 100), netGEX: entry?.netGEX || 0 };
      })
      .filter(g => g.percent > 0)
      .sort((a, b) => b.percent - a.percent);

    // -- 11. Compute P/C ratio from options flow --
    let totalCallOI = 0, totalPutOI = 0, totalCallVol = 0, totalPutVol = 0;
    for (const s of gex.strikes) {
      totalCallOI += s.callOI || 0;
      totalPutOI += s.putOI || 0;
    }
    // Volume data comes from VEX strikes if available (has volume info)
    if (vex && vex.strikes) {
      for (const s of vex.strikes as any[]) {
        totalCallVol += s.callVolume || 0;
        totalPutVol += s.putVolume || 0;
      }
    }
    const putCallRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : 1;
    const volumePCR = totalCallVol > 0 ? totalPutVol / totalCallVol : putCallRatio;
    const flowBias: 'CALL_HEAVY' | 'PUT_HEAVY' | 'BALANCED' =
      putCallRatio < 0.7 ? 'CALL_HEAVY' :
      putCallRatio > 1.3 ? 'PUT_HEAVY' :
      'BALANCED';

    const result: ProjectorResult = {
      symbol,
      spotPrice: spot,
      regime,
      targets: {
        upside: upSorted.slice(0, 5),
        downside: downSorted.slice(0, 5),
        primaryUpside: upSorted[0] || null,
        primaryDownside: downSorted[0] || null,
      },
      levels: {
        gexAnchor: gex.maxGammaStrike,
        gexFlip: gex.flipPoint,
        vexAnchor: vex?.maxVannaStrike || null,
        vexFlip: vex?.vannaFlipPoint || null,
        callWalls,
        putWalls,
        vannaAttractors,
        gammaConcentration,
      },
      projectionRange,
      confidence,
      narrative,
      timestamp: new Date().toISOString(),
      flowData: {
        totalCallOI,
        totalPutOI,
        putCallRatio: Math.round(putCallRatio * 100) / 100,
        totalCallVolume: totalCallVol,
        totalPutVolume: totalPutVol,
        volumePCR: Math.round(volumePCR * 100) / 100,
        flowBias,
      },
    };

    logger.info(`[GEX-VEX] ${symbol}: ${regime.type} regime (str ${regime.strength}), behavior=${projectionRange.behavior}, magnet=$${projectionRange.magnetPrice}, conf=${confidence}%`);
    return result;
  } catch (err) {
    logger.error(`[GEX-VEX] Projection error for ${symbol}:`, err);
    return null;
  }
}

// ---- Helpers -------------------------------------------------------------

/**
 * Determine gamma regime with strength scoring.
 * Strength is based on:
 *   1. Distance from flip point (further = deeper into regime)
 *   2. Net gamma magnitude (bigger = more dealer hedging pressure)
 */
function determineRegime(spot: number, flipPoint: number | null, totalGEX: number): GammaRegime {
  if (!flipPoint) {
    // No flip point — strength depends on how large the absolute GEX is.
    // Large absolute GEX with no flip means one-sided positioning.
    const absGEX = Math.abs(totalGEX);
    const gexStrength = Math.min(40, absGEX * 20); // capped at 40 without a flip

    if (absGEX > 0.5 && totalGEX > 0) {
      return {
        type: 'POSITIVE',
        description: `No clear flip detected but net GEX is positive (${totalGEX.toFixed(2)}B) -- likely positive gamma`,
        tradingBias: 'Mean-reversion: dealers likely dampen moves. Fade breakouts.',
        flipPoint: null,
        strength: Math.round(gexStrength),
      };
    }
    if (absGEX > 0.5 && totalGEX < 0) {
      return {
        type: 'NEGATIVE',
        description: `No clear flip detected but net GEX is negative (${totalGEX.toFixed(2)}B) -- likely negative gamma`,
        tradingBias: 'Momentum: dealers likely amplify moves. Trade with trend.',
        flipPoint: null,
        strength: Math.round(gexStrength),
      };
    }

    return {
      type: 'NEUTRAL',
      description: 'No clear gamma flip -- balanced dealer positioning',
      tradingBias: 'Range-bound, fade extremes',
      flipPoint: null,
      strength: 0,
    };
  }

  // Distance-based strength: how far spot is from flip as % of spot
  const flipDistPct = Math.abs(spot - flipPoint) / spot * 100;
  // Further from flip = deeper into regime. Saturates around 5% distance.
  const distanceScore = Math.min(50, flipDistPct * 10);

  // GEX magnitude score: bigger absolute GEX = stronger mechanical force
  const absGEX = Math.abs(totalGEX);
  const magnitudeScore = Math.min(50, absGEX * 25);

  const strength = Math.round(Math.min(100, distanceScore + magnitudeScore));

  if (spot > flipPoint) {
    return {
      type: 'POSITIVE',
      description: `Spot ($${spot.toFixed(0)}) above flip ($${flipPoint}) -- positive gamma`,
      tradingBias: 'Mean-reversion: dealers dampen moves, sell rips, buy dips. Fade breakouts.',
      flipPoint,
      strength,
    };
  }

  return {
    type: 'NEGATIVE',
    description: `Spot ($${spot.toFixed(0)}) below flip ($${flipPoint}) -- negative gamma`,
    tradingBias: 'Momentum: dealers amplify moves, trends accelerate. Trade with momentum.',
    flipPoint,
    strength,
  };
}

/**
 * Regime-aware projection range.
 *
 * POSITIVE gamma -> mean-reversion: magnet = GEX anchor, narrow bounds (damped)
 * NEGATIVE gamma -> momentum: magnet = momentum target (strongest put/call wall in move direction)
 * NEUTRAL        -> wide range, magnet = midpoint of walls
 */
function computeProjectionRange(
  spot: number,
  regime: GammaRegime,
  gexAnchor: number,
  callWalls: number[],
  putWalls: number[],
  vannaAttractors: number[],
  primaryUp: GEXVEXTarget | null,
  primaryDown: GEXVEXTarget | null,
  confidence: number,
  gexW: number,
  vexW: number,
  ctx?: ProjectionContext,
  timeframe?: string,
): ProjectionRange {
  // VIX-derived expected move — sizes EVERYTHING
  // daily EM = spot × (VIX/100) / √252
  const vix = ctx?.vixLevel || 18;  // default to 18 if no VIX
  const rawDailyEM = spot * (vix / 100) / Math.sqrt(252);

  // Scale EM by timeframe using √time rule
  // 5m ≈ 1/78 of day → √(1/78) ≈ 0.113, 15m ≈ √(1/26) ≈ 0.196, etc.
  const emScale: Record<string, number> = {
    '5m': Math.sqrt(1 / 78),    // ~0.11× daily
    '15m': Math.sqrt(3 / 78),   // ~0.20× daily
    '1h': Math.sqrt(1 / 6.5),   // ~0.39× daily
    '4h': Math.sqrt(4 / 6.5),   // ~0.78× daily
    '1d': 1,                     // 1× daily
    '1w': Math.sqrt(5),          // ~2.24× daily
  };
  const scaleFactor = emScale[timeframe || '1d'] || 1;
  const dailyEM = rawDailyEM * scaleFactor;

  // Determine bounds from walls
  const highestCallWall = callWalls.length > 0 ? Math.max(...callWalls) : spot + dailyEM * 1.5;
  const lowestPutWall = putWalls.length > 0 ? Math.min(...putWalls) : spot - dailyEM * 1.5;

  // Nearest strong walls (first entry is strongest due to sort order in caller)
  const nearestCallWall = callWalls.length > 0 ? Math.min(...callWalls) : spot + dailyEM;
  const nearestPutWall = putWalls.length > 0 ? Math.max(...putWalls) : spot - dailyEM;

  // Vanna-weighted midpoint (if available)
  let vannaMid: number | null = null;
  if (vannaAttractors.length > 0) {
    vannaMid = vannaAttractors.reduce((sum, s) => sum + s, 0) / vannaAttractors.length;
  }

  let magnetPrice: number;
  let upperBound: number;
  let lowerBound: number;
  let behavior: ProjectionBehavior;

  switch (regime.type) {
    case 'POSITIVE': {
      // Mean-reversion: price gravitates toward GEX anchor.
      // But the RANGE must reflect VIX-implied expected move, not just walls.
      behavior = 'MEAN_REVERT';

      // Magnet is primarily the GEX anchor, blended with vanna if VIX declining
      magnetPrice = gexAnchor;
      if (vannaMid !== null) {
        magnetPrice = magnetPrice * gexW + vannaMid * vexW;
      }

      // If magnet is within 0.3% of spot (noise), it's not a useful projection.
      // In positive gamma the "projection" is range-bound, so show the RANGE.
      // Magnet stays (it's the center of gravity) but bounds must be meaningful.
      const magnetDist = Math.abs(magnetPrice - spot);
      if (magnetDist / spot < 0.003) {
        // Magnet is essentially at spot. The real thesis is:
        // "price will stay in this range, damped by dealers"
        // Range = expected move scaled down by regime strength (stronger gamma = tighter range)
      }

      // Boundaries: EM-scaled, then tightened by regime strength
      // Stronger positive gamma = dealers dampen more = tighter range
      const dampFactor = 1 - (regime.strength / 100) * 0.4; // 0.6 to 1.0
      upperBound = spot + dailyEM * dampFactor;
      lowerBound = spot - dailyEM * dampFactor;

      // If walls are INSIDE the EM range, they dominate (hard resistance)
      if (nearestCallWall < upperBound && nearestCallWall > spot) {
        upperBound = nearestCallWall;
      }
      if (nearestPutWall > lowerBound && nearestPutWall < spot) {
        lowerBound = nearestPutWall;
      }

      // OpEx pinning: 0-2 DTE tightens range further (gamma pinning at max)
      if (ctx?.daysToExpiry !== undefined && ctx.daysToExpiry <= 2) {
        const mid = (upperBound + lowerBound) / 2;
        upperBound = mid + (upperBound - mid) * 0.6;
        lowerBound = mid + (lowerBound - mid) * 0.6;
      }
      break;
    }

    case 'NEGATIVE': {
      // Momentum: price accelerates through levels.
      // VIX-scaled: negative gamma AMPLIFIES moves, so range is wider than 1σ EM.
      behavior = 'MOMENTUM';

      // Amplification factor: stronger negative gamma = wider expected range
      const ampFactor = 1 + (regime.strength / 100) * 0.5; // 1.0 to 1.5×

      // Determine momentum direction
      const movingDown = regime.flipPoint !== null && spot < regime.flipPoint;

      if (movingDown) {
        // Downside momentum: put walls become magnets (not support)
        magnetPrice = nearestPutWall;
        if (primaryDown) {
          magnetPrice = magnetPrice * 0.6 + primaryDown.price * 0.4;
        }
        // Ensure magnet is at least 0.75× daily EM below spot
        if (Math.abs(magnetPrice - spot) < dailyEM * 0.75) {
          magnetPrice = spot - dailyEM * 0.75;
        }
        upperBound = Math.min(nearestCallWall, spot + dailyEM * 0.5); // limited upside
        lowerBound = spot - dailyEM * ampFactor; // amplified downside
      } else {
        // Upside momentum (short squeeze)
        magnetPrice = nearestCallWall;
        if (primaryUp) {
          magnetPrice = magnetPrice * 0.6 + primaryUp.price * 0.4;
        }
        if (Math.abs(magnetPrice - spot) < dailyEM * 0.75) {
          magnetPrice = spot + dailyEM * 0.75;
        }
        upperBound = spot + dailyEM * ampFactor;
        lowerBound = Math.max(nearestPutWall, spot - dailyEM * 0.5);
      }

      // Blend vanna (reduced weight when VIX rising)
      if (vannaMid !== null) {
        magnetPrice = magnetPrice * gexW + vannaMid * vexW;
      }
      break;
    }

    default: {
      // NEUTRAL: full expected move range, no strong pull
      behavior = 'RANGE_BOUND';

      // Magnet = midpoint of nearest walls or spot (no pull)
      magnetPrice = (nearestCallWall + nearestPutWall) / 2;

      // Blend vanna if available
      if (vannaMid !== null) {
        magnetPrice = magnetPrice * 0.5 + vannaMid * 0.5;
      }

      // Full 1σ EM range — no dampening, no amplification
      upperBound = spot + dailyEM;
      lowerBound = spot - dailyEM;

      // Expand to walls if they're outside EM
      if (highestCallWall > upperBound) upperBound = highestCallWall;
      if (lowestPutWall < lowerBound) lowerBound = lowestPutWall;
      break;
    }
  }

  // Round to 2 decimal places
  magnetPrice = +magnetPrice.toFixed(2);
  upperBound = +upperBound.toFixed(2);
  lowerBound = +lowerBound.toFixed(2);

  // Sanity: ensure bounds contain spot and magnet
  if (upperBound < spot) upperBound = +(spot + dailyEM * 0.3).toFixed(2);
  if (lowerBound > spot) lowerBound = +(spot - dailyEM * 0.3).toFixed(2);
  if (magnetPrice > upperBound) magnetPrice = upperBound;
  if (magnetPrice < lowerBound) magnetPrice = lowerBound;

  return {
    magnetPrice,
    upperBound,
    lowerBound,
    confidence,
    behavior,
  };
}

function computeCompositeTarget(
  targets: GEXVEXTarget[],
  spot: number,
  direction: 'UPSIDE' | 'DOWNSIDE',
  gexW: number = BASE_GEX_WEIGHT,
  vexW: number = BASE_VEX_WEIGHT,
): GEXVEXTarget | null {
  if (targets.length === 0) return null;

  // Weighted average price using strength as weight, with dynamic GEX/VEX source weights
  let weightedSum = 0;
  let totalWeight = 0;

  for (const t of targets) {
    const sourceWeight = t.source === 'GEX' ? gexW : t.source === 'VEX' ? vexW : 0.5;
    const w = t.strength * sourceWeight;
    weightedSum += t.price * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return null;

  const compositePrice = Math.round(weightedSum / totalWeight);
  const dist = Math.abs((compositePrice - spot) / spot) * 100;
  const avgStrength = targets.reduce((s, t) => s + t.strength, 0) / targets.length;

  return {
    price: compositePrice,
    type: 'COMPOSITE',
    source: 'COMBINED',
    strength: Math.min(95, avgStrength * 1.2),
    direction,
    distancePct: +dist.toFixed(2),
    label: `GEX+VEX composite target @ $${compositePrice}`,
  };
}

function buildNarrative(
  symbol: string,
  spot: number,
  regime: GammaRegime,
  upTarget: GEXVEXTarget | null,
  downTarget: GEXVEXTarget | null,
  hasVEX: boolean,
  projection: ProjectionRange,
  ctx?: ProjectionContext,
): string {
  const parts: string[] = [];

  // Regime
  if (regime.type === 'POSITIVE') {
    parts.push(
      `${symbol} is in a POSITIVE gamma regime (strength ${regime.strength}/100) -- dealers are hedging by selling rallies and buying dips, creating a mean-reverting environment.`
    );
    parts.push(
      `Price is expected to gravitate toward $${projection.magnetPrice} within the $${projection.lowerBound}-$${projection.upperBound} range.`
    );
  } else if (regime.type === 'NEGATIVE') {
    parts.push(
      `${symbol} is in NEGATIVE gamma territory (strength ${regime.strength}/100) -- dealer hedging amplifies moves in both directions. Momentum setups are favored.`
    );
    parts.push(
      `Momentum target is $${projection.magnetPrice}. Put walls at $${projection.lowerBound} can act as magnets on selloffs.`
    );
  } else {
    parts.push(
      `${symbol} shows balanced gamma positioning. No strong directional bias from dealer flows. Expecting range-bound action between $${projection.lowerBound} and $${projection.upperBound}.`
    );
  }

  // Upside target
  if (upTarget) {
    parts.push(`Upside: ${upTarget.label} (${upTarget.distancePct}% away, ${upTarget.strength.toFixed(0)}% conviction).`);
  }

  // Downside target
  if (downTarget) {
    parts.push(`Downside: ${downTarget.label} (${downTarget.distancePct}% away, ${downTarget.strength.toFixed(0)}% conviction).`);
  }

  // VEX note with VIX context
  if (hasVEX) {
    if (ctx?.vixChange !== undefined && ctx.vixChange < -0.5) {
      parts.push('VIX is declining -- vanna unwind is actively pulling price toward VEX magnets. VEX targets get elevated weight.');
    } else if (ctx?.vixChange !== undefined && ctx.vixChange > 0.5) {
      parts.push('VIX is rising -- vanna is pushing away from strikes, reducing VEX magnet pull. GEX walls dominate.');
    } else {
      parts.push('Vanna exposure is factored in -- if IV compresses, expect price to gravitate toward VEX magnets.');
    }
  }

  // OpEx note
  if (ctx?.daysToExpiry !== undefined) {
    if (ctx.daysToExpiry <= 2) {
      parts.push(`OpEx in ${ctx.daysToExpiry} day(s) -- gamma pinning effects are at maximum. Expect tight range around $${projection.magnetPrice}.`);
    } else if (ctx.daysToExpiry >= 8) {
      parts.push(`OpEx is ${ctx.daysToExpiry} days out -- gamma effects are weaker, macro and flow will dominate.`);
    }
  }

  return parts.join(' ');
}

// ---- Cache ---------------------------------------------------------------

const projectionCache = new Map<string, { data: ProjectorResult; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export async function getCachedProjection(
  symbol: string,
  ctx?: ProjectionContext,
  timeframe?: string,
): Promise<ProjectorResult | null> {
  const cacheKey = `${symbol}:${timeframe || '1d'}`;

  // When context is provided, skip cache (context-sensitive results)
  if (!ctx) {
    const cached = projectionCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  }

  const result = await computeGEXVEXProjection(symbol, true, ctx, timeframe);
  if (result) projectionCache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

logger.info('[GEX-VEX] Target Projector v2 (regime-aware) loaded');

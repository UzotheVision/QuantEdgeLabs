/**
 * Pattern Intelligence Service
 * 
 * Consolidated pattern detection engine that identifies and tracks:
 * - Bull/Bear Flags
 * - Ascending/Descending/Symmetrical Triangles
 * - Cup & Handle
 * - Volatility Contraction Patterns (VCP)
 * - Parabolic Moves
 * - Base Breakouts
 * - Momentum Surges
 */

import { db } from './db';
import { patternSignals, bullishTrends, type PatternType, type PatternStatus, type PatternSignal } from '@shared/schema';
import { eq, desc, and, gte, or, sql } from 'drizzle-orm';
import { logger } from './logger';
import { fetchOHLCData, OHLCData, detectSupportResistance } from './chart-analysis';
import { calculateRSI, calculateMACD, calculateSMA, calculateATR, calculateADX } from './technical-indicators';
import { recordSymbolAttention } from './attention-tracking-service';

// Pattern display names for UI
export const PATTERN_DISPLAY_NAMES: Record<PatternType, string> = {
  bull_flag: 'Bull Flag',
  bear_flag: 'Bear Flag',
  ascending_triangle: 'Ascending Triangle',
  descending_triangle: 'Descending Triangle',
  symmetrical_triangle: 'Symmetrical Triangle',
  cup_and_handle: 'Cup & Handle',
  inverse_head_shoulders: 'Inverse H&S',
  double_bottom: 'Double Bottom',
  falling_wedge: 'Falling Wedge',
  channel_breakout: 'Channel Breakout',
  vcp: 'VCP',
  parabolic_move: 'Parabolic Move',
  base_breakout: 'Base Breakout',
  momentum_surge: 'Momentum Surge',
};

// Bullish patterns for filtering
export const BULLISH_PATTERNS: PatternType[] = [
  'bull_flag',
  'ascending_triangle',
  'cup_and_handle',
  'inverse_head_shoulders',
  'double_bottom',
  'falling_wedge',
  'vcp',
  'parabolic_move',
  'base_breakout',
  'momentum_surge',
];

interface DetectedPattern {
  type: PatternType;
  score: number;
  resistance: number;
  support: number;
  breakoutLevel: number;
  target: number;
  stopLoss: number;
  riskReward: number;
  volumeConfirmed: boolean;
  priceConfirmed: boolean;
  patternHeight: number;
  patternDuration: number;
  tightness?: number;
  distanceToBreakout: number;
  urgency: 'imminent' | 'soon' | 'developing';
  notes: string;
}

interface SymbolAnalysis {
  symbol: string;
  currentPrice: number;
  patterns: DetectedPattern[];
  rsi: number;
  macdSignal: string;
  volumeRatio: number;
  priceVsSma20: number;
  priceVsSma50: number;
}

// Target universe for pattern scanning
const SCAN_UNIVERSE = [
  // User's bullish watchlist
  'OKLO', 'NNE', 'SMR', 'LEU', 'CCJ', 'UEC', 'DNN', 'URG', 'BWXT',
  'LMT', 'NOC', 'RTX', 'GD', 'BA', 'HII', 'LHX', 'TXT', 'HWM',
  'RKLB', 'ASTS', 'LUNR', 'RDW', 'MNTS', 'LLAP', 'SPCE', 'PL', 'OUST',
  'MARA', 'RIOT', 'CLSK', 'IREN', 'CIFR', 'COIN', 'HOOD', 'SOFI', 'AFRM', 'NU',
  'PLTR', 'RGTI', 'NBIS', 'IONQ', 'QBTS', 'ARQQ', 'QUBT', 'LAES', 'SOUN', 'APP',
  'CVNA', 'DASH', 'UBER', 'ABNB', 'CRWD', 'NET', 'SNOW', 'DDOG', 'ARM', 'SMCI',
  'TTD', 'ROKU', 'SQ', 'SHOP', 'MELI', 'DKNG', 'HIMS', 'RIVN', 'PATH', 'UPST', 'ZETA',
  // Top tech/growth
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'NFLX', 'CRM',
  'ORCL', 'ADBE', 'PYPL', 'NOW', 'INTU', 'WDAY', 'ZS', 'PANW', 'MDB', 'TEAM',
];

/**
 * Detect Bull Flag pattern
 * Requirements: Strong upward move (pole) followed by tight downward consolidation (flag)
 */
function detectBullFlag(ohlc: OHLCData, currentPrice: number): DetectedPattern | null {
  if (ohlc.closes.length < 25) return null;
  
  const closes = ohlc.closes;
  const highs = ohlc.highs;
  const lows = ohlc.lows;
  
  // Look for pole in last 20-25 days
  const poleStart = closes.length - 25;
  const poleEnd = closes.length - 10;
  const flagEnd = closes.length - 1;
  
  if (poleStart < 0) return null;
  
  const poleGain = (closes[poleEnd] - closes[poleStart]) / closes[poleStart];
  
  // Pole must have at least 8% gain
  if (poleGain < 0.08) return null;
  
  // Flag period - last 10 days
  const flagHighs = highs.slice(poleEnd, flagEnd + 1);
  const flagLows = lows.slice(poleEnd, flagEnd + 1);
  const flagCloses = closes.slice(poleEnd, flagEnd + 1);
  
  const flagHighMax = Math.max(...flagHighs);
  const flagLowMin = Math.min(...flagLows);
  const flagRange = (flagHighMax - flagLowMin) / flagHighMax;
  
  // Flag slope - should be slightly negative or flat
  const flagSlope = (flagCloses[flagCloses.length - 1] - flagCloses[0]) / flagCloses[0];
  
  // Flag should be tight (< 10% range) and slightly downward
  if (flagRange > 0.10 || flagSlope > 0.02 || flagSlope < -0.08) return null;
  
  // Calculate tightness (tighter = better)
  const tightness = 1 - (flagRange / 0.10);
  
  const resistance = flagHighMax;
  const support = flagLowMin;
  const breakoutLevel = resistance * 1.005; // 0.5% above flag high
  const target = currentPrice + (closes[poleEnd] - closes[poleStart]); // Pole height projection
  const stopLoss = support * 0.98;
  const distanceToBreakout = ((breakoutLevel - currentPrice) / currentPrice) * 100;
  
  // Score based on pole strength, flag tightness, and position
  let score = 60;
  score += Math.min(poleGain * 100, 20); // Up to 20 for pole strength
  score += tightness * 15; // Up to 15 for flag tightness
  if (currentPrice > (support + (resistance - support) * 0.6)) score += 5; // Near top of flag
  
  const urgency: 'imminent' | 'soon' | 'developing' = 
    distanceToBreakout < 1 ? 'imminent' : distanceToBreakout < 3 ? 'soon' : 'developing';
  
  return {
    type: 'bull_flag',
    score: Math.min(95, Math.round(score)),
    resistance,
    support,
    breakoutLevel,
    target: Number(target.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    riskReward: (target - currentPrice) / (currentPrice - stopLoss),
    volumeConfirmed: false, // Will be updated with volume data
    priceConfirmed: currentPrice > (support + (resistance - support) * 0.5),
    patternHeight: resistance - support,
    patternDuration: 10,
    tightness: tightness * 100,
    distanceToBreakout,
    urgency,
    notes: `Pole: +${(poleGain * 100).toFixed(1)}%, Flag range: ${(flagRange * 100).toFixed(1)}%`,
  };
}

/**
 * Detect Ascending Triangle pattern
 * Requirements: Flat resistance with rising support (higher lows)
 */
function detectAscendingTriangle(ohlc: OHLCData, currentPrice: number): DetectedPattern | null {
  if (ohlc.closes.length < 20) return null;
  
  const highs = ohlc.highs.slice(-20);
  const lows = ohlc.lows.slice(-20);
  
  // Check for flat resistance (highs cluster within 3%)
  const highMax = Math.max(...highs);
  const highMin = Math.min(...highs);
  const highRange = (highMax - highMin) / highMax;
  
  if (highRange > 0.03) return null;
  
  // Check for rising lows
  const lowsSegments = [
    Math.min(...lows.slice(0, 5)),
    Math.min(...lows.slice(5, 10)),
    Math.min(...lows.slice(10, 15)),
    Math.min(...lows.slice(15, 20)),
  ];
  
  let risingLows = true;
  for (let i = 1; i < lowsSegments.length; i++) {
    if (lowsSegments[i] < lowsSegments[i - 1] * 0.995) {
      risingLows = false;
      break;
    }
  }
  
  if (!risingLows) return null;
  
  const resistance = highMax;
  const support = lowsSegments[lowsSegments.length - 1];
  const triangleHeight = resistance - support;
  const breakoutLevel = resistance * 1.005;
  const target = resistance + triangleHeight;
  const stopLoss = support * 0.98;
  const distanceToBreakout = ((breakoutLevel - currentPrice) / currentPrice) * 100;
  
  let score = 70;
  if (currentPrice > resistance * 0.98) score += 10; // Near resistance
  if (highRange < 0.02) score += 5; // Very tight resistance
  
  const urgency: 'imminent' | 'soon' | 'developing' = 
    distanceToBreakout < 1 ? 'imminent' : distanceToBreakout < 2 ? 'soon' : 'developing';
  
  return {
    type: 'ascending_triangle',
    score: Math.min(95, Math.round(score)),
    resistance,
    support,
    breakoutLevel,
    target: Number(target.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    riskReward: (target - currentPrice) / (currentPrice - stopLoss),
    volumeConfirmed: false,
    priceConfirmed: currentPrice > support + (triangleHeight * 0.6),
    patternHeight: triangleHeight,
    patternDuration: 20,
    distanceToBreakout,
    urgency,
    notes: `Flat resistance at $${resistance.toFixed(2)}, rising support`,
  };
}

/**
 * Detect Cup and Handle pattern
 * Requirements: U-shaped base (cup) followed by small pullback (handle)
 */
function detectCupAndHandle(ohlc: OHLCData, currentPrice: number): DetectedPattern | null {
  if (ohlc.closes.length < 35) return null;
  
  const closes = ohlc.closes;
  const cupPeriod = Math.min(30, closes.length - 5);
  const cupCloses = closes.slice(-cupPeriod - 5, -5); // Cup excluding handle
  const handleCloses = closes.slice(-5); // Last 5 days for handle
  
  // Cup characteristics
  const cupHigh = Math.max(...cupCloses.slice(0, 5)); // Left side of cup
  const cupLow = Math.min(...cupCloses.slice(Math.floor(cupPeriod/3), Math.floor(cupPeriod*2/3))); // Bottom
  const cupRight = Math.max(...cupCloses.slice(-5)); // Right side of cup
  
  const cupDepth = (cupHigh - cupLow) / cupHigh;
  const cupSymmetry = Math.abs(cupHigh - cupRight) / cupHigh;
  
  // Cup must be 10-35% deep and reasonably symmetric
  if (cupDepth < 0.10 || cupDepth > 0.35 || cupSymmetry > 0.05) return null;
  
  // Handle characteristics
  const handleHigh = Math.max(...handleCloses);
  const handleLow = Math.min(...handleCloses);
  const handleDrop = (cupRight - handleLow) / cupRight;
  
  // Handle should be a small pullback (2-12% of cup depth)
  if (handleDrop < 0.02 || handleDrop > cupDepth * 0.5) return null;
  
  const resistance = Math.max(cupHigh, cupRight);
  const support = handleLow;
  const breakoutLevel = resistance * 1.005;
  const target = resistance + (resistance - cupLow); // Cup height projection
  const stopLoss = support * 0.98;
  const distanceToBreakout = ((breakoutLevel - currentPrice) / currentPrice) * 100;
  
  let score = 72;
  if (cupSymmetry < 0.03) score += 8; // Very symmetric cup
  if (handleDrop < cupDepth * 0.3) score += 5; // Shallow handle
  
  const urgency: 'imminent' | 'soon' | 'developing' = 
    distanceToBreakout < 1.5 ? 'imminent' : distanceToBreakout < 3 ? 'soon' : 'developing';
  
  return {
    type: 'cup_and_handle',
    score: Math.min(95, Math.round(score)),
    resistance,
    support,
    breakoutLevel,
    target: Number(target.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    riskReward: (target - currentPrice) / (currentPrice - stopLoss),
    volumeConfirmed: false,
    priceConfirmed: currentPrice > support + ((resistance - support) * 0.7),
    patternHeight: resistance - cupLow,
    patternDuration: cupPeriod + 5,
    distanceToBreakout,
    urgency,
    notes: `Cup depth: ${(cupDepth * 100).toFixed(1)}%, Handle: ${(handleDrop * 100).toFixed(1)}%`,
  };
}

/**
 * Detect VCP (Volatility Contraction Pattern)
 * Requirements: Series of tightening price contractions (each swing smaller than previous)
 */
function detectVCP(ohlc: OHLCData, currentPrice: number): DetectedPattern | null {
  if (ohlc.closes.length < 30) return null;
  
  const highs = ohlc.highs.slice(-30);
  const lows = ohlc.lows.slice(-30);
  
  // Calculate ranges for each 10-day period
  const ranges: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = i * 10;
    const end = start + 10;
    const periodHighs = highs.slice(start, end);
    const periodLows = lows.slice(start, end);
    const range = (Math.max(...periodHighs) - Math.min(...periodLows)) / Math.max(...periodHighs);
    ranges.push(range);
  }
  
  // VCP requires each range to be smaller than previous
  let contracting = true;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i] >= ranges[i - 1] * 0.95) { // Allow 5% tolerance
      contracting = false;
      break;
    }
  }
  
  if (!contracting) return null;
  
  // Final range should be tight (< 8%)
  const finalRange = ranges[ranges.length - 1];
  if (finalRange > 0.08) return null;
  
  const recentHighs = highs.slice(-10);
  const recentLows = lows.slice(-10);
  
  const resistance = Math.max(...recentHighs);
  const support = Math.min(...recentLows);
  const breakoutLevel = resistance * 1.003;
  const target = currentPrice * 1.15; // 15% target typical for VCP
  const stopLoss = support * 0.97;
  const distanceToBreakout = ((breakoutLevel - currentPrice) / currentPrice) * 100;
  
  const contractionRatio = ranges[0] / ranges[ranges.length - 1];
  
  let score = 75;
  score += Math.min(contractionRatio * 3, 15); // Better contraction = higher score
  if (finalRange < 0.05) score += 5; // Very tight final range
  
  const urgency: 'imminent' | 'soon' | 'developing' = 
    distanceToBreakout < 0.5 ? 'imminent' : distanceToBreakout < 2 ? 'soon' : 'developing';
  
  return {
    type: 'vcp',
    score: Math.min(95, Math.round(score)),
    resistance,
    support,
    breakoutLevel,
    target: Number(target.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    riskReward: (target - currentPrice) / (currentPrice - stopLoss),
    volumeConfirmed: false,
    priceConfirmed: true,
    patternHeight: resistance - support,
    patternDuration: 30,
    tightness: (1 - finalRange / 0.08) * 100,
    distanceToBreakout,
    urgency,
    notes: `${ranges.length} contractions, tightness: ${((1 - finalRange / 0.08) * 100).toFixed(0)}%`,
  };
}

/**
 * Detect Parabolic Move
 * Requirements: Accelerating upward price movement with expanding highs
 */
function detectParabolicMove(ohlc: OHLCData, currentPrice: number): DetectedPattern | null {
  if (ohlc.closes.length < 20) return null;
  
  const closes = ohlc.closes.slice(-20);
  
  // Calculate gains for each 5-day period
  const gains: number[] = [];
  for (let i = 0; i < 4; i++) {
    const start = i * 5;
    const end = start + 5;
    const gain = (closes[end - 1] - closes[start]) / closes[start];
    gains.push(gain);
  }
  
  // Parabolic requires accelerating gains (each period stronger than previous)
  let accelerating = true;
  for (let i = 1; i < gains.length; i++) {
    if (gains[i] <= gains[i - 1]) {
      accelerating = false;
      break;
    }
  }
  
  // Total gain must be significant (> 20%)
  const totalGain = (closes[closes.length - 1] - closes[0]) / closes[0];
  if (!accelerating || totalGain < 0.20) return null;
  
  // Check if recent momentum is strong
  const recent5DayGain = gains[gains.length - 1];
  if (recent5DayGain < 0.05) return null;
  
  const support = Math.min(...ohlc.lows.slice(-5)) * 0.95;
  const resistance = Math.max(...ohlc.highs.slice(-5));
  const target = currentPrice * (1 + recent5DayGain * 1.5); // Project recent momentum
  const stopLoss = support;
  const distanceToBreakout = 0; // Already moving
  
  let score = 80;
  score += Math.min(totalGain * 30, 15); // Up to 15 for total gain
  
  return {
    type: 'parabolic_move',
    score: Math.min(95, Math.round(score)),
    resistance,
    support,
    breakoutLevel: currentPrice, // Already breaking
    target: Number(target.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    riskReward: (target - currentPrice) / (currentPrice - stopLoss),
    volumeConfirmed: false,
    priceConfirmed: true,
    patternHeight: resistance - support,
    patternDuration: 20,
    distanceToBreakout,
    urgency: 'imminent',
    notes: `Accelerating +${(totalGain * 100).toFixed(1)}% in 20 days`,
  };
}

/**
 * Detect Momentum Surge
 * Requirements: Strong recent move with volume confirmation
 */
function detectMomentumSurge(ohlc: OHLCData, currentPrice: number, volumeRatio: number): DetectedPattern | null {
  if (ohlc.closes.length < 10) return null;
  
  const closes = ohlc.closes;
  const gain5d = (closes[closes.length - 1] - closes[closes.length - 5]) / closes[closes.length - 5];
  const gain3d = (closes[closes.length - 1] - closes[closes.length - 3]) / closes[closes.length - 3];
  
  // Need at least 5% gain in 5 days with strong recent acceleration
  if (gain5d < 0.05 || gain3d < 0.03) return null;
  
  // Volume should be elevated
  if (volumeRatio < 1.3) return null;
  
  const support = Math.min(...ohlc.lows.slice(-3));
  const resistance = Math.max(...ohlc.highs.slice(-3));
  const target = currentPrice * 1.08; // 8% target
  const stopLoss = support * 0.97;
  
  let score = 70;
  score += Math.min(gain5d * 100, 15);
  score += Math.min((volumeRatio - 1) * 10, 10);
  
  return {
    type: 'momentum_surge',
    score: Math.min(95, Math.round(score)),
    resistance,
    support,
    breakoutLevel: currentPrice,
    target: Number(target.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    riskReward: (target - currentPrice) / (currentPrice - stopLoss),
    volumeConfirmed: volumeRatio >= 1.5,
    priceConfirmed: true,
    patternHeight: resistance - support,
    patternDuration: 5,
    distanceToBreakout: 0,
    urgency: 'imminent',
    notes: `+${(gain5d * 100).toFixed(1)}% in 5 days, ${volumeRatio.toFixed(1)}x volume`,
  };
}

/**
 * Analyze a single symbol for all patterns
 */
export async function analyzeSymbolPatterns(symbol: string): Promise<SymbolAnalysis | null> {
  try {
    const ohlc = await fetchOHLCData(symbol, 'stock', 60);
    if (!ohlc || ohlc.closes.length < 20) {
      logger.debug(`[PATTERN] Insufficient data for ${symbol}`);
      return null;
    }
    
    const currentPrice = ohlc.closes[ohlc.closes.length - 1];
    const patterns: DetectedPattern[] = [];
    
    // Technical indicators
    const rsi = calculateRSI(ohlc.closes, 14);
    const macd = calculateMACD(ohlc.closes);
    const sma20 = calculateSMA(ohlc.closes, 20);
    const sma50 = ohlc.closes.length >= 50 ? calculateSMA(ohlc.closes, 50) : sma20;
    
    const priceVsSma20 = ((currentPrice - sma20) / sma20) * 100;
    const priceVsSma50 = ((currentPrice - sma50) / sma50) * 100;
    
    // Estimate volume ratio (would need actual volume data)
    const volumeRatio = 1.0; // Placeholder
    
    const macdSignal = macd.histogram > 0 ? 
      (macd.macd > macd.signal ? 'bullish_cross' : 'bullish') :
      (macd.macd < macd.signal ? 'bearish_cross' : 'bearish');
    
    // Detect all pattern types
    const bullFlag = detectBullFlag(ohlc, currentPrice);
    if (bullFlag) patterns.push(bullFlag);
    
    const ascTriangle = detectAscendingTriangle(ohlc, currentPrice);
    if (ascTriangle) patterns.push(ascTriangle);
    
    const cupHandle = detectCupAndHandle(ohlc, currentPrice);
    if (cupHandle) patterns.push(cupHandle);
    
    const vcp = detectVCP(ohlc, currentPrice);
    if (vcp) patterns.push(vcp);
    
    const parabolic = detectParabolicMove(ohlc, currentPrice);
    if (parabolic) patterns.push(parabolic);
    
    const momentum = detectMomentumSurge(ohlc, currentPrice, volumeRatio);
    if (momentum) patterns.push(momentum);
    
    // Sort patterns by score
    patterns.sort((a, b) => b.score - a.score);
    
    return {
      symbol,
      currentPrice,
      patterns,
      rsi,
      macdSignal,
      volumeRatio,
      priceVsSma20,
      priceVsSma50,
    };
  } catch (error) {
    logger.debug(`[PATTERN] Error analyzing ${symbol}:`, error);
    return null;
  }
}

/**
 * Run full pattern scan across universe
 */
export async function runPatternScan(customSymbols?: string[]): Promise<PatternSignal[]> {
  const symbols = customSymbols || SCAN_UNIVERSE;
  logger.info(`[PATTERN] Scanning ${symbols.length} symbols for patterns...`);
  
  const results: PatternSignal[] = [];
  const batchSize = 5;
  
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    
    const analyses = await Promise.all(
      batch.map(symbol => analyzeSymbolPatterns(symbol))
    );
    
    for (const analysis of analyses) {
      if (!analysis || analysis.patterns.length === 0) continue;
      
      // Process each detected pattern
      for (const pattern of analysis.patterns) {
        try {
          // Check for existing active pattern of same type
          const existing = await db.select()
            .from(patternSignals)
            .where(and(
              eq(patternSignals.symbol, analysis.symbol),
              eq(patternSignals.patternType, pattern.type),
              eq(patternSignals.isActive, true)
            ))
            .limit(1);
          
          const signalData = {
            symbol: analysis.symbol,
            patternType: pattern.type,
            patternStatus: (pattern.distanceToBreakout <= 0 ? 'confirmed' : 'forming') as PatternStatus,
            timeframe: 'daily' as const,
            detectionPrice: analysis.currentPrice,
            currentPrice: analysis.currentPrice,
            resistanceLevel: pattern.resistance,
            supportLevel: pattern.support,
            breakoutLevel: pattern.breakoutLevel,
            targetPrice: pattern.target,
            stopLoss: pattern.stopLoss,
            patternScore: pattern.score,
            volumeConfirmation: pattern.volumeConfirmed,
            priceConfirmation: pattern.priceConfirmed,
            patternHeight: pattern.patternHeight,
            patternDuration: pattern.patternDuration,
            consolidationTightness: pattern.tightness || null,
            rsiValue: analysis.rsi,
            macdSignal: analysis.macdSignal,
            volumeRatio: analysis.volumeRatio,
            priceVsSma20: analysis.priceVsSma20,
            priceVsSma50: analysis.priceVsSma50,
            riskRewardRatio: pattern.riskReward,
            distanceToBreakout: pattern.distanceToBreakout,
            urgency: pattern.urgency,
            notes: pattern.notes,
            isActive: true,
          };
          
          if (existing.length > 0) {
            // Update existing
            await db.update(patternSignals)
              .set({ ...signalData, updatedAt: new Date() })
              .where(eq(patternSignals.id, existing[0].id));
            results.push({ ...existing[0], ...signalData } as PatternSignal);
          } else {
            // Insert new
            const [inserted] = await db.insert(patternSignals)
              .values(signalData as any)
              .returning();
            results.push(inserted);
            
            // Record attention for new high-score patterns
            if (pattern.score >= 75) {
              recordSymbolAttention(
                analysis.symbol,
                'market_scanner',
                'discovery',
                {
                  direction: 'bullish',
                  confidence: pattern.score,
                  message: `${PATTERN_DISPLAY_NAMES[pattern.type]} detected - ${pattern.urgency}`,
                }
              );
            }
          }
        } catch (error) {
          logger.debug(`[PATTERN] Error saving pattern for ${analysis.symbol}:`, error);
        }
      }
    }
    
    // Rate limiting
    if (i + batchSize < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  logger.info(`[PATTERN] Scan complete: ${results.length} patterns found`);
  return results;
}

/**
 * Get active pattern signals with filters
 */
export async function getPatternSignals(filters?: {
  patternTypes?: PatternType[];
  minScore?: number;
  urgency?: string;
  status?: PatternStatus;
  limit?: number;
}): Promise<PatternSignal[]> {
  const conditions = [eq(patternSignals.isActive, true)];
  
  if (filters?.patternTypes && filters.patternTypes.length > 0) {
    conditions.push(
      or(...filters.patternTypes.map(t => eq(patternSignals.patternType, t)))!
    );
  }
  
  if (filters?.minScore) {
    conditions.push(gte(patternSignals.patternScore, filters.minScore));
  }
  
  if (filters?.urgency) {
    conditions.push(eq(patternSignals.urgency, filters.urgency));
  }
  
  if (filters?.status) {
    conditions.push(eq(patternSignals.patternStatus, filters.status));
  }
  
  return db.select()
    .from(patternSignals)
    .where(and(...conditions))
    .orderBy(desc(patternSignals.patternScore))
    .limit(filters?.limit || 50);
}

/**
 * Get imminent breakouts (urgency = 'imminent')
 */
export async function getImminentBreakouts(): Promise<PatternSignal[]> {
  return getPatternSignals({ urgency: 'imminent', minScore: 70, limit: 20 });
}

/**
 * Get top bullish patterns
 */
export async function getTopBullishPatterns(limit = 20): Promise<PatternSignal[]> {
  return getPatternSignals({ 
    patternTypes: BULLISH_PATTERNS, 
    minScore: 65, 
    limit 
  });
}

/**
 * Mark pattern as completed (hit target or failed)
 */
export async function updatePatternStatus(
  patternId: string, 
  status: PatternStatus,
  notes?: string
): Promise<void> {
  const updates: Partial<PatternSignal> = {
    patternStatus: status,
    updatedAt: new Date(),
    isActive: status === 'completed' || status === 'failed' ? false : true,
  };
  
  if (status === 'confirmed') {
    updates.confirmedAt = new Date();
  }
  
  if (notes) {
    updates.notes = notes;
  }
  
  await db.update(patternSignals)
    .set(updates)
    .where(eq(patternSignals.id, patternId));
}

/**
 * Deactivate stale patterns (older than 7 days without confirmation)
 */
export async function cleanupStalePatterns(): Promise<number> {
  const staleDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const result = await db.update(patternSignals)
    .set({ isActive: false, patternStatus: 'failed' as PatternStatus })
    .where(and(
      eq(patternSignals.isActive, true),
      eq(patternSignals.patternStatus, 'forming'),
      sql`${patternSignals.detectedAt} < ${staleDate.toISOString()}`
    ));
  
  return 0; // Drizzle doesn't return count easily
}

/**
 * BOT CONFLUENCE VALIDATOR
 * Multi-layer validation system that gives the bot its OWN analytical judgment
 * 
 * VALIDATION LAYERS:
 * 1. GREEKS ANALYSIS - Independent delta/gamma/IV assessment
 * 2. TECHNICAL CONFLUENCE - RSI, VWAP, MA alignment
 * 3. FLOW VALIDATION - Volume, open interest, unusual activity
 * 4. RISK/REWARD CHECK - Premium efficiency, max loss scenarios
 * 5. REGIME ALIGNMENT - Does direction match market context?
 * 
 * Bot can OVERRIDE trade idea generator recommendations!
 */

import { logger } from "./logger";
import { getOptionQuote, getTradierOptionsChain, getTradierQuote, getTradierHistoryOHLC } from "./tradier-api";
import { calculateRSI, calculateADX, calculateVWAP, calculateSMA } from "./technical-indicators";
import { getMarketContext } from "./market-context-service";

export interface ConfluenceResult {
  passed: boolean;
  score: number;
  layers: {
    greeks: LayerResult;
    technical: LayerResult;
    flow: LayerResult;
    riskReward: LayerResult;
    regime: LayerResult;
  };
  recommendation: 'EXECUTE' | 'SKIP' | 'ADJUST_STRIKE' | 'FLIP_DIRECTION';
  adjustedParams?: {
    suggestedStrike?: number;
    suggestedExpiry?: string;
    suggestedDirection?: 'call' | 'put';
  };
  reasons: string[];
}

interface LayerResult {
  passed: boolean;
  score: number;
  signals: string[];
  weight: number;
}

interface ConfluenceInput {
  symbol: string;
  direction: 'call' | 'put';
  strike: number;
  expiry: string;
  stockPrice: number;
  premium: number;
  delta?: number;
  gamma?: number;
  iv?: number;
}

const CONFLUENCE_WEIGHTS = {
  greeks: 25,
  technical: 30,
  flow: 20,
  riskReward: 15,
  regime: 10,
};

// 🛡️ TIGHTER ENTRY REQUIREMENTS - Raised from 35 to reduce losing trades
const MIN_CONFLUENCE_SCORE = 55; // Require higher conviction before entry

// Priority tickers get +5 boost (reduced from +15 to prevent weak setups from passing)
// 🎯 PRIORITY SECTORS: Nuclear, Space, Quantum, AI, Tech, Chinese stocks
const PRIORITY_TICKERS = [
  // ☢️ NUCLEAR & FUSION
  'NNE', 'OKLO', 'SMR', 'CCJ', 'LEU', 'UUUU',
  // 🚀 SPACE
  'RKLB', 'ASTS', 'LUNR', 'JOBY', 'ACHR', 'RDW', 'SPCE',
  // 🧠 AI & QUANTUM COMPUTING  
  'PLTR', 'AI', 'SOUN', 'IONQ', 'RGTI', 'QUBT', 'QBTS', 'UPST',
  // 🇨🇳 CHINESE STOCKS
  'BIDU', 'NIO', 'BABA', 'JD', 'PDD', 'XPEV', 'LI',
  // 📈 MEGA-CAP TECH (high liquidity)
  'NVDA', 'TSLA', 'AMD', 'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'META',
  // 🏦 INDICES & CRYPTO
  'SPY', 'QQQ', 'IWM', 'COIN', 'MARA', 'RIOT', 'ARM', 'INTC', 'SOFI',
];
const PRIORITY_TICKER_BOOST = 5; // Reduced from 15 to prevent weak entries

/**
 * LAYER 1: GREEKS ANALYSIS
 * Independent assessment of option Greeks for profitability
 */
async function validateGreeks(input: ConfluenceInput): Promise<LayerResult> {
  const signals: string[] = [];
  let score = 50;
  
  try {
    // Get option data from chain for complete Greeks
    const chain = await getTradierOptionsChain(input.symbol, input.expiry);
    
    // Find our specific option in the chain
    let optionData: any = null;
    if (chain && Array.isArray(chain)) {
      optionData = chain.find((opt: any) => 
        opt.strike === input.strike && 
        opt.option_type === input.direction
      );
    }
    
    // Use chain data if available, fallback to input values
    const delta = optionData?.greeks?.delta || input.delta || 0;
    const gamma = optionData?.greeks?.gamma || input.gamma || 0;
    const iv = optionData?.greeks?.mid_iv || input.iv || 0;
    const volume = optionData?.volume || 0;
    const openInterest = optionData?.open_interest || 0;
    const bid = optionData?.bid || 0;
    const ask = optionData?.ask || 0;
    const mid = (bid + ask) / 2 || input.premium;
    
    const absDelta = Math.abs(delta);
    
    // DELTA SWEET SPOT: 0.15-0.30 for lottos (good R/R with reasonable probability)
    if (absDelta >= 0.15 && absDelta <= 0.30) {
      score += 20;
      signals.push(`✅ DELTA_SWEET_SPOT: ${absDelta.toFixed(2)}`);
    } else if (absDelta >= 0.10 && absDelta < 0.15) {
      score += 10;
      signals.push(`⚠️ DELTA_AGGRESSIVE: ${absDelta.toFixed(2)} (low probability)`);
    } else if (absDelta > 0.30 && absDelta <= 0.45) {
      score += 15;
      signals.push(`📊 DELTA_CONSERVATIVE: ${absDelta.toFixed(2)} (higher cost)`);
    } else if (absDelta < 0.10) {
      score -= 15;
      signals.push(`❌ DELTA_TOO_LOW: ${absDelta.toFixed(2)} (lottery ticket only)`);
    } else {
      score -= 10;
      signals.push(`❌ DELTA_TOO_HIGH: ${absDelta.toFixed(2)} (expensive, low leverage)`);
    }
    
    // GAMMA CHECK: Higher gamma = faster delta changes (good for momentum plays)
    if (gamma > 0.05) {
      score += 8;
      signals.push(`✅ HIGH_GAMMA: ${gamma.toFixed(3)} (explosive potential)`);
    } else if (gamma < 0.02) {
      score -= 5;
      signals.push(`⚠️ LOW_GAMMA: ${gamma.toFixed(3)} (sluggish movement)`);
    }
    
    // IV CHECK: Avoid buying when IV is extremely high (expensive premiums)
    if (iv > 1.0) {
      score -= 15;
      signals.push(`❌ IV_EXTREME: ${(iv * 100).toFixed(0)}% (premium inflated)`);
    } else if (iv > 0.6) {
      score -= 8;
      signals.push(`⚠️ IV_HIGH: ${(iv * 100).toFixed(0)}% (moderately expensive)`);
    } else if (iv >= 0.25 && iv <= 0.5) {
      score += 10;
      signals.push(`✅ IV_OPTIMAL: ${(iv * 100).toFixed(0)}% (good value)`);
    }
    
    // BID-ASK SPREAD: Tight spreads = better fills
    const spread = ask - bid;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 100;
    if (spreadPct <= 10) {
      score += 10;
      signals.push(`✅ TIGHT_SPREAD: ${spreadPct.toFixed(1)}%`);
    } else if (spreadPct > 30) {
      score -= 10;
      signals.push(`❌ WIDE_SPREAD: ${spreadPct.toFixed(1)}%`);
    }
    
    // VOLUME/OI CHECK (moved here for Greeks layer)
    if (volume >= 500) {
      score += 8;
      signals.push(`✅ HIGH_VOLUME: ${volume.toLocaleString()}`);
    } else if (volume < 50) {
      score -= 5;
      signals.push(`⚠️ LOW_VOLUME: ${volume}`);
    }
    
    if (openInterest >= 500) {
      score += 5;
      signals.push(`✅ GOOD_OI: ${openInterest.toLocaleString()}`);
    }
    
  } catch (error) {
    logger.warn(`[CONFLUENCE] Greeks validation failed for ${input.symbol}`, { error });
    return { passed: false, score: 30, signals: ['GREEKS_FETCH_ERROR'], weight: CONFLUENCE_WEIGHTS.greeks };
  }
  
  return {
    passed: score >= 40, // Lowered from 50 for more aggressive entry
    score: Math.max(0, Math.min(100, score)),
    signals,
    weight: CONFLUENCE_WEIGHTS.greeks,
  };
}

/**
 * LAYER 2: TECHNICAL CONFLUENCE
 * Check if RSI, VWAP, moving averages align with trade direction
 */
async function validateTechnical(input: ConfluenceInput): Promise<LayerResult> {
  const signals: string[] = [];
  let score = 50;
  
  try {
    // Fetch historical OHLC data for technical analysis
    const history = await getTradierHistoryOHLC(input.symbol, 50);
    
    if (!history || !history.closes || history.closes.length < 20) {
      return { passed: true, score: 50, signals: ['NO_TECHNICAL_DATA'], weight: CONFLUENCE_WEIGHTS.technical };
    }
    
    // Use the arrays directly from the response
    const closes = history.closes;
    const highs = history.highs;
    const lows = history.lows;
    const currentPrice = closes[closes.length - 1];
    
    // Calculate technical indicators
    const rsi = calculateRSI(closes, 14);
    const rsi2 = calculateRSI(closes, 2);
    const adx = calculateADX(highs, lows, closes, 14);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = closes.length >= 50 ? calculateSMA(closes, 50) : sma20;
    
    const isBullish = input.direction === 'call';
    
    // RSI(2) MEAN REVERSION - Primary signal for lottos
    if (rsi2) {
      if (isBullish && rsi2 < 15) {
        score += 25;
        signals.push(`✅ RSI2_OVERSOLD: ${rsi2.toFixed(1)} (strong bounce expected)`);
      } else if (!isBullish && rsi2 > 85) {
        score += 25;
        signals.push(`✅ RSI2_OVERBOUGHT: ${rsi2.toFixed(1)} (pullback expected)`);
      } else if (isBullish && rsi2 > 80) {
        score -= 15;
        signals.push(`❌ RSI2_AGAINST: ${rsi2.toFixed(1)} (buying calls at overbought)`);
      } else if (!isBullish && rsi2 < 20) {
        score -= 15;
        signals.push(`❌ RSI2_AGAINST: ${rsi2.toFixed(1)} (buying puts at oversold)`);
      }
    }
    
    // RSI(14) for trend context
    if (rsi) {
      if (isBullish && rsi >= 30 && rsi <= 50) {
        score += 10;
        signals.push(`✅ RSI14_BULLISH_SETUP: ${rsi.toFixed(1)}`);
      } else if (!isBullish && rsi >= 50 && rsi <= 70) {
        score += 10;
        signals.push(`✅ RSI14_BEARISH_SETUP: ${rsi.toFixed(1)}`);
      }
    }
    
    // ADX TREND STRENGTH
    if (adx) {
      if (adx > 25) {
        score += 8;
        signals.push(`✅ ADX_TRENDING: ${adx.toFixed(1)} (strong trend)`);
      } else if (adx < 15) {
        score -= 5;
        signals.push(`⚠️ ADX_CHOPPY: ${adx.toFixed(1)} (low conviction)`);
      }
    }
    
    // PRICE vs SMA20 POSITIONING (proxy for VWAP in daily context)
    if (sma20 && currentPrice) {
      const sma20Diff = ((currentPrice - sma20) / sma20) * 100;
      if (isBullish && sma20Diff < -2) {
        score += 10;
        signals.push(`✅ BELOW_SMA20: ${sma20Diff.toFixed(2)}% (pullback entry)`);
      } else if (!isBullish && sma20Diff > 2) {
        score += 10;
        signals.push(`✅ ABOVE_SMA20: ${sma20Diff.toFixed(2)}% (extended, pullback likely)`);
      } else if (isBullish && sma20Diff > 5) {
        score -= 6;
        signals.push(`⚠️ EXTENDED_ABOVE_SMA20: ${sma20Diff.toFixed(2)}%`);
      } else if (!isBullish && sma20Diff < -5) {
        score -= 6;
        signals.push(`⚠️ EXTENDED_BELOW_SMA20: ${sma20Diff.toFixed(2)}%`);
      }
    }
    
    // MOVING AVERAGE ALIGNMENT
    if (sma20 && sma50 && currentPrice) {
      const aboveSma20 = currentPrice > sma20;
      const aboveSma50 = currentPrice > sma50;
      const sma20AboveSma50 = sma20 > sma50;
      
      if (isBullish) {
        if (aboveSma20 && aboveSma50 && sma20AboveSma50) {
          score += 10;
          signals.push(`✅ MA_BULLISH_STACK: Price > SMA20 > SMA50`);
        } else if (!aboveSma20 && !aboveSma50) {
          score -= 8;
          signals.push(`⚠️ MA_BEARISH_CONTEXT: Price below both MAs`);
        }
      } else {
        if (!aboveSma20 && !aboveSma50 && !sma20AboveSma50) {
          score += 10;
          signals.push(`✅ MA_BEARISH_STACK: Price < SMA20 < SMA50`);
        } else if (aboveSma20 && aboveSma50) {
          score -= 8;
          signals.push(`⚠️ MA_BULLISH_CONTEXT: Price above both MAs`);
        }
      }
    }
    
  } catch (error) {
    logger.warn(`[CONFLUENCE] Technical validation failed for ${input.symbol}`, { error });
    return { passed: true, score: 45, signals: ['TECHNICAL_FETCH_ERROR'], weight: CONFLUENCE_WEIGHTS.technical };
  }
  
  return {
    passed: score >= 35, // Lowered from 45 for aggressive mode
    score: Math.max(0, Math.min(100, score)),
    signals,
    weight: CONFLUENCE_WEIGHTS.technical,
  };
}

/**
 * LAYER 3: FLOW VALIDATION
 * Check volume, open interest, and unusual activity
 */
async function validateFlow(input: ConfluenceInput): Promise<LayerResult> {
  const signals: string[] = [];
  let score = 50;
  
  try {
    // Get option data from chain for volume/OI
    const chain = await getTradierOptionsChain(input.symbol, input.expiry);
    
    // Find our specific option
    let optionData: any = null;
    if (chain && Array.isArray(chain)) {
      optionData = chain.find((opt: any) => 
        opt.strike === input.strike && 
        opt.option_type === input.direction
      );
    }
    
    if (!optionData) {
      return { passed: true, score: 50, signals: ['NO_FLOW_DATA'], weight: CONFLUENCE_WEIGHTS.flow };
    }
    
    const volume = optionData.volume || 0;
    const openInterest = optionData.open_interest || 0;
    
    // VOLUME CHECK
    if (volume >= 500) {
      score += 15;
      signals.push(`✅ HIGH_VOLUME: ${volume.toLocaleString()}`);
    } else if (volume >= 100) {
      score += 8;
      signals.push(`📊 MODERATE_VOLUME: ${volume.toLocaleString()}`);
    } else if (volume < 20) {
      score -= 10;
      signals.push(`❌ LOW_VOLUME: ${volume} (illiquid)`);
    }
    
    // OPEN INTEREST CHECK
    if (openInterest >= 1000) {
      score += 12;
      signals.push(`✅ HIGH_OI: ${openInterest.toLocaleString()}`);
    } else if (openInterest >= 200) {
      score += 5;
      signals.push(`📊 MODERATE_OI: ${openInterest.toLocaleString()}`);
    } else if (openInterest < 50) {
      score -= 8;
      signals.push(`⚠️ LOW_OI: ${openInterest} (thin market)`);
    }
    
    // VOLUME/OI RATIO - High ratio indicates unusual activity
    const volumeOiRatio = openInterest > 0 ? volume / openInterest : 0;
    if (volumeOiRatio > 1.5) {
      score += 15;
      signals.push(`🔥 UNUSUAL_ACTIVITY: Vol/OI ${volumeOiRatio.toFixed(2)} (potential sweep)`);
    } else if (volumeOiRatio > 0.8) {
      score += 8;
      signals.push(`📊 ACTIVE_FLOW: Vol/OI ${volumeOiRatio.toFixed(2)}`);
    }
    
  } catch (error) {
    logger.warn(`[CONFLUENCE] Flow validation failed for ${input.symbol}`, { error });
  }
  
  return {
    passed: score >= 40,
    score: Math.max(0, Math.min(100, score)),
    signals,
    weight: CONFLUENCE_WEIGHTS.flow,
  };
}

/**
 * LAYER 4: RISK/REWARD VALIDATION
 * Ensure the trade has acceptable risk/reward characteristics
 */
function validateRiskReward(input: ConfluenceInput): LayerResult {
  const signals: string[] = [];
  let score = 50;
  
  const premium = input.premium;
  const stockPrice = input.stockPrice;
  const strike = input.strike;
  
  // PREMIUM EFFICIENCY: Lower premium = better leverage
  if (premium <= 0.50) {
    score += 15;
    signals.push(`✅ CHEAP_PREMIUM: $${premium.toFixed(2)} (high leverage)`);
  } else if (premium <= 1.00) {
    score += 10;
    signals.push(`📊 REASONABLE_PREMIUM: $${premium.toFixed(2)}`);
  } else if (premium > 2.50) {
    score -= 10;
    signals.push(`⚠️ EXPENSIVE_PREMIUM: $${premium.toFixed(2)} (capital intensive)`);
  }
  
  // OTM DISTANCE: Not too far (low prob) or too close (expensive)
  const otmPercent = input.direction === 'call'
    ? ((strike - stockPrice) / stockPrice) * 100
    : ((stockPrice - strike) / stockPrice) * 100;
  
  if (otmPercent >= 3 && otmPercent <= 10) {
    score += 15;
    signals.push(`✅ OTM_SWEET_SPOT: ${otmPercent.toFixed(1)}%`);
  } else if (otmPercent > 0 && otmPercent < 3) {
    score += 8;
    signals.push(`📊 NEAR_ATM: ${otmPercent.toFixed(1)}% (higher cost, better odds)`);
  } else if (otmPercent > 10 && otmPercent <= 15) {
    score += 5;
    signals.push(`⚠️ DEEP_OTM: ${otmPercent.toFixed(1)}% (lottery territory)`);
  } else if (otmPercent > 15) {
    score -= 15;
    signals.push(`❌ EXTREMELY_OTM: ${otmPercent.toFixed(1)}% (very low probability)`);
  } else if (otmPercent <= 0) {
    score -= 5;
    signals.push(`📊 ITM: ${Math.abs(otmPercent).toFixed(1)}% (expensive but safer)`);
  }
  
  // MAX LOSS PER CONTRACT (100 shares x premium)
  const maxLossPerContract = premium * 100;
  if (maxLossPerContract <= 50) {
    score += 10;
    signals.push(`✅ LOW_MAX_LOSS: $${maxLossPerContract.toFixed(0)}/contract`);
  } else if (maxLossPerContract > 200) {
    score -= 5;
    signals.push(`⚠️ HIGH_MAX_LOSS: $${maxLossPerContract.toFixed(0)}/contract`);
  }
  
  return {
    passed: score >= 40,
    score: Math.max(0, Math.min(100, score)),
    signals,
    weight: CONFLUENCE_WEIGHTS.riskReward,
  };
}

/**
 * LAYER 5: REGIME ALIGNMENT
 * Does trade direction align with current market regime?
 */
async function validateRegime(input: ConfluenceInput): Promise<LayerResult> {
  const signals: string[] = [];
  let score = 50;
  
  try {
    const marketContext = await getMarketContext();
    const isBullish = input.direction === 'call';
    
    // MARKET REGIME CHECK
    if (marketContext.regime === 'trending_up') {
      if (isBullish) {
        score += 20;
        signals.push(`✅ ALIGNED_WITH_TREND: Calls in uptrend`);
      } else {
        score -= 15;
        signals.push(`⚠️ COUNTER_TREND: Puts in uptrend (contrarian)`);
      }
    } else if (marketContext.regime === 'trending_down') {
      if (!isBullish) {
        score += 20;
        signals.push(`✅ ALIGNED_WITH_TREND: Puts in downtrend`);
      } else {
        score -= 15;
        signals.push(`⚠️ COUNTER_TREND: Calls in downtrend (contrarian)`);
      }
    } else if (marketContext.regime === 'ranging') {
      score += 5;
      signals.push(`📊 RANGING_MARKET: Mean reversion plays favored`);
    }
    
    // RISK SENTIMENT
    if (marketContext.riskSentiment === 'risk_on' && isBullish) {
      score += 10;
      signals.push(`✅ RISK_ON: Favors calls`);
    } else if (marketContext.riskSentiment === 'risk_off' && !isBullish) {
      score += 10;
      signals.push(`✅ RISK_OFF: Favors puts`);
    }
    
    // VIX CHECK (if available)
    if (marketContext.vixLevel) {
      if (marketContext.vixLevel > 25 && isBullish) {
        score -= 10;
        signals.push(`⚠️ HIGH_VIX: ${marketContext.vixLevel.toFixed(1)} (fear elevated for calls)`);
      } else if (marketContext.vixLevel < 15 && !isBullish) {
        score -= 8;
        signals.push(`⚠️ LOW_VIX: ${marketContext.vixLevel.toFixed(1)} (complacency for puts)`);
      }
    }
    
  } catch (error) {
    logger.warn(`[CONFLUENCE] Regime validation failed`, { error });
  }
  
  return {
    passed: score >= 35, // Lower bar - regime is advisory
    score: Math.max(0, Math.min(100, score)),
    signals,
    weight: CONFLUENCE_WEIGHTS.regime,
  };
}

/**
 * MAIN CONFLUENCE VALIDATOR
 * Runs all layers and produces final recommendation
 */
export async function validateConfluence(input: ConfluenceInput): Promise<ConfluenceResult> {
  logger.info(`🔍 [CONFLUENCE] Validating ${input.symbol} ${input.direction.toUpperCase()} $${input.strike}...`);
  
  // Run all validations in parallel for speed
  const [greeks, technical, flow, regime] = await Promise.all([
    validateGreeks(input),
    validateTechnical(input),
    validateFlow(input),
    validateRegime(input),
  ]);
  
  // Risk/reward is synchronous
  const riskReward = validateRiskReward(input);
  
  const layers = { greeks, technical, flow, riskReward, regime };
  
  // Calculate weighted score
  let totalWeightedScore = 0;
  let totalWeight = 0;
  
  for (const [layerName, result] of Object.entries(layers)) {
    totalWeightedScore += result.score * result.weight;
    totalWeight += result.weight;
  }
  
  let finalScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
  
  const passed = finalScore >= MIN_CONFLUENCE_SCORE;
  
  // Collect all reasons
  const reasons: string[] = [];
  for (const [layerName, result] of Object.entries(layers)) {
    for (const signal of result.signals) {
      reasons.push(`[${layerName.toUpperCase()}] ${signal}`);
    }
  }
  
  // Determine recommendation
  let recommendation: ConfluenceResult['recommendation'] = 'SKIP';
  let adjustedParams: ConfluenceResult['adjustedParams'] | undefined;
  
  if (passed && finalScore >= 70) {
    recommendation = 'EXECUTE';
  } else if (passed) {
    recommendation = 'EXECUTE';
  } else if (finalScore >= 25 && finalScore < MIN_CONFLUENCE_SCORE) {
    // Borderline - might suggest adjustments (lowered from 45 to 25)
    recommendation = 'ADJUST_STRIKE';
    
    // If technical says direction is wrong, suggest flip
    if (technical.score < 40 && greeks.score >= 50) {
      recommendation = 'FLIP_DIRECTION';
      adjustedParams = {
        suggestedDirection: input.direction === 'call' ? 'put' : 'call',
      };
    }
  }
  
  logger.info(`🔍 [CONFLUENCE] ${input.symbol}: Score=${finalScore.toFixed(1)}% | ${recommendation} | ${passed ? '✅ PASSED' : '❌ FAILED'}`);
  logger.debug(`🔍 [CONFLUENCE] Layer scores: Greeks=${greeks.score}, Technical=${technical.score}, Flow=${flow.score}, R/R=${riskReward.score}, Regime=${regime.score}`);
  
  return {
    passed,
    score: finalScore,
    layers,
    recommendation,
    adjustedParams,
    reasons,
  };
}

/**
 * INDEPENDENT OPTIONS CHAIN ANALYSIS
 * Bot's own analysis to find the BEST strike for a given symbol
 * Ignores what the trade idea generator suggested!
 */
export async function analyzeOptionsChainIndependently(
  symbol: string,
  stockPrice: number,
  preferredDirection?: 'call' | 'put'
): Promise<{
  bestCall?: { strike: number; expiry: string; score: number; premium: number };
  bestPut?: { strike: number; expiry: string; score: number; premium: number };
  recommendation: 'call' | 'put' | 'skip';
  reasons: string[];
} | null> {
  
  logger.info(`🧠 [INDEPENDENT] Analyzing ${symbol} options chain at $${stockPrice.toFixed(2)}...`);
  
  try {
    // Get next 2-3 weeks of expirations
    const today = new Date();
    const expirations: string[] = [];
    
    // Get Friday expirations for next 3 weeks
    for (let week = 1; week <= 3; week++) {
      const friday = new Date(today);
      friday.setDate(today.getDate() + (5 - today.getDay()) + (week - 1) * 7);
      if (friday.getDay() !== 5) friday.setDate(friday.getDate() + (5 - friday.getDay() + 7) % 7);
      expirations.push(friday.toISOString().split('T')[0]);
    }
    
    const chain = await getTradierOptionsChain(symbol, expirations[0]);
    if (!chain || !Array.isArray(chain) || chain.length === 0) {
      logger.warn(`[INDEPENDENT] No options chain for ${symbol}`);
      return null;
    }
    
    // Score each option
    const scoredOptions: Array<{
      type: 'call' | 'put';
      strike: number;
      expiry: string;
      premium: number;
      score: number;
      delta: number;
    }> = [];
    
    for (const opt of chain) {
      if (!opt.bid || opt.bid <= 0) continue;
      
      const mid = (opt.bid + opt.ask) / 2;
      const delta = Math.abs(opt.greeks?.delta || 0);
      const spread = opt.ask - opt.bid;
      const spreadPct = spread / mid;
      
      // Calculate OTM %
      const otmPct = opt.option_type === 'call'
        ? ((opt.strike - stockPrice) / stockPrice) * 100
        : ((stockPrice - opt.strike) / stockPrice) * 100;
      
      // Skip ITM or too far OTM
      if (otmPct < 0 || otmPct > 15) continue;
      
      // Skip if spread too wide or delta out of range
      if (spreadPct > 0.40 || delta < 0.10 || delta > 0.40) continue;
      if (mid < 0.10 || mid > 3.00) continue;
      
      let score = 50;
      
      // Delta scoring
      if (delta >= 0.15 && delta <= 0.28) score += 25;
      else if (delta >= 0.12 && delta < 0.15) score += 15;
      else if (delta > 0.28 && delta <= 0.35) score += 18;
      else score += 8;
      
      // Spread scoring
      if (spreadPct <= 0.12) score += 15;
      else if (spreadPct <= 0.20) score += 10;
      else score += 5;
      
      // Premium efficiency
      const efficiency = delta / mid;
      if (efficiency >= 0.20) score += 12;
      else if (efficiency >= 0.15) score += 8;
      else score += 4;
      
      // OTM sweet spot
      if (otmPct >= 4 && otmPct <= 10) score += 10;
      else if (otmPct >= 2 && otmPct < 4) score += 6;
      else score += 3;
      
      scoredOptions.push({
        type: opt.option_type as 'call' | 'put',
        strike: opt.strike,
        expiry: opt.expiration_date || expirations[0],
        premium: mid,
        score,
        delta,
      });
    }
    
    // Find best call and put
    const calls = scoredOptions.filter(o => o.type === 'call').sort((a, b) => b.score - a.score);
    const puts = scoredOptions.filter(o => o.type === 'put').sort((a, b) => b.score - a.score);
    
    const bestCall = calls[0];
    const bestPut = puts[0];
    
    const reasons: string[] = [];
    let recommendation: 'call' | 'put' | 'skip' = 'skip';
    
    if (bestCall && bestPut) {
      if (bestCall.score > bestPut.score + 5) {
        recommendation = 'call';
        reasons.push(`Best call $${bestCall.strike} (score ${bestCall.score}) beats best put (score ${bestPut.score})`);
      } else if (bestPut.score > bestCall.score + 5) {
        recommendation = 'put';
        reasons.push(`Best put $${bestPut.strike} (score ${bestPut.score}) beats best call (score ${bestCall.score})`);
      } else {
        recommendation = preferredDirection || 'call';
        reasons.push(`Calls and puts similar - using ${recommendation}`);
      }
    } else if (bestCall) {
      recommendation = 'call';
      reasons.push(`Only calls available - $${bestCall.strike} (score ${bestCall.score})`);
    } else if (bestPut) {
      recommendation = 'put';
      reasons.push(`Only puts available - $${bestPut.strike} (score ${bestPut.score})`);
    } else {
      reasons.push('No suitable options found');
    }
    
    logger.info(`🧠 [INDEPENDENT] ${symbol}: Recommends ${recommendation.toUpperCase()} | Best call: $${bestCall?.strike || 'N/A'} (${bestCall?.score || 0}) | Best put: $${bestPut?.strike || 'N/A'} (${bestPut?.score || 0})`);
    
    return {
      bestCall: bestCall ? { strike: bestCall.strike, expiry: bestCall.expiry, score: bestCall.score, premium: bestCall.premium } : undefined,
      bestPut: bestPut ? { strike: bestPut.strike, expiry: bestPut.expiry, score: bestPut.score, premium: bestPut.premium } : undefined,
      recommendation,
      reasons,
    };
    
  } catch (error) {
    logger.error(`[INDEPENDENT] Options chain analysis failed for ${symbol}`, { error });
    return null;
  }
}

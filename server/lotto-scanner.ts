// Dedicated Lotto Play Scanner
// Actively hunts for cheap far-OTM weekly options with 20x return potential

import type { InsertTradeIdea, TradeIdea } from "@shared/schema";
import { isUSMarketOpen, isValidTradingDay } from "@shared/market-calendar";
import { detectSectorFocus, detectRiskProfile, detectResearchHorizon } from './sector-detector';
import { getTradierQuote, getTradierOptionsChain, getTradierOptionsChainsByDTE } from './tradier-api';
import { logger } from './logger';
import { formatInTimeZone } from 'date-fns-tz';
import { storage } from './storage';
import { isLottoCandidate, calculateLottoTargets, getLottoThresholds } from './lotto-detector';
import { sendLottoToDiscord } from './discord-service';
import { getLetterGrade } from './grading';
import { recordSymbolAttention } from './attention-tracking-service';

/**
 * Calculate quality signals for lotto plays based on underlying momentum and option characteristics
 * Returns an array of signals and a confidence score (0-100)
 */
interface LottoQualityResult {
  signals: string[];
  score: number;
  grade: string;
  isValidForDayTrade: boolean;
  isValidForSwingTrade: boolean;
}

function calculateLottoQuality(
  quote: { 
    change_percentage: number; 
    volume: number; 
    average_volume: number;
    last: number;
    week_52_high: number;
    week_52_low: number;
    high: number;
    low: number;
    open: number;
  },
  candidate: LottoCandidate
): LottoQualityResult {
  const signals: string[] = [];
  let score = 50; // Start at neutral
  
  // 1. MOMENTUM CHECK: Price change alignment with option direction
  const priceChange = quote.change_percentage || 0;
  const isCallOption = candidate.optionType === 'call';
  const momentumAligned = isCallOption ? priceChange > 0 : priceChange < 0;
  
  if (momentumAligned) {
    const absChange = Math.abs(priceChange);
    if (absChange >= 3) {
      signals.push(`strong_momentum_${absChange.toFixed(1)}%`);
      score += 20;
    } else if (absChange >= 1) {
      signals.push(`momentum_aligned_${absChange.toFixed(1)}%`);
      score += 10;
    } else {
      signals.push(`weak_momentum_${absChange.toFixed(1)}%`);
      score += 5;
    }
  } else if (Math.abs(priceChange) < 0.5) {
    signals.push('neutral_momentum');
    // No penalty for neutral
  } else {
    // Momentum against position
    signals.push(`counter_momentum_${priceChange.toFixed(1)}%`);
    score -= 15;
  }
  
  // 2. VOLUME CHECK: Relative volume vs average
  const relativeVolume = quote.average_volume > 0 
    ? quote.volume / quote.average_volume 
    : 1;
  
  if (relativeVolume >= 2.0) {
    signals.push(`high_volume_${relativeVolume.toFixed(1)}x`);
    score += 15;
  } else if (relativeVolume >= 1.2) {
    signals.push(`above_avg_volume_${relativeVolume.toFixed(1)}x`);
    score += 8;
  } else if (relativeVolume < 0.5) {
    signals.push('low_volume');
    score -= 10;
  }
  
  // 3. RANGE POSITION: Where is price in 52-week range?
  const range52w = quote.week_52_high - quote.week_52_low;
  if (range52w > 0) {
    const positionInRange = (quote.last - quote.week_52_low) / range52w;
    
    if (isCallOption && positionInRange < 0.3) {
      signals.push('near_52w_low_call_risky');
      score -= 10; // Calls near lows are risky
    } else if (!isCallOption && positionInRange > 0.7) {
      signals.push('near_52w_high_put_risky');
      score -= 10; // Puts near highs are risky
    } else if (isCallOption && positionInRange > 0.5) {
      signals.push('bullish_range_position');
      score += 5;
    } else if (!isCallOption && positionInRange < 0.5) {
      signals.push('bearish_range_position');
      score += 5;
    }
  }
  
  // 4. INTRADAY STRENGTH: Price vs intraday range
  const intradayRange = quote.high - quote.low;
  if (intradayRange > 0) {
    const intradayPosition = (quote.last - quote.low) / intradayRange;
    
    if (isCallOption && intradayPosition > 0.7) {
      signals.push('intraday_strength');
      score += 8;
    } else if (!isCallOption && intradayPosition < 0.3) {
      signals.push('intraday_weakness');
      score += 8;
    } else if (isCallOption && intradayPosition < 0.3) {
      signals.push('intraday_weak_for_call');
      score -= 5;
    } else if (!isCallOption && intradayPosition > 0.7) {
      signals.push('intraday_strong_for_put');
      score -= 5;
    }
  }
  
  // 5. DELTA CHECK: Optimal delta range for lotto plays (0.05-0.12)
  const absDelta = Math.abs(candidate.delta);
  if (absDelta >= 0.05 && absDelta <= 0.12) {
    signals.push(`optimal_delta_${absDelta.toFixed(2)}`);
    score += 15; // Increased bonus for optimal delta
  } else if (absDelta < 0.03) {
    signals.push('extreme_otm_high_risk');
    score -= 15; // Heavy penalty for extreme OTM (too unlikely to hit)
  } else if (absDelta > 0.15) {
    signals.push('too_close_to_money_for_lotto');
    score -= 10; // Penalty for being too close to the money (not a true lotto)
  }
  
  // 6. DTE PREMIUM: Short DTE needs stronger signals
  if (candidate.daysToExpiry <= 2) {
    signals.push('day_trade_dte');
    // Day trades need extra conviction - penalty if momentum not strong
    if (!signals.some(s => s.includes('strong_momentum'))) {
      score -= 10;
    }
  } else if (candidate.daysToExpiry <= 7) {
    signals.push('weekly_dte');
  }
  
  // 7. OPTION VOLUME: Check if option itself has volume
  if (candidate.volume >= 1000) {
    signals.push(`option_volume_${candidate.volume}`);
    score += 8;
  } else if (candidate.volume >= 100) {
    signals.push('option_has_volume');
    score += 3;
  } else if (candidate.volume === 0) {
    signals.push('no_option_volume');
    score -= 5;
  }
  
  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));
  
  const grade = getLetterGrade(score);
  
  // Minimum grade requirements - RELAXED FOR MORE VOLUME:
  // - Day trades (0-2 DTE): Require C+ grade (70+) - was 80, now more trades
  // - Swing trades (3+ DTE): Require C- grade (60+) - was 70, now more trades
  const isValidForDayTrade = score >= 70; // C+ or better (was B)
  const isValidForSwingTrade = score >= 60; // C- or better (was 70)
  
  return {
    signals,
    score,
    grade,
    isValidForDayTrade,
    isValidForSwingTrade
  };
}

// Wrapper to maintain existing function signature
function isMarketOpen(): { isOpen: boolean; reason: string } {
  const status = isUSMarketOpen();
  return { isOpen: status.isOpen, reason: status.reason };
}

// High-volatility tickers perfect for lotto plays - EXPANDED with Quantum, Nuclear, Healthcare penny stocks
// These are characterized by extreme volatility, binary catalysts, and retail interest
const LOTTO_SCAN_TICKERS = [
  // === CORE HIGH-VOLATILITY ===
  'TSLA', 'NVDA', 'AMD', 'SPY', 'QQQ', 'AAPL', 'MSFT', 'NFLX', 'META', 'GOOGL', 'AMZN',
  
  // === 🔬 QUANTUM COMPUTING PENNY LOTTOS ===
  'IONQ',   // IonQ - Trapped ion ($5-15)
  'RGTI',   // Rigetti - Superconducting ($1-10) ⚡ TOP LOTTO
  'QUBT',   // Quantum Computing Inc ($1-5) ⚡ TOP LOTTO
  'QBTS',   // D-Wave Quantum ($3-10) ⚡ TOP LOTTO
  'ARQQ',   // Arqit Quantum ($1-5) ⚡ TOP LOTTO
  
  // === ⚛️ NUCLEAR FUSION PENNY LOTTOS ===
  'NNE',    // Nano Nuclear Energy ($10-30)
  'OKLO',   // Oklo - Advanced fission ($10-40)
  'SMR',    // NuScale Power ($10-25)
  'UEC',    // Uranium Energy ($5-10)
  'DNN',    // Denison Mines ($1-3) ⚡ TOP LOTTO
  'URG',    // Ur-Energy ($1-3) ⚡ TOP LOTTO
  'LTBR',   // Lightbridge ($2-5) ⚡ TOP LOTTO
  
  // === 🧬 BIOTECH PENNY LOTTOS ===
  'NVAX',   // Novavax ($5-20)
  'EDIT',   // Editas Medicine ($2-10) ⚡ TOP LOTTO
  // REMOVED: BLUE (delisted)
  'INO',    // Inovio ($1-5) ⚡ TOP LOTTO
  'SRNE',   // Sorrento ($0.20-1) ⚡ ULTRA LOTTO
  'VXRT',   // Vaxart ($0.50-3) ⚡ ULTRA LOTTO
  'FATE',   // Fate Therapeutics ($1-5) ⚡ TOP LOTTO
  'GRTS',   // Gritstone bio ($0.50-3) ⚡ ULTRA LOTTO
  
  // === 💰 CRYPTO/MEME PENNY LOTTOS ===
  'MARA', 'RIOT', 'COIN', 'MSTR',
  'CLSK',   // CleanSpark
  'BTBT',   // Bit Digital ($2-5) ⚡ TOP LOTTO
  'BITF',   // Bitfarms ($1-5) ⚡ TOP LOTTO
  'WULF',   // TeraWulf ($3-8)
  
  // === 🚗 EV PENNY LOTTOS ===
  'LCID',   // Lucid ($2-5) ⚡ TOP LOTTO
  'NIO',    // NIO ($3-10)
  'CHPT',   // ChargePoint ($0.50-3) ⚡ ULTRA LOTTO
  'BLNK',   // Blink ($1-5) ⚡ TOP LOTTO
  // REMOVED: FFIE, GOEV (delisted)
  'NKLA',   // Nikola ($0.50-3) ⚡ ULTRA LOTTO
  
  // === 🚀 SPACE PENNY LOTTOS ===
  'SPCE',   // Virgin Galactic ($1-5) ⚡ TOP LOTTO
  'BKSY',   // BlackSky ($0.50-2) ⚡ ULTRA LOTTO
  // REMOVED: LLAP (delisted)
  
  // === ⚡ CLEAN ENERGY PENNY LOTTOS ===
  'PLUG',   // Plug Power ($1-5) ⚡ TOP LOTTO
  'FCEL',   // FuelCell ($0.50-3) ⚡ ULTRA LOTTO
  'STEM',   // Stem Inc ($0.50-2) ⚡ ULTRA LOTTO
  'QS',     // QuantumScape ($3-10)
  
  // === 🎮 RETAIL/MEME FAVORITES ===
  'PLTR', 'SOFI', 'HOOD', 'GME', 'AMC',
  'TLRY',   // Tilray ($1-5) ⚡ TOP LOTTO
  'CGC',    // Canopy ($2-10)
  'SNDL',   // SNDL ($1-3) ⚡ TOP LOTTO
  
  // === 🤖 AI PENNY LOTTOS ===
  'SOUN',   // SoundHound ($5-15)
  'BBAI',   // BigBear.ai ($1-5) ⚡ TOP LOTTO
  'ZETA',   // Zeta Global - AI marketing ($15-35)
  'GFAI'    // Guardforce AI ($0.50-2) ⚡ ULTRA LOTTO
];

interface LottoCandidate {
  symbol: string;
  underlying: string;
  optionType: 'call' | 'put';
  strike: number;
  expiration: string;
  lastPrice: number;
  delta: number;
  daysToExpiry: number;
  volume: number;
  reasons: string[];
}

/**
 * Scan for lotto play candidates (cheap far-OTM weeklies)
 */
async function scanForLottoPlays(ticker: string): Promise<LottoCandidate[]> {
  try {
    logger.info(`🎰 [LOTTO] Scanning for lotto plays in ${ticker}...`);
    
    // Get options chain across multiple expirations
    const allOptions = await getTradierOptionsChainsByDTE(ticker);
    
    if (allOptions.length === 0) {
      logger.info(`🎰 [LOTTO] No options data for ${ticker}`);
      return [];
    }

    // Filter for valid trading days - include ALL DTE ranges (0DTE through LEAPS)
    // Weekly (0-7), Monthly (8-30), Quarterly (31-90), LEAPS (90+)
    const today = new Date();
    const options = allOptions.filter(opt => {
      if (!opt.expiration_date) return false;
      // 🔒 VALIDATION: Skip options with invalid expiration dates (weekends, holidays)
      if (!isValidTradingDay(opt.expiration_date)) return false;
      const expiryDate = new Date(opt.expiration_date);
      const daysToExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      // Allow ALL DTE ranges - from 0DTE to LEAPS (up to 540 days / 18 months)
      return daysToExpiry >= 0 && daysToExpiry <= 540;
    });

    logger.info(`🎰 [LOTTO] ${ticker}: Filtered to ${options.length} options with 0-540 days DTE (from ${allOptions.length} total)`);

    const thresholds = getLottoThresholds();
    const lottoCandidates: LottoCandidate[] = [];

    let noBidAskCount = 0;
    
    for (const option of options) {
      // 🔒 STRICT PRICING: REQUIRE bid/ask for accurate premiums - don't use stale 'last' price
      const hasBidAsk = option.bid && option.bid > 0 && option.ask && option.ask > 0;
      if (!hasBidAsk) {
        noBidAskCount++;
        continue; // Skip options without live bid/ask (market likely closed)
      }
      const midPrice = (option.bid + option.ask) / 2;
      
      // Skip if missing critical data
      if (midPrice <= 0 || !option.greeks?.delta || !option.expiration_date) {
        continue;
      }

      // Calculate days to expiration
      const expiryDate = new Date(option.expiration_date);
      const daysToExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Check if meets lotto criteria (use mid-price for accurate assessment)
      const meetsLotto = isLottoCandidate({
        lastPrice: midPrice,
        greeks: option.greeks,
        expiration: option.expiration_date,
        symbol: option.symbol
      });

      // 🔒 OTM SANITY CHECK: Reject strikes more than 15% OTM
      // This prevents unrealistic plays like TSLA $557 calls when stock is at $438
      if (meetsLotto && option.underlying) {
        const quote = await getTradierQuote(option.underlying);
        if (quote && quote.last > 0) {
          const underlyingPrice = quote.last;
          const strike = option.strike;
          let otmPercent = 0;
          
          if (option.option_type === 'call') {
            // Call is OTM when strike > current price
            otmPercent = ((strike - underlyingPrice) / underlyingPrice) * 100;
          } else {
            // Put is OTM when strike < current price
            otmPercent = ((underlyingPrice - strike) / underlyingPrice) * 100;
          }
          
          // Max 15% OTM for realistic lotto plays
          const MAX_OTM_PERCENT = 15;
          if (otmPercent > MAX_OTM_PERCENT) {
            logger.info(`🎰 [LOTTO] ❌ REJECTED ${ticker} ${option.option_type.toUpperCase()} $${strike} - ${otmPercent.toFixed(1)}% OTM exceeds ${MAX_OTM_PERCENT}% max (price: $${underlyingPrice.toFixed(2)})`);
            continue;
          }
        }
      }

      if (meetsLotto) {
        const reasons: string[] = [];
        reasons.push(`$${midPrice.toFixed(2)} entry`);
        reasons.push(`Δ ${Math.abs(option.greeks.delta).toFixed(2)}`);
        reasons.push(`${daysToExpiry}d DTE`);
        
        lottoCandidates.push({
          symbol: option.symbol,
          underlying: option.underlying,
          optionType: option.option_type as 'call' | 'put',
          strike: option.strike,
          expiration: option.expiration_date,
          lastPrice: midPrice, // Use mid-price for accurate entry
          delta: option.greeks.delta,
          daysToExpiry,
          volume: option.volume || 0,
          reasons
        });

        logger.info(`🎰 [LOTTO] ✅ FOUND: ${ticker} ${option.option_type.toUpperCase()} $${option.strike} @ $${midPrice.toFixed(2)} - ${reasons.join(', ')}`);
      }
    }

    if (noBidAskCount > 0) {
      logger.info(`🎰 [LOTTO] ${ticker}: Skipped ${noBidAskCount} options without bid/ask (market closed?)`);
    }
    logger.info(`🎰 [LOTTO] ${ticker}: Found ${lottoCandidates.length} lotto candidates`);
    return lottoCandidates;
  } catch (error) {
    logger.error(`🎰 [LOTTO] Error scanning ${ticker}:`, error);
    return [];
  }
}

/**
 * Generate trade idea from lotto candidate with quality checks
 */
async function generateLottoTradeIdea(candidate: LottoCandidate): Promise<InsertTradeIdea | null> {
  try {
    const ticker = candidate.underlying;
    
    // Get current underlying price
    const quote = await getTradierQuote(ticker);
    if (!quote) {
      logger.error(`🎰 [LOTTO] Failed to get quote for ${ticker}`);
      return null;
    }

    // 🔍 QUALITY CHECK: Calculate quality signals and score
    const quality = calculateLottoQuality(quote, candidate);
    const isDayTrade = candidate.daysToExpiry <= 2;
    
    // 🚫 FILTER: Reject low-quality ideas based on DTE
    if (isDayTrade && !quality.isValidForDayTrade) {
      logger.info(`🎰 [LOTTO] ❌ REJECTED ${ticker} day trade - Grade ${quality.grade} (${quality.score}) below B minimum. Signals: ${quality.signals.join(', ')}`);
      return null;
    }
    
    if (!isDayTrade && !quality.isValidForSwingTrade) {
      logger.info(`🎰 [LOTTO] ❌ REJECTED ${ticker} swing trade - Grade ${quality.grade} (${quality.score}) below C minimum. Signals: ${quality.signals.join(', ')}`);
      return null;
    }
    
    logger.info(`🎰 [LOTTO] ✅ QUALITY CHECK PASSED: ${ticker} Grade ${quality.grade} (${quality.score}). Signals: ${quality.signals.join(', ')}`);

    const currentPrice = quote.last;
    // For lotto plays, direction indicates market expectation (call=bullish, put=bearish)
    // But we're BUYING the option in both cases, so premium target is always 20x
    const direction = candidate.optionType === 'call' ? 'long' : 'short';
    
    // Calculate lotto targets with DTE-aware multipliers
    const entryPrice = candidate.lastPrice;
    const { targetPrice, riskRewardRatio, targetMultiplier, dteCategory } = calculateLottoTargets(entryPrice, candidate.expiration);
    
    // Calculate stop loss - 50% of premium for all lotto plays
    // (We're BUYING the option, so stop triggers if premium drops 50%)
    const stopLoss = entryPrice * 0.5;

    // Determine option type label based on DTE
    const optionTypeLabel = candidate.daysToExpiry <= 7 ? 'weekly' : candidate.daysToExpiry <= 30 ? 'monthly' : candidate.daysToExpiry <= 365 ? 'long-dated' : 'LEAPS';
    // 0-2 DTE = day trade, 3-14 DTE = swing trade, 15+ DTE = position trade
    const holdingTypeLabel = isDayTrade ? 'Day trade' : candidate.daysToExpiry <= 14 ? 'Swing trade' : 'Position trade';
    
    // Generate analysis with quality context and DTE-aware targets
    const qualityContext = `[${quality.grade}] ${quality.signals.slice(0, 3).join(', ')}`;
    const targetLabel = dteCategory === '0DTE' ? '4x gamma play' : dteCategory === '1-2DTE' ? '7x short-term' : '15x weekly';
    const analysis = `🎰 LOTTO PLAY: ${ticker} ${candidate.optionType.toUpperCase()} $${candidate.strike} expiring ${formatInTimeZone(new Date(candidate.expiration), 'America/Chicago', 'MMM dd, yyyy')} - Far OTM play (Δ ${Math.abs(candidate.delta).toFixed(2)}) targeting ${targetMultiplier}x return (${targetLabel}). Entry: $${entryPrice.toFixed(2)}, Target: $${targetPrice.toFixed(2)}. Quality: ${qualityContext}. HIGH RISK: ${optionTypeLabel} option with ${candidate.daysToExpiry}d until expiry. ${holdingTypeLabel} - sized for small account growth ($0.20-$2.00 entry range).`;

    // Get entry/exit windows based on DTE (days to expiry)
    const now = new Date();
    const dte = candidate.daysToExpiry;
    
    // Entry window scales with DTE:
    // - Short-dated (0-7 DTE): 1 hour entry window (act fast, theta decay)
    // - Medium-dated (8-30 DTE): 4 hours entry window  
    // - Long-dated (31-90 DTE): 24 hours entry window
    // - LEAPS (91+ DTE): 48 hours entry window (more time to enter position trades)
    let entryWindowMinutes: number;
    if (dte <= 7) {
      entryWindowMinutes = 60; // 1 hour
    } else if (dte <= 30) {
      entryWindowMinutes = 240; // 4 hours
    } else if (dte <= 90) {
      entryWindowMinutes = 1440; // 24 hours (1 day)
    } else {
      entryWindowMinutes = 2880; // 48 hours (2 days)
    }
    
    const entryValidUntilDate = new Date(now.getTime() + entryWindowMinutes * 60 * 1000);
    const entryWindow = formatInTimeZone(entryValidUntilDate, 'America/Chicago', "yyyy-MM-dd'T'HH:mm:ssXXX");
    
    // Exit window scales with DTE - give position time to work:
    // - Weekly (0-7 DTE): Exit same day/next day
    // - Monthly (8-30 DTE): Exit within 5-7 days (swing trade)
    // - Quarterly (31-90 DTE): Exit within 2-3 weeks
    // - LEAPS (91-365 DTE): Exit within 30-45 days
    // - Long LEAPS (365+ DTE): Exit within 60-90 days
    let exitWindowDays: number;
    let holdingPeriod: 'day' | 'swing' | 'position';
    
    // UPDATED: Hold contracts longer - user requested swing trades over day trades
    if (dte <= 1) {
      // 0-1 DTE: Short swing - hold 1-2 days (was day trade)
      exitWindowDays = 2;
      holdingPeriod = 'swing'; // Changed from 'day' to 'swing'
    } else if (dte <= 4) {
      // 2-4 DTE: Swing trade - hold 2-3 days
      exitWindowDays = Math.min(3, dte); 
      holdingPeriod = 'swing';
    } else if (dte <= 14) {
      // 5-14 DTE: Extended swing - hold 4-7 days
      exitWindowDays = Math.min(7, Math.floor(dte * 0.6)); // 60% of DTE, max 7 days
      holdingPeriod = 'swing';
    } else if (dte <= 45) {
      // 15-45 DTE: Long swing - hold 7-14 days
      exitWindowDays = Math.min(14, Math.floor(dte * 0.5)); // 50% of DTE, max 14 days
      holdingPeriod = 'swing';
    } else if (dte <= 180) {
      // 45-180 DTE: Position trade - hold 14-30 days
      exitWindowDays = Math.min(30, Math.floor(dte * 0.3)); // 30% of DTE, max 30 days
      holdingPeriod = 'position';
    } else {
      // LEAPS (180+ DTE) - hold 45-60 days
      exitWindowDays = Math.min(60, Math.floor(dte * 0.2)); // 20% of DTE, max 60 days
      holdingPeriod = 'position';
    }
    
    // Calculate exit time (market close on that day, 3:30 PM CT)
    const exitDate = new Date(now);
    exitDate.setDate(exitDate.getDate() + exitWindowDays);
    exitDate.setHours(15, 30, 0, 0); // 3:30 PM CT
    const exitBy = formatInTimeZone(exitDate, 'America/Chicago', "yyyy-MM-dd'T'HH:mm:ssXXX");
    
    logger.info(`🎰 [LOTTO] ${ticker} TIMING: DTE=${dte}d → Entry window ${entryWindowMinutes}min, Exit in ${exitWindowDays}d (${holdingPeriod} trade)`);

    // Create trade idea
    const sectorFocus = detectSectorFocus(ticker);
    const riskProfile = detectRiskProfile(ticker, entryPrice, true, 'option'); // Always speculative for lotto
    const researchHorizon = detectResearchHorizon(holdingPeriod, candidate.daysToExpiry);
    
    const idea: InsertTradeIdea = {
      symbol: ticker,
      assetType: 'option' as const,
      direction,
      entryPrice,
      targetPrice,
      stopLoss,
      riskRewardRatio,
      confidenceScore: quality.score, // Dynamic confidence based on quality signals
      qualitySignals: quality.signals, // Store actual quality signals
      probabilityBand: quality.grade, // Store the calculated grade
      catalyst: `🎰 ${ticker} ${candidate.optionType.toUpperCase()} $${candidate.strike} | ${quality.grade} | Δ${Math.abs(candidate.delta).toFixed(2)} | ${dte}d DTE | ${holdingPeriod} trade`,
      analysis,
      sessionContext: `Market hours - Lotto play on ${ticker} (${holdingPeriod} trade)`,
      holdingPeriod,
      source: 'lotto',
      strikePrice: candidate.strike,
      optionType: candidate.optionType,
      expiryDate: candidate.expiration,
      entryValidUntil: entryWindow,
      exitBy,
      isLottoPlay: true, // FLAG AS LOTTO PLAY
      timestamp: formatInTimeZone(now, 'America/Chicago', "yyyy-MM-dd'T'HH:mm:ssXXX"),
      sectorFocus,
      riskProfile,
      researchHorizon,
      liquidityWarning: true, // All lotto plays get liquidity warning
      engineVersion: 'lotto_v3.1.0_quality_gated', // Track quality-gated version
    };

    // Basic validation: ensure prices make sense
    if (direction === 'long' && targetPrice <= entryPrice) {
      logger.warn(`🎰 [LOTTO] ${ticker} invalid prices for long: target must be > entry`);
      return null;
    }
    if (direction === 'short' && targetPrice >= entryPrice) {
      logger.warn(`🎰 [LOTTO] ${ticker} invalid prices for short: target must be < entry`);
      return null;
    }

    logger.info(`🎰 [LOTTO] ✅ Generated lotto play: ${ticker} ${candidate.optionType.toUpperCase()} $${candidate.strike} [${quality.grade}] - Entry $${entryPrice.toFixed(2)}, Target $${targetPrice.toFixed(2)} (20x)`);
    return idea;
  } catch (error) {
    logger.error(`🎰 [LOTTO] Error generating trade idea for ${candidate.underlying}:`, error);
    return null;
  }
}

/**
 * Main lotto scanner - hunt for cheap far-OTM weeklies across all tickers
 */
export async function runLottoScanner(): Promise<void> {
  try {
    logger.info(`🎰 [LOTTO] ========== LOTTO SCANNER STARTED ==========`);
    
    // 🔒 MARKET HOURS CHECK: Only scan when market is open
    const marketStatus = isMarketOpen();
    if (!marketStatus.isOpen) {
      logger.info(`🎰 [LOTTO] Skipping scan - ${marketStatus.reason}. Data would be stale.`);
      return;
    }
    
    const startTime = Date.now();

    const allCandidates: LottoCandidate[] = [];
    
    // Scan all tickers for lotto plays
    const { checkAndMarkScanned } = await import('./scan-deduper');
    for (const ticker of LOTTO_SCAN_TICKERS) {
      // 🛡️ GLOBAL SCAN DEDUP - Skip if recently scanned by ANY scanner
      const scanCheck = checkAndMarkScanned(ticker, 'lotto');
      if (scanCheck.shouldSkip) {
        logger.debug(`🎰 [LOTTO] ⏭️ Skipped ${ticker} - ${scanCheck.reason}`);
        continue;
      }
      const candidates = await scanForLottoPlays(ticker);
      allCandidates.push(...candidates);
    }

    logger.info(`🎰 [LOTTO] Total candidates found: ${allCandidates.length}`);

    // Sort by best opportunities (cheapest entry, lowest delta = furthest OTM)
    allCandidates.sort((a, b) => {
      // Prefer cheaper entries
      if (a.lastPrice !== b.lastPrice) {
        return a.lastPrice - b.lastPrice;
      }
      // Then prefer lower delta (further OTM)
      return Math.abs(a.delta) - Math.abs(b.delta);
    });

    // Generate trade ideas for top 5 lotto plays
    const TOP_LOTTO_PLAYS = 5;
    const topCandidates = allCandidates.slice(0, TOP_LOTTO_PLAYS);
    
    let successCount = 0;
    let duplicateCount = 0;

    for (const candidate of topCandidates) {
      const idea = await generateLottoTradeIdea(candidate);
      if (idea) {
        // Spine 4h dedup. If it returns a pre-existing idea (timestamp differs
        // from the one we just built), it was a duplicate — skip the Discord
        // alert + auto-execute side-effects below.
        const createdIdea = await storage.createTradeIdea(idea, { dedupWindowHours: 4 });
        if (createdIdea.timestamp !== idea.timestamp) {
          logger.info(`🎰 [LOTTO] Skipping duplicate: ${candidate.underlying} ${candidate.optionType.toUpperCase()} $${candidate.strike}`);
          duplicateCount++;
          continue;
        }
        successCount++;
        
        // 🎯 CONVERGENCE TRACKING: Record lotto play for heat map
        try {
          await recordSymbolAttention(candidate.underlying, 'trade_idea', 'idea', {
            direction: candidate.optionType === 'call' ? 'bullish' : 'bearish',
            confidence: createdIdea.confidenceScore || 60,
            grade: (createdIdea as any).grade || 'B',
            message: `Lotto ${candidate.optionType.toUpperCase()} $${candidate.strike} @ $${candidate.lastPrice.toFixed(2)}`
          });
        } catch (attentionErr) {
          logger.debug(`🎰 [LOTTO] Attention tracking failed:`, attentionErr);
        }
        
        // ✅ RE-ENABLED: Lotto Discord notifications (user wants multi-channel alerts)
        // Lottos now go to both #lotto AND #quantbot channels
        try {
          await sendLottoToDiscord(createdIdea as TradeIdea);
          logger.info(`🎰 [LOTTO] Discord notification sent for ${candidate.underlying}`);
        } catch (discordError) {
          logger.warn(`🎰 [LOTTO] Discord notification failed for ${candidate.underlying}:`, discordError);
        }
        
        // Auto-execute in paper trading portfolio
        try {
          const { autoExecuteLotto } = await import('./auto-lotto-trader');
          await autoExecuteLotto(createdIdea as TradeIdea);
        } catch (autoTradeError) {
          logger.warn(`🎰 [LOTTO] Auto-trade failed for ${candidate.underlying}:`, autoTradeError);
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`🎰 [LOTTO] ========== SCAN COMPLETE ==========`);
    logger.info(`🎰 [LOTTO] Duration: ${duration}s`);
    logger.info(`🎰 [LOTTO] Candidates: ${allCandidates.length}`);
    logger.info(`🎰 [LOTTO] Generated: ${successCount}`);
    logger.info(`🎰 [LOTTO] Duplicates: ${duplicateCount}`);
  } catch (error) {
    logger.error(`🎰 [LOTTO] Fatal error in scanner:`, error);
  }
}

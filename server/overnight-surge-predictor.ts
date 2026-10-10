/**
 * Overnight Surge Predictor
 *
 * PREDICTIVE system to identify stocks at EOD that might surge 10-40% tomorrow.
 * Unlike the reactive surge detection (finds stocks already surging), this
 * predicts BEFORE the move happens.
 *
 * Predictive Factors:
 * 1. Consolidation Breakout Setup - Tight range + decreasing volume = explosion pending
 * 2. Volume Accumulation - Smart money building positions quietly
 * 3. Technical Reversal Patterns - Oversold bounce, hammer, morning star
 * 4. After-Hours Activity - Pre-market/AH moves signaling tomorrow
 * 5. Catalyst Alignment - Earnings, FDA, sector momentum
 * 6. Options Flow - Unusual call activity indicating expected moves
 */

import { logger } from './logger';

interface OvernightPrediction {
  symbol: string;
  companyName?: string;
  currentPrice: number;
  prediction: {
    tier: 'HIGH_CONVICTION' | 'STRONG_SETUP' | 'WATCH_CLOSELY' | 'SPECULATIVE';
    targetRange: { low: number; high: number };
    probability: number; // 0-100
    timeframe: 'overnight' | 'next_day' | '2-3_days';
  };
  signals: {
    name: string;
    strength: number; // 1-10
    description: string;
  }[];
  catalyst?: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  score: number;
  technicalSetup?: string;
  volumeProfile?: string;
}

// Universe of stocks known for big moves (momentum names, small caps, high beta)
const SURGE_CANDIDATE_UNIVERSE = [
  // Quantum/AI - Extreme volatility, can move 20-40% on news
  'IONQ', 'RGTI', 'QUBT', 'QBTS', 'AI', 'SOUN', 'BBAI', 'BIGB',

  // Space/Aviation - Catalyst-driven moves
  'RKLB', 'LUNR', 'JOBY', 'ACHR', 'ASTS', 'RDW', 'LLAP', 'SPCE',

  // Nuclear/Uranium - Policy-sensitive, gap potential
  'NNE', 'OKLO', 'SMR', 'CCJ', 'LEU', 'UUUU', 'UEC', 'DNN', 'URG', 'NXE',

  // Semiconductors - High momentum names
  'ARM', 'NVDA', 'AMD', 'SMCI', 'AVGO', 'MRVL', 'MU', 'TSM', 'ASML',

  // Crypto/Mining - BTC correlation, extreme vol (APLD = AI/crypto data centers)
  'MSTR', 'COIN', 'MARA', 'RIOT', 'CLSK', 'WULF', 'BITF', 'CORZ', 'IREN', 'HUT', 'APLD',

  // EV/Green - Sector moves together
  'TSLA', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'QS', 'CHPT', 'BLNK',

  // Biotech - Binary events, FDA plays
  'MRNA', 'BNTX', 'NVAX', 'SAVA', 'PRTA', 'IMVT', 'QURE', 'BLUE', 'EDIT',

  // Fintech/Growth - High beta to market (ONDS, ZETA frequent surgers)
  'ONDS', 'ZETA', 'SOFI', 'HOOD', 'UPST', 'AFRM', 'SQ', 'PYPL', 'NU', 'COIN', 'BILL', 'TOST',

  // Social/Tech - Meme potential
  'RDDT', 'SNAP', 'PINS', 'RBLX', 'U', 'PLTR', 'DKNG', 'PENN',

  // Small Cap Movers - High risk/reward
  'GEVO', 'PLUG', 'FCEL', 'BE', 'STEM', 'ENVX', 'BLDP', 'PTRA',

  // Defense/Security - Geopolitical plays
  'LMT', 'RTX', 'NOC', 'GD', 'KTOS', 'PLTR', 'PANW', 'CRWD', 'ZS'
];

/**
 * Analyze a single stock for overnight surge potential
 */
async function analyzeForOvernightSurge(
  yahooFinance: any,
  symbol: string
): Promise<OvernightPrediction | null> {
  try {
    // Get quote and historical data
    const [quote, historicalData] = await Promise.all([
      yahooFinance.quote(symbol),
      yahooFinance.historical(symbol, {
        period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        period2: new Date(),
        interval: '1d'
      }).catch(() => [])
    ]);

    if (!quote || !quote.regularMarketPrice) return null;

    const price = quote.regularMarketPrice;
    const signals: OvernightPrediction['signals'] = [];
    let score = 30; // Base score
    let tier: OvernightPrediction['prediction']['tier'] = 'SPECULATIVE';
    let riskLevel: OvernightPrediction['riskLevel'] = 'HIGH';

    // ============================================
    // SIGNAL 1: CONSOLIDATION BREAKOUT SETUP
    // Stocks in tight range with decreasing volume are coiled to explode
    // ============================================
    if (historicalData && historicalData.length >= 10) {
      const last10Days = historicalData.slice(-10);
      const highs = last10Days.map((d: any) => d.high);
      const lows = last10Days.map((d: any) => d.low);
      const volumes = last10Days.map((d: any) => d.volume);

      const maxHigh = Math.max(...highs);
      const minLow = Math.min(...lows);
      const rangePercent = ((maxHigh - minLow) / minLow) * 100;

      // Tight range (< 8% over 10 days) = consolidation
      if (rangePercent < 8) {
        const recentVolAvg = volumes.slice(-3).reduce((a: number, b: number) => a + b, 0) / 3;
        const olderVolAvg = volumes.slice(0, 5).reduce((a: number, b: number) => a + b, 0) / 5;
        const volumeDecreasing = recentVolAvg < olderVolAvg * 0.7;

        if (volumeDecreasing) {
          signals.push({
            name: 'Consolidation Coil',
            strength: 9,
            description: `Tight ${rangePercent.toFixed(1)}% range with volume drying up - explosion imminent`
          });
          score += 25;
        } else {
          signals.push({
            name: 'Tight Range',
            strength: 6,
            description: `${rangePercent.toFixed(1)}% consolidation - watching for breakout`
          });
          score += 12;
        }
      }
    }

    // ============================================
    // SIGNAL 2: VOLUME ACCUMULATION
    // Smart money buying quietly before big moves
    // ============================================
    const volume = quote.regularMarketVolume || 0;
    const avgVolume = quote.averageDailyVolume10Day || quote.averageVolume || volume;
    const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;

    // High volume with small price move = accumulation
    const dayChange = quote.regularMarketChangePercent || 0;
    if (volumeRatio >= 2 && Math.abs(dayChange) < 3) {
      signals.push({
        name: 'Volume Accumulation',
        strength: 8,
        description: `${volumeRatio.toFixed(1)}x volume with only ${dayChange > 0 ? '+' : ''}${dayChange.toFixed(1)}% move - institutions loading`
      });
      score += 20;
    } else if (volumeRatio >= 1.5) {
      signals.push({
        name: 'Volume Interest',
        strength: 5,
        description: `${volumeRatio.toFixed(1)}x average volume today`
      });
      score += 10;
    }

    // ============================================
    // SIGNAL 3: TECHNICAL REVERSAL SETUP
    // Oversold conditions ready for bounce
    // ============================================
    const fiftyTwoWeekHigh = quote.fiftyTwoWeekHigh || price;
    const fiftyTwoWeekLow = quote.fiftyTwoWeekLow || price;
    const fromHigh = ((fiftyTwoWeekHigh - price) / fiftyTwoWeekHigh) * 100;
    const fromLow = ((price - fiftyTwoWeekLow) / fiftyTwoWeekLow) * 100;

    // Deeply oversold (> 40% from highs) with recent green day
    if (fromHigh > 40 && dayChange > 0) {
      signals.push({
        name: 'Oversold Bounce Setup',
        strength: 7,
        description: `${fromHigh.toFixed(0)}% off highs, showing buying interest (+${dayChange.toFixed(1)}%)`
      });
      score += 15;
      riskLevel = 'EXTREME'; // High risk, high reward
    }

    // Near 52-week highs = momentum confirmed
    if (fromHigh < 5) {
      signals.push({
        name: 'Breakout Momentum',
        strength: 8,
        description: 'Near 52-week highs - momentum players watching'
      });
      score += 18;
      riskLevel = 'MEDIUM';
    }

    // ============================================
    // SIGNAL 4: AFTER-HOURS ACTIVITY
    // Pre/post market moves signal next-day action
    // ============================================
    const preMarketPrice = quote.preMarketPrice || 0;
    const postMarketPrice = quote.postMarketPrice || 0;

    if (preMarketPrice > 0) {
      const preMarketChange = ((preMarketPrice - price) / price) * 100;
      if (Math.abs(preMarketChange) >= 2) {
        signals.push({
          name: 'Pre-Market Move',
          strength: 8,
          description: `${preMarketChange > 0 ? '+' : ''}${preMarketChange.toFixed(1)}% in pre-market`
        });
        score += Math.min(25, Math.abs(preMarketChange) * 3);
      }
    }

    if (postMarketPrice > 0) {
      const postMarketChange = ((postMarketPrice - price) / price) * 100;
      if (Math.abs(postMarketChange) >= 2) {
        signals.push({
          name: 'After-Hours Activity',
          strength: 8,
          description: `${postMarketChange > 0 ? '+' : ''}${postMarketChange.toFixed(1)}% after hours - gap potential`
        });
        score += Math.min(25, Math.abs(postMarketChange) * 3);
      }
    }

    // ============================================
    // SIGNAL 5: PRICE POSITION ANALYSIS
    // Where stock sits in its range matters
    // ============================================
    const dayHigh = quote.regularMarketDayHigh || price;
    const dayLow = quote.regularMarketDayLow || price;
    const dayRange = dayHigh - dayLow;

    if (dayRange > 0) {
      const positionInRange = (price - dayLow) / dayRange;

      // Closing near highs = bullish continuation likely
      if (positionInRange > 0.9) {
        signals.push({
          name: 'Strong Close',
          strength: 7,
          description: 'Closing near day highs - follow-through likely'
        });
        score += 12;
      }

      // Closing near lows with high volume = potential reversal
      if (positionInRange < 0.2 && volumeRatio >= 1.5) {
        signals.push({
          name: 'Capitulation Setup',
          strength: 6,
          description: 'Closing weak on volume - reversal bounce possible'
        });
        score += 8;
      }
    }

    // ============================================
    // SIGNAL 6: SECTOR/THEME BONUS
    // Hot sectors get extra weight
    // ============================================
    let sectorBonus = '';
    if (['IONQ', 'RGTI', 'QUBT', 'QBTS'].includes(symbol)) {
      sectorBonus = '⚛️ Quantum Computing';
      score += 10;
    } else if (['AI', 'SOUN', 'BBAI', 'PLTR'].includes(symbol)) {
      sectorBonus = '🤖 AI Play';
      score += 10;
    } else if (['NNE', 'OKLO', 'SMR', 'CCJ', 'LEU'].includes(symbol)) {
      sectorBonus = '⚡ Nuclear/Uranium';
      score += 10;
    } else if (['RKLB', 'LUNR', 'JOBY', 'ACHR', 'ASTS'].includes(symbol)) {
      sectorBonus = '🚀 Space/Aviation';
      score += 10;
    } else if (['MSTR', 'COIN', 'MARA', 'RIOT', 'CLSK', 'APLD', 'IREN', 'WULF', 'BITF'].includes(symbol)) {
      sectorBonus = '₿ Crypto/Data Center';
      score += 10;
    } else if (['MRNA', 'BNTX', 'NVAX', 'SAVA'].includes(symbol)) {
      sectorBonus = '🧬 Biotech Catalyst';
      score += 8;
    } else if (['ONDS', 'ZETA', 'SOFI', 'HOOD', 'UPST', 'AFRM'].includes(symbol)) {
      sectorBonus = '💳 Fintech Momentum';
      score += 10;
    }

    if (sectorBonus) {
      signals.push({
        name: 'Hot Sector',
        strength: 6,
        description: sectorBonus
      });
    }

    // ============================================
    // CALCULATE PREDICTION TIER
    // ============================================
    score = Math.min(94, score); // Cap at 94

    if (score >= 75) {
      tier = 'HIGH_CONVICTION';
      riskLevel = 'MEDIUM';
    } else if (score >= 60) {
      tier = 'STRONG_SETUP';
    } else if (score >= 45) {
      tier = 'WATCH_CLOSELY';
    } else {
      tier = 'SPECULATIVE';
    }

    // Only return meaningful predictions
    if (signals.length < 2 || score < 40) {
      return null;
    }

    // Calculate target range based on setup
    const avgSignalStrength = signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;
    const targetLow = price * (1 + (avgSignalStrength * 1.5) / 100);
    const targetHigh = price * (1 + (avgSignalStrength * 4) / 100);

    return {
      symbol,
      companyName: quote.shortName || quote.longName,
      currentPrice: price,
      prediction: {
        tier,
        targetRange: { low: targetLow, high: targetHigh },
        probability: Math.min(85, 30 + score * 0.6),
        timeframe: preMarketPrice || postMarketPrice ? 'overnight' : 'next_day'
      },
      signals: signals.sort((a, b) => b.strength - a.strength),
      riskLevel,
      score,
      technicalSetup: signals.find(s => s.name.includes('Consolidation') || s.name.includes('Breakout'))?.description,
      volumeProfile: signals.find(s => s.name.includes('Volume'))?.description
    };

  } catch (error) {
    logger.debug(`[OVERNIGHT] Failed to analyze ${symbol}:`, error);
    return null;
  }
}

/**
 * Scan for overnight surge candidates
 * Call this near market close (3-4 PM ET) for best results
 */
export async function scanOvernightSurgeCandidates(): Promise<OvernightPrediction[]> {
  logger.info('[OVERNIGHT-PREDICTOR] 🌐 Scanning MARKET-WIDE for next-day surge candidates...');

  const predictions: OvernightPrediction[] = [];
  const scannedSymbols = new Set<string>();

  try {
    const yahooFinance = (await import('yahoo-finance2')).default;

    // STEP 1: MARKET-WIDE SCAN - Get today's top gainers (they might continue tomorrow)
    // This catches ANY stock that's hot, not just our watchlist
    let marketWideSymbols: string[] = [];
    try {
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 8000)
      );

      const gainersPromise = yahooFinance.screener({
        scrIds: 'day_gainers',
        count: 50, // Get top 50 market-wide gainers
      }).catch(() => null);

      const gainers = await Promise.race([gainersPromise, timeoutPromise]);

      if (gainers?.quotes) {
        for (const quote of gainers.quotes as any[]) {
          if (!quote.symbol || quote.symbol.includes('.') || quote.symbol.length > 5) continue;
          // Only include stocks with 5%+ gain (momentum plays)
          const change = quote.regularMarketChangePercent || 0;
          if (change >= 5) {
            marketWideSymbols.push(quote.symbol);
          }
        }
      }

      if (marketWideSymbols.length > 0) {
        logger.info(`[OVERNIGHT-PREDICTOR] 🔥 Found ${marketWideSymbols.length} HOT stocks from market scan: ${marketWideSymbols.slice(0, 8).join(', ')}`);
      }
    } catch (e) {
      logger.error('[OVERNIGHT-PREDICTOR] Market-wide scan failed:', e);
    }

    // STEP 2: Analyze market-wide gainers FIRST (these are today's movers)
    for (let i = 0; i < marketWideSymbols.length; i += 5) {
      const batch = marketWideSymbols.slice(i, i + 5);

      const results = await Promise.allSettled(
        batch.map(symbol => analyzeForOvernightSurge(yahooFinance, symbol))
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          predictions.push(result.value);
          scannedSymbols.add(result.value.symbol);
        }
      }

      await new Promise(r => setTimeout(r, 300));
    }

    // STEP 3: Also scan our curated watchlist (for stocks that haven't moved yet)
    const watchlistToScan = SURGE_CANDIDATE_UNIVERSE.filter(s => !scannedSymbols.has(s));

    const batchSize = 8;
    for (let i = 0; i < watchlistToScan.length; i += batchSize) {
      const batch = watchlistToScan.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(symbol => analyzeForOvernightSurge(yahooFinance, symbol))
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          predictions.push(result.value);
        }
      }

      await new Promise(r => setTimeout(r, 400));
    }

    // Sort by score (highest conviction first)
    predictions.sort((a, b) => b.score - a.score);

    const highConviction = predictions.filter(p => p.prediction.tier === 'HIGH_CONVICTION').length;
    const strongSetups = predictions.filter(p => p.prediction.tier === 'STRONG_SETUP').length;
    const fromMarketScan = marketWideSymbols.filter(s => predictions.some(p => p.symbol === s)).length;

    logger.info(`[OVERNIGHT-PREDICTOR] ✅ Found ${predictions.length} candidates: ${highConviction} HIGH_CONVICTION, ${strongSetups} STRONG_SETUP (${fromMarketScan} from market-wide scan)`);

    return predictions.slice(0, 30); // Return more candidates

  } catch (error) {
    logger.error('[OVERNIGHT-PREDICTOR] Scan failed:', error);
    return [];
  }
}

/**
 * Get high conviction predictions only
 */
export function getHighConvictionPredictions(predictions: OvernightPrediction[]): OvernightPrediction[] {
  return predictions.filter(p =>
    p.prediction.tier === 'HIGH_CONVICTION' ||
    (p.prediction.tier === 'STRONG_SETUP' && p.score >= 65)
  );
}

/**
 * Check if market is approaching close (best time to run)
 */
export function isNearMarketClose(): boolean {
  const now = new Date();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();

  // Market close is 4 PM ET = 21:00 UTC (winter) or 20:00 UTC (summer)
  // Best scanning time: 3-4 PM ET = 20:00-21:00 UTC (winter) or 19:00-20:00 UTC (summer)
  const hourUTC = hours;

  // Roughly 3-4 PM ET window
  return (hourUTC >= 19 && hourUTC <= 21);
}

export { SURGE_CANDIDATE_UNIVERSE };

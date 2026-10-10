import { logger } from './logger';
import { enrichStockWithCatalysts, formatCatalystBadge } from './catalyst-tracker-service';
import type { AnyCatalyst } from '../shared/catalyst-types';
import { safeScreener } from './yahoo-finance-service';

interface BreakoutCandidate {
  symbol: string;
  price: number;
  score: number;
  reason: string;
  upside?: number;
  volume?: number;
  change?: number;
  sector?: string;
  tier?: 'SURGE' | 'MOMENTUM' | 'SETUP' | 'WATCH';
  isRealMover?: boolean; // From actual market movers
  // Catalyst enrichment
  catalyst?: {
    type: string;
    title: string;
    value?: string;
    icon: string;
    color: string;
  };
  catalystScore?: number;
  hasCatalyst?: boolean;
}

interface RealMover {
  symbol: string;
  change: number;
  price: number;
  volume: number;
}

// Fetch actual market movers from Yahoo Finance - AGGRESSIVE market-wide scan
async function fetchRealMarketMovers(): Promise<string[]> {
  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 8000)
    );

    // Get day gainers - these are ACTUAL surging stocks across the ENTIRE market
    const gainersPromise = safeScreener({
      scrIds: 'day_gainers',
      count: 100, // INCREASED - catch more surging stocks market-wide
    });

    const gainers = await Promise.race([gainersPromise, timeoutPromise]);

    const symbols: string[] = [];

    if (gainers?.quotes) {
      for (const quote of gainers.quotes) {
        // Filter: valid US stocks only (no ADRs with dots, reasonable ticker length)
        if (quote.symbol &&
            !quote.symbol.includes('.') &&
            quote.symbol.length <= 5 &&
            quote.symbol.length >= 1) {
          symbols.push(quote.symbol);
        }
      }
    }

    if (symbols.length > 0) {
      logger.info(`[MARKET-WIDE-SCAN] 🔍 Fetched ${symbols.length} REAL market movers: ${symbols.slice(0, 10).join(', ')}...`);
    }
    return symbols;
  } catch (e) {
    logger.error('[MARKET-WIDE-SCAN] Failed to fetch market movers:', e);
    return [];
  }
}

// NEW: Fetch detailed data for real market movers - this is where we catch ANY surging stock
async function fetchDetailedMarketMovers(): Promise<RealMover[]> {
  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 10000)
    );

    // Fetch top gainers AND most active stocks
    const [gainersResult, activeResult] = await Promise.all([
      Promise.race([
        safeScreener({ scrIds: 'day_gainers', count: 50 }),
        timeoutPromise
      ]),
      Promise.race([
        safeScreener({ scrIds: 'most_actives', count: 30 }),
        new Promise<null>((r) => setTimeout(() => r(null), 10000))
      ])
    ]);

    const movers: RealMover[] = [];
    const seen = new Set<string>();

    // Process gainers - these are the BIG movers we want
    if (gainersResult?.quotes) {
      for (const quote of gainersResult.quotes as any[]) {
        if (!quote.symbol || quote.symbol.includes('.') || quote.symbol.length > 5) continue;
        if (seen.has(quote.symbol)) continue;
        seen.add(quote.symbol);

        movers.push({
          symbol: quote.symbol,
          change: quote.regularMarketChangePercent || 0,
          price: quote.regularMarketPrice || 0,
          volume: quote.regularMarketVolume || 0
        });
      }
    }

    // Also add most active (high volume = potential breakout)
    if (activeResult?.quotes) {
      for (const quote of activeResult.quotes as any[]) {
        if (!quote.symbol || quote.symbol.includes('.') || quote.symbol.length > 5) continue;
        if (seen.has(quote.symbol)) continue;
        seen.add(quote.symbol);

        // Only include if green
        const change = quote.regularMarketChangePercent || 0;
        if (change > 0) {
          movers.push({
            symbol: quote.symbol,
            change,
            price: quote.regularMarketPrice || 0,
            volume: quote.regularMarketVolume || 0
          });
        }
      }
    }

    // Sort by change descending - biggest movers first
    movers.sort((a, b) => b.change - a.change);

    logger.info(`[MARKET-WIDE-SCAN] 🎯 Detailed scan found ${movers.length} movers. Top 5: ${movers.slice(0, 5).map(m => `${m.symbol} +${m.change.toFixed(1)}%`).join(', ')}`);

    return movers;
  } catch (e) {
    logger.error('[MARKET-WIDE-SCAN] Detailed fetch failed:', e);
    return [];
  }
}

const SURGE_WATCH_UNIVERSE = [
  // Semiconductors - HIGH PRIORITY (ARM surge situation)
  'ARM', 'NVDA', 'AMD', 'INTC', 'AVGO', 'QCOM', 'MU', 'MRVL', 'SWKS', 'ON',
  'AMAT', 'LRCX', 'KLAC', 'ASML', 'TSM', 'SNPS', 'CDNS', 'WOLF', 'MPWR', 'ALGM',
  
  // AI/Quantum - Growth plays
  'IONQ', 'RGTI', 'QUBT', 'AI', 'SOUN', 'PLTR', 'PATH', 'SNOW', 'MDB', 'DDOG',
  'CRWD', 'ZS', 'NET', 'ESTC', 'CFLT', 'GTLB', 'DOCN', 'DT', 'NEWR', 'SUMO',
  
  // Space/Aviation - Momentum plays
  'RKLB', 'LUNR', 'JOBY', 'ACHR', 'ASTS', 'SPCE', 'RDW', 'LLAP', 'BA', 'LMT',
  'RTX', 'NOC', 'GD', 'HII', 'TDG', 'HWM', 'SPR', 'KTOS', 'AVAV', 'AXON',
  
  // Nuclear/Energy - Policy plays  
  'NNE', 'OKLO', 'SMR', 'CCJ', 'LEU', 'UUUU', 'UEC', 'DNN', 'URG', 'NXE',
  'BWXT', 'FLR', 'BWE', 'VST', 'CEG', 'NRG', 'AES', 'NEE', 'SO', 'DUK',
  
  // Crypto/Mining - Volatility plays
  'COIN', 'MARA', 'RIOT', 'BITF', 'HIVE', 'CLSK', 'WULF', 'CORZ', 'IREN', 'HUT',
  'BTBT', 'CIFR', 'ARBK', 'GREE', 'MSTR', 'XYZ', 'PYPL', 'AFRM', 'NU', 'HOOD',
  
  // EV/Auto - Sector plays
  'TSLA', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'FSR', 'GOEV', 'NKLA', 'HYLN',
  'QS', 'CHPT', 'BLNK', 'EVGO', 'GM', 'F', 'TM', 'HMC', 'STLA', 'RACE',
  
  // China/Emerging - Rebound plays
  'BABA', 'JD', 'PDD', 'BIDU', 'TME', 'BILI', 'IQ', 'NTES', 'SE', 'GRAB',
  'MELI', 'STNE', 'PAGS', 'VTEX', 'DLO', 'GLBE', 'SHOP', 'WIX', 'BIGC', 'CPNG',
  
  // Social/Media - Trend plays
  'SNAP', 'PINS', 'MTCH', 'BMBL', 'RDDT', 'YELP', 'TTD', 'ROKU', 'PUBM', 'MGNI',
  'CRTO', 'DV', 'IAS', 'APPS', 'FLYW', 'ZI', 'TWLO', 'DBX', 'BOX', 'FVRR',
  
  // Growth/Tech - FOMO plays
  'SOFI', 'UPST', 'ONDAS', 'ZETA', 'HIMS', 'DOCS', 'TDOC', 'AMWL', 'LVGO', 'CERT',
  'SMCI', 'DELL', 'HPE', 'NTAP', 'WDC', 'STX', 'PANW', 'OKTA', 'FTNT',
  
  // Biotech/Health - Catalyst plays
  'MRNA', 'BNTX', 'NVAX', 'ARKG', 'XBI', 'SGEN', 'VRTX', 'REGN', 'ILMN', 'EXAS',

  // Precious Metals & Commodities - Silver, Gold, Copper plays
  'SLV', 'PSLV', 'AGI', 'AG', 'PAAS', 'HL', 'EXK', 'MAG', 'FSM', 'WPM', // Silver
  'GLD', 'IAU', 'GDX', 'GDXJ', 'GOLD', 'NEM', 'AEM', 'KGC', 'FNV', 'RGLD', // Gold
  'COPX', 'CPER', 'FCX', 'SCCO', 'TECK', 'RIO', 'BHP', 'VALE', // Copper & Base metals
  'USO', 'XLE', 'OXY', 'COP', 'DVN', 'EOG', 'FANG', 'HES', 'MRO' // Oil & Energy
];

export async function discoverBreakoutCandidates(): Promise<BreakoutCandidate[]> {
  logger.info('[MARKET-WIDE-SCAN] 🔍 Scanning ENTIRE MARKET for surging stocks...');

  const candidates: BreakoutCandidate[] = [];

  try {
    const yahooFinance = (await import('yahoo-finance2')).default;

    // STEP 1: Fetch REAL market movers - THIS IS PRIMARY (catches APLD, LAZR, any surging stock)
    const detailedMovers = await fetchDetailedMarketMovers();
    const realMovers = await fetchRealMarketMovers();

    // Create a set of all real movers for quick lookup
    const realMoverSet = new Set([
      ...realMovers,
      ...detailedMovers.map(m => m.symbol)
    ]);

    // STEP 2: Add a SMALL subset of watchlist (just for sector coverage)
    const shuffled = [...SURGE_WATCH_UNIVERSE].sort(() => Math.random() - 0.5);
    const watchlistSubset = shuffled.slice(0, 10); // Minimal - real movers are priority

    // STEP 3: Combine - REAL market movers are the PRIMARY source now
    const toScan = [
      ...Array.from(realMoverSet), // ALL real movers first
      ...watchlistSubset.filter(s => !realMoverSet.has(s))
    ];

    logger.info(`[MARKET-WIDE-SCAN] 🎯 Priority: ${realMoverSet.size} REAL movers + ${watchlistSubset.filter(s => !realMoverSet.has(s)).length} watchlist = ${toScan.length} total`);

    const batchSize = 15; // Increased batch size for speed
    for (let i = 0; i < toScan.length; i += batchSize) {
      const batch = toScan.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          const quote = await yahooFinance.quote(symbol);
          if (!quote || !quote.regularMarketPrice) return null;

          const price = quote.regularMarketPrice;
          const isRealMover = realMoverSet.has(symbol);
          // Real movers get bonus - they're already proven surging
          let score = isRealMover ? 60 : 40;
          const reasons: string[] = [];
          let tier: 'SURGE' | 'MOMENTUM' | 'SETUP' | 'WATCH' = 'WATCH';

          if (isRealMover) {
            reasons.push('🔥 TOP MOVER');
          }
          
          const change = quote.regularMarketChangePercent || 0;
          const volume = quote.regularMarketVolume || 0;
          const avgVolume = quote.averageDailyVolume10Day || quote.averageVolume || volume;
          const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;
          
          // SURGE DETECTION - Major moves happening NOW
          if (change >= 5) {
            tier = 'SURGE';
            reasons.push(`🚀 SURGING +${change.toFixed(1)}%`);
            score += 35;
          } else if (change >= 3) {
            tier = 'MOMENTUM';
            reasons.push(`📈 +${change.toFixed(1)}% momentum`);
            score += 25;
          } else if (change >= 1.5) {
            tier = 'SETUP';
            reasons.push(`⬆️ +${change.toFixed(1)}% building`);
            score += 15;
          } else if (change > 0) {
            reasons.push(`Green +${change.toFixed(1)}%`);
            score += 5;
          }
          
          // VOLUME SPIKE - Early warning signal
          if (volumeRatio >= 3) {
            reasons.push(`🔥 Volume 3x+ unusual`);
            score += 25;
            if (tier === 'WATCH') tier = 'SETUP';
          } else if (volumeRatio >= 2) {
            reasons.push(`📊 Volume 2x spike`);
            score += 15;
          } else if (volumeRatio >= 1.5) {
            reasons.push(`Volume ${volumeRatio.toFixed(1)}x`);
            score += 8;
          }
          
          // NEAR DAY HIGH - Strength signal
          const dayHigh = quote.regularMarketDayHigh || price;
          const dayLow = quote.regularMarketDayLow || price;
          const range = dayHigh - dayLow;
          if (range > 0) {
            const positionInRange = (price - dayLow) / range;
            if (positionInRange > 0.85) {
              reasons.push('At day highs');
              score += 12;
            } else if (positionInRange > 0.7) {
              reasons.push('Near highs');
              score += 6;
            }
          }
          
          // 52-WEEK ANALYSIS - Upside potential
          const fiftyTwoWeekHigh = quote.fiftyTwoWeekHigh || price;
          const fiftyTwoWeekLow = quote.fiftyTwoWeekLow || price;
          const fromHigh = ((fiftyTwoWeekHigh - price) / fiftyTwoWeekHigh) * 100;
          const fromLow = ((price - fiftyTwoWeekLow) / fiftyTwoWeekLow) * 100;
          
          // Breaking out from lows = high potential
          if (fromLow > 20 && fromHigh > 30) {
            reasons.push(`Breakout from lows +${fromLow.toFixed(0)}%`);
            score += 10;
          }
          
          // Near 52-week high = momentum confirmed
          if (fromHigh < 5) {
            reasons.push('Near 52W high 🎯');
            score += 8;
          } else if (fromHigh < 15) {
            reasons.push('Within 15% of highs');
            score += 5;
          }
          
          // SECTOR BONUSES
          if (symbol.match(/^(ARM|NVDA|AMD|AVGO|QCOM|MU|MRVL|TSM|ASML)/)) {
            reasons.push('🔷 Semiconductor');
            score += 8;
          } else if (symbol.match(/^(IONQ|RGTI|QUBT|AI|SOUN|PLTR)/)) {
            reasons.push('🤖 AI/Quantum');
            score += 8;
          } else if (symbol.match(/^(NNE|OKLO|SMR|CCJ|LEU|UUUU|UEC)/)) {
            reasons.push('⚛️ Nuclear');
            score += 8;
          } else if (symbol.match(/^(RKLB|LUNR|JOBY|ACHR|ASTS)/)) {
            reasons.push('🚀 Space');
            score += 8;
          } else if (symbol.match(/^(COIN|MARA|RIOT|MSTR|CLSK)/)) {
            reasons.push('₿ Crypto');
            score += 5;
          } else if (symbol.match(/^(SLV|PSLV|AGI|AG|PAAS|HL|EXK|MAG|FSM|WPM)/)) {
            reasons.push('🥈 Silver');
            score += 6;
          } else if (symbol.match(/^(GLD|IAU|GDX|GDXJ|GOLD|NEM|AEM|KGC|FNV|RGLD)/)) {
            reasons.push('🥇 Gold');
            score += 6;
          } else if (symbol.match(/^(COPX|CPER|FCX|SCCO|TECK|RIO|BHP|VALE)/)) {
            reasons.push('🔶 Copper/Base');
            score += 6;
          }
          
          // PRICE TIER INFO (no filtering, just info)
          if (price < 10) {
            reasons.push(`$${price.toFixed(2)} low-priced`);
          } else if (price < 25) {
            reasons.push(`$${price.toFixed(2)} mid-tier`);
          } else if (price < 50) {
            reasons.push(`$${price.toFixed(2)}`);
          } else if (price < 100) {
            reasons.push(`$${price.toFixed(0)} premium`);
          } else {
            reasons.push(`$${price.toFixed(0)} high-cap`);
          }
          
          return {
            symbol,
            price,
            score: Math.min(98, score),
            reason: reasons.join(' | '),
            upside: fromHigh,
            volume,
            change,
            tier,
            isRealMover
          };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const c = result.value;
          // Include: all SURGE/MOMENTUM, real movers, or good score
          if (c.tier === 'SURGE' || c.tier === 'MOMENTUM' || c.isRealMover || c.score >= 50) {
            candidates.push(c);
          }
        }
      }

      // Minimal delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Sort by tier priority, then by score
    const tierOrder = { 'SURGE': 0, 'MOMENTUM': 1, 'SETUP': 2, 'WATCH': 3 };
    candidates.sort((a, b) => {
      const tierDiff = tierOrder[a.tier || 'WATCH'] - tierOrder[b.tier || 'WATCH'];
      if (tierDiff !== 0) return tierDiff;
      return b.score - a.score;
    });

    const surgeCount = candidates.filter(c => c.tier === 'SURGE').length;
    const momentumCount = candidates.filter(c => c.tier === 'MOMENTUM').length;
    const realMoverCount = candidates.filter(c => c.isRealMover).length;

    logger.info(`[MARKET-WIDE-SCAN] ✅ Found ${candidates.length} total: ${surgeCount} SURGING, ${momentumCount} MOMENTUM, ${realMoverCount} from REAL market scan`);

    // Log the top surgers so we never miss one
    const topSurgers = candidates.filter(c => c.tier === 'SURGE').slice(0, 5);
    if (topSurgers.length > 0) {
      logger.info(`[MARKET-WIDE-SCAN] 🔥 TOP SURGERS: ${topSurgers.map(c => `${c.symbol} +${c.change?.toFixed(1)}%`).join(' | ')}`);
    }

    // CATALYST ENRICHMENT - Add WHY stocks are moving
    const topCandidates = candidates.slice(0, 50);
    try {
      const enrichmentPromises = topCandidates.map(async (candidate) => {
        try {
          const enrichment = await enrichStockWithCatalysts(candidate.symbol);
          if (enrichment.hasBullishCatalyst && enrichment.topCatalyst) {
            const badge = formatCatalystBadge(enrichment.topCatalyst);
            candidate.catalyst = {
              type: enrichment.topCatalyst.type,
              title: enrichment.topCatalyst.title,
              value: enrichment.topCatalyst.valueFormatted,
              icon: badge.icon,
              color: badge.color,
            };
            candidate.catalystScore = enrichment.catalystScore;
            candidate.hasCatalyst = true;
            // Boost score for stocks with catalysts
            candidate.score = Math.min(99, candidate.score + 15);
            candidate.reason = `${badge.icon} ${enrichment.topCatalyst.title} | ${candidate.reason}`;
          }
        } catch (e) {
          // Catalyst lookup failed, continue without
        }
        return candidate;
      });

      await Promise.allSettled(enrichmentPromises);

      // Re-sort with catalyst boost
      topCandidates.sort((a, b) => {
        // Catalysts get priority
        if (a.hasCatalyst && !b.hasCatalyst) return -1;
        if (!a.hasCatalyst && b.hasCatalyst) return 1;
        // Then by tier
        const tierOrder = { 'SURGE': 0, 'MOMENTUM': 1, 'SETUP': 2, 'WATCH': 3 };
        const tierDiff = tierOrder[a.tier || 'WATCH'] - tierOrder[b.tier || 'WATCH'];
        if (tierDiff !== 0) return tierDiff;
        return b.score - a.score;
      });

      const withCatalysts = topCandidates.filter(c => c.hasCatalyst).length;
      if (withCatalysts > 0) {
        logger.info(`[CATALYST] 🎯 ${withCatalysts} movers have known catalysts`);
      }
    } catch (e) {
      logger.debug('[CATALYST] Enrichment failed, continuing without:', e);
    }

    return topCandidates;
    
  } catch (error) {
    logger.error('[SURGE-DETECTOR] Scan failed:', error);
    return [];
  }
}

export async function detectPreBreakout(): Promise<BreakoutCandidate[]> {
  logger.info('[PRE-BREAKOUT] Scanning for early surge signals...');
  
  const candidates: BreakoutCandidate[] = [];
  
  try {
    const yahooFinance = (await import('yahoo-finance2')).default;
    
    // Focus on high-quality names that could surge
    const priorityTickers = [
      'ARM', 'NVDA', 'AMD', 'SMCI', 'AVGO', 'TSM', 'ASML', 'MRVL', 'MU', 'QCOM',
      'RKLB', 'OKLO', 'NNE', 'SMR', 'IONQ', 'PLTR', 'COIN', 'MSTR', 'MARA',
      'SOFI', 'HOOD', 'UPST', 'AFRM', 'XYZ', 'NET', 'CRWD', 'ZS', 'SNOW', 'DDOG'
    ];
    
    for (const symbol of priorityTickers) {
      try {
        const quote = await yahooFinance.quote(symbol);
        if (!quote || !quote.regularMarketPrice) continue;
        
        const price = quote.regularMarketPrice;
        const change = quote.regularMarketChangePercent || 0;
        const volume = quote.regularMarketVolume || 0;
        const avgVolume = quote.averageDailyVolume10Day || quote.averageVolume || volume;
        const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;
        
        // Pre-breakout signals: volume building + small positive move
        if (volumeRatio >= 1.3 && change > 0 && change < 5) {
          const reasons: string[] = [];
          let score = 60;
          
          reasons.push(`📊 Volume building ${volumeRatio.toFixed(1)}x`);
          reasons.push(`+${change.toFixed(1)}% early move`);
          score += volumeRatio * 5;
          score += change * 3;
          
          candidates.push({
            symbol,
            price,
            score: Math.min(90, score),
            reason: reasons.join(' | '),
            volume,
            change,
            tier: 'SETUP'
          });
        }
        
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        // Skip failed quotes
      }
    }
    
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 15);
    
  } catch (error) {
    logger.error('[PRE-BREAKOUT] Detection failed:', error);
    return [];
  }
}

export { SURGE_WATCH_UNIVERSE, fetchDetailedMarketMovers, fetchRealMarketMovers };

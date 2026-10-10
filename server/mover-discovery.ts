/**
 * DYNAMIC MOVER DISCOVERY SERVICE
 * 
 * Fetches real-time most-active stocks and biggest gainers/losers from Yahoo Finance
 * to catch movers NOT in the static ticker universe.
 * 
 * This ensures we never miss a CVNA-style move again.
 */

import { logger } from './logger';
import { getFullUniverse } from './ticker-universe';
import { recordSymbolAttention } from './attention-tracking-service';

// Cache for discovered movers (refreshed every scan)
let discoveredMovers: Set<string> = new Set();
let lastDiscoveryTime: Date | null = null;

// Persistent fallback cache - survives API failures
let fallbackMoversCache: DiscoveredMover[] = [];
let fallbackCacheTime: Date | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes fallback validity

// Yahoo Finance screener endpoints
const YAHOO_SCREENER_BASE = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved';

interface YahooScreenerResult {
  symbol: string;
  shortName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  averageVolume?: number;
}

interface DiscoveredMover {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  relativeVolume: number;
  source: 'most_active' | 'day_gainers' | 'day_losers' | 'trending';
  discoveredAt: Date;
  isNewDiscovery: boolean; // Not in static universe
}

/**
 * Fetch most active stocks from Yahoo Finance
 */
async function fetchYahooScreener(screenerType: string): Promise<YahooScreenerResult[]> {
  try {
    const url = `${YAHOO_SCREENER_BASE}?formatted=false&lang=en-US&region=US&scrIds=${screenerType}&count=50`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      logger.warn(`[MOVER-DISCOVERY] Yahoo screener ${screenerType} returned ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const quotes = data?.finance?.result?.[0]?.quotes || [];
    
    return quotes.map((q: any) => ({
      symbol: q.symbol,
      shortName: q.shortName || q.longName,
      regularMarketPrice: q.regularMarketPrice,
      regularMarketChangePercent: q.regularMarketChangePercent,
      regularMarketVolume: q.regularMarketVolume,
      averageVolume: q.averageDailyVolume3Month || q.averageVolume
    }));
  } catch (error) {
    logger.error(`[MOVER-DISCOVERY] Error fetching ${screenerType}:`, error);
    return [];
  }
}

/**
 * Fetch trending tickers from Yahoo Finance
 */
async function fetchTrendingTickers(): Promise<string[]> {
  try {
    const url = 'https://query1.finance.yahoo.com/v1/finance/trending/US?count=50';
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const quotes = data?.finance?.result?.[0]?.quotes || [];
    
    return quotes.map((q: any) => q.symbol).filter(Boolean);
  } catch (error) {
    logger.error('[MOVER-DISCOVERY] Error fetching trending:', error);
    return [];
  }
}

/**
 * Discover movers from all sources
 * Uses fallback cache when API calls fail
 */
export async function discoverMovers(): Promise<DiscoveredMover[]> {
  const staticUniverse = new Set(getFullUniverse());
  const allMovers: DiscoveredMover[] = [];
  
  logger.info('[MOVER-DISCOVERY] Starting mover discovery scan...');
  
  // Fetch from multiple sources in parallel
  const [mostActive, dayGainers, dayLosers, trending] = await Promise.all([
    fetchYahooScreener('most_actives'),
    fetchYahooScreener('day_gainers'),
    fetchYahooScreener('day_losers'),
    fetchTrendingTickers()
  ]);
  
  // Check if all API calls failed - use fallback cache
  const totalResults = mostActive.length + dayGainers.length + dayLosers.length + trending.length;
  if (totalResults === 0) {
    const cacheAge = fallbackCacheTime ? Date.now() - fallbackCacheTime.getTime() : Infinity;
    if (fallbackMoversCache.length > 0 && cacheAge < CACHE_TTL_MS) {
      logger.warn(`[MOVER-DISCOVERY] All API calls failed - using fallback cache (${fallbackMoversCache.length} movers, ${Math.round(cacheAge / 60000)}min old)`);
      return fallbackMoversCache;
    }
    logger.error('[MOVER-DISCOVERY] All API calls failed and no valid fallback cache available');
    return [];
  }
  
  // Process most active
  for (const stock of mostActive) {
    if (!stock.symbol || stock.symbol.includes('^') || stock.symbol.includes('.')) continue;
    
    const relVol = stock.averageVolume ? stock.regularMarketVolume! / stock.averageVolume : 1;
    
    allMovers.push({
      symbol: stock.symbol,
      name: stock.shortName || stock.symbol,
      price: stock.regularMarketPrice || 0,
      changePercent: stock.regularMarketChangePercent || 0,
      volume: stock.regularMarketVolume || 0,
      avgVolume: stock.averageVolume || 0,
      relativeVolume: relVol,
      source: 'most_active',
      discoveredAt: new Date(),
      isNewDiscovery: !staticUniverse.has(stock.symbol)
    });
  }
  
  // Process day gainers
  for (const stock of dayGainers) {
    if (!stock.symbol || stock.symbol.includes('^') || stock.symbol.includes('.')) continue;
    if (allMovers.some(m => m.symbol === stock.symbol)) continue;
    
    const relVol = stock.averageVolume ? stock.regularMarketVolume! / stock.averageVolume : 1;
    
    allMovers.push({
      symbol: stock.symbol,
      name: stock.shortName || stock.symbol,
      price: stock.regularMarketPrice || 0,
      changePercent: stock.regularMarketChangePercent || 0,
      volume: stock.regularMarketVolume || 0,
      avgVolume: stock.averageVolume || 0,
      relativeVolume: relVol,
      source: 'day_gainers',
      discoveredAt: new Date(),
      isNewDiscovery: !staticUniverse.has(stock.symbol)
    });
  }
  
  // Process day losers
  for (const stock of dayLosers) {
    if (!stock.symbol || stock.symbol.includes('^') || stock.symbol.includes('.')) continue;
    if (allMovers.some(m => m.symbol === stock.symbol)) continue;
    
    const relVol = stock.averageVolume ? stock.regularMarketVolume! / stock.averageVolume : 1;
    
    allMovers.push({
      symbol: stock.symbol,
      name: stock.shortName || stock.symbol,
      price: stock.regularMarketPrice || 0,
      changePercent: stock.regularMarketChangePercent || 0,
      volume: stock.regularMarketVolume || 0,
      avgVolume: stock.averageVolume || 0,
      relativeVolume: relVol,
      source: 'day_losers',
      discoveredAt: new Date(),
      isNewDiscovery: !staticUniverse.has(stock.symbol)
    });
  }
  
  // Add trending tickers not already in list
  for (const symbol of trending) {
    if (!symbol || symbol.includes('^') || symbol.includes('.')) continue;
    if (allMovers.some(m => m.symbol === symbol)) continue;
    
    allMovers.push({
      symbol,
      name: symbol,
      price: 0,
      changePercent: 0,
      volume: 0,
      avgVolume: 0,
      relativeVolume: 1,
      source: 'trending',
      discoveredAt: new Date(),
      isNewDiscovery: !staticUniverse.has(symbol)
    });
  }
  
  // Update cache
  discoveredMovers = new Set(allMovers.map(m => m.symbol));
  lastDiscoveryTime = new Date();
  
  // Update fallback cache for graceful degradation
  if (allMovers.length > 0) {
    fallbackMoversCache = [...allMovers];
    fallbackCacheTime = new Date();
    logger.debug(`[MOVER-DISCOVERY] Updated fallback cache with ${allMovers.length} movers`);
  }
  
  // Log new discoveries
  const newDiscoveries = allMovers.filter(m => m.isNewDiscovery);
  if (newDiscoveries.length > 0) {
    logger.info(`[MOVER-DISCOVERY] Found ${newDiscoveries.length} stocks NOT in static universe:`);
    newDiscoveries.slice(0, 10).forEach(m => {
      logger.info(`  - ${m.symbol}: ${m.changePercent.toFixed(1)}% (${m.source})`);
    });
  }
  
  // 🎯 CONVERGENCE TRACKING: Record significant movers for heat map
  const significantMovers = allMovers.filter(m => Math.abs(m.changePercent) >= 5 || m.relativeVolume >= 3);
  for (const mover of significantMovers.slice(0, 20)) {
    try {
      await recordSymbolAttention(mover.symbol, 'mover_discovery', 'discovery', {
        changePercent: mover.changePercent,
        direction: mover.changePercent >= 0 ? 'bullish' : 'bearish',
        message: `${mover.source.replace('_', ' ')}: ${mover.changePercent >= 0 ? '+' : ''}${mover.changePercent.toFixed(1)}%`
      });
    } catch (err) {
      // Silently ignore attention tracking errors
    }
  }
  
  logger.info(`[MOVER-DISCOVERY] Total movers discovered: ${allMovers.length}, New discoveries: ${newDiscoveries.length}`);
  
  return allMovers;
}

/**
 * Get symbols that should be added to scanner queue
 * Returns symbols that are moving but NOT in the static universe
 */
export async function getNewMoverSymbols(): Promise<string[]> {
  const movers = await discoverMovers();
  
  // Filter for new discoveries with significant moves
  return movers
    .filter(m => m.isNewDiscovery)
    .filter(m => Math.abs(m.changePercent) >= 3 || m.relativeVolume >= 2) // 3%+ move OR 2x avg volume
    .map(m => m.symbol);
}

/**
 * Get the combined universe: static list + discovered movers
 */
export function getExpandedUniverse(): string[] {
  const staticUniverse = getFullUniverse();
  const combined = new Set(staticUniverse);
  discoveredMovers.forEach(symbol => combined.add(symbol));
  return Array.from(combined);
}

/**
 * Get discovery status
 */
export function getDiscoveryStatus() {
  const cacheAge = fallbackCacheTime ? Math.round((Date.now() - fallbackCacheTime.getTime()) / 60000) : null;
  return {
    lastDiscoveryTime,
    discoveredCount: discoveredMovers.size,
    discoveredSymbols: Array.from(discoveredMovers),
    fallbackCache: {
      available: fallbackMoversCache.length > 0,
      count: fallbackMoversCache.length,
      ageMinutes: cacheAge,
      isValid: cacheAge !== null && cacheAge < 30 // 30 min TTL
    }
  };
}

/**
 * Check if a symbol was dynamically discovered (not in static list)
 */
export function isDiscoveredMover(symbol: string): boolean {
  return discoveredMovers.has(symbol) && !getFullUniverse().includes(symbol);
}

/**
 * Ingest significant movers into Trade Desk via centralized ingestion
 * Creates trade ideas for movers meeting quality criteria
 */
export async function ingestMoversToTradeDesk(): Promise<{ ingested: number; skipped: number }> {
  const { ingestTradeIdea, createScannerSignals } = await import('./trade-idea-ingestion');
  
  const movers = await discoverMovers();
  let ingested = 0;
  let skipped = 0;
  
  // Filter for significant movers only
  const significantMovers = movers.filter(m => 
    Math.abs(m.changePercent) >= 4 && 
    m.relativeVolume >= 1.5 &&
    m.price >= 2 // Skip penny stocks
  );
  
  for (const mover of significantMovers.slice(0, 20)) {
    const direction = mover.changePercent >= 0 ? 'bullish' : 'bearish';
    
    // Create signals based on mover characteristics
    const signals = createScannerSignals({
      changePercent: Math.abs(mover.changePercent),
      relativeVolume: mover.relativeVolume,
      breakout: Math.abs(mover.changePercent) >= 6 && mover.relativeVolume >= 2,
    });
    
    // Need at least 2 signals
    if (signals.length < 2) {
      skipped++;
      continue;
    }
    
    // Determine holding period based on move size
    const holdingPeriod = Math.abs(mover.changePercent) >= 8 ? 'day' : 'swing';
    
    const sourceLabel = mover.source.replace('_', ' ');
    const result = await ingestTradeIdea({
      source: 'market_scanner',
      symbol: mover.symbol,
      assetType: 'stock',
      direction,
      signals,
      holdingPeriod,
      currentPrice: mover.price,
      catalyst: `${sourceLabel}: ${mover.changePercent >= 0 ? '+' : ''}${mover.changePercent.toFixed(1)}% with ${mover.relativeVolume.toFixed(1)}x volume`,
      analysis: `${mover.name || mover.symbol} discovered via ${sourceLabel}. ` +
        `${mover.isNewDiscovery ? 'NEW DISCOVERY - not in static universe! ' : ''}` +
        `Price: $${mover.price.toFixed(2)}, Volume: ${mover.relativeVolume.toFixed(1)}x average.`,
    });
    
    if (result.success) {
      ingested++;
      logger.info(`[DISCOVERY->TRADE-DESK] ✅ Ingested ${mover.symbol}: ${mover.changePercent.toFixed(1)}% (${sourceLabel})`);
    } else {
      skipped++;
    }
  }
  
  logger.info(`[DISCOVERY->TRADE-DESK] Complete: ${ingested} ingested, ${skipped} skipped`);
  return { ingested, skipped };
}

/**
 * Generate OPTIONS (calls/puts) for dynamically discovered movers
 * This ensures we don't miss opportunities like SNDK puts or SLV calls
 */
export async function generateOptionsForMovers(): Promise<{ ingested: number; skipped: number }> {
  const { ingestTradeIdea, createScannerSignals } = await import('./trade-idea-ingestion');
  const { getTradierOptionsChainsByDTE } = await import('./tradier-api');

  const movers = await discoverMovers();
  let ingested = 0;
  let skipped = 0;

  // Filter for movers suitable for options (need liquidity and significant move)
  const optionableMovers = movers.filter(m =>
    Math.abs(m.changePercent) >= 3 &&
    m.relativeVolume >= 1.3 &&
    m.price >= 10 && // Options need decent price
    m.price <= 500 // Not too expensive
  );

  logger.info(`[MOVER-OPTIONS] Processing ${optionableMovers.length} movers for options plays...`);

  for (const mover of optionableMovers.slice(0, 15)) { // Limit to 15 to avoid rate limits
    try {
      const direction = mover.changePercent >= 0 ? 'bullish' : 'bearish';
      const optionType: 'call' | 'put' = direction === 'bullish' ? 'call' : 'put';

      // Fetch options chain
      const optionsChain = await getTradierOptionsChainsByDTE(mover.symbol);
      if (!optionsChain || optionsChain.length === 0) {
        skipped++;
        continue;
      }

      const now = new Date();
      const today = now.toISOString().split('T')[0];

      // Group by expiration
      const expirationMap = new Map<string, typeof optionsChain>();
      for (const opt of optionsChain) {
        if (!opt.expiration_date || opt.expiration_date <= today) continue;
        if (!expirationMap.has(opt.expiration_date)) {
          expirationMap.set(opt.expiration_date, []);
        }
        expirationMap.get(opt.expiration_date)!.push(opt);
      }

      // Find weekly expiration (5-10 days out)
      const sortedExpirations = Array.from(expirationMap.keys()).sort();
      const weeklyExpiration = sortedExpirations.find(exp => {
        const dte = Math.ceil((new Date(exp).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return dte >= 5 && dte <= 14;
      });

      if (!weeklyExpiration) {
        skipped++;
        continue;
      }

      const dte = Math.ceil((new Date(weeklyExpiration).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const expirationOptions = expirationMap.get(weeklyExpiration) || [];

      // Filter for our option type with valid pricing
      const validOptions = expirationOptions.filter(opt => {
        if (opt.option_type !== optionType) return false;
        const hasBidAsk = opt.bid && opt.bid > 0 && opt.ask && opt.ask > 0;
        if (!hasBidAsk) return false;
        const delta = Math.abs(opt.greeks?.delta || 0);
        return delta >= 0.20 && delta <= 0.45; // Slightly OTM
      });

      if (validOptions.length === 0) {
        skipped++;
        continue;
      }

      // Sort by delta closest to 0.30 (sweet spot)
      validOptions.sort((a, b) => {
        const deltaA = Math.abs(Math.abs(a.greeks?.delta || 0) - 0.30);
        const deltaB = Math.abs(Math.abs(b.greeks?.delta || 0) - 0.30);
        return deltaA - deltaB;
      });

      const bestOption = validOptions[0];
      const entryPrice = (bestOption.bid + bestOption.ask) / 2;
      const delta = Math.abs(bestOption.greeks?.delta || 0);

      // Calculate targets
      const targetPrice = entryPrice * 1.40; // 40% target
      const stopLoss = entryPrice * 0.50; // 50% stop

      // Create signals
      const signals = createScannerSignals({
        changePercent: Math.abs(mover.changePercent),
        relativeVolume: mover.relativeVolume,
        breakout: Math.abs(mover.changePercent) >= 5 && mover.relativeVolume >= 2,
      });

      signals.push({
        type: 'dynamic_discovery',
        weight: 10,
        description: `Dynamically discovered mover (${mover.source.replace('_', ' ')})`,
      });

      const sourceLabel = mover.source.replace('_', ' ');
      const result = await ingestTradeIdea({
        source: 'market_scanner',
        symbol: mover.symbol,
        assetType: 'option',
        direction,
        signals,
        holdingPeriod: dte <= 7 ? 'day' : 'swing',
        currentPrice: entryPrice,
        suggestedEntry: entryPrice,
        suggestedTarget: targetPrice,
        suggestedStop: stopLoss,
        optionType,
        strikePrice: bestOption.strike,
        expiryDate: weeklyExpiration,
        catalyst: `${optionType.toUpperCase()} on ${sourceLabel}: ${mover.changePercent >= 0 ? '+' : ''}${mover.changePercent.toFixed(1)}%`,
        analysis: `DYNAMIC DISCOVERY: ${mover.name || mover.symbol} ${optionType.toUpperCase()} $${bestOption.strike} exp ${weeklyExpiration}. ` +
          `Stock moved ${mover.changePercent.toFixed(1)}% with ${mover.relativeVolume.toFixed(1)}x volume. ` +
          `Delta: ${delta.toFixed(2)}, Premium: $${entryPrice.toFixed(2)}. ` +
          `${mover.isNewDiscovery ? 'NEW DISCOVERY - not in static watchlist!' : ''}`,
        sourceMetadata: {
          scannerType: 'dynamic_mover_options',
          dte,
          delta,
          moverSource: mover.source,
          isNewDiscovery: mover.isNewDiscovery,
        },
      });

      if (result.success) {
        ingested++;
        logger.info(`[MOVER-OPTIONS] ✅ ${optionType.toUpperCase()} for ${mover.symbol}: $${bestOption.strike} exp ${weeklyExpiration}`);
      } else {
        skipped++;
      }

      // Rate limit protection
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      logger.error(`[MOVER-OPTIONS] Error processing ${mover.symbol}:`, err);
      skipped++;
    }
  }

  logger.info(`[MOVER-OPTIONS] Complete: ${ingested} options generated, ${skipped} skipped`);
  return { ingested, skipped };
}

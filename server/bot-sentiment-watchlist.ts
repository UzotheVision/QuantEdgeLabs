import { logger } from './logger';
import { storage } from './storage';

interface SentimentWatchlistItem {
  symbol: string;
  sentimentScore: number;
  reason: string;
  priceTarget?: number;
  currentPrice?: number;
  upside?: number;
  sources: string[];
  addedAt: string;
}

let botWatchlist: SentimentWatchlistItem[] = [];
let lastRefresh = 0;
const REFRESH_INTERVAL = 30 * 60 * 1000;

export async function getBotSentimentWatchlist(): Promise<SentimentWatchlistItem[]> {
  const now = Date.now();
  if (botWatchlist.length > 0 && (now - lastRefresh) < REFRESH_INTERVAL) {
    return botWatchlist;
  }
  
  await refreshBotWatchlist();
  return botWatchlist;
}

export async function refreshBotWatchlist(): Promise<void> {
  logger.info('[BOT-WATCHLIST] Refreshing sentiment-based watchlist...');
  
  const newWatchlist: SentimentWatchlistItem[] = [];
  const seenSymbols = new Set<string>();
  
  try {
    const { fetchWSBTrending } = await import('./social-sentiment-scanner');
    const wsbData = await fetchWSBTrending();
    
    if (wsbData && Array.isArray(wsbData)) {
      for (const item of wsbData.slice(0, 20)) {
        if (seenSymbols.has(item.ticker)) continue;
        seenSymbols.add(item.ticker);
        
        const sentimentScore = Math.min(95, 50 + (item.mentions || 0) / 10);
        
        if (sentimentScore >= 60) {
          newWatchlist.push({
            symbol: item.ticker,
            sentimentScore,
            reason: `WSB trending: ${item.mentions} mentions, rank #${item.rank}`,
            sources: ['WSB', 'Reddit'],
            addedAt: new Date().toISOString()
          });
        }
      }
    }
  } catch (error) {
    logger.warn('[BOT-WATCHLIST] WSB data fetch failed:', error);
  }

  try {
    const { scanBullishTrends } = await import('./bullish-trend-scanner');
    const bullishStocks = await scanBullishTrends();
    
    for (const stock of bullishStocks.slice(0, 15)) {
      if (seenSymbols.has(stock.symbol)) continue;
      seenSymbols.add(stock.symbol);
      
      const anyStock = stock as any;
      newWatchlist.push({
        symbol: stock.symbol,
        sentimentScore: anyStock.confidence || anyStock.confidenceScore || 70,
        reason: `Bullish trend: ${anyStock.signals?.slice(0, 2).join(', ') || anyStock.qualitySignals?.slice(0, 2).join(', ') || 'Technical breakout'}`,
        currentPrice: anyStock.price || anyStock.currentPrice,
        priceTarget: anyStock.targetPrice,
        upside: anyStock.targetPrice && (anyStock.price || anyStock.currentPrice) ? ((anyStock.targetPrice - (anyStock.price || anyStock.currentPrice)) / (anyStock.price || anyStock.currentPrice)) * 100 : undefined,
        sources: ['Technical', 'Trend'],
        addedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.warn('[BOT-WATCHLIST] Bullish trends fetch failed:', error);
  }

  try {
    const { discoverBreakoutCandidates } = await import('./breakout-discovery-service');
    const breakouts = await discoverBreakoutCandidates();
    
    for (const stock of breakouts.slice(0, 10)) {
      if (seenSymbols.has(stock.symbol)) continue;
      seenSymbols.add(stock.symbol);
      
      newWatchlist.push({
        symbol: stock.symbol,
        sentimentScore: stock.score || 75,
        reason: stock.reason || 'Breakout candidate',
        currentPrice: stock.price,
        upside: stock.upside,
        sources: ['Breakout', 'Scanner'],
        addedAt: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.warn('[BOT-WATCHLIST] Breakout discovery failed:', error);
  }

  newWatchlist.sort((a, b) => b.sentimentScore - a.sentimentScore);
  
  botWatchlist = newWatchlist.slice(0, 30);
  lastRefresh = Date.now();
  
  logger.info(`[BOT-WATCHLIST] Refreshed with ${botWatchlist.length} items`);
}

export async function addToBotWatchlist(item: Omit<SentimentWatchlistItem, 'addedAt'>): Promise<void> {
  const existing = botWatchlist.findIndex(w => w.symbol === item.symbol);
  
  if (existing >= 0) {
    botWatchlist[existing] = { ...item, addedAt: botWatchlist[existing].addedAt };
  } else {
    botWatchlist.push({ ...item, addedAt: new Date().toISOString() });
  }
  
  botWatchlist.sort((a, b) => b.sentimentScore - a.sentimentScore);
  botWatchlist = botWatchlist.slice(0, 30);
}

export async function removeFromBotWatchlist(symbol: string): Promise<void> {
  botWatchlist = botWatchlist.filter(w => w.symbol !== symbol);
}

export function getBotWatchlistSymbols(): string[] {
  return botWatchlist.map(w => w.symbol);
}

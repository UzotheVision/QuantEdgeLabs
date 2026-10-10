import { db } from './db';
import { bullishTrends, type BullishTrend, type TrendStrength, type TrendPhase, type TrendCategory } from '@shared/schema';
import { eq, desc, and } from 'drizzle-orm';
import { logger } from './logger';
import { calculateRSI, calculateMACD, calculateSMA } from './technical-indicators';
import { recordSymbolAttention } from './attention-tracking-service';
import { getScannerUniverse } from './scanner-universe';
import { postDiscordWebhook } from './discord-service';

const YAHOO_FINANCE_API = "https://query1.finance.yahoo.com/v8/finance/chart";
const TRADIER_API = "https://api.tradier.com/v1";
const TRADIER_API_KEY = process.env.TRADIER_API_KEY;

const USER_BULLISH_WATCHLIST = [
  // Nuclear & Energy
  'OKLO', 'NNE', 'SMR', 'LEU', 'CCJ', 'UEC', 'DNN', 'URG', 'BWXT',
  // Defense & Aerospace
  'LMT', 'NOC', 'RTX', 'GD', 'BA', 'HII', 'LHX', 'TXT', 'HWM',
  // Space & Satellites
  'RKLB', 'ASTS', 'LUNR', 'RDW', 'MNTS', 'LLAP', 'SPCE', 'PL', 'OUST',
  // Crypto & Fintech
  'MARA', 'RIOT', 'CLSK', 'IREN', 'CIFR', 'COIN', 'HOOD', 'SOFI', 'AFRM', 'NU',
  // AI & Quantum
  'PLTR', 'RGTI', 'NBIS', 'IONQ', 'QBTS', 'ARQQ', 'QUBT', 'LAES', 'SOUN', 'APP',
  // Tech Leaders & Growth
  'CVNA', 'DASH', 'UBER', 'ABNB', 'CRWD', 'NET', 'SNOW', 'DDOG', 'ARM', 'SMCI',
  'TTD', 'ROKU', 'SQ', 'SHOP', 'MELI', 'DKNG', 'HIMS', 'RIVN', 'PATH', 'UPST', 'ZETA',
  // Speculative
  'INTC', 'SERV', 'UAMY', 'UUU', 'NAK', 'USAR', 'ONDS', 'NVO'
];

const SECTOR_CATEGORIES: Record<string, TrendCategory> = {
  'Technology': 'growth',
  'Financial Services': 'turnaround',
  'Consumer Cyclical': 'momentum',
  'Energy': 'sector_rotation',
  'Healthcare': 'growth',
  'Basic Materials': 'speculative',
  'Industrials': 'momentum',
  'Communication Services': 'growth',
  'Real Estate': 'sector_rotation',
  'Utilities': 'sector_rotation',
};

interface QuoteData {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice: number;
  regularMarketPreviousClose: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
  averageDailyVolume10Day?: number;
  averageDailyVolume3Month?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  marketCap?: number;
  sector?: string;
  industry?: string;
}

interface HistoricalData {
  prices: number[];
  volumes: number[];
  timestamps: number[];
}

async function fetchQuotes(symbols: string[]): Promise<QuoteData[]> {
  try {
    // Use Tradier API (more reliable than Yahoo)
    if (!TRADIER_API_KEY) {
      logger.warn('[BULLISH] No Tradier API key, falling back to limited Yahoo data');
      return await fetchQuotesYahooFallback(symbols);
    }
    
    const results: QuoteData[] = [];
    const symbolList = symbols.join(',');
    
    try {
      const url = `${TRADIER_API}/markets/quotes?symbols=${symbolList}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${TRADIER_API_KEY}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const quotes = data.quotes?.quote || [];
        const quotesArray = Array.isArray(quotes) ? quotes : [quotes];
        
        for (const q of quotesArray) {
          if (q && q.symbol && typeof q.last === 'number') {
            results.push({
              symbol: q.symbol,
              shortName: q.description,
              longName: q.description,
              regularMarketPrice: q.last || q.close || 0,
              regularMarketPreviousClose: q.prevclose || q.close || 0,
              regularMarketChange: q.change || 0,
              regularMarketChangePercent: q.change_percentage || 0,
              regularMarketVolume: q.volume || 0,
              averageDailyVolume10Day: q.average_volume || 0,
              averageDailyVolume3Month: q.average_volume || 0,
              fiftyTwoWeekHigh: q.week_52_high || 0,
              fiftyTwoWeekLow: q.week_52_low || 0,
            });
          }
        }
        
        logger.info(`[BULLISH] Tradier fetched ${results.length}/${symbols.length} quotes`);
        return results;
      } else {
        logger.warn(`[BULLISH] Tradier quotes failed: ${response.status}`);
      }
    } catch (tradierError) {
      logger.warn('[BULLISH] Tradier API error, falling back to Yahoo', { error: tradierError });
    }
    
    // Fallback to Yahoo if Tradier fails
    return await fetchQuotesYahooFallback(symbols);
  } catch (error) {
    logger.error('[BULLISH] Failed to fetch quotes', { error });
    return [];
  }
}

async function fetchQuotesYahooFallback(symbols: string[]): Promise<QuoteData[]> {
  const results: QuoteData[] = [];
  
  // Fetch quotes one at a time with delays to avoid rate limiting
  for (const symbol of symbols.slice(0, 20)) { // Limit to 20 to avoid rate limits
    try {
      const url = `${YAHOO_FINANCE_API}/${symbol}?interval=1d&range=5d`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      if (response.ok) {
        const data = await response.json();
        const result = data.chart?.result?.[0];
        const meta = result?.meta;
        
        if (meta) {
          results.push({
            symbol: meta.symbol,
            shortName: meta.symbol,
            longName: meta.symbol,
            regularMarketPrice: meta.regularMarketPrice || 0,
            regularMarketPreviousClose: meta.chartPreviousClose || meta.previousClose || 0,
            regularMarketChange: (meta.regularMarketPrice || 0) - (meta.chartPreviousClose || meta.regularMarketPrice || 0),
            regularMarketChangePercent: meta.chartPreviousClose ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : 0,
            regularMarketVolume: meta.regularMarketVolume || 0,
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
          });
        }
      }
      
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      // Skip individual failures
    }
  }
  
  logger.info(`[BULLISH] Yahoo fallback fetched ${results.length} quotes`);
  return results;
}

async function fetchHistoricalData(symbol: string, period = '3mo'): Promise<HistoricalData | null> {
  try {
    const url = `${YAHOO_FINANCE_API}/${symbol}?interval=1d&range=${period}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;
    
    const timestamps = result.timestamp || [];
    const prices = result.indicators?.quote?.[0]?.close || [];
    const volumes = result.indicators?.quote?.[0]?.volume || [];
    
    return {
      prices: prices.filter((p: number | null) => p !== null),
      volumes: volumes.filter((v: number | null) => v !== null),
      timestamps
    };
  } catch (error) {
    logger.debug(`[BULLISH] Failed to fetch historical for ${symbol}`, { error });
    return null;
  }
}

function calculateMomentumScore(data: {
  rsi14: number;
  priceVsSma20: number;
  priceVsSma50: number;
  priceVsSma200: number;
  volumeRatio: number;
  dayChangePercent: number;
  weekChangePercent: number;
  percentFrom52High: number;
  relativeStrength?: number; // % out/under-performance vs SPY (month-weighted). Surfaces quiet trend leaders.
}): number {
  let score = 50;
  
  if (data.rsi14 > 50 && data.rsi14 < 70) score += 10;
  else if (data.rsi14 >= 70) score += 5;
  else if (data.rsi14 < 30) score -= 15;
  else if (data.rsi14 < 50) score -= 5;
  
  if (data.priceVsSma20 > 0) score += Math.min(10, data.priceVsSma20 * 2);
  if (data.priceVsSma50 > 0) score += Math.min(10, data.priceVsSma50);
  if (data.priceVsSma200 > 0) score += Math.min(10, data.priceVsSma200 * 0.5);
  
  if (data.volumeRatio > 2) score += 15;
  else if (data.volumeRatio > 1.5) score += 10;
  else if (data.volumeRatio > 1) score += 5;
  
  if (data.dayChangePercent > 5) score += 10;
  else if (data.dayChangePercent > 2) score += 5;
  else if (data.dayChangePercent < -3) score -= 10;
  
  if (data.weekChangePercent > 10) score += 10;
  else if (data.weekChangePercent > 5) score += 5;
  else if (data.weekChangePercent < -5) score -= 10;
  
  if (data.percentFrom52High > -5) score += 10;
  else if (data.percentFrom52High > -15) score += 5;

  // 📈 Relative strength vs SPY — rewards quiet outperformers that have no volume/price spike.
  // This is how mature large-cap uptrends (ORCL, CRM, NOW) earn a score without a breakout day.
  if (data.relativeStrength !== undefined) {
    if (data.relativeStrength > 8) score += 12;
    else if (data.relativeStrength > 4) score += 8;
    else if (data.relativeStrength > 1) score += 4;
    else if (data.relativeStrength < -8) score -= 8;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function determineTrendStrength(momentumScore: number): TrendStrength {
  if (momentumScore >= 80) return 'explosive';
  if (momentumScore >= 65) return 'strong';
  if (momentumScore >= 45) return 'moderate';
  return 'weak';
}

function determineTrendPhase(data: {
  priceVsSma20: number;
  priceVsSma50: number;
  volumeRatio: number;
  percentFrom52High: number;
  dayChangePercent: number;
}): TrendPhase {
  if (data.volumeRatio > 2 && data.priceVsSma20 > 3 && data.dayChangePercent > 3) {
    return 'breakout';
  }
  if (data.priceVsSma20 > 0 && data.priceVsSma50 > 0 && data.percentFrom52High > -10) {
    return 'momentum';
  }
  if (data.priceVsSma20 < 0 && data.priceVsSma50 > 0) {
    return 'distribution';
  }
  return 'accumulation';
}

export async function scanBullishTrends(): Promise<BullishTrend[]> {
  logger.info('[BULLISH] Starting bullish trend scan...');

  // Merge user watchlist (priority) + hardcoded domain-specific symbols
  const { symbols: universeSymbols, watchlistSymbols } = await getScannerUniverse();
  // Combine: user watchlist first, then domain-specific symbols not already in universe
  const domainOnly = USER_BULLISH_WATCHLIST.filter(s => !watchlistSymbols.has(s) && !universeSymbols.includes(s));
  const symbols = [...universeSymbols, ...domainOnly];
  logger.info(`[BULLISH] Scanning ${symbols.length} symbols (${watchlistSymbols.size} from watchlist, ${domainOnly.length} domain-specific)`);
  const quotes = await fetchQuotes(symbols);

  if (quotes.length === 0) {
    logger.warn('[BULLISH] No quotes fetched');
    return [];
  }

  // 📈 Benchmark for relative strength: fetch SPY once and derive week/month returns.
  // Quiet leaders (ORCL/CRM/NOW) rarely spike on volume but consistently beat the market —
  // RS is the signal that lets them surface alongside the loud small-cap movers.
  let spyWeekChange = 0;
  let spyMonthChange = 0;
  try {
    const spy = await fetchHistoricalData('SPY');
    if (spy && spy.prices.length >= 22) {
      const spyPrices = spy.prices;
      const spyNow = spyPrices[spyPrices.length - 1];
      const spyWeekAgo = spyPrices[spyPrices.length - 5];
      const spyMonthAgo = spyPrices[spyPrices.length - 22];
      spyWeekChange = ((spyNow - spyWeekAgo) / spyWeekAgo) * 100;
      spyMonthChange = ((spyNow - spyMonthAgo) / spyMonthAgo) * 100;
    }
  } catch (err) {
    logger.debug('[BULLISH] SPY benchmark fetch failed — relative strength disabled this scan', { err });
  }

  const results: BullishTrend[] = [];
  // Relative strength per symbol (in-memory only — not a bullish_trends column). Used for scoring + the trend-leader gate.
  const relativeStrengthBySymbol = new Map<string, number>();

  for (const quote of quotes) {
    try {
      const historical = await fetchHistoricalData(quote.symbol);
      if (!historical || historical.prices.length < 20) continue;
      
      const prices = historical.prices;
      const volumes = historical.volumes;
      
      const rsi14 = calculateRSI(prices, 14);
      const rsi2 = calculateRSI(prices, 2);
      const macd = calculateMACD(prices);
      
      const sma20 = calculateSMA(prices, 20);
      const sma50 = prices.length >= 50 ? calculateSMA(prices, 50) : sma20;
      const sma200 = quote.twoHundredDayAverage || sma50;
      
      const currentPrice = quote.regularMarketPrice;
      const priceVsSma20 = ((currentPrice - sma20) / sma20) * 100;
      const priceVsSma50 = ((currentPrice - sma50) / sma50) * 100;
      const priceVsSma200 = ((currentPrice - sma200) / sma200) * 100;
      
      const avgVolume = quote.averageDailyVolume10Day || 
        (volumes.slice(-10).reduce((a, b) => a + b, 0) / 10);
      const volumeRatio = avgVolume > 0 ? quote.regularMarketVolume / avgVolume : 1;
      
      const weekPrices = prices.slice(-5);
      const weekChangePercent = weekPrices.length >= 5 
        ? ((currentPrice - weekPrices[0]) / weekPrices[0]) * 100 
        : 0;
      
      const monthPrices = prices.slice(-22);
      const monthChangePercent = monthPrices.length >= 22
        ? ((currentPrice - monthPrices[0]) / monthPrices[0]) * 100
        : 0;
      
      const week52High = quote.fiftyTwoWeekHigh || Math.max(...prices);
      const week52Low = quote.fiftyTwoWeekLow || Math.min(...prices);
      const percentFrom52High = ((currentPrice - week52High) / week52High) * 100;
      const percentFrom52Low = ((currentPrice - week52Low) / week52Low) * 100;

      // Relative strength vs SPY — month-weighted so sustained leaders beat one-week noise.
      const relativeStrength = (monthChangePercent - spyMonthChange) * 0.6
        + (weekChangePercent - spyWeekChange) * 0.4;
      relativeStrengthBySymbol.set(quote.symbol, relativeStrength);

      const momentumScore = calculateMomentumScore({
        rsi14,
        priceVsSma20,
        priceVsSma50,
        priceVsSma200,
        volumeRatio,
        dayChangePercent: quote.regularMarketChangePercent,
        weekChangePercent,
        percentFrom52High,
        relativeStrength
      });
      
      const trendStrength = determineTrendStrength(momentumScore);
      const trendPhase = determineTrendPhase({
        priceVsSma20,
        priceVsSma50,
        volumeRatio,
        percentFrom52High,
        dayChangePercent: quote.regularMarketChangePercent
      });
      
      let macdSignal = 'neutral';
      if (macd.histogram > 0 && macd.macd > macd.signal) {
        macdSignal = macd.histogram > 0.1 ? 'bullish_cross' : 'bullish';
      } else if (macd.histogram < 0 && macd.macd < macd.signal) {
        macdSignal = macd.histogram < -0.1 ? 'bearish_cross' : 'bearish';
      }
      
      const isBreakout = volumeRatio > 1.5 && priceVsSma20 > 2 && quote.regularMarketChangePercent > 2;
      const isHighVolume = volumeRatio > 2;
      const isAboveMAs = priceVsSma20 > 0 && priceVsSma50 > 0 && priceVsSma200 > 0;
      const isNewHigh = percentFrom52High > -5;
      
      const sector = quote.sector || 'Other';
      const category = SECTOR_CATEGORIES[sector] || 'momentum';
      
      const trendData: Partial<BullishTrend> = {
        symbol: quote.symbol,
        name: quote.shortName || quote.longName || quote.symbol,
        sector,
        category,
        currentPrice,
        previousClose: quote.regularMarketPreviousClose,
        dayChange: quote.regularMarketChange,
        dayChangePercent: quote.regularMarketChangePercent,
        weekChangePercent,
        monthChangePercent,
        rsi14,
        rsi2,
        macdSignal,
        sma20,
        sma50,
        sma200,
        priceVsSma20,
        priceVsSma50,
        priceVsSma200,
        currentVolume: quote.regularMarketVolume,
        avgVolume,
        volumeRatio,
        trendStrength,
        trendPhase,
        momentumScore,
        week52High,
        week52Low,
        percentFrom52High,
        percentFrom52Low,
        isBreakout,
        isHighVolume,
        isAboveMAs,
        isNewHigh,
        isActive: true,
        lastScannedAt: new Date()
      };
      
      const existing = await db.select().from(bullishTrends)
        .where(eq(bullishTrends.symbol, quote.symbol))
        .limit(1);
      
      if (existing.length > 0) {
        await db.update(bullishTrends)
          .set({ ...trendData, updatedAt: new Date() })
          .where(eq(bullishTrends.id, existing[0].id));
        results.push({ ...existing[0], ...trendData } as BullishTrend);
      } else {
        const [inserted] = await db.insert(bullishTrends)
          .values(trendData as any)
          .returning();
        results.push(inserted);
      }
      
      // Record attention for bullish trend detection (momentum score 70+)
      if (momentumScore >= 70) {
        recordSymbolAttention(
          quote.symbol,
          'bullish_trend',
          'alert',
          { 
            confidence: momentumScore, 
            direction: 'bullish',
            message: `Momentum ${momentumScore}% | ${trendPhase} phase | ${trendStrength} trend${isBreakout ? ' | BREAKOUT' : ''}${isNewHigh ? ' | NEW HIGH' : ''}`
          }
        );
      }
      
      await new Promise(r => setTimeout(r, 100));
      
    } catch (error) {
      logger.debug(`[BULLISH] Error processing ${quote.symbol}`, { error });
    }
  }
  
  logger.info(`[BULLISH] Scan complete: ${results.length} stocks analyzed`);
  
  // Generate trade ideas for top momentum stocks (75+ score, or RS-leaders at 70+)
  await generateTradeIdeasFromMomentum(results, relativeStrengthBySymbol);

  return results;
}

// Generate trade ideas for high-momentum bullish stocks
async function generateTradeIdeasFromMomentum(
  trends: BullishTrend[],
  relativeStrengthBySymbol: Map<string, number> = new Map(),
): Promise<void> {
  const rsOf = (t: BullishTrend) => relativeStrengthBySymbol.get(t.symbol) ?? 0;

  // Two qualifying paths into the Trade Desk:
  //  1. Loud movers — the classic breakout/momentum setup at 75+ (unchanged).
  //  2. Quiet trend leaders — above all MAs, healthy RSI, beating SPY, at 70+.
  //     This is what surfaces mature large-cap uptrends (ORCL, CRM, NOW) that
  //     never print a volume-spike day but quietly outperform the market.
  const highMomentum = trends.filter(t => {
    if (!t.currentPrice || t.currentPrice <= 1) return false; // Avoid penny stocks
    if (!t.momentumScore) return false;

    const loudMover =
      t.momentumScore >= 75 &&
      (t.trendPhase === 'breakout' || t.trendPhase === 'momentum') &&
      t.isAboveMAs;

    const trendLeader =
      t.momentumScore >= 70 &&
      t.isAboveMAs &&
      rsOf(t) > 3 && // meaningfully outperforming SPY
      !!t.rsi14 && t.rsi14 >= 50 && t.rsi14 < 72 && // not overbought, not weak
      t.trendPhase !== 'distribution'; // allow accumulation + momentum, exclude rollovers

    return loudMover || trendLeader;
  });

  if (highMomentum.length === 0) {
    logger.debug('[BULLISH] No high-momentum stocks for trade ideas');
    return;
  }

  // Momentum/relative strength is a coverage observation, not an executable
  // trade plan. This path formerly persisted percentage/ATR defaults straight
  // into Oracle, which made a name such as MSFT appear "entered" even when
  // its own read still contained a bearish MACD and no structural target.
  // Keep the underlying bullishTrends records for the coverage lane; only a
  // structure-aware publisher may promote one into Active Signals.
  logger.info(
    `[BULLISH] ${highMomentum.length} momentum leaders retained as coverage; ` +
    '0 trade ideas published (requires trigger, invalidation, and structural target)',
  );
}

export async function getBullishTrends(): Promise<BullishTrend[]> {
  return db.select()
    .from(bullishTrends)
    .where(eq(bullishTrends.isActive, true))
    .orderBy(desc(bullishTrends.momentumScore));
}

export async function getTopMomentumStocks(limit = 10): Promise<BullishTrend[]> {
  return db.select()
    .from(bullishTrends)
    .where(and(
      eq(bullishTrends.isActive, true),
      eq(bullishTrends.trendStrength, 'strong')
    ))
    .orderBy(desc(bullishTrends.momentumScore))
    .limit(limit);
}

export async function getBreakoutStocks(): Promise<BullishTrend[]> {
  return db.select()
    .from(bullishTrends)
    .where(and(
      eq(bullishTrends.isActive, true),
      eq(bullishTrends.isBreakout, true)
    ))
    .orderBy(desc(bullishTrends.volumeRatio));
}

export async function addBullishStock(
  symbol: string, 
  userId: string,
  notes?: string,
  category?: TrendCategory
): Promise<BullishTrend | null> {
  try {
    const quotes = await fetchQuotes([symbol.toUpperCase()]);
    if (quotes.length === 0) {
      throw new Error(`Could not find quote data for ${symbol}`);
    }
    
    const quote = quotes[0];
    const historical = await fetchHistoricalData(quote.symbol);
    
    const prices = historical?.prices || [quote.regularMarketPrice];
    const rsi14 = calculateRSI(prices, 14);
    const sma20 = calculateSMA(prices, 20);
    
    const trendData = {
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || quote.symbol,
      sector: quote.sector || 'Other',
      category: category || 'momentum',
      currentPrice: quote.regularMarketPrice,
      previousClose: quote.regularMarketPreviousClose,
      dayChange: quote.regularMarketChange,
      dayChangePercent: quote.regularMarketChangePercent,
      rsi14,
      sma20,
      currentVolume: quote.regularMarketVolume,
      avgVolume: quote.averageDailyVolume10Day || 0,
      volumeRatio: quote.averageDailyVolume10Day 
        ? quote.regularMarketVolume / quote.averageDailyVolume10Day 
        : 1,
      momentumScore: 50,
      trendStrength: 'moderate' as TrendStrength,
      trendPhase: 'accumulation' as TrendPhase,
      week52High: quote.fiftyTwoWeekHigh,
      week52Low: quote.fiftyTwoWeekLow,
      addedManually: true,
      addedBy: userId,
      notes,
      isActive: true
    };
    
    const existing = await db.select().from(bullishTrends)
      .where(eq(bullishTrends.symbol, quote.symbol))
      .limit(1);
    
    if (existing.length > 0) {
      await db.update(bullishTrends)
        .set({ ...trendData, updatedAt: new Date() })
        .where(eq(bullishTrends.id, existing[0].id));
      return { ...existing[0], ...trendData } as BullishTrend;
    }
    
    const [inserted] = await db.insert(bullishTrends)
      .values(trendData as any)
      .returning();
    
    return inserted;
  } catch (error) {
    logger.error(`[BULLISH] Failed to add stock ${symbol}`, { error });
    return null;
  }
}

export async function removeBullishStock(symbol: string): Promise<boolean> {
  try {
    await db.update(bullishTrends)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(bullishTrends.symbol, symbol.toUpperCase()));
    return true;
  } catch (error) {
    logger.error(`[BULLISH] Failed to remove stock ${symbol}`, { error });
    return false;
  }
}

export async function sendBreakoutAlerts(): Promise<void> {
  const breakouts = await getBreakoutStocks();
  const newBreakouts = breakouts.filter(b => !b.alertSent);
  
  // QUANTFLOOR restricted to announcements only - breakout alerts go to general URL
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  
  for (const breakout of newBreakouts) {
    try {
      const message = {
        embeds: [{
          title: `🚀 BREAKOUT ALERT: ${breakout.symbol}`,
          description: `**${breakout.name}** is breaking out!`,
          color: 0x00ff00,
          fields: [
            { name: 'Price', value: `$${breakout.currentPrice?.toFixed(2)}`, inline: true },
            { name: 'Change', value: `${breakout.dayChangePercent?.toFixed(2)}%`, inline: true },
            { name: 'Volume Ratio', value: `${breakout.volumeRatio?.toFixed(1)}x`, inline: true },
            { name: 'Momentum Score', value: `${breakout.momentumScore}/100`, inline: true },
            { name: 'Trend Phase', value: breakout.trendPhase || 'Unknown', inline: true },
            { name: 'RSI(14)', value: breakout.rsi14?.toFixed(1) || 'N/A', inline: true },
          ],
          footer: { text: 'Quant Edge Labs - Bullish Trend Tracker' },
          timestamp: new Date().toISOString()
        }]
      };
      
      await postDiscordWebhook(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });
      
      await db.update(bullishTrends)
        .set({ alertSent: true, lastAlertDate: new Date() })
        .where(eq(bullishTrends.id, breakout.id));
        
    } catch (error) {
      logger.error(`[BULLISH] Failed to send alert for ${breakout.symbol}`, { error });
    }
  }
}

export function startBullishTrendScanner(): void {
  logger.info('[BULLISH] Starting Bullish Trend Scanner...');
  
  // Run immediate ingestion using existing DB data (doesn't wait for slow scan)
  setTimeout(async () => {
    try {
      logger.info('[BULLISH] Running immediate Trade Desk ingestion with existing data...');
      const result = await ingestBullishTrendsToTradeDesk();
      logger.info(`[BULLISH] Immediate ingestion complete: ${result.ingested} ingested, ${result.skipped} skipped`);
    } catch (err) {
      logger.error('[BULLISH] Immediate Trade Desk ingestion failed', { error: err });
    }
  }, 3000); // 3 second delay to let other startup tasks complete
  
  // Start the scan in background (non-blocking)
  scanBullishTrends().then(() => {
    logger.info('[BULLISH] Scan completed, running post-scan ingestion...');
    ingestBullishTrendsToTradeDesk().catch(err =>
      logger.error('[BULLISH] Post-scan Trade Desk ingestion failed', { error: err })
    );
  }).catch(err => 
    logger.error('[BULLISH] Initial scan failed', { error: err })
  );
  
  setInterval(() => {
    // Evaluate the market-hours guard in ET. Production runs on UTC, so raw
    // getHours() drifts the window to ~5am–1pm ET and the scanner silently
    // stops re-scanning for the afternoon session.
    const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = et.getHours();
    const day = et.getDay();

    if (day >= 1 && day <= 5 && hour >= 9 && hour <= 16) {
      scanBullishTrends().catch(err => 
        logger.error('[BULLISH] Scheduled scan failed', { error: err })
      );
      // Ingest strong trends to Trade Desk
      ingestBullishTrendsToTradeDesk().catch(err =>
        logger.error('[BULLISH] Trade Desk ingestion failed', { error: err })
      );
    }
  }, 15 * 60 * 1000);
  
  logger.info('[BULLISH] Scanner started - scanning every 15 minutes during market hours');
}

/**
 * Ingest strong bullish trends into Trade Desk
 * Creates trade ideas for trends meeting quality criteria
 */
export async function ingestBullishTrendsToTradeDesk(): Promise<{ ingested: number; skipped: number }> {
  logger.info('[BULLISH->TRADE-DESK] 🚀 Starting ingestion pipeline...');
  
  const { ingestTradeIdea, createScannerSignals } = await import('./trade-idea-ingestion');
  
  const trends = await getBullishTrends();
  logger.info(`[BULLISH->TRADE-DESK] Found ${trends.length} trends to evaluate`);
  
  let ingested = 0;
  let skipped = 0;
  let filterStats = { momentum: 0, strength: 0, phase: 0, volume: 0, rsi: 0, signals: 0 };
  
  for (const trend of trends) {
    // Quality filters for Trade Desk ingestion
    // 1. Strong momentum score (>= 60)
    if (!trend.momentumScore || trend.momentumScore < 60) {
      filterStats.momentum++;
      skipped++;
      continue;
    }
    
    // 2. Good trend strength (not weak)
    if (trend.trendStrength === 'weak') {
      filterStats.strength++;
      skipped++;
      continue;
    }
    
    // 3. Acceptable trend phases (accumulation, momentum, breakout)
    const goodPhases: TrendPhase[] = ['accumulation', 'momentum', 'breakout'];
    if (!trend.trendPhase || !goodPhases.includes(trend.trendPhase)) {
      filterStats.phase++;
      skipped++;
      continue;
    }
    
    // 4. Volume confirmation (relaxed to 0.7 - many strong trends have slightly below-average volume)
    if (!trend.volumeRatio || trend.volumeRatio < 0.7) {
      filterStats.volume++;
      skipped++;
      continue;
    }
    
    // 5. RSI not overbought (< 80)
    if (trend.rsi14 && trend.rsi14 > 80) {
      filterStats.rsi++;
      skipped++;
      continue;
    }
    
    // Calculate distance from 52-week high
    const distanceFromHigh = trend.week52High && trend.currentPrice 
      ? ((trend.week52High - trend.currentPrice) / trend.week52High) * 100 
      : undefined;
    
    // Create base signals from trend data
    const signals = createScannerSignals({
      changePercent: trend.dayChangePercent || 0,
      relativeVolume: trend.volumeRatio || 1,
      rsi: trend.rsi14 || 50,
      nearHigh: distanceFromHigh !== undefined && distanceFromHigh < 5,
      breakout: trend.trendPhase === 'breakout',
      trendStrength: trend.trendStrength === 'strong' ? 0.9 : trend.trendStrength === 'moderate' ? 0.7 : 0.5,
    });
    
    // Boost signal weights for pre-screened bullish trends (momentum & phase already validated)
    // Add a "bullish momentum" signal with weight based on momentum score to push above threshold
    const momentumBoostWeight = Math.min(20, Math.floor((trend.momentumScore || 60) / 5));
    signals.push({
      type: 'bullish_momentum',
      description: `Bullish momentum ${trend.momentumScore || 60}/100`,
      weight: momentumBoostWeight,
    });
    
    // Add extra weight for breakout phase
    if (trend.trendPhase === 'breakout') {
      signals.push({
        type: 'breakout_confirmation',
        description: 'Breakout phase with volume',
        weight: 15,
      });
    }
    
    // Need at least 1 signal (relaxed from 2)
    if (signals.length < 1) {
      filterStats.signals++;
      skipped++;
      continue;
    }
    
    logger.info(`[BULLISH->TRADE-DESK] Passed filters: ${trend.symbol} (mom=${trend.momentumScore}, vol=${trend.volumeRatio?.toFixed(2)}, phase=${trend.trendPhase}, signals=${signals.length})`)
    
    // Determine holding period based on trend phase
    const holdingPeriod = trend.trendPhase === 'breakout' ? 'day' : 'swing';
    
    const result = await ingestTradeIdea({
      source: 'bullish_trend', // Dedicated source for bullish trends
      symbol: trend.symbol,
      assetType: 'stock',
      direction: 'bullish',
      signals,
      holdingPeriod,
      currentPrice: trend.currentPrice || undefined,
      catalyst: `${trend.trendStrength} ${trend.trendPhase} trend with ${(trend.momentumScore || 0).toFixed(0)} momentum`,
      analysis: `${trend.name || trend.symbol} showing ${trend.trendStrength} bullish momentum. ${
        trend.trendPhase === 'breakout' ? 'Breaking out with volume confirmation.' : 
        trend.trendPhase === 'accumulation' ? 'Accumulation phase detected.' :
        'In active momentum phase.'
      } RSI: ${trend.rsi14?.toFixed(0) || 'N/A'}, Volume: ${trend.volumeRatio?.toFixed(1)}x avg.`,
    });
    
    if (result.success) {
      ingested++;
      logger.info(`[BULLISH->TRADE-DESK] ✅ Ingested ${trend.symbol}: ${trend.trendPhase} (score: ${trend.momentumScore})`);
    } else {
      skipped++;
      logger.debug(`[BULLISH->TRADE-DESK] ⏭️ Skipped ${trend.symbol}: ${result.reason || 'No reason provided'}`);
    }
  }
  
  logger.info(`[BULLISH->TRADE-DESK] Filter stats - momentum: ${filterStats.momentum}, strength: ${filterStats.strength}, phase: ${filterStats.phase}, volume: ${filterStats.volume}, rsi: ${filterStats.rsi}, signals: ${filterStats.signals}`);
  logger.info(`[BULLISH->TRADE-DESK] Complete: ${ingested} ingested, ${skipped} skipped`);
  return { ingested, skipped };
}

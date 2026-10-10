import { logger } from "./logger";
import { storage } from "./storage";
import { postDiscordWebhook } from './discord-service';

interface SwingOpportunity {
  symbol: string;
  currentPrice: number;
  rsi14: number;
  targetPrice: number;
  targetPercent: number;
  stopLoss: number;
  stopLossPercent: number;
  holdDays: number;
  pattern: string;
  grade: string;
  score: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  sma50: number;
  sma200: number;
  trendBias: 'bullish' | 'bearish' | 'neutral';
  reason: string;
  createdAt: Date;
}

// Swing trade universe - quality mid/large caps with good liquidity
const SWING_TICKERS = [
  // Tech leaders
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'AMD', 'INTC', 'CRM', 'ORCL',
  // Growth stocks
  'TSLA', 'PLTR', 'SNOW', 'COIN', 'SQ', 'SHOP', 'ROKU', 'DKNG', 'UBER', 'ABNB',
  // Financials
  'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'PYPL',
  // Energy/Materials
  'XOM', 'CVX', 'OXY', 'FCX', 'NEM',
  // Healthcare
  'JNJ', 'PFE', 'ABBV', 'MRK', 'LLY',
  // Consumer
  'NKE', 'SBUX', 'MCD', 'DIS', 'NFLX',
  // ETFs for broad market swings
  'SPY', 'QQQ', 'IWM', 'XLF', 'XLE', 'XLK'
];

// Cache for daily data
const dailyDataCache = new Map<string, { data: any; timestamp: Date }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch daily chart data from Yahoo Finance
 */
async function fetchDailyData(symbol: string): Promise<any> {
  const cached = dailyDataCache.get(symbol);
  if (cached && (Date.now() - cached.timestamp.getTime()) < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=6mo`
    );
    
    if (!response.ok) {
      logger.warn(`[SWING] Failed to fetch daily data for ${symbol}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (result) {
      dailyDataCache.set(symbol, { data: result, timestamp: new Date() });
    }
    
    return result;
  } catch (error) {
    logger.error(`[SWING] Error fetching ${symbol}:`, error);
    return null;
  }
}

/**
 * Calculate RSI(14) from closing prices
 */
function calculateRSI14(closes: number[]): number {
  if (closes.length < 15) return 50;
  
  const period = 14;
  let gains = 0;
  let losses = 0;
  
  // Initial average gain/loss
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Detect daily chart patterns
 */
function detectPattern(closes: number[], highs: number[], lows: number[]): string {
  if (closes.length < 10) return 'insufficient_data';
  
  const recent = closes.slice(-5);
  const prior = closes.slice(-10, -5);
  
  const recentAvg = recent.reduce((s, p) => s + p, 0) / recent.length;
  const priorAvg = prior.reduce((s, p) => s + p, 0) / prior.length;
  
  const currentPrice = closes[closes.length - 1];
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  
  // Recent low (potential bounce)
  const recentLow = Math.min(...lows.slice(-5));
  const recentHigh = Math.max(...highs.slice(-20));
  
  // Patterns
  if (currentPrice < sma20 && recentAvg < priorAvg && currentPrice > recentLow * 1.01) {
    return 'oversold_bounce';
  }
  
  if (currentPrice > sma20 && currentPrice > sma50 && recentAvg > priorAvg) {
    return 'uptrend_pullback';
  }
  
  if (currentPrice < sma50 && recentAvg < priorAvg * 0.95) {
    return 'deep_pullback';
  }
  
  if (Math.abs(currentPrice - sma50) / sma50 < 0.02) {
    return 'sma50_support';
  }
  
  if (currentPrice < recentHigh * 0.9) {
    return 'breakdown_recovery';
  }
  
  return 'consolidation';
}

/**
 * Score a swing opportunity (0-100)
 */
function scoreSwingOpportunity(
  rsi14: number,
  volumeRatio: number,
  pattern: string,
  trendBias: string,
  priceVsSMA50: number
): number {
  let score = 50;
  
  // RSI(14) scoring - sweet spot is 30-40 for oversold bounce
  if (rsi14 < 30) score += 20;
  else if (rsi14 < 40) score += 15;
  else if (rsi14 < 50) score += 5;
  else if (rsi14 > 70) score -= 15;
  
  // Volume confirmation
  if (volumeRatio > 2.0) score += 10;
  else if (volumeRatio > 1.5) score += 5;
  else if (volumeRatio < 0.5) score -= 10;
  
  // Pattern scoring
  const patternScores: Record<string, number> = {
    'oversold_bounce': 15,
    'sma50_support': 12,
    'uptrend_pullback': 10,
    'deep_pullback': 8,
    'breakdown_recovery': 5,
    'consolidation': 0,
    'insufficient_data': -20
  };
  score += patternScores[pattern] || 0;
  
  // Trend bias
  if (trendBias === 'bullish') score += 10;
  else if (trendBias === 'bearish') score -= 5;
  
  // Price relative to SMA50
  if (priceVsSMA50 > -0.05 && priceVsSMA50 < 0.02) {
    score += 8; // Near SMA50 support
  } else if (priceVsSMA50 < -0.10) {
    score += 5; // Deeply oversold vs SMA50
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Scan for swing trade opportunities
 */
export async function scanSwingOpportunities(): Promise<SwingOpportunity[]> {
  /**
   * Scan the liquid universe, not a hand-typed list.
   *
   * An audit of all 23 producers found 20 capped to hand-written arrays while
   * the 2,000-name liquid universe sat loaded in memory. ORCL was the case that
   * exposed it: on the core watchlist, 180 sessions of bars available, and zero
   * ideas in the platform's history — never rejected, never evaluated, because
   * nobody had typed it into an array.
   *
   * The hand list is unioned in, so nothing that used to be scanned drops out
   * when the universe is cold.
   */
  let swingUniverse: string[] = [...SWING_TICKERS];
  try {
    const { getLiquidSymbols, loadLiquidUniverseFromDisk } = await import('./liquid-universe');
    if (getLiquidSymbols().length === 0) await loadLiquidUniverseFromDisk();
    const liquid = getLiquidSymbols();
    if (liquid.length > 0) {
      swingUniverse = Array.from(new Set([...SWING_TICKERS, ...liquid].map((x) => x.toUpperCase())));
    }
  } catch { /* cold universe — the hand list still scans */ }
  logger.info(`[SWING] 🔍 Scanning ${swingUniverse.length} tickers for swing opportunities...`);
  
  const opportunities: SwingOpportunity[] = [];
  
  for (const symbol of swingUniverse) {
    try {
      const data = await fetchDailyData(symbol);
      if (!data) continue;
      
      const quotes = data.indicators?.quote?.[0];
      const closes = quotes?.close?.filter((p: any) => p !== null) || [];
      const highs = quotes?.high?.filter((p: any) => p !== null) || [];
      const lows = quotes?.low?.filter((p: any) => p !== null) || [];
      const volumes = quotes?.volume?.filter((v: any) => v !== null) || [];
      
      if (closes.length < 50) continue;
      
      const currentPrice = closes[closes.length - 1];
      const rsi14 = calculateRSI14(closes);
      const sma50 = calculateSMA(closes, 50);
      const sma200 = calculateSMA(closes, 200);
      
      // Volume analysis
      const currentVolume = volumes[volumes.length - 1] || 0;
      const avgVolume = volumes.slice(-20).reduce((s: number, v: number) => s + v, 0) / 20;
      const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
      
      // Trend bias
      let trendBias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      if (sma50 > sma200 && currentPrice > sma50) trendBias = 'bullish';
      else if (sma50 < sma200 && currentPrice < sma50) trendBias = 'bearish';
      
      // Detect pattern
      const pattern = detectPattern(closes, highs, lows);
      
      // Price vs SMA50
      const priceVsSMA50 = (currentPrice - sma50) / sma50;
      
      // Score the opportunity
      const score = scoreSwingOpportunity(rsi14, volumeRatio, pattern, trendBias, priceVsSMA50);
      
      // Only consider if RSI is favorable and score is decent
      if (rsi14 > 50 || score < 60) continue;
      
      // Calculate targets (5-10% gain potential)
      const targetPercent = rsi14 < 30 ? 10 : rsi14 < 40 ? 8 : 6;
      const targetPrice = currentPrice * (1 + targetPercent / 100);
      
      // Stop loss at 3-5% depending on volatility
      const stopLossPercent = targetPercent > 8 ? 5 : 4;
      const stopLoss = currentPrice * (1 - stopLossPercent / 100);
      
      // Estimate hold time based on pattern
      let holdDays = 5;
      if (pattern === 'deep_pullback') holdDays = 10;
      else if (pattern === 'oversold_bounce') holdDays = 4;
      else if (pattern === 'uptrend_pullback') holdDays = 3;
      
      // Build reason string
      let reason = `RSI(14): ${rsi14.toFixed(1)}`;
      if (pattern !== 'consolidation') reason += ` | ${pattern.replace(/_/g, ' ')}`;
      if (trendBias !== 'neutral') reason += ` | ${trendBias} trend`;
      
      // Map score to grade
      let grade = 'C';
      if (score >= 85) grade = 'S';
      else if (score >= 75) grade = 'A';
      else if (score >= 65) grade = 'B';
      else if (score >= 55) grade = 'C';
      else grade = 'D';
      
      opportunities.push({
        symbol,
        currentPrice,
        rsi14,
        targetPrice,
        targetPercent,
        stopLoss,
        stopLossPercent,
        holdDays,
        pattern,
        grade,
        score,
        volume: currentVolume,
        avgVolume,
        volumeRatio,
        sma50,
        sma200,
        trendBias,
        reason,
        createdAt: new Date()
      });
      
    } catch (error) {
      logger.error(`[SWING] Error analyzing ${symbol}:`, error);
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Sort by score (best first)
  opportunities.sort((a, b) => b.score - a.score);
  
  logger.info(`[SWING] ✅ Found ${opportunities.length} swing opportunities`);
  
  return opportunities;
}

/**
 * Get top swing opportunities
 */
export async function getTopSwingOpportunities(limit: number = 10): Promise<SwingOpportunity[]> {
  const all = await scanSwingOpportunities();
  return all.slice(0, limit);
}

/**
 * Send swing opportunity to Discord
 */
export async function sendSwingToDiscord(opp: SwingOpportunity): Promise<boolean> {
  // DEDUPLICATION: Check if we can send notification (global + per-symbol cooldown)
  const { canSendScannerNotification, markScannerNotificationSent } = await import('./discord-service');
  const dedupCheck = canSendScannerNotification('swing_trade', [opp.symbol]);

  if (!dedupCheck.canSend) {
    logger.info(`[SWING] Discord notification BLOCKED for ${opp.symbol}: ${dedupCheck.reason}`);
    return false;
  }

  if (!dedupCheck.filteredSymbols.includes(opp.symbol)) {
    logger.info(`[SWING] ${opp.symbol} was recently notified - skipping Discord`);
    return false;
  }

  const embed = {
    title: `📈 SWING TRADE: ${opp.symbol}`,
    color: opp.grade === 'S' ? 0xFFD700 : opp.grade === 'A' ? 0x00FF00 : 0x00BFFF,
    fields: [
      {
        name: '💰 Entry',
        value: `$${opp.currentPrice.toFixed(2)}`,
        inline: true
      },
      {
        name: '🎯 Target',
        value: `$${opp.targetPrice.toFixed(2)} (+${opp.targetPercent.toFixed(1)}%)`,
        inline: true
      },
      {
        name: '🛑 Stop',
        value: `$${opp.stopLoss.toFixed(2)} (-${opp.stopLossPercent.toFixed(1)}%)`,
        inline: true
      },
      {
        name: '📊 RSI(14)',
        value: opp.rsi14.toFixed(1),
        inline: true
      },
      {
        name: '⏱️ Hold Time',
        value: `${opp.holdDays} days`,
        inline: true
      },
      {
        name: '📈 Grade',
        value: `${opp.grade} (${opp.score}/100)`,
        inline: true
      },
      {
        name: '🔍 Pattern',
        value: opp.pattern.replace(/_/g, ' '),
        inline: true
      },
      {
        name: '📉 Trend',
        value: opp.trendBias,
        inline: true
      },
      {
        name: '📊 Volume',
        value: `${opp.volumeRatio.toFixed(1)}x avg`,
        inline: true
      }
    ],
    footer: {
      text: `🔬 Swing Scanner | ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago' })} CT`
    }
  };

  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK_CHARTANALYSIS || process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      logger.warn(`[SWING] No Discord webhook configured`);
      return false;
    }
    
    const response = await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
    
    if (!response.ok) {
      logger.warn(`[SWING] Discord webhook failed: ${response.status}`);
      return false;
    }

    // Mark notification as sent to prevent spam
    markScannerNotificationSent('swing_trade', [opp.symbol]);
    logger.info(`[SWING] 📱 Sent ${opp.symbol} to Discord (deduped)`);
    return true;
  } catch (error) {
    logger.error(`[SWING] Discord send failed:`, error);
    return false;
  }
}

export { SwingOpportunity };

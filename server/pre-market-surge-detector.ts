import { logger } from './logger';
import { postDiscordWebhook } from './discord-service';

const PRE_MARKET_WATCHLIST = [
  // Nuclear & Energy
  'OKLO', 'NNE', 'SMR', 'LEU', 'CCJ', 'UEC', 'DNN', 'URG', 'BWXT',
  // Defense & Aerospace (Lockheed, Northrop, RTX, General Dynamics, Boeing, etc.)
  'LMT', 'NOC', 'RTX', 'GD', 'BA', 'HII', 'LHX', 'TXT', 'HWM',
  // Space & Satellites
  'RKLB', 'ASTS', 'LUNR', 'RDW', 'MNTS', 'LLAP', 'SPCE',
  // Crypto & Fintech
  'MARA', 'RIOT', 'CLSK', 'IREN', 'CIFR',
  // AI & Quantum
  'PLTR', 'RGTI', 'NBIS', 'IONQ', 'QBTS', 'ARQQ', 'QUBT', 'LAES',
  // Tech Leaders
  'INTC', 'ZETA', 'RIVN', 'SOFI', 'ARM', 'APP', 'TSLA', 'NVDA', 'AMD',
  // EV & Battery
  'KULR', 'QS', 'SLDP', 'MVST',
];

const SURGE_THRESHOLDS = {
  MODERATE: 5,   // Was 3% - raised to reduce spam
  HIGH: 8,       // Was 5%
  CRITICAL: 12,  // Was 8%
};

interface SurgeAlert {
  symbol: string;
  currentPrice: number;
  previousClose: number;
  changePercent: number;
  urgency: 'moderate' | 'high' | 'critical';
  timestamp: Date;
}

const alertCache = new Map<string, { percent: number; timestamp: Date }>();
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours - only alert once per session
const DELTA_THRESHOLD = 5; // Only re-alert if move increases by 5%+ more
const DISABLE_DISCORD_ALERTS = true; // Disable Discord spam - use for internal tracking only

function isPreMarketHours(): boolean {
  const now = new Date();
  const etOptions: Intl.DateTimeFormatOptions = { 
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  };
  const etTime = new Intl.DateTimeFormat('en-US', etOptions).format(now);
  const [hours, minutes] = etTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;
  
  const dayOfWeek = new Date().toLocaleDateString('en-US', { 
    timeZone: 'America/New_York', 
    weekday: 'short' 
  });
  
  if (dayOfWeek === 'Sat' || dayOfWeek === 'Sun') {
    return false;
  }
  
  const preMarketStart = 4 * 60;
  const preMarketEnd = 9 * 60 + 30;
  
  return totalMinutes >= preMarketStart && totalMinutes < preMarketEnd;
}

function getUrgencyLevel(changePercent: number): 'moderate' | 'high' | 'critical' | null {
  const absChange = Math.abs(changePercent);
  if (absChange >= SURGE_THRESHOLDS.CRITICAL) return 'critical';
  if (absChange >= SURGE_THRESHOLDS.HIGH) return 'high';
  if (absChange >= SURGE_THRESHOLDS.MODERATE) return 'moderate';
  return null;
}

function shouldSendAlert(symbol: string, changePercent: number): boolean {
  const cached = alertCache.get(symbol);
  if (!cached) return true;
  
  const timeSinceLastAlert = Date.now() - cached.timestamp.getTime();
  if (timeSinceLastAlert >= ALERT_COOLDOWN_MS) return true;
  
  const deltaSinceLastAlert = Math.abs(changePercent) - Math.abs(cached.percent);
  if (deltaSinceLastAlert >= DELTA_THRESHOLD) return true;
  
  return false;
}

const YAHOO_FINANCE_API = 'https://query1.finance.yahoo.com/v8/finance/chart';

async function fetchPreMarketQuote(symbol: string): Promise<{ preMarketPrice: number; previousClose: number; regularPrice: number } | null> {
  try {
    const response = await fetch(
      `${YAHOO_FINANCE_API}/${symbol}?interval=1m&range=1d&includePrePost=true`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result) return null;

    const meta = result.meta;
    const preMarketPrice = meta.preMarketPrice || meta.regularMarketPrice;
    const previousClose = meta.previousClose || meta.chartPreviousClose;
    const regularPrice = meta.regularMarketPrice;
    
    if (!preMarketPrice || !previousClose) return null;

    return {
      preMarketPrice,
      previousClose,
      regularPrice,
    };
  } catch (error) {
    logger.debug(`[PRE-MARKET] Failed to fetch quote for ${symbol}: ${error}`);
    return null;
  }
}

async function fetchPreMarketQuotes(symbols: string[]): Promise<Map<string, { preMarketPrice: number; previousClose: number; regularPrice: number }>> {
  const results = new Map<string, { preMarketPrice: number; previousClose: number; regularPrice: number }>();
  
  for (const symbol of symbols) {
    try {
      const quote = await fetchPreMarketQuote(symbol);
      if (quote) {
        results.set(symbol, quote);
      }
      await new Promise(r => setTimeout(r, 100));
    } catch (error) {
      logger.debug(`[PRE-MARKET] Error fetching ${symbol}`, { error });
    }
  }
  
  return results;
}

async function sendPreMarketSurgeAlert(alert: SurgeAlert): Promise<void> {
  // Discord alerts disabled - use internal tracking only to prevent spam
  if (DISABLE_DISCORD_ALERTS) {
    logger.debug(`[PRE-MARKET] Discord alerts disabled - ${alert.symbol} ${alert.urgency} surge tracked internally`);
    return;
  }
  
  // QUANTFLOOR restricted to announcements only - surge alerts go to general URL
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl) {
    logger.warn('[PRE-MARKET] No Discord webhook configured for pre-market alerts');
    return;
  }
  
  const urgencyEmoji = {
    moderate: '🟡',
    high: '🟠', 
    critical: '🔴',
  };
  
  const urgencyText = {
    moderate: 'MODERATE SURGE',
    high: 'HIGH SURGE',
    critical: '🚨 CRITICAL SURGE',
  };
  
  const direction = alert.changePercent > 0 ? '📈' : '📉';
  const changeSign = alert.changePercent > 0 ? '+' : '';
  
  const embed = {
    title: `${urgencyEmoji[alert.urgency]} ${alert.symbol} ${urgencyText[alert.urgency]} ${direction}`,
    description: `**Pre-Market Alert** - ${alert.symbol} is moving!`,
    color: alert.changePercent > 0 ? 0x22c55e : 0xef4444,
    fields: [
      {
        name: '💰 Current Price',
        value: `$${alert.currentPrice.toFixed(2)}`,
        inline: true,
      },
      {
        name: '📊 Change',
        value: `${changeSign}${alert.changePercent.toFixed(2)}%`,
        inline: true,
      },
      {
        name: '📉 Previous Close',
        value: `$${alert.previousClose.toFixed(2)}`,
        inline: true,
      },
      {
        name: '🔗 Quick Links',
        value: `[TradingView](https://tradingview.com/chart/?symbol=${alert.symbol}) | [Yahoo](https://finance.yahoo.com/quote/${alert.symbol})`,
        inline: false,
      },
    ],
    footer: {
      text: `Pre-Market Surge Detector • ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT`,
    },
    timestamp: new Date().toISOString(),
  };
  
  try {
    const response = await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    
    if (response.ok) {
      logger.info(`[PRE-MARKET] Alert sent for ${alert.symbol}: ${changeSign}${alert.changePercent.toFixed(2)}%`);
      alertCache.set(alert.symbol, { percent: alert.changePercent, timestamp: new Date() });
    } else {
      logger.warn(`[PRE-MARKET] Discord webhook failed: ${response.status}`);
    }
  } catch (error) {
    logger.error('[PRE-MARKET] Failed to send Discord alert', { error });
  }
}

export async function scanPreMarketSurges(): Promise<SurgeAlert[]> {
  if (!isPreMarketHours()) {
    logger.debug('[PRE-MARKET] Outside pre-market hours, skipping scan');
    return [];
  }
  
  logger.info('[PRE-MARKET] Starting pre-market surge scan...');
  
  const quotes = await fetchPreMarketQuotes(PRE_MARKET_WATCHLIST);
  const alerts: SurgeAlert[] = [];
  
  for (const [symbol, data] of Array.from(quotes.entries())) {
    const changePercent = ((data.preMarketPrice - data.previousClose) / data.previousClose) * 100;
    const urgency = getUrgencyLevel(changePercent);
    
    if (!urgency) continue;
    if (data.preMarketPrice < 2) continue;
    
    if (!shouldSendAlert(symbol, changePercent)) {
      logger.debug(`[PRE-MARKET] ${symbol} surge already alerted, skipping`);
      continue;
    }
    
    const alert: SurgeAlert = {
      symbol,
      currentPrice: data.preMarketPrice,
      previousClose: data.previousClose,
      changePercent,
      urgency,
      timestamp: new Date(),
    };
    
    alerts.push(alert);
    await sendPreMarketSurgeAlert(alert);
    
    // Record attention event
    try {
      const { recordSymbolAttention } = await import('./attention-tracking-service');
      await recordSymbolAttention(symbol, 'pre_market_surge', 'alert', {
        price: data.preMarketPrice,
        changePercent,
        direction: changePercent > 0 ? 'bullish' : 'bearish',
        message: `${urgency} surge: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%`,
      });
    } catch (e) {
      // Silently fail - don't block alerts
    }
  }
  
  if (alerts.length > 0) {
    logger.info(`[PRE-MARKET] Detected ${alerts.length} surges: ${alerts.map(a => `${a.symbol} ${a.changePercent > 0 ? '+' : ''}${a.changePercent.toFixed(1)}%`).join(', ')}`);
  } else {
    logger.debug('[PRE-MARKET] No significant surges detected');
  }
  
  return alerts;
}

let scanInterval: NodeJS.Timeout | null = null;

export function startPreMarketSurgeDetector(): void {
  logger.info('[PRE-MARKET] Starting Pre-Market Surge Detector...');
  
  setTimeout(() => scanPreMarketSurges(), 5000);
  
  scanInterval = setInterval(() => {
    scanPreMarketSurges().catch(err => {
      logger.error('[PRE-MARKET] Scan error', { error: err });
    });
  }, 5 * 60 * 1000);
  
  logger.info('[PRE-MARKET] Surge detector started - scanning every 5 minutes during pre-market hours (4 AM - 9:30 AM ET)');
}

export function stopPreMarketSurgeDetector(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    logger.info('[PRE-MARKET] Surge detector stopped');
  }
}

export function addToPreMarketWatchlist(symbol: string): void {
  if (!PRE_MARKET_WATCHLIST.includes(symbol.toUpperCase())) {
    PRE_MARKET_WATCHLIST.push(symbol.toUpperCase());
    logger.info(`[PRE-MARKET] Added ${symbol} to watchlist`);
  }
}

export function getPreMarketWatchlist(): string[] {
  return [...PRE_MARKET_WATCHLIST];
}

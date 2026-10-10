import { logger } from './logger';
import { ingestTradeIdea, IngestionInput } from './trade-idea-ingestion';
import { safeScreener, safeQuote } from './yahoo-finance-service';

// Market-wide scan - fetch actual surging stocks from the ENTIRE market
async function fetchMarketWideSurgers(): Promise<Array<{ symbol: string; change: number; price: number; volume: number }>> {
  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 10000)
    );

    // Fetch TOP GAINERS from the ENTIRE market - not limited to any watchlist
    const gainersPromise = safeScreener({
      scrIds: 'day_gainers',
      count: 100, // Get top 100 gainers market-wide
    });

    const gainers = await Promise.race([gainersPromise, timeoutPromise]);

    const surgers: Array<{ symbol: string; change: number; price: number; volume: number }> = [];

    if (gainers?.quotes) {
      for (const quote of gainers.quotes as any[]) {
        // Filter: valid US stocks only
        if (!quote.symbol || quote.symbol.includes('.') || quote.symbol.length > 5) continue;

        const change = quote.regularMarketChangePercent || 0;
        // Only include stocks with meaningful movement (3%+ or high volume)
        if (change >= 3 || quote.regularMarketVolume > 10000000) {
          surgers.push({
            symbol: quote.symbol,
            change,
            price: quote.regularMarketPrice || 0,
            volume: quote.regularMarketVolume || 0
          });
        }
      }
    }

    surgers.sort((a, b) => b.change - a.change);

    if (surgers.length > 0) {
      logger.info(`[DETECTION-ENGINE] 🌐 MARKET-WIDE SCAN found ${surgers.length} surgers: ${surgers.slice(0, 8).map(s => `${s.symbol}+${s.change.toFixed(0)}%`).join(', ')}`);
    }

    return surgers;
  } catch (e) {
    logger.error('[DETECTION-ENGINE] Market-wide scan failed:', e);
    return [];
  }
}

interface DetectionAlert {
  symbol: string;
  trigger: 'VOLUME_SPIKE' | 'PRICE_BREAKOUT' | 'NEWS_CATALYST' | 'SECTOR_MOVE' | 'TECHNICAL_SIGNAL';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  price: number;
  change: number;
  detectedAt: Date;
  data?: any;
}

interface WatchCriteria {
  volumeMultiplier: number;
  priceChangeThreshold: number;
  technicalBreakout: boolean;
  newsWatch: boolean;
}

const DEFAULT_CRITERIA: WatchCriteria = {
  volumeMultiplier: 2.0,
  priceChangeThreshold: 3.0,
  technicalBreakout: true,
  newsWatch: true
};

const activeAlerts: Map<string, DetectionAlert> = new Map();
const watchedSymbols: Map<string, { lastPrice: number; lastVolume: number; avgVolume: number }> = new Map();

const PRIORITY_WATCHLIST = [
  // Semiconductors & AI
  'ARM', 'NVDA', 'AMD', 'SMCI', 'AVGO', 'TSM', 'ASML', 'MU', 'QCOM', 'MRVL',
  'WDC', 'STX', 'INTC', 'AMAT', 'LRCX', 'KLAC', 'ON', 'WOLF', 'MPWR',
  // Nuclear & Energy
  'RKLB', 'OKLO', 'NNE', 'SMR', 'CCJ', 'LEU', 'UUUU', 'UEC', 'DNN', 'URG',
  // Quantum & AI Software
  'IONQ', 'RGTI', 'QUBT', 'PLTR', 'AI', 'SOUN', 'PATH', 'SNOW', 'DDOG', 'ARQQ',
  // Crypto & Fintech (APLD = AI/crypto data centers, often surges with miners)
  'COIN', 'MARA', 'RIOT', 'MSTR', 'CLSK', 'BITF', 'WULF', 'IREN', 'CIFR', 'APLD',
  'SOFI', 'HOOD', 'UPST', 'AFRM', 'SQ', 'PYPL', 'NET', 'CRWD', 'ZS',
  // Space & Defense - KEY MOVERS (RDW, ASTS, LUNR often surge)
  'RDW', 'ASTS', 'LUNR', 'RCAT', 'JOBY', 'ACHR', 'SPCE', 'BKSY', 'LMT', 'NOC',
  // Fintech & Payments - KEY MOVERS (ONDS, ZETA often surge)
  'ONDS', 'ZETA', 'BILL', 'TOST', 'FOUR', 'FLYW', 'PAYO', 'NU',
  // High Momentum / Meme - Often surge on news
  'CVNA', 'UBER', 'DASH', 'RIVN', 'LCID', 'NIO', 'GME', 'AMC', 'FUBO',
  // Biotech runners
  'MRNA', 'BNTX', 'NVAX', 'DNA', 'CRSP', 'EDIT', 'NTLA', 'BEAM',
  // China Tech ADRs - volatile
  'BABA', 'JD', 'PDD', 'LI', 'XPEV', 'BIDU', 'NIO',
  // Speculative plays - often surge
  'USAR', 'BNAI', 'NBIS', 'LAES', 'KULR', 'QS', 'SLDP'
];

async function checkPriceThresholds(): Promise<DetectionAlert[]> {
  const alerts: DetectionAlert[] = [];

  try {
    // STEP 1: MARKET-WIDE SCAN - This is the PRIMARY source now
    // Catches ANY stock surging in the market (APLD, LAZR, whatever is moving)
    const marketWideSurgers = await fetchMarketWideSurgers();
    const marketWideSymbols = new Set(marketWideSurgers.map(s => s.symbol));

    // Process market-wide surgers FIRST - these are the stocks actually moving
    for (const surger of marketWideSurgers) {
      const { symbol, change, price, volume } = surger;

      // Auto-alert for ANY stock surging 5%+ (no watchlist required!)
      if (change >= 5) {
        const severity = change >= 15 ? 'HIGH' : change >= 8 ? 'HIGH' : 'MEDIUM';
        const alert: DetectionAlert = {
          symbol,
          trigger: 'PRICE_BREAKOUT',
          severity,
          message: `🌐 ${symbol} MARKET-WIDE SURGE +${change.toFixed(1)}%`,
          price,
          change,
          detectedAt: new Date(),
          data: { volume, source: 'market_wide_scan' }
        };
        alerts.push(alert);
        activeAlerts.set(`${symbol}-PRICE`, alert);

        // Log significant surgers we're catching
        if (change >= 10) {
          logger.info(`[DETECTION-ENGINE] 🔥 CAUGHT SURGE: ${symbol} +${change.toFixed(1)}% (market-wide scan)`);
        }
      }
    }

    // STEP 2: Supplement with watchlist scan (smaller subset)
    const watchlistSubset = PRIORITY_WATCHLIST.filter(s => !marketWideSymbols.has(s)).slice(0, 30);

    const batchSize = 15;
    for (let i = 0; i < watchlistSubset.length; i += batchSize) {
      const batch = watchlistSubset.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          try {
            const quote = await safeQuote(symbol);
            if (!quote || !quote.regularMarketPrice) return null;

            const price = quote.regularMarketPrice;
            const change = quote.regularMarketChangePercent || 0;
            const volume = quote.regularMarketVolume || 0;
            const avgVolume = quote.averageDailyVolume10Day || quote.averageVolume || volume;
            const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;

            const prev = watchedSymbols.get(symbol);
            watchedSymbols.set(symbol, { lastPrice: price, lastVolume: volume, avgVolume });

            if (change >= DEFAULT_CRITERIA.priceChangeThreshold) {
              const alert: DetectionAlert = {
                symbol,
                trigger: 'PRICE_BREAKOUT',
                severity: change >= 8 ? 'HIGH' : change >= 5 ? 'MEDIUM' : 'LOW',
                message: `${symbol} breaking out +${change.toFixed(1)}%`,
                price,
                change,
                detectedAt: new Date(),
                data: { volumeRatio, dayHigh: quote.regularMarketDayHigh }
              };
              alerts.push(alert);
              activeAlerts.set(`${symbol}-PRICE`, alert);
            }

            if (volumeRatio >= DEFAULT_CRITERIA.volumeMultiplier) {
              const existingAlert = activeAlerts.get(`${symbol}-VOLUME`);
              const isNew = !existingAlert || (Date.now() - existingAlert.detectedAt.getTime()) > 30 * 60 * 1000;

              if (isNew) {
                const alert: DetectionAlert = {
                  symbol,
                  trigger: 'VOLUME_SPIKE',
                  severity: volumeRatio >= 4 ? 'HIGH' : volumeRatio >= 2.5 ? 'MEDIUM' : 'LOW',
                  message: `${symbol} unusual volume ${volumeRatio.toFixed(1)}x average`,
                  price,
                  change,
                  detectedAt: new Date(),
                  data: { volumeRatio, volume, avgVolume }
                };
                alerts.push(alert);
                activeAlerts.set(`${symbol}-VOLUME`, alert);
              }
            }

            const fiftyTwoWeekHigh = quote.fiftyTwoWeekHigh || price * 1.5;
            const nearHigh = (price / fiftyTwoWeekHigh) > 0.95;
            if (nearHigh && change > 1) {
              const alert: DetectionAlert = {
                symbol,
                trigger: 'TECHNICAL_SIGNAL',
                severity: 'MEDIUM',
                message: `${symbol} testing 52-week high at $${price.toFixed(2)}`,
                price,
                change,
                detectedAt: new Date(),
                data: { fiftyTwoWeekHigh, percentOfHigh: (price / fiftyTwoWeekHigh * 100).toFixed(1) }
              };
              alerts.push(alert);
              activeAlerts.set(`${symbol}-TECHNICAL`, alert);
            }

            return { symbol, price, change, volumeRatio };
          } catch (e) {
            return null;
          }
        })
      );

      await new Promise(r => setTimeout(r, 200));
    }

    // Log market-wide vs watchlist breakdown
    const marketWideAlerts = alerts.filter(a => a.data?.source === 'market_wide_scan').length;
    if (marketWideAlerts > 0) {
      logger.info(`[DETECTION-ENGINE] 📊 Alerts: ${marketWideAlerts} from MARKET-WIDE scan, ${alerts.length - marketWideAlerts} from watchlist`);
    }

  } catch (error) {
    logger.error('[DETECTION-ENGINE] Price threshold check failed:', error);
  }

  return alerts;
}

async function checkNewsCatalysts(): Promise<DetectionAlert[]> {
  const alerts: DetectionAlert[] = [];
  
  try {
    const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!alphaVantageKey) return alerts;
    
    const keywords = ['ARM', 'NVIDIA', 'AMD', 'SMCI', 'semiconductor', 'AI chip', 'quantum', 'nuclear'];
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=technology,earnings&apikey=${alphaVantageKey}`;
    
    const response = await fetch(url);
    if (!response.ok) return alerts;
    
    const data = await response.json();
    if (!data.feed) return alerts;
    
    const recentNews = data.feed.slice(0, 20);
    
    for (const article of recentNews) {
      const title = (article.title || '').toLowerCase();
      const summary = (article.summary || '').toLowerCase();
      
      for (const symbol of PRIORITY_WATCHLIST.slice(0, 20)) {
        if (title.includes(symbol.toLowerCase()) || summary.includes(symbol.toLowerCase())) {
          const existingKey = `${symbol}-NEWS-${article.title?.slice(0, 20)}`;
          if (!activeAlerts.has(existingKey)) {
            const sentiment = article.overall_sentiment_score || 0;
            const alert: DetectionAlert = {
              symbol,
              trigger: 'NEWS_CATALYST',
              severity: Math.abs(sentiment) > 0.3 ? 'HIGH' : 'MEDIUM',
              message: `News: ${article.title?.slice(0, 60)}...`,
              price: 0,
              change: 0,
              detectedAt: new Date(),
              data: { 
                title: article.title, 
                sentiment,
                source: article.source
              }
            };
            alerts.push(alert);
            activeAlerts.set(existingKey, alert);
          }
        }
      }
    }
    
  } catch (error) {
    logger.error('[DETECTION-ENGINE] News catalyst check failed:', error);
  }
  
  return alerts;
}

async function checkSectorMoves(): Promise<DetectionAlert[]> {
  const alerts: DetectionAlert[] = [];
  
  try {
    const sectorETFs = [
      { symbol: 'SMH', sector: 'Semiconductor', triggers: ['ARM', 'NVDA', 'AMD', 'AVGO', 'INTC', 'MU', 'QCOM'] },
      { symbol: 'ARKK', sector: 'Innovation', triggers: ['COIN', 'PLTR', 'PATH', 'ROKU', 'SQ'] },
      { symbol: 'URA', sector: 'Uranium/Nuclear', triggers: ['CCJ', 'LEU', 'UUUU', 'UEC', 'NNE', 'OKLO', 'SMR'] },
      { symbol: 'BITQ', sector: 'Crypto', triggers: ['COIN', 'MARA', 'RIOT', 'MSTR', 'CLSK'] }
    ];

    for (const etf of sectorETFs) {
      try {
        const quote = await safeQuote(etf.symbol);
        if (!quote || !quote.regularMarketChangePercent) continue;
        
        const change = quote.regularMarketChangePercent;
        
        if (Math.abs(change) >= 2) {
          const alert: DetectionAlert = {
            symbol: etf.symbol,
            trigger: 'SECTOR_MOVE',
            severity: Math.abs(change) >= 4 ? 'HIGH' : 'MEDIUM',
            message: `${etf.sector} sector ${change > 0 ? 'surging' : 'dropping'} ${change.toFixed(1)}% - watch ${etf.triggers.slice(0, 3).join(', ')}`,
            price: quote.regularMarketPrice || 0,
            change,
            detectedAt: new Date(),
            data: { relatedSymbols: etf.triggers }
          };
          alerts.push(alert);
        }
        
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
      }
    }
    
  } catch (error) {
    logger.error('[DETECTION-ENGINE] Sector move check failed:', error);
  }
  
  return alerts;
}

async function ingestSurgeAlerts(alerts: DetectionAlert[]): Promise<void> {
  const highPriorityAlerts = alerts.filter(a => a.severity === 'HIGH' || a.severity === 'MEDIUM');
  const uniqueSymbols = new Set<string>();
  
  for (const alert of highPriorityAlerts) {
    if (uniqueSymbols.has(alert.symbol)) continue;
    uniqueSymbols.add(alert.symbol);
    
    try {
      const signals = [];

      // Higher signal weights to ensure tradeable grades (B- or better = 80%+ confidence)
      if (alert.trigger === 'PRICE_BREAKOUT') {
        signals.push({ type: 'price_breakout', weight: 20, description: `+${alert.change.toFixed(1)}% breakout` });
      }
      if (alert.trigger === 'VOLUME_SPIKE') {
        signals.push({ type: 'volume_spike', weight: 18, description: 'Unusual volume detected' });
      }
      if (alert.trigger === 'NEWS_CATALYST') {
        signals.push({ type: 'news_catalyst', weight: 20, description: 'News catalyst detected' });
      }
      if (alert.trigger === 'TECHNICAL_SIGNAL') {
        signals.push({ type: 'technical_breakout', weight: 18, description: alert.message });
      }
      if (alert.trigger === 'SECTOR_MOVE') {
        signals.push({ type: 'sector_strength', weight: 15, description: 'Sector momentum' });
      }

      if (alert.change > 5) signals.push({ type: 'strong_momentum', weight: 15, description: `Strong momentum +${alert.change.toFixed(1)}%` });
      if (alert.severity === 'HIGH') signals.push({ type: 'high_conviction', weight: 18, description: 'High priority detection' });
      
      const input: IngestionInput = {
        source: 'surge_detection',
        symbol: alert.symbol,
        assetType: 'stock',
        direction: alert.change > 0 ? 'bullish' : 'bearish',
        signals,
        currentPrice: alert.price,
        holdingPeriod: 'day',
        catalyst: alert.message,
        analysis: `Surge detected: ${alert.trigger} - ${alert.message}`,
        sourceMetadata: {
          trigger: alert.trigger,
          severity: alert.severity,
          detectedAt: alert.detectedAt.toISOString()
        }
      };
      
      const result = await ingestTradeIdea(input);
      if (result.success) {
        logger.info(`[SURGE->TRADE-DESK] ✅ Ingested ${alert.symbol}: ${alert.trigger} (${alert.severity})`);
      }
    } catch (error) {
      logger.error(`[SURGE->TRADE-DESK] Failed to ingest ${alert.symbol}:`, error);
    }
  }
  
  if (highPriorityAlerts.length > 0) {
    logger.info(`[SURGE->TRADE-DESK] Processed ${uniqueSymbols.size} unique symbols from ${highPriorityAlerts.length} alerts`);
  }
}

export async function runDetectionCycle(): Promise<DetectionAlert[]> {
  logger.info('[DETECTION-ENGINE] Running detection cycle...');
  
  const oldAlerts = Array.from(activeAlerts.entries());
  for (const [key, alert] of oldAlerts) {
    if (Date.now() - alert.detectedAt.getTime() > 60 * 60 * 1000) {
      activeAlerts.delete(key);
    }
  }
  
  const [priceAlerts, newsAlerts, sectorAlerts] = await Promise.all([
    checkPriceThresholds(),
    checkNewsCatalysts(),
    checkSectorMoves()
  ]);
  
  const allAlerts = [...priceAlerts, ...newsAlerts, ...sectorAlerts];
  
  allAlerts.sort((a, b) => {
    const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
  
  if (allAlerts.length > 0) {
    logger.info(`[DETECTION-ENGINE] Found ${allAlerts.length} alerts: ${allAlerts.filter(a => a.severity === 'HIGH').length} HIGH, ${allAlerts.filter(a => a.severity === 'MEDIUM').length} MEDIUM`);
    
    await ingestSurgeAlerts(allAlerts);
  }
  
  return allAlerts;
}

export function getActiveAlerts(): DetectionAlert[] {
  return Array.from(activeAlerts.values())
    .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
}

export function clearAlert(symbol: string): void {
  const keys = Array.from(activeAlerts.keys());
  for (const key of keys) {
    if (key.startsWith(symbol)) {
      activeAlerts.delete(key);
    }
  }
}

let detectionInterval: NodeJS.Timeout | null = null;
let lastDetectionAlerts: DetectionAlert[] = [];

export function startDetectionEngine(intervalMs: number = 60000): void {
  if (detectionInterval) {
    clearInterval(detectionInterval);
  }
  
  logger.info(`[DETECTION-ENGINE] Starting with ${intervalMs / 1000}s interval`);
  
  runDetectionCycle().then(alerts => {
    lastDetectionAlerts = alerts;
  });
  
  detectionInterval = setInterval(async () => {
    const alerts = await runDetectionCycle();
    lastDetectionAlerts = alerts;
  }, intervalMs);
}

export function stopDetectionEngine(): void {
  if (detectionInterval) {
    clearInterval(detectionInterval);
    detectionInterval = null;
    logger.info('[DETECTION-ENGINE] Stopped');
  }
}

export function getLastDetectionAlerts(): DetectionAlert[] {
  return lastDetectionAlerts;
}

export { DetectionAlert, WatchCriteria, PRIORITY_WATCHLIST };

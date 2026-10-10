/**
 * Earnings Trade Scanner
 *
 * Identifies high-conviction earnings plays and generates trade ideas.
 * Unlike the earnings-service (which blocks trades), this service
 * CREATES trade ideas for stocks with upcoming earnings that have strong setups.
 *
 * Criteria for generating earnings trade ideas:
 * 1. Earnings within 1-7 days
 * 2. Strong momentum or technical setup
 * 3. High relative volume / unusual activity
 * 4. Historical earnings beat pattern
 * 5. Favorable IV rank (not too expensive)
 */

import { logger } from './logger';
import { getUpcomingEarnings } from './earnings-service';
import { getTradierQuote, getTradierHistory } from './tradier-api';
import { ingestTradeIdea, IngestionInput } from './trade-idea-ingestion';
import { safeQuote } from './yahoo-finance-service';

interface EarningsSetup {
  symbol: string;
  reportDate: string;
  estimate: string | null;
  direction: 'bullish' | 'bearish';
  confidence: number;
  signals: Array<{ type: string; weight: number; description: string }>;
  analysis: string;
  catalyst: string;
}

// Minimum criteria for generating an earnings trade idea
const MIN_CONFIDENCE_THRESHOLD = 55;
const MIN_SIGNALS_REQUIRED = 2;

// Well-known high-attention earnings (manually curated for Q1 2026)
const HIGH_ATTENTION_EARNINGS = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA',
  'AMD', 'INTC', 'CRM', 'ORCL', 'ADBE', 'NFLX', 'DIS', 'PYPL',
  'SQ', 'SHOP', 'COIN', 'PLTR', 'SNOW', 'NET', 'DDOG', 'MDB',
  'CRWD', 'ZS', 'OKTA', 'PANW', 'FTNT', 'UBER', 'LYFT', 'ABNB',
  'DASH', 'RBLX', 'U', 'TEAM', 'ASML', 'TSM', 'AVGO', 'QCOM',
  'MU', 'MRVL', 'AMAT', 'LRCX', 'KLAC', 'SNPS', 'CDNS',
  'V', 'MA', 'AXP', 'GS', 'JPM', 'BAC', 'C', 'WFC',
  'XOM', 'CVX', 'COP', 'SLB', 'HAL',
  'UNH', 'JNJ', 'PFE', 'MRNA', 'LLY', 'ABBV', 'BMY',
  'HD', 'LOW', 'TGT', 'WMT', 'COST', 'AMZN',
  'BA', 'CAT', 'DE', 'GE', 'HON', 'MMM', 'RTX', 'LMT',
  // AI/HPC infrastructure plays
  'IREN', 'MARA', 'RIOT', 'CLSK', 'BITF', 'HUT', 'CORZ',
  // Recent momentum names
  'SMCI', 'ARM', 'IONQ', 'RGTI', 'QUBT',
  // Storage/Memory (big earnings movers)
  'SNDK', 'WDC', 'STX', 'NTNX', 'PURE', 'NTAP',
  // EV/Auto (volatile earnings)
  'F', 'GM', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI',
  // Social/Streaming (big movers)
  'ROKU', 'SPOT', 'TTD', 'PINS', 'SNAP', 'MTCH',
]);

/**
 * Analyze a stock's setup quality for an earnings play
 */
async function analyzeEarningsSetup(
  symbol: string,
  reportDate: string,
  estimate: string | null
): Promise<EarningsSetup | null> {
  try {
    // Get current quote data
    const [tradierQuote, yahooQuote] = await Promise.all([
      getTradierQuote(symbol).catch(() => null),
      safeQuote(symbol),
    ]);

    const quote = tradierQuote || yahooQuote;
    if (!quote) {
      logger.debug(`[EARNINGS-SCANNER] Could not get quote for ${symbol}`);
      return null;
    }

    // Extract relevant data
    const price = tradierQuote?.last || yahooQuote?.regularMarketPrice || 0;
    const change = tradierQuote?.change_percentage || yahooQuote?.regularMarketChangePercent || 0;
    const volume = tradierQuote?.volume || yahooQuote?.regularMarketVolume || 0;
    const avgVolume = tradierQuote?.average_volume || yahooQuote?.averageDailyVolume10Day || volume;
    const relativeVolume = avgVolume > 0 ? volume / avgVolume : 1;

    // Skip penny stocks
    if (price < 5) {
      logger.debug(`[EARNINGS-SCANNER] Skipping ${symbol}: price too low ($${price})`);
      return null;
    }

    const signals: Array<{ type: string; weight: number; description: string }> = [];
    let baseConfidence = 45; // Start with earnings base

    // SIGNAL 1: High-attention stock bonus
    if (HIGH_ATTENTION_EARNINGS.has(symbol)) {
      signals.push({
        type: 'high_attention_earnings',
        weight: 12,
        description: 'High-profile earnings event with market attention',
      });
      baseConfidence += 10;
    }

    // SIGNAL 2: Momentum alignment
    const absChange = Math.abs(change);
    let direction: 'bullish' | 'bearish' = 'bullish';

    if (change > 2) {
      signals.push({
        type: 'strong_bullish_momentum',
        weight: 15,
        description: `Strong pre-earnings momentum (+${change.toFixed(1)}%)`,
      });
      direction = 'bullish';
    } else if (change > 0.5) {
      signals.push({
        type: 'bullish_momentum',
        weight: 10,
        description: `Bullish momentum (+${change.toFixed(1)}%)`,
      });
      direction = 'bullish';
    } else if (change < -2) {
      signals.push({
        type: 'strong_bearish_momentum',
        weight: 12,
        description: `Strong bearish momentum (${change.toFixed(1)}%)`,
      });
      direction = 'bearish';
    } else if (change < -0.5) {
      signals.push({
        type: 'bearish_momentum',
        weight: 8,
        description: `Bearish momentum (${change.toFixed(1)}%)`,
      });
      direction = 'bearish';
    }

    // SIGNAL 3: Volume surge
    if (relativeVolume > 2.0) {
      signals.push({
        type: 'volume_surge',
        weight: 15,
        description: `Unusual volume (${relativeVolume.toFixed(1)}x average)`,
      });
    } else if (relativeVolume > 1.5) {
      signals.push({
        type: 'elevated_volume',
        weight: 10,
        description: `Elevated volume (${relativeVolume.toFixed(1)}x average)`,
      });
    }

    // SIGNAL 4: EPS estimate available (more predictable)
    if (estimate && parseFloat(estimate) !== 0) {
      signals.push({
        type: 'analyst_coverage',
        weight: 8,
        description: `Analyst estimate: $${estimate} EPS`,
      });
    }

    // SIGNAL 5: Pre-earnings run-up detection (bullish bias)
    // If stock is up significantly in the last week, there's bullish sentiment
    try {
      const closingPrices = await getTradierHistory(symbol, 7); // Get 7 days of closes
      if (closingPrices && closingPrices.length >= 5) {
        const weekAgoPrice = closingPrices[0];
        const weekChange = ((price - weekAgoPrice) / weekAgoPrice) * 100;

        if (weekChange > 5) {
          signals.push({
            type: 'pre_earnings_runup',
            weight: 12,
            description: `Strong pre-earnings run-up (+${weekChange.toFixed(1)}% this week)`,
          });
          direction = 'bullish';
        } else if (weekChange < -5) {
          signals.push({
            type: 'pre_earnings_selloff',
            weight: 10,
            description: `Pre-earnings selloff (${weekChange.toFixed(1)}% this week)`,
          });
          // Could be a bounce play or continuation - default to neutral momentum
        }
      }
    } catch (err) {
      // Historical data unavailable, continue without it
    }

    // Calculate total signal weight
    const totalSignalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    const confidence = Math.min(92, baseConfidence + totalSignalWeight * 0.8);

    // Check minimum criteria
    if (signals.length < MIN_SIGNALS_REQUIRED) {
      logger.debug(`[EARNINGS-SCANNER] ${symbol}: Insufficient signals (${signals.length})`);
      return null;
    }

    if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      logger.debug(`[EARNINGS-SCANNER] ${symbol}: Confidence too low (${confidence.toFixed(0)}%)`);
      return null;
    }

    // Build analysis text
    const analysis = buildEarningsAnalysis(symbol, reportDate, direction, signals, estimate);
    const catalyst = `Earnings report on ${reportDate}${estimate ? ` (Est: $${estimate} EPS)` : ''}`;

    return {
      symbol,
      reportDate,
      estimate,
      direction,
      confidence: Math.round(confidence),
      signals,
      analysis,
      catalyst,
    };
  } catch (error) {
    logger.error(`[EARNINGS-SCANNER] Error analyzing ${symbol}:`, error);
    return null;
  }
}

/**
 * Build analysis text for an earnings trade idea
 */
function buildEarningsAnalysis(
  symbol: string,
  reportDate: string,
  direction: 'bullish' | 'bearish',
  signals: Array<{ type: string; description: string }>,
  estimate: string | null
): string {
  const signalSummary = signals.map(s => s.description).join('. ');

  const directionText = direction === 'bullish'
    ? 'bullish positioning ahead of earnings'
    : 'bearish positioning ahead of earnings';

  return `${symbol} earnings trade opportunity: ${directionText}. ` +
    `Report date: ${reportDate}. ` +
    (estimate ? `Analyst consensus EPS: $${estimate}. ` : '') +
    `Setup signals: ${signalSummary}. ` +
    `This is a high-volatility earnings play - size accordingly.`;
}

/**
 * Scan for earnings trade opportunities
 * Returns the number of trade ideas generated
 */
export async function scanEarningsOpportunities(): Promise<number> {
  logger.info('[EARNINGS-SCANNER] Starting earnings opportunity scan...');

  try {
    // Get earnings in the next 7 days
    const upcomingEarnings = await getUpcomingEarnings(7);

    if (upcomingEarnings.length === 0) {
      logger.info('[EARNINGS-SCANNER] No upcoming earnings found');
      return 0;
    }

    logger.info(`[EARNINGS-SCANNER] Found ${upcomingEarnings.length} stocks with earnings in next 7 days`);

    // Prioritize high-attention earnings
    const sortedEarnings = [...upcomingEarnings].sort((a, b) => {
      const aHighAttention = HIGH_ATTENTION_EARNINGS.has(a.symbol) ? 1 : 0;
      const bHighAttention = HIGH_ATTENTION_EARNINGS.has(b.symbol) ? 1 : 0;
      return bHighAttention - aHighAttention;
    });

    // Limit to top 30 to avoid rate limits
    const earningsToScan = sortedEarnings.slice(0, 30);

    let ideasGenerated = 0;
    const processedSymbols = new Set<string>();

    for (const earnings of earningsToScan) {
      // Skip if already processed
      if (processedSymbols.has(earnings.symbol)) continue;
      processedSymbols.add(earnings.symbol);

      try {
        const setup = await analyzeEarningsSetup(
          earnings.symbol,
          earnings.reportDate,
          earnings.estimate
        );

        if (!setup) continue;

        // Create trade idea input
        const input: IngestionInput = {
          source: 'earnings_play',
          symbol: setup.symbol,
          assetType: 'stock', // Could also generate option ideas
          direction: setup.direction,
          signals: setup.signals,
          holdingPeriod: 'day', // Earnings plays are short-term
          catalyst: setup.catalyst,
          analysis: setup.analysis,
          sourceMetadata: {
            reportDate: setup.reportDate,
            estimate: setup.estimate,
            scanTimestamp: new Date().toISOString(),
          },
        };

        const result = await ingestTradeIdea(input);

        if (result.success) {
          ideasGenerated++;
          logger.info(`[EARNINGS-SCANNER] ✅ Generated ${setup.direction.toUpperCase()} idea for ${setup.symbol} (${setup.confidence}% confidence)`);
        } else {
          logger.debug(`[EARNINGS-SCANNER] Skipped ${setup.symbol}: ${result.reason}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        logger.error(`[EARNINGS-SCANNER] Error processing ${earnings.symbol}:`, err);
      }
    }

    logger.info(`[EARNINGS-SCANNER] Scan complete: ${ideasGenerated} ideas generated from ${processedSymbols.size} stocks scanned`);
    return ideasGenerated;
  } catch (error) {
    logger.error('[EARNINGS-SCANNER] Scan failed:', error);
    return 0;
  }
}

/**
 * Get upcoming high-attention earnings for display
 */
export async function getHighAttentionEarnings(limit: number = 10): Promise<Array<{
  symbol: string;
  reportDate: string;
  estimate: string | null;
  isHighAttention: boolean;
}>> {
  const upcoming = await getUpcomingEarnings(14); // Next 2 weeks

  return upcoming
    .map(e => ({
      symbol: e.symbol,
      reportDate: e.reportDate,
      estimate: e.estimate,
      isHighAttention: HIGH_ATTENTION_EARNINGS.has(e.symbol),
    }))
    .sort((a, b) => {
      // High attention first, then by date
      if (a.isHighAttention !== b.isHighAttention) {
        return a.isHighAttention ? -1 : 1;
      }
      return new Date(a.reportDate).getTime() - new Date(b.reportDate).getTime();
    })
    .slice(0, limit);
}

/**
 * Check if a specific symbol has an upcoming earnings catalyst
 */
export async function hasEarningsCatalyst(symbol: string): Promise<{
  hasEarnings: boolean;
  reportDate: string | null;
  estimate: string | null;
  daysUntil: number | null;
}> {
  const upcoming = await getUpcomingEarnings(7);
  const match = upcoming.find(e => e.symbol.toUpperCase() === symbol.toUpperCase());

  if (!match) {
    return { hasEarnings: false, reportDate: null, estimate: null, daysUntil: null };
  }

  const reportDate = new Date(match.reportDate);
  const now = new Date();
  const daysUntil = Math.ceil((reportDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return {
    hasEarnings: true,
    reportDate: match.reportDate,
    estimate: match.estimate,
    daysUntil,
  };
}

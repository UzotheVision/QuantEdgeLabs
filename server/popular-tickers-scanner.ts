/**
 * Popular Tickers Scanner
 *
 * Dedicated scanner for the most-traded stocks (TSLA, AMD, NVDA, AAPL, META, etc.)
 * Unlike other scanners that wait for surges or unusual activity, this scanner
 * PROACTIVELY monitors popular tickers for coverage changes.
 *
 * This is intentionally a coverage scanner, not an idea publisher. A moving
 * quote or a liquid name tells Oracle where to look; it does not establish an
 * entry, invalidation, or structural target. Dedicated structure, flow, GEX,
 * and catalyst scanners can publish only after their own gates are satisfied.
 *
 * Runs every 2 hours during market hours to ensure coverage of major tickers.
 */

import { logger } from './logger';
import { ingestTradeIdea, IngestionInput } from './trade-idea-ingestion';
import { getTradierQuote, getTradierHistory, getTradierHistoryOHLC, getTradierOptionsChainsByDTE } from './tradier-api';
import { safeQuote } from './yahoo-finance-service';
import { isApprovedTicker, isSkipTicker } from '../shared/approved-tickers';
import { calculateATRTargets, calculateSimpleTargets } from './atr-targets';
import { getScannerUniverse } from './scanner-universe';
// Lotto detection handled inline

// The most-traded stocks that users EXPECT to see trade ideas for
export const POPULAR_TICKERS = [
  // Mega Cap Tech (Always liquid, always moving)
  'TSLA', 'NVDA', 'AMD', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META',
  // Popular Tech/Growth
  'NFLX', 'PLTR', 'COIN', 'SQ', 'PYPL', 'UBER', 'SHOP',
  // Semiconductors (AI hype)
  'AVGO', 'MU', 'INTC', 'QCOM', 'ARM', 'SMCI', 'MRVL',
  // Storage/Memory (earnings movers like SNDK)
  'SNDK', 'WDC', 'STX', 'NTNX',
  // Financials
  'JPM', 'GS', 'BAC', 'V', 'MA',
  // Energy
  'XOM', 'CVX', 'COP',
  // Healthcare
  'JNJ', 'UNH', 'LLY', 'PFE',
  // Consumer
  'DIS', 'NKE', 'SBUX', 'MCD', 'WMT', 'COST',
  // Popular Retail Favorites
  'GME', 'AMC', 'RIVN', 'LCID', 'NIO',
  // AI/Software
  'CRM', 'NOW', 'SNOW', 'CRWD', 'NET',
  // Crypto-related
  'MARA', 'RIOT', 'MSTR', 'CLSK',
  // Commodities/Metals ETFs (for put/call plays)
  'SLV', 'GLD', 'USO', 'GDX', 'GDXJ', 'SIL', 'XLE', 'XLF',
  // Major ETFs (high options volume)
  'SPY', 'QQQ', 'IWM', 'DIA', 'TLT', 'XLK', 'SMH',
  // Social/Streaming
  'ROKU', 'SPOT', 'TTD', 'PINS', 'SNAP',
];

// Minimum requirements for generating a trade idea
const MIN_SIGNALS_REQUIRED = 2;
const MIN_CONFIDENCE_THRESHOLD = 55;

interface TickerAnalysis {
  symbol: string;
  direction: 'bullish' | 'bearish';
  confidence: number;
  signals: Array<{ type: string; weight: number; description: string }>;
  analysis: string;
  catalyst: string;
  currentPrice: number;
  suggestedTarget: number;
  suggestedStop: number;
  weeklyTrend: number; // % change over the week
}

export interface PopularCoverageRead {
  symbol: string;
  bias: 'bullish' | 'bearish';
  observedAt: string;
  price: number;
  weeklyTrend: number;
  observations: Array<{ type: string; description: string }>;
  summary: string;
  nextStep: string;
}

const latestCoverage = new Map<string, PopularCoverageRead>();

/** Latest broad-market reads for the coverage lane. Never trade instructions. */
export function getPopularTickerCoverage(symbols?: string[]): PopularCoverageRead[] {
  const requested = symbols?.map(symbol => symbol.toUpperCase());
  return Array.from(latestCoverage.values())
    .filter(read => !requested || requested.includes(read.symbol))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}

interface OptionSetup {
  symbol: string;
  direction: 'bullish' | 'bearish';
  optionType: 'call' | 'put';
  strikePrice: number;
  expiryDate: string;
  entryPrice: number; // Option premium
  targetPrice: number;
  stopLoss: number;
  dte: number;
  isLotto: boolean;
  analysis: string;
  catalyst: string;
  confidence: number;
}

/**
 * Analyze a popular ticker for trade opportunities
 */
async function analyzePopularTicker(symbol: string): Promise<TickerAnalysis | null> {
  try {
    // Get current quote data from both sources
    const [tradierQuote, yahooQuote] = await Promise.all([
      getTradierQuote(symbol).catch(() => null),
      safeQuote(symbol),
    ]);

    const quote = tradierQuote || yahooQuote;
    if (!quote) {
      logger.debug(`[POPULAR-SCANNER] Could not get quote for ${symbol}`);
      return null;
    }

    // Extract data
    const price = tradierQuote?.last || yahooQuote?.regularMarketPrice || 0;
    const change = tradierQuote?.change_percentage || yahooQuote?.regularMarketChangePercent || 0;
    const volume = tradierQuote?.volume || yahooQuote?.regularMarketVolume || 0;
    const avgVolume = tradierQuote?.average_volume || yahooQuote?.averageDailyVolume10Day || volume;
    const relativeVolume = avgVolume > 0 ? volume / avgVolume : 1;
    const high = tradierQuote?.high || yahooQuote?.regularMarketDayHigh || price;
    const low = tradierQuote?.low || yahooQuote?.regularMarketDayLow || price;
    const open = tradierQuote?.open || yahooQuote?.regularMarketOpen || price;
    const prevClose = tradierQuote?.prevclose || yahooQuote?.regularMarketPreviousClose || price;

    // Skip if price is too low
    if (price < 5) {
      logger.debug(`[POPULAR-SCANNER] Skipping ${symbol}: price too low ($${price})`);
      return null;
    }

    const signals: Array<{ type: string; weight: number; description: string }> = [];
    let baseConfidence = 45;
    let direction: 'bullish' | 'bearish' = 'bullish';

    // SIGNAL 1: Intraday momentum
    if (change > 3) {
      signals.push({
        type: 'strong_momentum',
        weight: 15,
        description: `Strong intraday momentum (+${change.toFixed(1)}%)`,
      });
      direction = 'bullish';
      baseConfidence += 8;
    } else if (change > 1.5) {
      signals.push({
        type: 'momentum',
        weight: 10,
        description: `Bullish momentum (+${change.toFixed(1)}%)`,
      });
      direction = 'bullish';
      baseConfidence += 5;
    } else if (change < -3) {
      signals.push({
        type: 'strong_selloff',
        weight: 12,
        description: `Strong selloff (${change.toFixed(1)}%) - potential bounce`,
      });
      direction = 'bullish'; // Oversold bounce
      baseConfidence += 5;
    } else if (change < -1.5) {
      signals.push({
        type: 'bearish_momentum',
        weight: 10,
        description: `Bearish momentum (${change.toFixed(1)}%)`,
      });
      direction = 'bearish';
      baseConfidence += 3;
    }

    // SIGNAL 2: Volume confirmation
    if (relativeVolume > 2.0) {
      signals.push({
        type: 'volume_surge',
        weight: 15,
        description: `Heavy volume (${relativeVolume.toFixed(1)}x average)`,
      });
      baseConfidence += 8;
    } else if (relativeVolume > 1.3) {
      signals.push({
        type: 'elevated_volume',
        weight: 10,
        description: `Above-average volume (${relativeVolume.toFixed(1)}x)`,
      });
      baseConfidence += 5;
    }

    // SIGNAL 3: Intraday range position
    const dayRange = high - low;
    if (dayRange > 0) {
      const rangePosition = (price - low) / dayRange;

      if (rangePosition > 0.85 && change > 0) {
        signals.push({
          type: 'near_highs',
          weight: 12,
          description: `Trading near day highs (${(rangePosition * 100).toFixed(0)}% of range)`,
        });
        direction = 'bullish';
        baseConfidence += 5;
      } else if (rangePosition < 0.15 && change < 0) {
        signals.push({
          type: 'near_lows',
          weight: 10,
          description: `Trading near day lows - oversold bounce potential`,
        });
        direction = 'bullish';
        baseConfidence += 3;
      }
    }

    // SIGNAL 4: Gap analysis
    const gapPercent = ((open - prevClose) / prevClose) * 100;
    if (gapPercent > 2) {
      signals.push({
        type: 'gap_up',
        weight: 12,
        description: `Gapped up ${gapPercent.toFixed(1)}% at open`,
      });
      direction = 'bullish';
      baseConfidence += 5;
    } else if (gapPercent < -2) {
      signals.push({
        type: 'gap_down',
        weight: 10,
        description: `Gapped down ${Math.abs(gapPercent).toFixed(1)}% - gap fill potential`,
      });
      direction = 'bullish';
      baseConfidence += 3;
    }

    // SIGNAL 5: Week trend analysis
    let weekChange = 0;
    try {
      const closingPrices = await getTradierHistory(symbol, 7);
      if (closingPrices && closingPrices.length >= 5) {
        const weekAgoPrice = closingPrices[0];
        weekChange = ((price - weekAgoPrice) / weekAgoPrice) * 100;

        if (weekChange > 5) {
          signals.push({
            type: 'weekly_uptrend',
            weight: 12,
            description: `Strong weekly trend (+${weekChange.toFixed(1)}% this week)`,
          });
          direction = 'bullish';
          baseConfidence += 5;
        } else if (weekChange < -5) {
          signals.push({
            type: 'weekly_downtrend',
            weight: 10,
            description: `Weekly downtrend (${weekChange.toFixed(1)}%) - mean reversion potential`,
          });
          direction = 'bullish';
          baseConfidence += 3;
        }
      }
    } catch {
      // Historical data unavailable
    }

    // SIGNAL 6: Popular ticker bonus
    signals.push({
      type: 'popular_ticker',
      weight: 8,
      description: `High-profile stock with strong liquidity`,
    });

    // Calculate final confidence
    const totalSignalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    const confidence = Math.min(92, baseConfidence + totalSignalWeight * 0.6);

    // Check minimum criteria
    if (signals.length < MIN_SIGNALS_REQUIRED) {
      logger.debug(`[POPULAR-SCANNER] ${symbol}: Insufficient signals (${signals.length})`);
      return null;
    }

    if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      logger.debug(`[POPULAR-SCANNER] ${symbol}: Confidence too low (${confidence.toFixed(0)}%)`);
      return null;
    }

    // 📐 ATR-BASED TARGET/STOP — replaces fixed % heuristic
    // Pulls 20-day OHLC from Tradier and computes ATR-multiplied targets.
    // Falls back to volatility-aware close-only estimator if OHLC unavailable.
    let suggestedTarget: number;
    let suggestedStop: number;
    try {
      const ohlc = await getTradierHistoryOHLC(symbol, 20).catch(() => null);
      if (ohlc && ohlc.closes.length >= 14) {
        const targets = calculateATRTargets({
          currentPrice: price,
          highs: ohlc.highs,
          lows: ohlc.lows,
          closes: ohlc.closes,
          direction,
          holdingPeriod: 'swing',
        });
        suggestedTarget = targets.target;
        suggestedStop = targets.stop;
        logger.debug(`[POPULAR-SCANNER] ${symbol} ATR targets: T=$${suggestedTarget} S=$${suggestedStop} (ATR=${targets.atr}, R:R=${targets.riskRewardRatio})`);
      } else {
        // Fallback: volatility-aware estimator from intraday range
        const fallback = calculateSimpleTargets({
          currentPrice: price,
          closes: [prevClose, low, high, price].filter(Boolean),
          direction,
          holdingPeriod: 'swing',
        });
        suggestedTarget = fallback.target;
        suggestedStop = fallback.stop;
      }
    } catch (e) {
      // Hard fallback — use intraday range
      const avgDailyMove = dayRange / price * 100;
      const targetMove = Math.max(2, avgDailyMove * 1.2);
      const stopMove = Math.max(1, avgDailyMove * 0.6);
      if (direction === 'bullish') {
        suggestedTarget = price * (1 + targetMove / 100);
        suggestedStop = price * (1 - stopMove / 100);
      } else {
        suggestedTarget = price * (1 - targetMove / 100);
        suggestedStop = price * (1 + stopMove / 100);
      }
    }

    const signalSummary = signals.map(s => s.description).join('. ');
    const analysis = `${symbol} popular ticker setup: ${direction} bias. ` +
      `Current price: $${price.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(1)}% today). ` +
      `Signals: ${signalSummary}. ` +
      `Popular stock with strong liquidity.`;

    const catalyst = signals.find(s => s.type.includes('momentum') || s.type.includes('volume'))?.description ||
      'Technical setup on popular ticker';

    return {
      symbol,
      direction,
      confidence: Math.round(confidence),
      signals,
      analysis,
      catalyst,
      currentPrice: price,
      suggestedTarget,
      suggestedStop,
      weeklyTrend: weekChange,
    };
  } catch (error) {
    logger.error(`[POPULAR-SCANNER] Error analyzing ${symbol}:`, error);
    return null;
  }
}

/**
 * Find option plays for a ticker with good signals
 * Returns multiple options across different timeframes: weekly, swing (2 weeks), lotto
 */
async function findOptionPlays(analysis: TickerAnalysis): Promise<OptionSetup[]> {
  const options: OptionSetup[] = [];

  try {
    // Fetch options chain with multiple expirations
    const optionsChain = await getTradierOptionsChainsByDTE(analysis.symbol);
    if (!optionsChain || optionsChain.length === 0) {
      logger.debug(`[POPULAR-SCANNER] No options chain for ${analysis.symbol}`);
      return options;
    }

    const optionType: 'call' | 'put' = analysis.direction === 'bullish' ? 'call' : 'put';
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Group options by expiration date
    const expirationMap = new Map<string, typeof optionsChain>();
    for (const opt of optionsChain) {
      if (!opt.expiration_date) continue;
      if (!expirationMap.has(opt.expiration_date)) {
        expirationMap.set(opt.expiration_date, []);
      }
      expirationMap.get(opt.expiration_date)!.push(opt);
    }

    // Sort expirations by date
    const sortedExpirations = Array.from(expirationMap.keys())
      .filter(exp => exp > today) // Only future expirations
      .sort();

    if (sortedExpirations.length === 0) {
      return options;
    }

    // Find options for different timeframes
    const timeframes = [
      { label: 'weekly', minDTE: 3, maxDTE: 10, deltaTarget: 0.35 },
      { label: 'swing', minDTE: 10, maxDTE: 21, deltaTarget: 0.30 },
      { label: 'monthly', minDTE: 21, maxDTE: 45, deltaTarget: 0.25 },
    ];

    for (const tf of timeframes) {
      // Find expiration that fits this timeframe
      const expiration = sortedExpirations.find(exp => {
        const dte = Math.ceil((new Date(exp).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return dte >= tf.minDTE && dte <= tf.maxDTE;
      });

      if (!expiration) continue;

      const dte = Math.ceil((new Date(expiration).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const expirationOptions = expirationMap.get(expiration) || [];

      // Filter for our option type with valid pricing
      const validOptions = expirationOptions.filter(opt => {
        if (opt.option_type !== optionType) return false;
        const hasBidAsk = opt.bid && opt.bid > 0 && opt.ask && opt.ask > 0;
        if (!hasBidAsk) return false;
        const delta = Math.abs(opt.greeks?.delta || 0);
        return delta >= 0.15 && delta <= 0.50;
      });

      if (validOptions.length === 0) continue;

      // Sort by how close delta is to target
      validOptions.sort((a, b) => {
        const deltaA = Math.abs(Math.abs(a.greeks?.delta || 0) - tf.deltaTarget);
        const deltaB = Math.abs(Math.abs(b.greeks?.delta || 0) - tf.deltaTarget);
        return deltaA - deltaB;
      });

      const bestOption = validOptions[0];
      const entryPrice = (bestOption.bid + bestOption.ask) / 2;
      const delta = Math.abs(bestOption.greeks?.delta || 0);

      // Calculate option targets based on expected stock move and delta
      const stockMovePercent = analysis.direction === 'bullish'
        ? (analysis.suggestedTarget - analysis.currentPrice) / analysis.currentPrice
        : (analysis.currentPrice - analysis.suggestedTarget) / analysis.currentPrice;

      // Options move ~delta * stock move (simplified) + time decay consideration
      const optionMovePercent = delta * stockMovePercent * 100 * 2; // Leverage factor
      const targetPrice = entryPrice * (1 + Math.max(0.30, optionMovePercent / 100)); // Min 30% target
      const stopLoss = entryPrice * 0.50; // 50% stop on options

      options.push({
        symbol: analysis.symbol,
        direction: analysis.direction,
        optionType,
        strikePrice: bestOption.strike,
        expiryDate: expiration,
        entryPrice: Math.round(entryPrice * 100) / 100,
        targetPrice: Math.round(targetPrice * 100) / 100,
        stopLoss: Math.round(stopLoss * 100) / 100,
        dte,
        isLotto: false,
        analysis: `${tf.label.toUpperCase()} ${optionType.toUpperCase()} - ${analysis.symbol} $${bestOption.strike} exp ${expiration}. Delta: ${delta.toFixed(2)}. ${analysis.catalyst}`,
        catalyst: `${tf.label} option play: ${analysis.catalyst}`,
        confidence: analysis.confidence - 5, // Slightly lower confidence for options
      });
    }

    // LOTTO PLAY: Find cheap OTM options (< $1.00)
    for (const exp of sortedExpirations.slice(0, 3)) { // Check first 3 expirations
      const expirationOptions = expirationMap.get(exp) || [];
      const dte = Math.ceil((new Date(exp).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Skip if too far out for lotto
      if (dte > 14) continue;

      const lottoOptions = expirationOptions.filter(opt => {
        if (opt.option_type !== optionType) return false;
        const hasBidAsk = opt.bid && opt.bid > 0 && opt.ask && opt.ask > 0;
        if (!hasBidAsk) return false;
        const midPrice = (opt.bid + opt.ask) / 2;
        const delta = Math.abs(opt.greeks?.delta || 0);
        // Lotto: cheap premium, low delta (far OTM)
        return midPrice <= 1.00 && midPrice >= 0.05 && delta >= 0.05 && delta <= 0.25;
      });

      if (lottoOptions.length === 0) continue;

      // Pick the option with best volume/OI
      lottoOptions.sort((a, b) => ((b.volume || 0) + (b.open_interest || 0)) - ((a.volume || 0) + (a.open_interest || 0)));

      const lottoOption = lottoOptions[0];
      const entryPrice = (lottoOption.bid + lottoOption.ask) / 2;

      // Lotto targets: 100-300% gains
      options.push({
        symbol: analysis.symbol,
        direction: analysis.direction,
        optionType,
        strikePrice: lottoOption.strike,
        expiryDate: exp,
        entryPrice: Math.round(entryPrice * 100) / 100,
        targetPrice: Math.round(entryPrice * 3 * 100) / 100, // 3x target (200% gain)
        stopLoss: 0, // Lottos: risk full premium
        dte,
        isLotto: true,
        analysis: `LOTTO ${optionType.toUpperCase()} - ${analysis.symbol} $${lottoOption.strike} exp ${exp}. Cheap OTM play ($${entryPrice.toFixed(2)} premium). High risk/reward.`,
        catalyst: `Lotto play: ${analysis.catalyst}`,
        confidence: 50, // Lower confidence for lottos
      });

      break; // Only one lotto per ticker
    }

    return options;
  } catch (error) {
    logger.error(`[POPULAR-SCANNER] Error finding options for ${analysis.symbol}:`, error);
    return options;
  }
}

/**
 * Scan popular tickers for coverage. This does not create active signals.
 */
export async function scanPopularTickers(): Promise<number> {
  // Merge user watchlist (priority) + static popular tickers
  const { symbols: universeSymbols, watchlistSymbols } = await getScannerUniverse();
  // Combine: universe first (includes watchlist at the front), then any popular tickers not already covered
  const extraPopular = POPULAR_TICKERS.filter(s => !universeSymbols.includes(s));
  const allSymbols = [...universeSymbols, ...extraPopular];
  logger.info(`[POPULAR-SCANNER] Starting scan of ${allSymbols.length} tickers (${watchlistSymbols.size} from watchlist)...`);

  let coverageReads = 0;
  const processedSymbols = new Set<string>();

  for (const symbol of allSymbols) {
    if (processedSymbols.has(symbol)) continue;
    processedSymbols.add(symbol);

    // Skip list: proven money losers — but NEVER skip user watchlist symbols
    if (isSkipTicker(symbol) && !watchlistSymbols.has(symbol)) {
      logger.debug(`[POPULAR-SCANNER] ${symbol}: on skip list`);
      continue;
    }

    try {
      const analysis = await analyzePopularTicker(symbol);

      if (!analysis) continue;

      latestCoverage.set(analysis.symbol, {
        symbol: analysis.symbol,
        bias: analysis.direction,
        observedAt: new Date().toISOString(),
        price: analysis.currentPrice,
        weeklyTrend: analysis.weeklyTrend,
        observations: analysis.signals.map(({ type, description }) => ({ type, description })),
        summary: analysis.analysis,
        nextStep: 'Coverage only — wait for a structure, flow, GEX, or catalyst scanner to define trigger, invalidation, and structural target.',
      });
      coverageReads++;
      logger.debug(`[POPULAR-SCANNER] ◌ COVERAGE ${analysis.symbol} ${analysis.direction.toUpperCase()} — not published as a trade`);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      logger.error(`[POPULAR-SCANNER] Error processing ${symbol}:`, err);
    }
  }

  logger.info(`[POPULAR-SCANNER] Scan complete: ${coverageReads} coverage reads from ${processedSymbols.size} tickers; 0 trade ideas published`);
  return coverageReads;
}

/**
 * Start the popular tickers scanner on a schedule
 * Runs every 2 hours during market hours
 */
export function startPopularTickersScanner(): void {
  logger.info('[POPULAR-SCANNER] Starting Popular Tickers Scanner service...');

  // Run immediately on startup
  scanPopularTickers().catch(err =>
    logger.error('[POPULAR-SCANNER] Initial scan failed:', err)
  );

  // Schedule every 2 hours
  setInterval(async () => {
    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const dayOfWeek = nowET.getDay();

    // Only scan during extended market hours (8 AM - 5 PM ET, weekdays)
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isMarketHours = hour >= 8 && hour < 17;

    if (isWeekday && isMarketHours) {
      logger.info('[POPULAR-SCANNER] Starting scheduled scan...');
      await scanPopularTickers().catch(err =>
        logger.error('[POPULAR-SCANNER] Scheduled scan failed:', err)
      );
    }
  }, 2 * 60 * 60 * 1000); // Every 2 hours

  logger.info('[POPULAR-SCANNER] Popular Tickers Scanner started - runs every 2 hours during market hours');
}

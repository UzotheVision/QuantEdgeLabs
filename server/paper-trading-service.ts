import { storage } from "./storage";
import { searchSymbol, fetchCryptoPrice, fetchStockPrice } from "./market-api";
import { getOptionQuote, getTradierHistoryOHLC } from "./tradier-api";
import { logger } from "./logger";
import { isUSMarketOpen, normalizeDateString } from "@shared/market-calendar";
import { analyzeTrade, recordWin } from "./loss-analyzer-service";
import { calculateRSI } from "./technical-indicators";
import type {
  TradeIdea,
  PaperPortfolio,
  PaperPosition,
  InsertPaperPosition,
  InsertPaperEquitySnapshot,
  AssetType,
} from "@shared/schema";

// Re-export for backward compatibility
export function isOptionsMarketOpen(): { isOpen: boolean; reason: string } {
  const status = isUSMarketOpen();
  return { isOpen: status.isOpen, reason: status.reason };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ EXIT CALLBACK HOOK - Notifies external systems (like auto-lotto) of ALL exits
// This ensures cooldowns are recorded for EVERY exit, not just manual ones
// ═══════════════════════════════════════════════════════════════════════════
type ExitCallbackFn = (symbol: string, optionType?: string, strike?: number, wasWin?: boolean) => void;
let onExitCallback: ExitCallbackFn | null = null;

/**
 * Register a callback to be invoked on EVERY position close
 * Used by auto-lotto-trader to record exit cooldowns
 */
export function registerExitCallback(callback: ExitCallbackFn): void {
  onExitCallback = callback;
  logger.info('🛡️ [EXIT-HOOK] Exit callback registered - all closes will now trigger cooldowns');
}

export interface ExecuteTradeResult {
  success: boolean;
  position?: PaperPosition;
  error?: string;
}

export interface ClosePositionResult {
  success: boolean;
  position?: PaperPosition;
  error?: string;
}

export interface PortfolioValue {
  cashBalance: number;
  positionsValue: number;
  totalValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

// 🎯 SMART POSITION SIZING LIMITS
// These limits ensure trades never exceed available capital
const MAX_PERCENT_PER_TRADE = 0.25; // 25% of CURRENT cash per trade
const MAX_PERCENT_PER_SYMBOL = 0.30; // 30% max exposure per symbol
const MAX_DOLLAR_PER_TRADE = 250; // Hard cap $250 per trade (allows single contracts of mid-priced options)
const MAX_CONTRACTS_PER_TRADE = 3; // Max 3 contracts per trade
const ONE_POSITION_PER_SYMBOL = true; // Only allow ONE open position per underlying symbol

// 📊 DTE-AWARE EXIT STRATEGY - Smarter stops for options with time value
// Longer-dated options get wider stops because they have more time to recover
interface DTEExitConfig {
  hardStopPercent: number;    // Absolute max loss before forced exit
  softStopPercent: number;    // Warn but allow hold if thesis valid
  requireThesisCheck: boolean; // Re-validate signals before exit
  allowMarketOverride: boolean; // Skip exit if market-wide pullback
}

function getDTEExitConfig(daysToExpiry: number): DTEExitConfig {
  // Very short-dated (0-3 DTE): Tight stops, no mercy - theta decay is brutal
  if (daysToExpiry <= 3) {
    return { hardStopPercent: 35, softStopPercent: 25, requireThesisCheck: false, allowMarketOverride: false };
  }
  // Short-dated (4-7 DTE): Moderate stops, quick decisions needed
  if (daysToExpiry <= 7) {
    return { hardStopPercent: 45, softStopPercent: 30, requireThesisCheck: false, allowMarketOverride: true };
  }
  // Medium-dated (8-14 DTE): Wider stops, can hold through volatility
  if (daysToExpiry <= 14) {
    return { hardStopPercent: 55, softStopPercent: 35, requireThesisCheck: true, allowMarketOverride: true };
  }
  // Longer-dated (15-30 DTE): Wide stops, swing trade mentality
  if (daysToExpiry <= 30) {
    return { hardStopPercent: 65, softStopPercent: 40, requireThesisCheck: true, allowMarketOverride: true };
  }
  // LEAPS (30+ DTE): Very wide stops, hold through volatility
  return { hardStopPercent: 75, softStopPercent: 50, requireThesisCheck: true, allowMarketOverride: true };
}

function calculateDTE(expiryDate: string | Date | null): number {
  if (!expiryDate) return 7; // Default to 7 DTE if no expiry
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

// Cache for SPY market context
let cachedMarketContext: { spyDown: boolean; spyChange: number } = { spyDown: false, spyChange: 0 };
let lastSpyFetchTime: number = 0;

// Cache for thesis checks (avoid hammering API on every check)
const thesisCheckCache: Map<string, { valid: boolean; timestamp: number }> = new Map();
const THESIS_CACHE_TTL = 10 * 60 * 1000; // 10 minute cache for thesis checks

/**
 * Quick thesis validation - checks if bullish/bearish case is still intact
 * Uses RSI and recent price action to determine if original direction is still valid
 */
async function quickThesisCheck(symbol: string, isCall: boolean): Promise<{ valid: boolean; reason: string }> {
  const cacheKey = `${symbol}_${isCall ? 'call' : 'put'}`;
  const cached = thesisCheckCache.get(cacheKey);
  const now = Date.now();
  
  // Return cached result if fresh
  if (cached && now - cached.timestamp < THESIS_CACHE_TTL) {
    return { valid: cached.valid, reason: 'cached' };
  }
  
  try {
    // Get recent price history for multi-factor thesis check
    const history = await getTradierHistoryOHLC(symbol, 20);
    if (!history || !history.closes || history.closes.length < 14) {
      return { valid: true, reason: 'insufficient_data' }; // Default to valid if no data
    }
    
    const closes = history.closes;
    const currentPrice = closes[closes.length - 1];
    const currentRSI = calculateRSI(closes, 14);
    
    // Calculate 10-day SMA for trend direction
    const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const priceAboveSMA = currentPrice > sma10;
    
    // Calculate momentum (price change over last 3 days) - STRICT threshold
    const momentum3d = closes.length >= 3 
      ? ((currentPrice - closes[closes.length - 3]) / closes[closes.length - 3]) * 100 
      : 0;
    // For calls: momentum must be positive (>0%) - any decline invalidates bullish thesis
    // For puts: momentum must be negative (<0%) - any rise invalidates bearish thesis
    
    // For CALL options: thesis valid if not overbought AND price above SMA AND momentum positive
    // For PUT options: thesis valid if not oversold AND price below SMA AND momentum negative
    // ALL conditions must be true - no OR logic that weakens the check
    let valid: boolean;
    let reason: string;
    
    if (isCall) {
      const notOverbought = currentRSI < 70;
      const priceSupport = priceAboveSMA;
      const momentumSupport = momentum3d > 0; // Must be rising, not just "not falling much"
      valid = notOverbought && priceSupport && momentumSupport;
      
      if (!valid) {
        if (!notOverbought) {
          reason = `RSI ${currentRSI.toFixed(0)} overbought`;
        } else {
          reason = `Price ${priceAboveSMA ? 'above' : 'below'} SMA, momentum ${momentum3d.toFixed(1)}%`;
        }
      } else {
        reason = `RSI ${currentRSI.toFixed(0)}, ${priceAboveSMA ? 'above' : 'below'} SMA, mom ${momentum3d.toFixed(1)}%`;
      }
    } else {
      const notOversold = currentRSI > 30;
      const priceSupport = !priceAboveSMA; // Price must be BELOW SMA for bearish
      const momentumSupport = momentum3d < 0; // Must be falling, not rising
      valid = notOversold && priceSupport && momentumSupport;
      
      if (!valid) {
        if (!notOversold) {
          reason = `RSI ${currentRSI.toFixed(0)} oversold`;
        } else {
          reason = `Price ${priceAboveSMA ? 'above' : 'below'} SMA, momentum ${momentum3d.toFixed(1)}%`;
        }
      } else {
        reason = `RSI ${currentRSI.toFixed(0)}, ${priceAboveSMA ? 'above' : 'below'} SMA, mom ${momentum3d.toFixed(1)}%`;
      }
    }
    
    // Cache the result
    thesisCheckCache.set(cacheKey, { valid, timestamp: now });
    
    return { valid, reason };
  } catch (error) {
    // On error, default to thesis valid (don't force exit on API failure)
    return { valid: true, reason: 'api_error' };
  }
}

async function getMarketContext(): Promise<{ spyDown: boolean; spyChange: number }> {
  try {
    const now = Date.now();
    // Only fetch SPY every 5 minutes to avoid rate limits - return cached result
    if (lastSpyFetchTime && now - lastSpyFetchTime < 5 * 60 * 1000) {
      return cachedMarketContext; // Return cached market context
    }
    
    const spyData = await fetchStockPrice('SPY');
    // Use changePercent directly from market data (real data, not estimated)
    const spyChange = spyData?.changePercent || 0;
    const spyDown = spyChange < -0.5; // Market is "down" if SPY dropped more than 0.5%
    
    // Cache the result
    cachedMarketContext = { spyDown, spyChange };
    lastSpyFetchTime = now;
    
    if (spyDown) {
      logger.info(`📉 [MARKET] SPY down ${spyChange.toFixed(2)}% - market pullback mode active`);
    }
    
    return cachedMarketContext;
  } catch (e) {
    // Ignore errors, return cached or default
  }
  return cachedMarketContext;
}

export async function executeTradeIdea(
  portfolioId: string,
  tradeIdea: TradeIdea,
  options?: { maxQuantity?: number; riskFraction?: number }
): Promise<ExecuteTradeResult> {
  try {
    const portfolio = await storage.getPaperPortfolioById(portfolioId);
    if (!portfolio) {
      return { success: false, error: "Portfolio not found" };
    }

    // 🛑 CHECK EXISTING SYMBOL EXPOSURE - Prevent overconcentration
    const existingPositions = await storage.getPaperPositionsByPortfolio(portfolioId);
    const symbolPositions = existingPositions.filter(p => 
      p.symbol === tradeIdea.symbol && p.status === 'open'
    );
    
    // 🛑🛑 CRITICAL: CHECK FOR EXACT DUPLICATE POSITION (same option contract)
    // This prevents race condition duplicates from parallel bot executions
    if (tradeIdea.assetType === 'option' && tradeIdea.strikePrice && tradeIdea.optionType) {
      const exactDuplicate = existingPositions.find(p => 
        p.symbol === tradeIdea.symbol && 
        p.status === 'open' &&
        p.optionType === tradeIdea.optionType &&
        p.strikePrice === tradeIdea.strikePrice &&
        p.expiryDate === tradeIdea.expiryDate
      );
      
      if (exactDuplicate) {
        logger.warn(`🛑 [DUPLICATE-POSITION] Rejecting ${tradeIdea.symbol} ${tradeIdea.optionType?.toUpperCase()} $${tradeIdea.strikePrice} - already have open position (ID: ${exactDuplicate.id})`);
        return { success: false, error: `Duplicate position for ${tradeIdea.symbol} ${tradeIdea.optionType} $${tradeIdea.strikePrice}` };
      }
    }
    
    if (symbolPositions.length > 0) {
      // 🛑 ONE POSITION PER SYMBOL - Block any new trades on same underlying
      if (ONE_POSITION_PER_SYMBOL && tradeIdea.assetType === 'option') {
        const existingSymbolPos = symbolPositions[0];
        logger.warn(`🛑 [ONE-PER-SYMBOL] Rejecting ${tradeIdea.symbol} ${tradeIdea.optionType?.toUpperCase()} $${tradeIdea.strikePrice} - already have ${existingSymbolPos.optionType?.toUpperCase()} $${existingSymbolPos.strikePrice} open`);
        return { success: false, error: `Already have position on ${tradeIdea.symbol} - only 1 per symbol allowed` };
      }
      
      const totalSymbolExposure = symbolPositions.reduce((sum, p) => 
        sum + (p.quantity * (p.entryPrice || 0) * (p.optionType ? 100 : 1)), 0
      );
      const symbolExposurePercent = totalSymbolExposure / portfolio.startingCapital;
      
      if (symbolExposurePercent >= MAX_PERCENT_PER_SYMBOL) {
        logger.warn(`🛑 [POSITION-LIMIT] Rejecting ${tradeIdea.symbol} - already at ${(symbolExposurePercent * 100).toFixed(1)}% exposure (max ${MAX_PERCENT_PER_SYMBOL * 100}%)`);
        return { success: false, error: `Already at max exposure for ${tradeIdea.symbol}` };
      }
    }

    // Fill at the LIVE price, not the idea's planned entry.
    //
    // Filling at tradeIdea.entryPrice books a gain that never happened: a signal generated
    // at $80.59 on a name now trading $84.34 opens the position already +4.6% up. That
    // manufactures P&L out of signal staleness and makes the whole paper record fiction.
    // A real fill happens at the market, so the record only counts what happened AFTER
    // the trade was taken.
    const currentPrice = (tradeIdea as any).currentPrice ?? tradeIdea.entryPrice;
    const multiplier = tradeIdea.assetType === 'option' ? 100 : 1;
    
    let quantity: number;
    let positionCost: number;

    if (tradeIdea.assetType === 'option') {
      // 🎯 SMART POSITION SIZING: Use the MINIMUM of:
      // 1. 20% of CURRENT cash balance (not starting capital)
      // 2. Hard cap of $60 per trade (small account friendly)
      // 3. Available cash balance
      const percentBasedMax = portfolio.cashBalance * MAX_PERCENT_PER_TRADE;
      // The flat $250 cap was small-account protection acting as a universal
      // ceiling: the 100K clean-era book was refused a $655 MSFT contract by a
      // rule written for a $2K lotto account. The dollar cap now scales with
      // the book (3% of cash) and the flat figure survives only as the FLOOR
      // of that scale — tiny accounts keep their guardrail, real books can
      // buy one contract of the board they exist to measure.
      const scaledDollarCap = Math.max(MAX_DOLLAR_PER_TRADE, portfolio.cashBalance * 0.03);
      const maxAllowedSpend = Math.min(percentBasedMax, scaledDollarCap, portfolio.cashBalance);
      
      const contractCost = currentPrice * 100;
      
      // 🛡️ CRITICAL: Verify we can afford at least 1 contract
      if (contractCost > portfolio.cashBalance) {
        logger.warn(`🛑 [POSITION-SIZE] Cannot afford 1 contract of ${tradeIdea.symbol} @ $${currentPrice.toFixed(2)} (cost: $${contractCost.toFixed(0)}, balance: $${portfolio.cashBalance.toFixed(2)})`);
        return { success: false, error: `Insufficient cash for ${tradeIdea.symbol}. Need $${contractCost.toFixed(0)}, have $${portfolio.cashBalance.toFixed(2)}` };
      }
      
      // 🛡️ CRITICAL: Reject if 1 contract exceeds the spend limit (small account protection)
      // This prevents buying expensive options that don't fit the account size
      if (contractCost > maxAllowedSpend) {
        logger.warn(`🛑 [POSITION-SIZE] Contract too expensive for account size: $${contractCost.toFixed(0)} > max allowed $${maxAllowedSpend.toFixed(0)} (${tradeIdea.symbol} @ $${currentPrice.toFixed(2)})`);
        return { success: false, error: `Option premium too high for account. Cost: $${contractCost.toFixed(0)}, Max allowed: $${maxAllowedSpend.toFixed(0)}` };
      }
      
      // Size options by dollars at risk, not premium spend alone. With a $10
      // premium and a $5 stop, one contract risks $500—not $1,000. The caller's
      // chosen risk fraction now means the same thing for shares and options.
      const riskPerTrade = options?.riskFraction ?? (portfolio.riskPerTrade || 0.02);
      const riskBudget = portfolio.cashBalance * riskPerTrade;
      const stopPremium = Number(tradeIdea.stopLoss ?? 0);
      const riskPerContract = Math.abs(currentPrice - stopPremium) * 100;
      if (!(riskPerContract > 0)) {
        return { success: false, error: `Invalid option stop for ${tradeIdea.symbol}` };
      }

      // 🛡️ Cap quantity to what we can actually afford within spend and risk limits
      const maxAffordable = Math.floor(portfolio.cashBalance / contractCost);
      const maxBySpendLimit = Math.floor(maxAllowedSpend / contractCost);
      const maxByRisk = Math.floor(riskBudget / riskPerContract);
      // Only buy what fits within spend limit AND what we can afford - NO forcing to 1
      // 💎 PLAYBOOK: Respect maxQuantity parameter (for Options Bot single-contract rule)
      const maxAllowed = options?.maxQuantity ? Math.min(MAX_CONTRACTS_PER_TRADE, options.maxQuantity) : MAX_CONTRACTS_PER_TRADE;
      quantity = Math.min(maxAllowed, maxBySpendLimit, maxAffordable, maxByRisk);
      
      // Safety: ensure at least 1 contract (should always pass given prior checks)
      if (quantity < 1) {
        logger.warn(`🛑 [POSITION-SIZE] Quantity calculation resulted in 0 contracts for ${tradeIdea.symbol}`);
        return { success: false, error: `One ${tradeIdea.symbol} contract risks $${riskPerContract.toFixed(0)}, above the $${riskBudget.toFixed(0)} trade budget` };
      }
      
      positionCost = quantity * contractCost;
      
      // 🛡️ FINAL CHECK: Reject if position cost exceeds cash OR spend limit
      if (positionCost > portfolio.cashBalance) {
        logger.warn(`🛑 [POSITION-SIZE] Position cost $${positionCost.toFixed(0)} exceeds cash $${portfolio.cashBalance.toFixed(2)}`);
        return { success: false, error: `Position too large. Cost: $${positionCost.toFixed(0)}, Cash: $${portfolio.cashBalance.toFixed(2)}` };
      }
      
      if (positionCost > maxAllowedSpend) {
        logger.warn(`🛑 [POSITION-SIZE] Position cost $${positionCost.toFixed(0)} exceeds spend limit $${maxAllowedSpend.toFixed(0)}`);
        return { success: false, error: `Position exceeds max allowed. Cost: $${positionCost.toFixed(0)}, Limit: $${maxAllowedSpend.toFixed(0)}` };
      }
      
      logger.info(`📊 [POSITION-SIZE] ${tradeIdea.symbol}: ${quantity} contracts @ $${currentPrice.toFixed(2)} = $${positionCost.toFixed(0)}; risk $${(quantity * riskPerContract).toFixed(0)}/${riskBudget.toFixed(0)} budget`);
    } else {
      // Callers may size down per-fill (the bot halves risk on a selective
      // tape instead of refusing to trade — caution expressed in dollars,
      // not in a starved sample).
      const riskPerTrade = options?.riskFraction ?? (portfolio.riskPerTrade || 0.02);
      const riskAmount = portfolio.cashBalance * riskPerTrade;
      const stopDistance = Math.abs(currentPrice - tradeIdea.stopLoss);
      
      if (stopDistance > 0) {
        quantity = Math.floor(riskAmount / stopDistance);
      } else {
        const maxPosition = portfolio.maxPositionSize || 5000;
        quantity = Math.floor(maxPosition / currentPrice);
      }
      
      quantity = Math.max(1, quantity);
      
      const maxPositionValue = portfolio.maxPositionSize || 5000;
      if (quantity * currentPrice > maxPositionValue) {
        quantity = Math.floor(maxPositionValue / currentPrice);
      }
      
      positionCost = quantity * currentPrice;
    }

    if (positionCost > portfolio.cashBalance) {
      return { 
        success: false, 
        error: `Insufficient cash. Need $${positionCost.toFixed(2)}, have $${portfolio.cashBalance.toFixed(2)}` 
      };
    }

    const now = new Date().toISOString();
    
    // Build entry reason from trade idea context
    const entryReason = tradeIdea.catalyst || tradeIdea.analysis || `${tradeIdea.source || 'QUANT'} signal for ${tradeIdea.symbol}`;
    const entrySignals = tradeIdea.qualitySignals ? JSON.stringify(tradeIdea.qualitySignals) : null;
    
    const positionData: InsertPaperPosition = {
      portfolioId,
      tradeIdeaId: tradeIdea.id,
      symbol: tradeIdea.symbol,
      assetType: tradeIdea.assetType,
      direction: tradeIdea.direction,
      optionType: tradeIdea.optionType || null,
      strikePrice: tradeIdea.strikePrice || null,
      expiryDate: tradeIdea.expiryDate || null,
      entryPrice: currentPrice,
      quantity,
      entryTime: now,
      entryReason,
      entrySignals,
      targetPrice: tradeIdea.targetPrice,
      stopLoss: tradeIdea.stopLoss,
      currentPrice,
      lastPriceUpdate: now,
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,
      status: 'open',
    };

    const position = await storage.createPaperPosition(positionData);

    await storage.updatePaperPortfolio(portfolioId, {
      cashBalance: portfolio.cashBalance - positionCost,
    });

    logger.info(`Paper trade executed: ${tradeIdea.symbol} ${tradeIdea.direction} x${quantity} @ $${currentPrice}`, {
      portfolioId,
      positionId: position.id,
      cost: positionCost,
    });

    return { success: true, position };
  } catch (error) {
    logger.error("Error executing paper trade", { error, portfolioId, tradeIdeaId: tradeIdea.id });
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function closePosition(
  positionId: string,
  exitPrice: number,
  exitReason: string
): Promise<ClosePositionResult> {
  try {
    const position = await storage.closePaperPosition(positionId, exitPrice, exitReason);
    if (!position) {
      return { success: false, error: "Position not found" };
    }

    logger.info(`Paper position closed: ${position.symbol} @ $${exitPrice}`, {
      positionId,
      exitReason,
      realizedPnL: position.realizedPnL,
    });
    
    // 🛡️ CRITICAL: Invoke exit callback for EVERY close
    // This ensures auto-lotto cooldowns are recorded for ALL exits, not just manual ones
    if (onExitCallback) {
      const pnlPercent = position.realizedPnLPercent || 0;
      const wasWin = pnlPercent >= 0;
      onExitCallback(
        position.symbol, 
        position.optionType || undefined, 
        position.strikePrice || undefined, 
        wasWin
      );
      logger.info(`🛡️ [EXIT-HOOK] Notified: ${position.symbol} ${position.optionType || ''} $${position.strikePrice || ''} (${wasWin ? 'WIN' : 'LOSS'})`);
    }

    // === ADAPTIVE LOSS INTELLIGENCE ===
    // Analyze ALL closed trades to learn from both wins and losses
    const pnlPercent = position.realizedPnLPercent || 0;
    const isLoss = pnlPercent < 0;
    
    try {
      if (isLoss && Math.abs(pnlPercent) >= 5) {
        // Significant loss (>5%) - analyze for patterns and apply remediations
        const diagnosis = await analyzeTrade(position);
        
        if (diagnosis) {
          logger.info(`🧠 [ADAPTIVE LEARNING] Applied remediation for ${position.symbol} loss: ${diagnosis.primaryCause}`, {
            symbol: position.symbol,
            pnlPercent,
            cause: diagnosis.primaryCause,
            categories: diagnosis.lossCategories,
          });
        }
      } else if (pnlPercent >= 10) {
        // Significant win (>10%) - record positive reinforcement
        await recordWin(position);
        logger.info(`🎯 [ADAPTIVE LEARNING] Recorded win for ${position.symbol}: +${pnlPercent.toFixed(1)}%`);
      }
    } catch (analysisError) {
      // Don't fail the close operation if analysis fails
      logger.warn(`[ADAPTIVE LEARNING] Analysis failed for ${position.symbol}`, { error: analysisError });
    }

    return { success: true, position };
  } catch (error) {
    logger.error("Error closing paper position", { error, positionId });
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Fetch current price for a position
 * For options, we MUST fetch the actual option premium, NEVER fall back to stock prices
 * This prevents P&L calculation errors where stock prices are used instead of option premiums
 */
async function fetchCurrentPrice(
  symbol: string, 
  assetType: AssetType,
  optionDetails?: { underlying: string; expiryDate: string; optionType: 'call' | 'put'; strike: number },
  fallbackPrice?: number
): Promise<number | null> {
  try {
    if (assetType === 'crypto') {
      const data = await fetchCryptoPrice(symbol);
      return data?.currentPrice || null;
    } else if (assetType === 'option') {
      // CRITICAL: For options, we MUST have option details to get the correct premium
      // NEVER fall back to stock prices - this causes massively inflated P&L
      if (!optionDetails) {
        logger.error(`🚨 [PAPER] Option ${symbol} missing metadata - cannot fetch price. Using fallback: $${fallbackPrice?.toFixed(2) || 'null'}`);
        return fallbackPrice || null;
      }
      
      // Fetch actual option premium from Tradier
      const quote = await getOptionQuote({
        underlying: optionDetails.underlying,
        expiryDate: optionDetails.expiryDate,
        optionType: optionDetails.optionType,
        strike: optionDetails.strike,
      });
      
      if (quote) {
        // Mark to BID, not mid. These are long positions and the exit path fills
        // at the bid (see closePosition), so marking the open book at mid while
        // closing it at bid overstates every unrealized gain by half the spread.
        // On the $0.05-$1.00 premium this bot actually trades that is 5-10% of
        // the position. Open and closed have to be valued by the same rule or the
        // two halves of the book cannot be compared to each other.
        const price = quote.bid > 0 ? quote.bid : (quote.mid > 0 ? quote.mid : quote.last);
        if (price > 0) {
          logger.info(`📊 [PAPER] Option price for ${symbol} ${optionDetails.optionType.toUpperCase()} $${optionDetails.strike}: $${price.toFixed(2)} (bid: $${quote.bid}, ask: $${quote.ask})`);
          return price;
        }
      }
      
      // Tradier is the primary option quote source and returns 401 on an unfunded account,
      // so this path was ALWAYS falling through to the entry price — which is why every
      // paper option position sat at exactly +$0.00 / +0.0% and the bot looked frozen.
      // A position that can't be marked to market can't be managed: stops and targets
      // never trigger either. CBOE's delayed chain needs no key and prices the same
      // contract, so try it before giving up.
      try {
        const { getContractQuote } = await import('./cboe-options-fallback');
        const cboe = await getContractQuote(
          optionDetails.underlying,
          optionDetails.optionType,
          optionDetails.strike,
          optionDetails.expiryDate,
        );
        if (cboe && cboe.mid > 0) {
          logger.info(`📊 [PAPER] CBOE mark for ${symbol} ${optionDetails.optionType.toUpperCase()} $${optionDetails.strike}: $${cboe.mid.toFixed(2)} (bid $${cboe.bid} / ask $${cboe.ask}, delayed)`);
          return cboe.mid;
        }
      } catch (err: any) {
        logger.warn(`📊 [PAPER] CBOE fallback failed for ${symbol}: ${err?.message}`);
      }

      // Genuinely no mark available — hold the last known value rather than inventing one.
      logger.warn(`📊 [PAPER] No option quote for ${symbol} ${optionDetails.optionType?.toUpperCase()} $${optionDetails.strike} exp ${optionDetails.expiryDate} - using fallback: $${fallbackPrice?.toFixed(2) || 'null'}`);
      return fallbackPrice || null;
    } else {
      // Only use stock prices for actual stocks
      const data = await fetchStockPrice(symbol);
      return data?.currentPrice || null;
    }
  } catch (error) {
    logger.warn(`Failed to fetch price for ${symbol}`, { error });
    return fallbackPrice || null;
  }
}

export async function updatePositionPrices(portfolioId: string): Promise<void> {
  try {
    const positions = await storage.getPaperPositionsByPortfolio(portfolioId);
    const openPositions = positions.filter(p => p.status === 'open');
    
    const now = new Date().toISOString();

    for (const position of openPositions) {
      // Build option details if this is an option position
      let optionDetails: { underlying: string; expiryDate: string; optionType: 'call' | 'put'; strike: number } | undefined;
      
      if (position.assetType === 'option' && position.strikePrice && position.optionType && position.expiryDate) {
        optionDetails = {
          underlying: position.symbol,
          expiryDate: position.expiryDate,
          optionType: position.optionType as 'call' | 'put',
          strike: position.strikePrice,
        };
      }
      
      // For options, pass current price as fallback to avoid using stock prices
      const fallbackPrice = position.assetType === 'option' 
        ? (position.currentPrice || position.entryPrice) 
        : undefined;
      
      const currentPrice = await fetchCurrentPrice(
        position.symbol, 
        position.assetType as AssetType,
        optionDetails,
        fallbackPrice
      );
      
      if (currentPrice !== null) {
        const multiplier = position.assetType === 'option' ? 100 : 1;
        const directionMultiplier = position.direction === 'long' ? 1 : -1;
        
        // Same rule as closePaperPosition: a bought option is long the contract,
        // so a put's unrealised P&L must NOT be inverted by the underlying thesis.
        const pnlSign = position.assetType === 'option' ? 1 : directionMultiplier;
        const unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity * multiplier * pnlSign;
        const unrealizedPnLPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100 * pnlSign;

        // SMART TRAILING STOP: Update high water mark and trailing stop
        const updateData: Record<string, any> = {
          currentPrice,
          lastPriceUpdate: now,
          unrealizedPnL,
          unrealizedPnLPercent,
        };
        
        // Bought calls and puts are both long premium positions. `direction`
        // remains the underlying thesis and must not invert put management.
        const isLong = position.assetType === 'option' || position.direction === 'long';
        const currentHWM = position.highWaterMark || position.entryPrice;
        const entryPrice = position.entryPrice;
        
        // For long positions: HWM is the peak high price
        // For short positions: HWM would be lowest low price (we use same field, just logic differs)
        const priceImproved = isLong ? currentPrice > currentHWM : currentPrice < currentHWM;
        
        if (priceImproved) {
          updateData.highWaterMark = currentPrice;
          
          // Dynamic trailing stop: wider trailing when winning big, tighter when gains are small
          // At 50%+ gain: use 35% trailing stop (let it breathe)
          // At 100%+ gain: use 40% trailing stop (let big winners run)
          // At 200%+ gain: use 50% trailing stop (mega winners need room)
          const gainPercent = isLong 
            ? ((currentPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - currentPrice) / entryPrice) * 100;
          
          let trailingPercent = 25; // Default 25% trailing stop
          
          if (gainPercent >= 200) {
            trailingPercent = 50; // Let mega winners run
          } else if (gainPercent >= 100) {
            trailingPercent = 40; // Let big winners run
          } else if (gainPercent >= 50) {
            trailingPercent = 35; // Let winners breathe
          } else if (gainPercent >= 25) {
            trailingPercent = 30; // Standard winners
          }
          
          // CRITICAL: Calculate trailing stop but ALWAYS clamp to at least break-even
          // This ensures a profitable trade NEVER exits at a loss
          let rawTrailingStop = isLong 
            ? currentPrice * (1 - trailingPercent / 100)
            : currentPrice * (1 + trailingPercent / 100);
          
          // Clamp trailing stop to at least break-even (entry price)
          // Only set trailing stop if it's above entry (for longs) or below entry (for shorts)
          const trailingStopAboveBreakeven = isLong 
            ? rawTrailingStop >= entryPrice
            : rawTrailingStop <= entryPrice;
          
          if (trailingStopAboveBreakeven) {
            updateData.trailingStopPercent = trailingPercent;
            updateData.trailingStopPrice = rawTrailingStop;
            
            const lockedGain = isLong 
              ? ((rawTrailingStop - entryPrice) / entryPrice) * 100
              : ((entryPrice - rawTrailingStop) / entryPrice) * 100;
            
            logger.info(`📈 [TRAILING] ${position.symbol}: New HWM $${currentPrice.toFixed(2)} (+${gainPercent.toFixed(0)}%), trailing stop at $${rawTrailingStop.toFixed(2)} (locks +${lockedGain.toFixed(0)}%)`);
          } else {
            // Trailing stop would be below break-even, don't activate it yet
            // Keep original stop loss active until trailing stop can lock in gains
            logger.debug(`📈 [TRAILING] ${position.symbol}: HWM $${currentPrice.toFixed(2)} (+${gainPercent.toFixed(0)}%), but trailing stop $${rawTrailingStop.toFixed(2)} is below entry - using original stop`);
          }
        }

        await storage.updatePaperPosition(position.id, updateData);
      }
    }

    logger.info(`Updated prices for ${openPositions.length} positions`, { portfolioId });
  } catch (error) {
    logger.error("Error updating position prices", { error, portfolioId });
  }
}

export async function checkStopsAndTargets(portfolioId: string): Promise<PaperPosition[]> {
  const closedPositions: PaperPosition[] = [];
  
  try {
    const positions = await storage.getPaperPositionsByPortfolio(portfolioId);
    const openPositions = positions.filter(p => p.status === 'open');
    
    // Check if market is open for options - needed for valid price-based closures
    const marketStatus = isOptionsMarketOpen();

    for (const position of openPositions) {
      if (!position.currentPrice) continue;

      const isLong = position.assetType === 'option' || position.direction === 'long';
      let shouldClose = false;
      let exitReason = '';
      
      // For options, only check stops/targets if market is open (real prices available)
      const isOption = position.assetType === 'option';
      const canUsePrice = !isOption || marketStatus.isOpen;
      
      // Check if current price is stale (equals entry price, suggesting no real update)
      const priceIsStale = isOption && 
        Math.abs(position.currentPrice - position.entryPrice) < 0.001;

      // Only check price-based exits if we have real prices (not stale)
      if (canUsePrice && !priceIsStale) {
        // SMART EXIT STRATEGY: Use trailing stops to let winners run
        const useTrailing = position.useTrailingStop !== false; // Default to true
        const trailingStopPrice = position.trailingStopPrice;
        const highWaterMark = position.highWaterMark || position.entryPrice;
        const entryPrice = position.entryPrice;
        
        // 1. Check TRAILING STOP (only if it's been set AND it's above break-even)
        // The trailing stop is only set when it would lock in a gain, so if it exists, use it
        if (useTrailing && trailingStopPrice) {
          const trailingHit = isLong 
            ? position.currentPrice <= trailingStopPrice
            : position.currentPrice >= trailingStopPrice;
          
          if (trailingHit) {
            const gainFromEntry = isLong
              ? ((highWaterMark - entryPrice) / entryPrice) * 100
              : ((entryPrice - highWaterMark) / entryPrice) * 100;
            const lockedGain = isLong
              ? ((trailingStopPrice - entryPrice) / entryPrice) * 100
              : ((entryPrice - trailingStopPrice) / entryPrice) * 100;
            // The FILL is currentPrice, not the trigger. During the Sep 2-7
            // outage AAPL's stop sat at +64% and the wake-up fill was −32% —
            // and the old label still said "locked_64pct". A label must
            // describe the exit that happened, not the one that was planned.
            const actualPct = isLong
              ? ((position.currentPrice - entryPrice) / entryPrice) * 100
              : ((entryPrice - position.currentPrice) / entryPrice) * 100;
            const gapped = Math.abs(position.currentPrice - trailingStopPrice) / trailingStopPrice > 0.10;
            shouldClose = true;
            exitReason = gapped
              ? `trailing_stop_gapped_${actualPct >= 0 ? '+' : ''}${actualPct.toFixed(0)}pct_vs_${Math.max(0, lockedGain).toFixed(0)}pct_lock`
              : `trailing_stop_hit_locked_${Math.max(0, lockedGain).toFixed(0)}pct`;
            logger.info(`📉 [TRAILING] ${position.symbol}: Hit trailing stop at $${position.currentPrice.toFixed(2)} (set at $${trailingStopPrice.toFixed(2)}${gapped ? ' — GAPPED THROUGH' : ''}). Peak was $${highWaterMark.toFixed(2)} (+${gainFromEntry.toFixed(0)}%), fill ${actualPct >= 0 ? '+' : ''}${actualPct.toFixed(0)}%`);
          }
        }
        
        // 2. Check STOP LOSS with DTE-AWARE SMART EXIT LOGIC
        // Longer-dated options get wider stops - they have time to recover!
        if (!shouldClose && !trailingStopPrice) {
          const currentLoss = isLong 
            ? ((entryPrice - position.currentPrice) / entryPrice) * 100
            : ((position.currentPrice - entryPrice) / entryPrice) * 100;
          
          // Get DTE-aware exit configuration
          const dte = isOption ? calculateDTE(position.expiryDate) : 0;
          const exitConfig = getDTEExitConfig(dte);
          
          // Check if we hit the SOFT stop (warning zone)
          const hitSoftStop = currentLoss >= exitConfig.softStopPercent;
          // Check if we hit the HARD stop (forced exit)
          const hitHardStop = currentLoss >= exitConfig.hardStopPercent;
          
          if (hitHardStop) {
            // HARD STOP: Forced exit, no exceptions
            shouldClose = true;
            exitReason = `hard_stop_${currentLoss.toFixed(0)}pct_loss`;
            logger.warn(`🛑 [HARD STOP] ${position.symbol}: -${currentLoss.toFixed(1)}% exceeds max ${exitConfig.hardStopPercent}% for ${dte} DTE option`);
          } else if (hitSoftStop) {
            // SOFT STOP: Check market context AND thesis validity before exiting
            const marketContext = await getMarketContext();
            const isCallOption = position.optionType === 'call';
            
            // Run thesis check if required by DTE config
            let thesisValid = true;
            let thesisReason = '';
            if (exitConfig.requireThesisCheck && isOption) {
              const thesisResult = await quickThesisCheck(position.symbol, isCallOption);
              thesisValid = thesisResult.valid;
              thesisReason = thesisResult.reason;
            }
            
            // STRICT GATING: Only hold on soft stop if BOTH market is down AND thesis is valid
            // No unconditional holds based on DTE alone!
            const canOverride = exitConfig.allowMarketOverride && marketContext.spyDown && thesisValid;
            
            if (canOverride) {
              // Market-wide pullback AND thesis still valid - hold
              logger.info(`⏸️ [SOFT STOP] ${position.symbol}: -${currentLoss.toFixed(1)}% but SPY down ${marketContext.spyChange.toFixed(1)}% & thesis valid (${thesisReason}) - HOLDING ${dte} DTE option`);
              // Don't exit, market is pulling back everything and thesis still intact
            } else if (!thesisValid) {
              // Thesis no longer valid - exit immediately
              shouldClose = true;
              exitReason = `thesis_invalidated_${currentLoss.toFixed(0)}pct`;
              logger.warn(`📉 [THESIS FAIL] ${position.symbol}: -${currentLoss.toFixed(1)}% and ${thesisReason} - exiting`);
            } else if (!marketContext.spyDown) {
              // Market not pulling back but hit soft stop - exit
              shouldClose = true;
              exitReason = `soft_stop_${currentLoss.toFixed(0)}pct`;
              logger.info(`📉 [SOFT STOP] ${position.symbol}: -${currentLoss.toFixed(1)}% with SPY flat/up - exiting`);
            } else {
              // Fallback: shouldn't reach here, but exit to be safe
              shouldClose = true;
              exitReason = `stop_hit_${currentLoss.toFixed(0)}pct`;
              logger.info(`📉 [STOP] ${position.symbol}: -${currentLoss.toFixed(1)}% - exiting`);
            }
          }
          
          // Also check original stop loss for non-options or fallback
          if (!shouldClose && !isOption && position.stopLoss) {
            if ((isLong && position.currentPrice <= position.stopLoss) ||
                (!isLong && position.currentPrice >= position.stopLoss)) {
              shouldClose = true;
              exitReason = 'stop_hit';
            }
          }
        }
        
        // 3. Check MEGA TARGET (400%+ gain - take massive profits to lock in wins)
        if (!shouldClose && position.targetPrice) {
          const megaTarget = entryPrice * 4; // 300%+ gain is mega territory
          const megaHit = isLong 
            ? position.currentPrice >= megaTarget
            : position.currentPrice <= entryPrice * 0.25; // 75% drop for shorts (rare)
          
          if (megaHit) {
            shouldClose = true;
            exitReason = 'mega_target_hit';
            logger.info(`🚀 [MEGA] ${position.symbol}: Hit mega target at $${position.currentPrice.toFixed(2)} (400%+)!`);
          }
        }
      }

      // For expiry, only close if market is open (so we have real exit prices)
      if (isOption && position.expiryDate) {
        // Normalize both dates to YYYY-MM-DD for proper comparison
        const today = normalizeDateString(new Date());
        const expiryDateNormalized = normalizeDateString(position.expiryDate);
        
        if (expiryDateNormalized <= today) {
          if (marketStatus.isOpen && !priceIsStale) {
            // Market is open and we have real prices - close normally
            shouldClose = true;
            exitReason = 'expired';
          } else {
            // Market closed or stale price - log but don't close with bad prices
            logger.info(`📊 [PAPER] Skipping expired option close for ${position.symbol} - ${marketStatus.reason}, will close when market opens with real prices`);
          }
        }
      }

      if (shouldClose) {
        // 🛡️ CRITICAL FIX: Fetch REAL market price before closing
        // This prevents P&L inflation from using stale/assumed prices
        let realExitPrice = position.currentPrice;
        
        if (position.assetType === 'option' && position.strikePrice && position.optionType && position.expiryDate) {
          try {
            const freshQuote = await getOptionQuote({
              underlying: position.symbol,
              expiryDate: position.expiryDate,
              optionType: position.optionType as 'call' | 'put',
              strike: position.strikePrice,
            });
            
            if (freshQuote && freshQuote.bid > 0) {
              // Use BID price for selling (realistic fill)
              realExitPrice = freshQuote.bid;
              logger.info(`📊 [REAL-PRICE] ${position.symbol}: Closing at REAL bid $${realExitPrice.toFixed(2)} (was $${position.currentPrice?.toFixed(2)})`);
            } else {
              logger.warn(`📊 [REAL-PRICE] ${position.symbol}: No fresh quote available, using cached price $${position.currentPrice?.toFixed(2)}`);
            }
          } catch (quoteErr) {
            logger.warn(`📊 [REAL-PRICE] ${position.symbol}: Quote fetch failed, using cached price`, { error: quoteErr });
          }
        }
        
        const result = await closePosition(position.id, realExitPrice, exitReason);
        if (result.success && result.position) {
          closedPositions.push(result.position);
        }
      }
    }

    if (closedPositions.length > 0) {
      logger.info(`Auto-closed ${closedPositions.length} positions`, { portfolioId });
    }

    return closedPositions;
  } catch (error) {
    logger.error("Error checking stops and targets", { error, portfolioId });
    return closedPositions;
  }
}

export async function calculatePortfolioValue(portfolioId: string): Promise<PortfolioValue | null> {
  try {
    const portfolio = await storage.getPaperPortfolioById(portfolioId);
    if (!portfolio) return null;

    const positions = await storage.getPaperPositionsByPortfolio(portfolioId);
    const openPositions = positions.filter(p => p.status === 'open');

    let positionsValue = 0;
    let unrealizedPnL = 0;

    for (const position of openPositions) {
      const multiplier = position.assetType === 'option' ? 100 : 1;
      const currentValue = (position.currentPrice || position.entryPrice) * position.quantity * multiplier;
      positionsValue += currentValue;
      unrealizedPnL += position.unrealizedPnL || 0;
    }

    const totalValue = portfolio.cashBalance + positionsValue;
    const unrealizedPnLPercent = portfolio.startingCapital > 0 
      ? ((totalValue - portfolio.startingCapital) / portfolio.startingCapital) * 100 
      : 0;

    return {
      cashBalance: portfolio.cashBalance,
      positionsValue,
      totalValue,
      unrealizedPnL,
      unrealizedPnLPercent,
    };
  } catch (error) {
    logger.error("Error calculating portfolio value", { error, portfolioId });
    return null;
  }
}

export async function recordEquitySnapshot(portfolioId: string): Promise<boolean> {
  try {
    const portfolioValue = await calculatePortfolioValue(portfolioId);
    if (!portfolioValue) return false;

    const portfolio = await storage.getPaperPortfolioById(portfolioId);
    if (!portfolio) return false;

    const today = new Date().toISOString().split('T')[0];

    const existingSnapshots = await storage.getPaperEquitySnapshots(portfolioId, today, today);
    if (existingSnapshots.length > 0) {
      logger.info(`Equity snapshot already exists for ${today}`, { portfolioId });
      return true;
    }

    const previousSnapshots = await storage.getPaperEquitySnapshots(portfolioId);
    const previousValue = previousSnapshots.length > 0 
      ? previousSnapshots[0].totalValue 
      : portfolio.startingCapital;

    const dailyPnL = portfolioValue.totalValue - previousValue;
    const dailyPnLPercent = previousValue > 0 
      ? (dailyPnL / previousValue) * 100 
      : 0;

    const snapshot: InsertPaperEquitySnapshot = {
      portfolioId,
      date: today,
      totalValue: portfolioValue.totalValue,
      cashBalance: portfolioValue.cashBalance,
      positionsValue: portfolioValue.positionsValue,
      dailyPnL,
      dailyPnLPercent,
    };

    await storage.createPaperEquitySnapshot(snapshot);
    
    await storage.updatePaperPortfolio(portfolioId, {
      totalValue: portfolioValue.totalValue,
      totalPnL: portfolioValue.totalValue - portfolio.startingCapital,
      totalPnLPercent: ((portfolioValue.totalValue - portfolio.startingCapital) / portfolio.startingCapital) * 100,
    });

    logger.info(`Equity snapshot recorded for ${today}`, { 
      portfolioId, 
      totalValue: portfolioValue.totalValue,
      dailyPnL,
    });

    return true;
  } catch (error) {
    logger.error("Error recording equity snapshot", { error, portfolioId });
    return false;
  }
}

export async function getOpenPositions(portfolioId: string): Promise<PaperPosition[]> {
  const positions = await storage.getPaperPositionsByPortfolio(portfolioId);
  return positions.filter(p => p.status === 'open');
}

export async function getClosedPositions(portfolioId: string): Promise<PaperPosition[]> {
  const positions = await storage.getPaperPositionsByPortfolio(portfolioId);
  return positions.filter(p => p.status === 'closed');
}

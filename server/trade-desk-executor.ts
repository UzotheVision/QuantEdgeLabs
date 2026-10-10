/**
 * Trade Desk Executor
 *
 * Listens to Trade Desk signals and auto-executes via Alpaca
 * Uses confluence (Band B = 3+ signals) for high-probability trades
 *
 * This REPLACES the weak auto-idea-generator bot
 */

import { logger } from './logger';
import {
  submitBracketOrder,
  submitOrder,
  getAccount,
  getPositions,
  closePosition,
  isMarketOpen,
  isAlpacaConfigured,
  AlpacaPosition,
  BracketOrderRequest,
} from './alpaca-trading';
import { sendPositionAlert } from './sms-notification-service';
import { storage } from './storage';
import { buildOptionSymbol } from './tradier-api';
import { selfLearning } from './self-learning-service';
import { validateEntryTiming } from './entry-timing-validator';

// ============================================
// USER TRADING RULES (Your $700 account rules)
// ============================================

interface TradingRules {
  accountSize: number;
  maxRiskPerTrade: number;       // $50 max
  maxRiskPercent: number;        // 7% of account
  maxOpenPositions: number;      // Don't overtrade
  minConfidence: number;         // Min confidence score
  minSignals: number;            // Band B = 3+ signals
  preferredTickers: string[];    // Your winners
  avoidTickers: string[];        // Your losers
  minDTE: number;                // Minimum days to expiry
  maxOTMPercent: number;         // Max % out of the money
  stopLossPercent: number;       // -30% stop
  takeProfitPercent: number;     // +50% target
  onlyDuringMarketHours: boolean;
  requireConfluence: boolean;    // Must have 3+ signals
}

const DEFAULT_RULES: TradingRules = {
  accountSize: 3000,             // $3k paper trading size
  maxRiskPerTrade: 200,          // $200 per trade (~7% risk)
  maxRiskPercent: 7,             // 7% risk per trade
  maxOpenPositions: 5,           // Max 5 positions open
  minConfidence: 60,             // LOWERED: Accept C+ and above (60%+) for more trades
  minSignals: 2,                 // LOWERED: 2+ signals (more opportunities)
  preferredTickers: [],          // REMOVED: Trade ANYTHING that qualifies (not just indexes)
  avoidTickers: ['MSTR', 'CVNA', 'SMR', 'HOOD', 'RKLB', 'USAR'],  // Still avoid known losers
  minDTE: 0,                     // 0DTE allowed for scalps
  maxOTMPercent: 15,             // INCREASED: Allow up to 15% OTM for more options
  stopLossPercent: 10,           // RULE 5: -10% auto exit, no "one more candle"
  takeProfitPercent: 50,         // +50-70% you are OUT (use 50 as trigger)
  onlyDuringMarketHours: true,
  requireConfluence: false,      // DISABLED: Don't require 3+ signals - trade on quality
};

// Small account premium targeting: $0.02 - $1.00 MAX for multi-position strategy
const MIN_PREMIUM = 0.02;        // No garbage penny contracts
const MAX_PREMIUM_ALLOWED = 1.00; // HARD CAP: $1.00 max ($100/contract)
const MAX_PREMIUM_SCALP = 0.50;  // Sweet spot for 2-5 contracts
const DAILY_LOSS_LIMIT = 50;     // Brain not tradable after -$50

// TIERED TRADE LIMITS - AGGRESSIVE MODE FOR TESTING
const BASE_TRADES_PER_DAY = 5;   // INCREASED: 5 base trades
const ELITE_BONUS_TRADES = 5;    // INCREASED: A/A+ signals can add 5 more
const HARD_CAP_TRADES = 10;      // INCREASED: 10 max trades (testing PDT limits)

// Track daily stats
let dailyPnL = 0;
let dailyTradeCount = 0;
let lastResetDate = '';

let tradingRules = { ...DEFAULT_RULES };

// ============================================
// TRADE DESK SIGNAL INTERFACE
// ============================================

interface TradeDeskSignal {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  assetType: 'stock' | 'option';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  confidenceScore: number;
  probabilityBand: string;      // A, B+, B, C+, C
  qualitySignals: string[];     // The signals that triggered this
  source: string;
  catalyst: string;
  timestamp: Date;
  // Option-specific fields
  optionType?: 'call' | 'put';
  strikePrice?: number;
  expiryDate?: string;          // YYYY-MM-DD format
}

// ============================================
// EXECUTION STATE
// ============================================

interface ExecutedTrade {
  signalId: string;
  symbol: string;
  orderId: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  executedAt: Date;
  status: 'open' | 'closed' | 'stopped' | 'target_hit';
}

const executedTrades: Map<string, ExecutedTrade> = new Map();
let isExecutorRunning = false;
let executorInterval: NodeJS.Timeout | null = null;

// ============================================
// TICKER PERFORMANCE HISTORY
// ============================================

/**
 * Check if we should avoid this ticker based on past performance
 * Prevents re-entering tickers we've consistently lost on (like BITF -83% 3x)
 */
async function getTickerPerformance(ticker: string): Promise<{
  shouldAvoid: boolean;
  reason: string;
}> {
  try {
    // Get all completed trades for this ticker
    const allTrades = await storage.getAllTradeIdeas();
    const tickerTrades = allTrades.filter(
      (t: any) => t.symbol === ticker &&
      t.outcomeStatus &&
      ['hit_target', 'hit_stop', 'expired', 'manual_exit'].includes(t.outcomeStatus)
    );

    if (tickerTrades.length === 0) {
      return { shouldAvoid: false, reason: 'No history' };
    }

    // Count wins and losses
    const wins = tickerTrades.filter((t: any) => t.outcomeStatus === 'hit_target').length;
    const losses = tickerTrades.filter((t: any) =>
      t.outcomeStatus === 'hit_stop' ||
      (t.outcomeStatus !== 'hit_target' && t.percentGain !== null && t.percentGain < 0)
    ).length;

    const totalDecisive = wins + losses;
    const winRate = totalDecisive > 0 ? (wins / totalDecisive) * 100 : 0;

    // Check for catastrophic losses (>70% loss)
    const catastrophicLosses = tickerTrades.filter((t: any) =>
      t.percentGain !== null && t.percentGain < -70
    );

    if (catastrophicLosses.length > 0) {
      const worstLoss = Math.min(...catastrophicLosses.map((t: any) => t.percentGain));
      return {
        shouldAvoid: true,
        reason: `Lost ${worstLoss.toFixed(0)}% on ${ticker} before - avoid ticker entirely`
      };
    }

    // Check recent consecutive losses (last 2-3 trades)
    const recentTrades = tickerTrades.slice(-3);
    const recentLosses = recentTrades.filter((t: any) =>
      t.outcomeStatus === 'hit_stop' ||
      (t.outcomeStatus !== 'hit_target' && t.percentGain !== null && t.percentGain < 0)
    );

    if (recentLosses.length >= 2 && recentTrades.length >= 2) {
      const avgRecentLoss = recentLosses.reduce((sum: number, t: any) => sum + (t.percentGain || 0), 0) / recentLosses.length;
      return {
        shouldAvoid: true,
        reason: `Lost ${recentLosses.length} consecutive times on ${ticker} (avg ${avgRecentLoss.toFixed(1)}%) - cooling off`
      };
    }

    // Check overall poor win rate (if we have enough history)
    if (totalDecisive >= 5 && winRate < 30) {
      return {
        shouldAvoid: true,
        reason: `${ticker} win rate only ${winRate.toFixed(0)}% (${wins}W/${losses}L) - unreliable ticker`
      };
    }

    // Ticker is okay to trade
    return { shouldAvoid: false, reason: `${ticker} history acceptable (${wins}W/${losses}L)` };

  } catch (error) {
    logger.error('[TICKER-HISTORY] Error checking ticker performance:', error);
    return { shouldAvoid: false, reason: 'Error checking history' };
  }
}

// ============================================
// SIGNAL VALIDATION
// ============================================

async function validateSignalForExecution(signal: TradeDeskSignal): Promise<{
  valid: boolean;
  reason?: string;
}> {
  // AGGRESSIVE MODE: Trade any ticker UNLESS on avoid list (preferred tickers disabled if empty)
  if (tradingRules.preferredTickers.length > 0 && !tradingRules.preferredTickers.includes(signal.symbol)) {
    return { valid: false, reason: `${signal.symbol} not in focus list` };
  }

  // Avoid problem tickers
  if (tradingRules.avoidTickers.includes(signal.symbol)) {
    return { valid: false, reason: `${signal.symbol} is on avoid list` };
  }

  // Check confidence (LOWERED to 60%+ for aggressive mode)
  if (signal.confidenceScore < tradingRules.minConfidence) {
    return { valid: false, reason: `Confidence ${signal.confidenceScore} below ${tradingRules.minConfidence}` };
  }

  // Check confluence (optional in aggressive mode)
  if (tradingRules.requireConfluence && signal.qualitySignals.length < tradingRules.minSignals) {
    return { valid: false, reason: `Only ${signal.qualitySignals.length} signals, need ${tradingRules.minSignals}+` };
  }

  // Check probability band (EXPANDED to include C+)
  const goodBands = ['A', 'A+', 'A-', 'B+', 'B', 'B-', 'C+'];
  if (!goodBands.includes(signal.probabilityBand)) {
    return { valid: false, reason: `Band ${signal.probabilityBand} not in approved bands` };
  }

  // CRITICAL: Check entry timing - don't chase moves that already happened.
  // NOTE: `changePercent` is the underlying's day move and `premium` the contract
  // cost — TradeDeskSignal carries neither, so both are passed as 0 and the
  // chase/expensive-premium checks are inert. Wiring a live quote in here is the
  // next step; until then only the predictive-signal check does real work.
  const timingCheck = validateEntryTiming(
    signal.symbol,
    signal.optionType ?? (signal.direction === 'long' ? 'call' : 'put'),
    0,
    signal.qualitySignals,
    0
  );

  if (!timingCheck.allowed) {
    return { valid: false, reason: `Entry timing: ${timingCheck.reason}` };
  }

  // CRITICAL: Check ML learned patterns - don't repeat past mistakes
  const mlCheck = selfLearning.shouldTakeTrade({
    symbol: signal.symbol,
    confidenceScore: signal.confidenceScore,
    source: 'trade_desk', // All signals from Trade Desk
    // `direction` is already 'long' | 'short'. Comparing it to 'bullish' was always
    // false, so every signal reached the ML filter labelled short.
    direction: signal.direction,
  });

  if (!mlCheck.take) {
    return { valid: false, reason: `ML filter: ${mlCheck.reason}` };
  }

  // CRITICAL: Check ticker-specific history - avoid repeated losses on same ticker
  const tickerHistory = await getTickerPerformance(signal.symbol);
  if (tickerHistory.shouldAvoid) {
    return { valid: false, reason: `Ticker history: ${tickerHistory.reason}` };
  }

  return { valid: true };
}

// ============================================
// EXECUTE TRADE
// ============================================

async function executeSignal(signal: TradeDeskSignal): Promise<boolean> {
  // Validate
  const validation = await validateSignalForExecution(signal);
  if (!validation.valid) {
    logger.info(`[EXECUTOR] Skipping ${signal.symbol}: ${validation.reason}`);
    return false;
  }

  // Check if already executed
  if (executedTrades.has(signal.id)) {
    logger.info(`[EXECUTOR] Signal ${signal.id} already executed`);
    return false;
  }

  // Check max positions
  const positions = await getPositions();
  if (positions.length >= tradingRules.maxOpenPositions) {
    logger.info(`[EXECUTOR] Max positions (${tradingRules.maxOpenPositions}) reached`);
    return false;
  }

  const isLong = signal.direction === 'long';
  const isOption = signal.assetType === 'option';

  // Build the trading symbol
  let tradingSymbol = signal.symbol;
  if (isOption && signal.optionType && signal.strikePrice && signal.expiryDate) {
    // Build OCC option symbol for Alpaca
    tradingSymbol = buildOptionSymbol(
      signal.symbol,
      signal.expiryDate,
      signal.optionType,
      signal.strikePrice
    );
    logger.info(`[EXECUTOR] 📝 Built OCC symbol: ${tradingSymbol}`);
  }

  // Check if already in this symbol
  if (positions.some(p => p.symbol === tradingSymbol || p.symbol === signal.symbol)) {
    logger.info(`[EXECUTOR] Already have position in ${tradingSymbol}`);
    return false;
  }

  // Reset daily counters if new day
  const todayStr = new Date().toISOString().split('T')[0];
  if (lastResetDate !== todayStr) {
    dailyPnL = 0;
    dailyTradeCount = 0;
    lastResetDate = todayStr;
    logger.info(`[EXECUTOR] 📅 New trading day - counters reset`);
  }

  // Check daily loss limit (-$30 brain not tradable)
  if (dailyPnL <= -DAILY_LOSS_LIMIT) {
    logger.warn(`[EXECUTOR] 🧠 DAILY LOSS LIMIT: Down $${Math.abs(dailyPnL).toFixed(2)} - no more trades today`);
    return false;
  }

  // TIERED TRADE LIMITS: Be strategic, not restrictive
  // Normal signals: 3 trades max
  // A/A+ signals with 4+ quality signals: can take up to 5 trades
  const isEliteSignal = ['A', 'A+', 'A-'].includes(signal.probabilityBand) && signal.qualitySignals.length >= 4;
  const currentLimit = isEliteSignal ? HARD_CAP_TRADES : BASE_TRADES_PER_DAY;

  if (dailyTradeCount >= currentLimit) {
    if (isEliteSignal) {
      logger.info(`[EXECUTOR] 📊 HARD CAP: Already ${dailyTradeCount} trades today (including elite trades) - done for the day`);
    } else if (dailyTradeCount >= BASE_TRADES_PER_DAY && dailyTradeCount < HARD_CAP_TRADES) {
      logger.info(`[EXECUTOR] 📊 BASE LIMIT: Already ${dailyTradeCount} trades today - only A/A+ elite signals can exceed (${HARD_CAP_TRADES - dailyTradeCount} slots for elite)`);
    } else {
      logger.info(`[EXECUTOR] 📊 MAX TRADES: Already ${dailyTradeCount} trades today - done for the day`);
    }
    return false;
  }

  // Log if this is an elite signal that exceeds base limit
  if (dailyTradeCount >= BASE_TRADES_PER_DAY && isEliteSignal) {
    logger.info(`[EXECUTOR] ⭐ ELITE SIGNAL: ${signal.symbol} (${signal.probabilityBand}, ${signal.qualitySignals.length} signals) - using bonus slot ${dailyTradeCount + 1}/${HARD_CAP_TRADES}`);
  }

  // Calculate position size based on premium tier
  let quantity: number;
  if (isOption) {
    const premium = signal.entryPrice;
    const costPerContract = premium * 100;

    // RULE: No garbage penny contracts under $0.02
    if (premium < MIN_PREMIUM) {
      logger.info(`[EXECUTOR] ❌ Premium $${premium} too cheap (min $${MIN_PREMIUM}) - lottery ticket`);
      return false;
    }

    // RULE: No expensive options over $1.00 (keeps buying power for multiple positions)
    if (premium > MAX_PREMIUM_ALLOWED) {
      logger.info(`[EXECUTOR] ❌ Premium $${premium} too expensive (max $${MAX_PREMIUM_ALLOWED}) - need cheap options for multiple trades`);
      return false;
    }

    // SMALL ACCOUNT SIZING:
    // $0.02 - $0.10: 5-10 contracts (scalp mode)
    // $0.10 - $0.50: 2-5 contracts (sweet spot)
    // $0.50 - $1.50: 1-2 contracts (standard)
    // $1.50+: 1 contract only
    if (premium <= 0.10) {
      // Cheap scalp: 5-10 contracts
      const maxContracts = Math.floor(tradingRules.maxRiskPerTrade / costPerContract);
      quantity = Math.max(5, Math.min(maxContracts, 10));
    } else if (premium <= MAX_PREMIUM_SCALP) {
      // Sweet spot: 2-5 contracts
      const maxContracts = Math.floor(tradingRules.maxRiskPerTrade / costPerContract);
      quantity = Math.max(2, Math.min(maxContracts, 5));
    } else if (premium <= 1.50) {
      // Standard: 1-2 contracts
      const maxContracts = Math.floor(tradingRules.maxRiskPerTrade / costPerContract);
      quantity = Math.max(1, Math.min(maxContracts, 2));
    } else {
      // Expensive: 1 contract only
      quantity = 1;
    }

    // Final check: can we afford it?
    if (costPerContract * quantity > tradingRules.maxRiskPerTrade * 1.5) {
      // Allow slight overage but not too much
      quantity = Math.max(1, Math.floor(tradingRules.maxRiskPerTrade / costPerContract));
    }

    logger.info(`[EXECUTOR] 💰 Premium: $${premium} -> ${quantity} contracts ($${(costPerContract * quantity).toFixed(2)} total)`);
  } else {
    const riskPerShare = Math.abs(signal.entryPrice - signal.stopLoss);
    quantity = Math.floor(tradingRules.maxRiskPerTrade / riskPerShare);
  }

  if (quantity < 1) {
    logger.info(`[EXECUTOR] Position size too small for ${signal.symbol}`);
    return false;
  }

  // For options, submit a simple market order (bracket orders don't work well with options on Alpaca)
  if (isOption) {
    logger.info(`[EXECUTOR] 🚀 Executing OPTION ${tradingSymbol}:`);
    logger.info(`[EXECUTOR]    Underlying: ${signal.symbol}`);
    logger.info(`[EXECUTOR]    Type: ${signal.optionType?.toUpperCase()} @ $${signal.strikePrice} exp ${signal.expiryDate}`);
    logger.info(`[EXECUTOR]    Direction: BUY (CASH ACCOUNT - always buy options)`);
    logger.info(`[EXECUTOR]    Signal intent: ${isLong ? 'BULLISH (buy call)' : 'BEARISH (buy put)'}`);
    logger.info(`[EXECUTOR]    Quantity: ${quantity} contract(s)`);
    logger.info(`[EXECUTOR]    Premium: $${signal.entryPrice}`);
    logger.info(`[EXECUTOR]    Confidence: ${signal.confidenceScore}% | Band: ${signal.probabilityBand}`);
    logger.info(`[EXECUTOR]    Signals: ${signal.qualitySignals.join(', ')}`);

    // CRITICAL: Small cash accounts MUST buy options, never sell (selling requires huge margin)
    const order = await submitOrder({
      symbol: tradingSymbol,
      qty: quantity,
      side: 'buy',  // ALWAYS BUY for cash accounts ($300 can't sell options)
      type: 'market', // Market order for options
      time_in_force: 'day',
    });

    if (order) {
      executedTrades.set(signal.id, {
        signalId: signal.id,
        symbol: tradingSymbol,
        orderId: order.id,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.targetPrice,
        quantity,
        executedAt: new Date(),
        status: 'open',
      });

      await sendPositionAlert({
        type: 'profit_target',
        symbol: tradingSymbol,
        underlying: signal.symbol,
        plPercent: 0,
        currentPrice: signal.entryPrice,
        avgCost: signal.entryPrice,
        quantity,
        message: `🟢 OPENED: ${quantity}x ${signal.symbol} ${signal.optionType?.toUpperCase()} $${signal.strikePrice} @ $${signal.entryPrice}\nSignal Strength: ${signal.confidenceScore}pts | Signals: ${signal.qualitySignals.length}`,
      });

      dailyTradeCount++;
      logger.info(`[EXECUTOR] ✅ Option order submitted: ${order.id} | Trade #${dailyTradeCount} today`);
      return true;
    } else {
      logger.error(`[EXECUTOR] ❌ Failed to submit option order for ${tradingSymbol}`);
      return false;
    }
  }

  // For stocks, use bracket order
  const stopLossPrice = isLong
    ? signal.entryPrice * (1 - tradingRules.stopLossPercent / 100)
    : signal.entryPrice * (1 + tradingRules.stopLossPercent / 100);

  const takeProfitPrice = isLong
    ? signal.entryPrice * (1 + tradingRules.takeProfitPercent / 100)
    : signal.entryPrice * (1 - tradingRules.takeProfitPercent / 100);

  const bracketRequest: BracketOrderRequest = {
    symbol: signal.symbol,
    qty: quantity,
    side: isLong ? 'buy' : 'sell',
    entryType: 'limit',
    entryPrice: signal.entryPrice,
    stopLoss: Math.round(stopLossPrice * 100) / 100,
    takeProfit: Math.round(takeProfitPrice * 100) / 100,
    timeInForce: 'day',
  };

  logger.info(`[EXECUTOR] 🚀 Executing STOCK ${signal.symbol}:`);
  logger.info(`[EXECUTOR]    Direction: ${signal.direction.toUpperCase()}`);
  logger.info(`[EXECUTOR]    Quantity: ${quantity} shares`);
  logger.info(`[EXECUTOR]    Entry: $${signal.entryPrice}`);
  logger.info(`[EXECUTOR]    Stop: $${bracketRequest.stopLoss} (-${tradingRules.stopLossPercent}%)`);
  logger.info(`[EXECUTOR]    Target: $${bracketRequest.takeProfit} (+${tradingRules.takeProfitPercent}%)`);
  logger.info(`[EXECUTOR]    Signals: ${signal.qualitySignals.join(', ')}`);

  const order = await submitBracketOrder(bracketRequest);

  if (order) {
    executedTrades.set(signal.id, {
      signalId: signal.id,
      symbol: signal.symbol,
      orderId: order.id,
      entryPrice: signal.entryPrice,
      stopLoss: bracketRequest.stopLoss,
      takeProfit: bracketRequest.takeProfit,
      quantity,
      executedAt: new Date(),
      status: 'open',
    });

    await sendPositionAlert({
      type: 'profit_target',
      symbol: signal.symbol,
      underlying: signal.symbol,
      plPercent: 0,
      currentPrice: signal.entryPrice,
      avgCost: signal.entryPrice,
      quantity,
      message: `🟢 OPENED: ${quantity} ${signal.symbol} @ $${signal.entryPrice}\nStop: $${bracketRequest.stopLoss} | Target: $${bracketRequest.takeProfit}\nSignals: ${signal.qualitySignals.length}`,
    });

    logger.info(`[EXECUTOR] ✅ Order submitted: ${order.id}`);
    return true;
  } else {
    logger.error(`[EXECUTOR] ❌ Failed to submit order for ${signal.symbol}`);
    return false;
  }
}

// ============================================
// MONITOR POSITIONS
// ============================================

async function monitorPositions(): Promise<void> {
  const positions = await getPositions();

  for (const position of positions) {
    const pl = parseFloat(position.unrealized_pl);
    const plPercent = parseFloat(position.unrealized_plpc) * 100;
    const currentPrice = parseFloat(position.current_price);
    const avgCost = parseFloat(position.avg_entry_price);
    const qty = parseInt(position.qty);

    // RULE 5: STOP LOSS = -10% Auto-exit. No "one more candle."
    if (plPercent <= -tradingRules.stopLossPercent) {
      logger.warn(`[EXECUTOR] 🔴 STOP -10%: ${position.symbol} at ${plPercent.toFixed(1)}% - AUTO EXIT`);

      const closeOrder = await closePosition(position.symbol);
      if (closeOrder) {
        dailyPnL += pl;
        logger.info(`[EXECUTOR] ✅ Stop hit: ${position.symbol} | Daily P&L: $${dailyPnL.toFixed(2)}`);
      }

      await sendPositionAlert({
        type: 'stop_loss',
        symbol: position.symbol,
        underlying: position.symbol,
        plPercent,
        currentPrice,
        avgCost,
        quantity: qty,
        message: `🔴 STOP -10%: ${position.symbol}\nP&L: ${plPercent.toFixed(1)}% ($${pl.toFixed(2)})\nNo "one more candle" 🛑`,
      });
      continue;
    }

    // RULE 4: +50-70% → You are OUT
    if (plPercent >= tradingRules.takeProfitPercent) {
      logger.info(`[EXECUTOR] 🎯 YOU ARE OUT: ${position.symbol} at +${plPercent.toFixed(1)}% - TAKING THE BAG`);

      const closeOrder = await closePosition(position.symbol);
      if (closeOrder) {
        dailyPnL += pl;
        logger.info(`[EXECUTOR] ✅ Big win locked: ${position.symbol} | Daily P&L: $${dailyPnL.toFixed(2)}`);
      }

      await sendPositionAlert({
        type: 'profit_target',
        symbol: position.symbol,
        underlying: position.symbol,
        plPercent,
        currentPrice,
        avgCost,
        quantity: qty,
        message: `🎯 YOU ARE OUT: ${position.symbol}\n+${plPercent.toFixed(1)}% (+$${pl.toFixed(2)})\nBag secured 💰`,
      });
      continue;
    }

    // ============================================
    // YOUR PROFIT RULES - Stack boring wins
    // ============================================

    // RULE 4: +25-40% → Sell (full for small account)
    // Your job is not to catch 300% everyday. Your job is to stack boring wins.
    if (plPercent >= 25 && plPercent < 50) {
      logger.info(`[EXECUTOR] 💰 PROFIT RULE: ${position.symbol} up ${plPercent.toFixed(1)}% - TAKING PROFIT (25-40% zone)`);

      const closeOrder = await closePosition(position.symbol);
      if (closeOrder) {
        dailyPnL += pl;
        logger.info(`[EXECUTOR] ✅ Profit taken: ${position.symbol} | Daily P&L now: $${dailyPnL.toFixed(2)}`);
      }

      await sendPositionAlert({
        type: 'profit_target',
        symbol: position.symbol,
        underlying: position.symbol,
        plPercent,
        currentPrice,
        avgCost,
        quantity: qty,
        message: `💰 PROFIT TAKEN: ${position.symbol}\n+${plPercent.toFixed(1)}% (+$${pl.toFixed(2)})\nBoring wins stack up 📈`,
      });
      continue;
    }

    // TIME DECAY EXIT: For 0DTE options, close by 3pm ET to avoid theta crush
    const isOption = position.symbol.length > 10; // OCC symbols are long
    if (isOption) {
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hourET = nowET.getHours();
      const minuteET = nowET.getMinutes();

      // Check if this is a 0DTE (expires today)
      const symbolDate = position.symbol.slice(-15, -9); // Extract YYMMDD from OCC
      const todayDateStr = `${String(nowET.getFullYear()).slice(-2)}${String(nowET.getMonth() + 1).padStart(2, '0')}${String(nowET.getDate()).padStart(2, '0')}`;
      const is0DTE = symbolDate === todayDateStr;

      // Close 0DTE positions after 3pm ET (or 2:30pm if losing)
      if (is0DTE) {
        const shouldCloseTime = (hourET >= 15) || (hourET === 14 && minuteET >= 30 && plPercent < 0);
        if (shouldCloseTime) {
          logger.info(`[EXECUTOR] ⏰ 0DTE TIME EXIT: ${position.symbol} - closing before expiry (${hourET}:${minuteET} ET)`);

          const closeOrder = await closePosition(position.symbol);
          if (closeOrder) {
            dailyPnL += pl;
            logger.info(`[EXECUTOR] ✅ 0DTE closed: ${position.symbol} | Daily P&L: $${dailyPnL.toFixed(2)}`);
          }

          await sendPositionAlert({
            type: plPercent >= 0 ? 'profit_target' : 'stop_loss',
            symbol: position.symbol,
            underlying: position.symbol,
            plPercent,
            currentPrice,
            avgCost,
            quantity: qty,
            message: `⏰ 0DTE EXIT: ${position.symbol}\nP&L: ${plPercent >= 0 ? '+' : ''}${plPercent.toFixed(1)}% ($${pl.toFixed(2)})`,
          });
          continue;
        }
      }
    }

    // Check for bag hold warning
    if (plPercent <= -50) {
      await sendPositionAlert({
        type: 'bag_hold',
        symbol: position.symbol,
        underlying: position.symbol,
        plPercent,
        currentPrice,
        avgCost,
        quantity: qty,
        message: `⚠️ BAG HOLD WARNING: ${position.symbol}\nDown ${plPercent.toFixed(1)}%!\nConsider cutting losses.`,
      });
    }
  }
}

// ============================================
// SCAN TRADE DESK FOR SIGNALS
// ============================================

async function scanForExecutableSignals(): Promise<TradeDeskSignal[]> {
  try {
    // Get recent trade ideas from Trade Desk
    const allIdeas = await storage.getAllTradeIdeas();
    const now = new Date();

    // Use ET timezone for "today" calculation to match Trade Desk filtering
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStrET = `${nowET.getFullYear()}-${String(nowET.getMonth() + 1).padStart(2, '0')}-${String(nowET.getDate()).padStart(2, '0')}`;

    // Filter for today's high-quality signals (not just last 5 minutes!)
    const executableSignals: TradeDeskSignal[] = allIdeas
      .filter((idea: any) => {
        // Only TODAY's ideas (in ET timezone) - much more useful than 5-minute window
        const ideaTime = new Date(idea.timestamp);
        const ideaDateStrET = ideaTime.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        if (ideaDateStrET !== todayStrET) {
          return false;
        }

        // Only open ideas (not already closed/exited)
        if (idea.outcomeStatus && idea.outcomeStatus !== 'open') return false;

        // Only trade OPTIONS (not stocks) - options are the main trading vehicle
        if (idea.assetType !== 'option') return false;

        // Options must have all required fields
        if (!idea.optionType || !idea.strikePrice || !idea.expiryDate) {
          logger.debug(`[EXECUTOR] Skipping ${idea.symbol}: missing option fields (type=${idea.optionType}, strike=${idea.strikePrice}, expiry=${idea.expiryDate})`);
          return false;
        }

        // Must have confidence score
        if (!idea.confidenceScore) return false;

        return true;
      })
      .map((idea: any) => ({
        id: idea.id,
        symbol: idea.symbol,
        direction: idea.direction as 'long' | 'short',
        assetType: idea.assetType as 'stock' | 'option',
        entryPrice: idea.entryPrice,
        targetPrice: idea.targetPrice,
        stopLoss: idea.stopLoss,
        confidenceScore: idea.confidenceScore,
        probabilityBand: idea.probabilityBand || 'C',
        qualitySignals: idea.qualitySignals || [],
        source: idea.source,
        catalyst: idea.catalyst,
        timestamp: new Date(idea.timestamp),
        // Option fields
        optionType: idea.optionType as 'call' | 'put' | undefined,
        strikePrice: idea.strikePrice,
        expiryDate: idea.expiryDate,
      }));

    // Log summary of today's signals
    if (executableSignals.length > 0) {
      logger.info(`[EXECUTOR] 📋 Today's signals: ${executableSignals.map(s => `${s.symbol}(${s.confidenceScore}%,${s.qualitySignals.length} sigs)`).join(', ')}`);
    } else {
      // Debug: show why we have no signals
      const todayCount = allIdeas.filter((i: any) => {
        const ideaTime = new Date(i.timestamp);
        const ideaDateStrET = ideaTime.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        return ideaDateStrET === todayStrET;
      }).length;
      logger.info(`[EXECUTOR] 📭 No executable signals. Total ideas: ${allIdeas.length}, Today's ideas: ${todayCount}`);
    }

    return executableSignals;
  } catch (error) {
    logger.error('[EXECUTOR] Error scanning for signals:', error);
    return [];
  }
}

// ============================================
// MAIN EXECUTOR LOOP
// ============================================

async function executorLoop(): Promise<void> {
  if (!isAlpacaConfigured()) {
    logger.warn('[EXECUTOR] Alpaca not configured, skipping');
    return;
  }

  // Check market hours
  if (tradingRules.onlyDuringMarketHours) {
    const marketOpen = await isMarketOpen();
    if (!marketOpen) {
      // Only log this occasionally to avoid spam
      const now = new Date();
      if (now.getMinutes() === 0) {
        logger.info('[EXECUTOR] Market closed, skipping execution (checked hourly)');
      }
      return;
    }
  }

  // Check account
  const account = await getAccount();
  if (!account) {
    logger.error('[EXECUTOR] Cannot access Alpaca account');
    return;
  }

  const buyingPower = parseFloat(account.buying_power);
  logger.info(`[EXECUTOR] 💰 Account buying power: $${buyingPower.toFixed(2)}`);

  if (buyingPower < tradingRules.maxRiskPerTrade) {
    logger.warn(`[EXECUTOR] Insufficient buying power: $${buyingPower.toFixed(2)} < $${tradingRules.maxRiskPerTrade}`);
    return;
  }

  // Monitor existing positions
  const positions = await getPositions();
  logger.info(`[EXECUTOR] 📊 Current positions: ${positions.length}/${tradingRules.maxOpenPositions}`);
  await monitorPositions();

  // Scan for new signals
  const signals = await scanForExecutableSignals();
  logger.info(`[EXECUTOR] 🔍 Found ${signals.length} executable signals for today`);

  // Execute valid signals with detailed logging
  let validCount = 0;
  let skippedCount = 0;
  const skipReasons: Record<string, number> = {};

  for (const signal of signals) {
    // validateSignalForExecution is async. Reading .valid off the un-awaited promise
    // gave undefined, so every signal fell into the skip branch as "unknown".
    const validation = await validateSignalForExecution(signal);
    if (validation.valid) {
      validCount++;
      await executeSignal(signal);
    } else {
      skippedCount++;
      const reason = validation.reason || 'unknown';
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      logger.debug(`[EXECUTOR] ⏭️ Skipped ${signal.symbol}: ${reason}`);
    }
  }

  if (signals.length > 0) {
    logger.info(`[EXECUTOR] 📈 Execution summary: ${validCount} valid, ${skippedCount} skipped`);
    if (Object.keys(skipReasons).length > 0) {
      logger.info(`[EXECUTOR] 📊 Skip reasons: ${Object.entries(skipReasons).map(([r, c]) => `${r}(${c})`).join(', ')}`);
    }
  }
}

// ============================================
// START/STOP EXECUTOR
// ============================================

export async function startTradeExecutor(): Promise<boolean> {
  if (isExecutorRunning) {
    logger.warn('[EXECUTOR] Already running');
    return false;
  }

  if (!isAlpacaConfigured()) {
    logger.error('[EXECUTOR] Cannot start - Alpaca not configured');
    return false;
  }

  logger.info('[EXECUTOR] 🤖 Starting Trade Desk Executor...');
  logger.info(`[EXECUTOR]    Max Risk/Trade: $${tradingRules.maxRiskPerTrade}`);
  logger.info(`[EXECUTOR]    Max Positions: ${tradingRules.maxOpenPositions}`);
  logger.info(`[EXECUTOR]    Min Confidence: ${tradingRules.minConfidence}%`);
  logger.info(`[EXECUTOR]    Require Confluence: ${tradingRules.requireConfluence} (${tradingRules.minSignals}+ signals)`);
  logger.info(`[EXECUTOR]    Stop Loss: -${tradingRules.stopLossPercent}%`);
  logger.info(`[EXECUTOR]    Take Profit: +${tradingRules.takeProfitPercent}%`);

  isExecutorRunning = true;

  // Run immediately
  await executorLoop();

  // Then run every 30 seconds (wrap in try-catch to prevent silent failures)
  executorInterval = setInterval(async () => {
    try {
      await executorLoop();
    } catch (error) {
      logger.error(`[EXECUTOR] Loop error: ${error}`);
    }
  }, 30 * 1000);

  logger.info('[EXECUTOR] ✅ Trade Desk Executor started (checking every 30s)');
  return true;
}

export function stopTradeExecutor(): void {
  if (executorInterval) {
    clearInterval(executorInterval);
    executorInterval = null;
  }
  isExecutorRunning = false;
  logger.info('[EXECUTOR] 🛑 Trade Desk Executor stopped');
}

export function isExecutorActive(): boolean {
  return isExecutorRunning;
}

// ============================================
// CONFIGURATION
// ============================================

export function getExecutorRules(): TradingRules {
  return { ...tradingRules };
}

export function updateExecutorRules(updates: Partial<TradingRules>): TradingRules {
  tradingRules = { ...tradingRules, ...updates };
  logger.info('[EXECUTOR] Rules updated:', tradingRules);
  return tradingRules;
}

export function getExecutedTrades(): ExecutedTrade[] {
  return Array.from(executedTrades.values());
}

// ============================================
// MANUAL EXECUTION (for testing)
// ============================================

export async function manualExecute(signalId: string): Promise<boolean> {
  const allIdeas = await storage.getAllTradeIdeas();
  const idea = allIdeas.find((i: any) => i.id === signalId);

  if (!idea) {
    logger.error(`[EXECUTOR] Signal ${signalId} not found`);
    return false;
  }

  const signal: TradeDeskSignal = {
    id: idea.id,
    symbol: idea.symbol,
    direction: idea.direction as 'long' | 'short',
    assetType: idea.assetType as 'stock' | 'option',
    entryPrice: idea.entryPrice,
    targetPrice: idea.targetPrice,
    stopLoss: idea.stopLoss,
    confidenceScore: idea.confidenceScore || 50,
    probabilityBand: idea.probabilityBand || 'C',
    qualitySignals: idea.qualitySignals || [],
    source: idea.source,
    catalyst: idea.catalyst,
    timestamp: new Date(idea.timestamp),
  };

  return executeSignal(signal);
}

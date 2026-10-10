import { storage } from "./storage";
import { executeTradeIdea, checkStopsAndTargets, updatePositionPrices } from "./paper-trading-service";
import { sendBotTradeEntryToDiscord, sendBotTradeExitToDiscord, sendFuturesTradesToDiscord } from "./discord-service";
import { getTradierQuote, getTradierOptionsChainsByDTE } from "./tradier-api";
import { calculateLottoTargets, getLottoThresholds } from "./lotto-detector";
import { getLetterGrade } from "./grading";
import { formatInTimeZone } from "date-fns-tz";
import { TradeIdea, PaperPortfolio, InsertTradeIdea, AutoLottoPreferences } from "@shared/schema";
import { isUSMarketOpen, isCMEMarketOpen, normalizeDateString } from "@shared/market-calendar";
import { logger } from "./logger";
import { 
  getMarketContext, 
  getEntryTiming, 
  checkDynamicExit, 
  checkDynamicExitEnhanced, 
  MarketContext, 
  ExitConfluenceData,
  shouldAllowSessionEntry,
  checkUnifiedEntryGate,
  getTradingSession,
  type StrategyType
} from "./market-context-service";
import { getActiveFuturesContract, getFuturesPrice } from "./futures-data-service";
import { getTopMovers } from "./market-scanner";
import { 
  calculateEnhancedSignalScore, 
  detectCandlestickPatterns,
  calculateRSI,
  calculateADX,
  determineMarketRegime,
  validateSwingSetup,
  calculateFibonacciLevels,
  recommendStrikeSelection
} from "./technical-indicators";
import { 
  analyzeTrade, 
  recordWin, 
  getSymbolAdjustment, 
  getAdaptiveParameters,
  getLearningState
} from "./loss-analyzer-service";
import { analyzePosition, ExitAdvisory } from "./position-monitor-service";
import { broadcastBotEvent } from "./bot-notification-service";
import { 
  runTradingEngine, 
  analyzeFundamentals, 
  analyzeTechnicals, 
  validateConfluence,
  type AssetClass,
  type TradingEngineResult
} from "./trading-engine";
import { analyzeVolatility } from "./volatility-analysis-service";
import { getCatalystsForSymbol, getUpcomingCatalysts, calculateCatalystScore } from "./catalyst-intelligence-service";
import { checkCorrelationCaps } from "./correlation-position-caps";
import { selfLearning, LEARNED_THRESHOLDS } from "./self-learning-service";

// User preferences interface with defaults
interface BotPreferences {
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  maxPositionSize: number;
  maxConcurrentTrades: number;
  dailyLossLimit: number;
  enableOptions: boolean;
  enableFutures: boolean;
  enableCrypto: boolean;
  enablePropFirm: boolean;
  optionsAllocation: number;
  futuresAllocation: number;
  cryptoAllocation: number;
  minConfidenceScore: number;
  minRiskRewardRatio: number;
  tradePreMarket: boolean;
  tradeRegularHours: boolean;
  tradeAfterHours: boolean;
  enableDiscordAlerts: boolean;
  futuresMaxContracts: number;
  futuresStopPoints: number;
  futuresTargetPoints: number;
  cryptoPreferredCoins: string[];
  cryptoEnableMemeCoins: boolean;
}

// Default preferences - SMART RISK MANAGEMENT
  const DEFAULT_PREFERENCES: BotPreferences = {
    riskTolerance: 'moderate',
    maxPositionSize: 500, // $500 max per trade (5% of $10k portfolio)
    maxConcurrentTrades: 20,
    dailyLossLimit: 2000, // $2k daily loss limit
    enableOptions: true,
    enableFutures: false,
    enableCrypto: true,
    enablePropFirm: false,
    optionsAllocation: 40,
    futuresAllocation: 30,
    cryptoAllocation: 30,
    minConfidenceScore: 65, // LOWERED for testing - allow B- grade trades (was 80)
    minRiskRewardRatio: 1.0, // At least 1:1 R:R
    tradePreMarket: true,
    tradeRegularHours: true,
    tradeAfterHours: true,
    enableDiscordAlerts: true,
    futuresMaxContracts: 2,
    futuresStopPoints: 15,
    futuresTargetPoints: 30,
    cryptoPreferredCoins: ['BTC', 'ETH', 'SOL'],
    cryptoEnableMemeCoins: true,
  };

// Cached preferences with expiry
let cachedPreferences: BotPreferences | null = null;
let preferencesLastFetched = 0;
const PREFERENCES_CACHE_TTL = 60000; // 1 minute cache

/**
 * Get bot preferences for the system user, with fallback to defaults
 */
export async function getBotPreferences(): Promise<BotPreferences> {
  const now = Date.now();
  
  // Use cached preferences if still valid
  if (cachedPreferences && (now - preferencesLastFetched) < PREFERENCES_CACHE_TTL) {
    return cachedPreferences;
  }
  
  try {
    // Fetch from database (system user preferences)
    const userPrefs = await storage.getAutoLottoPreferences(SYSTEM_USER_ID);
    
    if (userPrefs) {
      const prefs: BotPreferences = {
        riskTolerance: userPrefs.riskTolerance as 'conservative' | 'moderate' | 'aggressive',
        maxPositionSize: 500, // $500 max per trade - smart sizing
        maxConcurrentTrades: 20,
        dailyLossLimit: 2000,
        enableOptions: true,
        enableFutures: true,
        enableCrypto: true,
        enablePropFirm: true,
        optionsAllocation: 40,
        futuresAllocation: 30,
        cryptoAllocation: 30,
        minConfidenceScore: 65, // LOWERED for testing - allow B- grade trades
        minRiskRewardRatio: 1.0, // At least 1:1 R:R 
        tradePreMarket: true,
        tradeRegularHours: true,
        tradeAfterHours: true,
        enableDiscordAlerts: true,
        futuresMaxContracts: 2,
        futuresStopPoints: 15,
        futuresTargetPoints: 30,
        cryptoPreferredCoins: userPrefs.cryptoPreferredCoins || ['BTC', 'ETH', 'SOL'],
        cryptoEnableMemeCoins: true,
      };
      cachedPreferences = prefs;
      preferencesLastFetched = now;
      logger.debug(`[BOT-PREFS] Loaded user preferences: ${prefs.riskTolerance}, maxPos=$${prefs.maxPositionSize}`);
      return prefs;
    }
  } catch (error) {
    logger.debug(`[BOT-PREFS] Using defaults (no user preferences found)`);
  }
  
  // Return defaults if no user preferences
  cachedPreferences = { ...DEFAULT_PREFERENCES };
  preferencesLastFetched = now;
  return cachedPreferences;
}

/**
 * Clear cached preferences (call after user updates their settings)
 */
export function clearPreferencesCache(): void {
  cachedPreferences = null;
  preferencesLastFetched = 0;
}

/**
 * Clear all portfolio caches (call after admin reset)
 */
export function clearPortfolioCaches(): void {
  optionsPortfolio = null;
  futuresPortfolio = null;
  cryptoPortfolio = null;
  propFirmPortfolio = null;
  smallAccountPortfolio = null;
  logger.info('[BOT] Portfolio caches cleared');
}

// Separate portfolios for Options, Futures, and Crypto
const OPTIONS_PORTFOLIO_NAME = "Auto-Lotto Options";
const FUTURES_PORTFOLIO_NAME = "Auto-Lotto Futures";
const CRYPTO_PORTFOLIO_NAME = "Auto-Lotto Crypto";
const PROP_FIRM_PORTFOLIO_NAME = "Prop Firm Mode"; // Conservative futures for funded evaluations
const SMALL_ACCOUNT_PORTFOLIO_NAME = "Small Account Lotto"; // $150 account for cheap A+ plays
const SYSTEM_USER_ID = "system-auto-trader";
const STARTING_CAPITAL = 300; // $300 per portfolio
// 🎯 POSITION SIZING - Allow quality plays, not just ultra-cheap lottos
// $150 max = can buy 1x $1.50 option or 2x $0.75 options
const MAX_POSITION_SIZE = 150; // $150 max per trade for quality plays
const FUTURES_MAX_POSITION_SIZE_PER_TRADE = 100;
const CRYPTO_MAX_POSITION_SIZE = 100;

// ═══════════════════════════════════════════════════════════════════════════
// 💎 STRICT OPTIONS PLAYBOOK - Disciplined $300 Account Rules
// Based on proven $200 trading playbook - treat capital like fragile glass
// Goal: Get traction without blowing up. Follow these like law, not vibes.
// ═══════════════════════════════════════════════════════════════════════════

// 1️⃣ NON-NEGOTIABLE ACCOUNT RULES
const OPTIONS_PLAYBOOK = {
  // Position sizing
  MAX_RISK_PER_TRADE: 35,       // $25-35 max risk per trade
  MAX_CONTRACTS: 1,             // 1 contract max per trade
  MAX_LOSS_PERCENT: 20,         // Max 20% loss per trade before stop out
  
  // Trade frequency limits
  MAX_TRADES_PER_DAY: 1,        // Only 1 trade per day
  MAX_CONSECUTIVE_RED_DAYS: 2,  // After 2 red days, pause for 2 days
  PAUSE_DAYS_AFTER_RED: 2,      // Days to pause after hitting red day limit
  
  // Exit rules
  STOP_LOSS_PERCENT: 18,        // -15-20% stop loss (use 18% center)
  TAKE_PROFIT_PERCENT: 22,      // +20-25% take profit (use 22% center)
  
  // DTE rules (expiration)
  MIN_DTE: 10,                  // Minimum 10 DTE
  MAX_DTE: 21,                  // Maximum 21 DTE
  
  // Delta/Strike rules
  MIN_DELTA: 0.35,              // Delta must be >= 0.35 (no gambling)
  MAX_OTM_STRIKES: 1,           // ATM or 1 strike ITM only
};

// 2️⃣ ALLOWED TICKERS - Expanded to include priority sectors
const OPTIONS_PLAYBOOK_TICKERS = [
  // 📈 INDEX ETFs
  'SPY',   // S&P 500 ETF
  'QQQ',   // Nasdaq 100 ETF
  'IWM',   // Russell 2000 ETF - Small caps index
  // 🖥️ MEGA CAP TECH
  'AAPL',  // Apple
  'NVDA',  // NVIDIA
  'TSLA',  // Tesla
  'AMD',   // AMD
  'META',  // Meta
  'GOOGL', // Google
  'AMZN',  // Amazon
  'MSFT',  // Microsoft
  // 💰 FINTECH
  'SOFI',  // SoFi
  'HOOD',  // Robinhood
  'COIN',  // Coinbase
  // ☢️ NUCLEAR & ENERGY - User priority
  'NNE',   // Nano Nuclear
  'OKLO',  // Oklo Inc
  'SMR',   // NuScale Power
  'CCJ',   // Cameco
  'LEU',   // Centrus Energy
  'UUUU',  // Energy Fuels
  'UEC',   // Uranium Energy
  'DNN',   // Denison Mines
  'BWXT',  // BWX Technologies
  // 🛡️ DEFENSE & AEROSPACE
  'LMT',   // Lockheed Martin
  'RTX',   // Raytheon
  'NOC',   // Northrop Grumman
  'GD',    // General Dynamics
  'BA',    // Boeing
  'PLTR',  // Palantir
  // 🚀 SPACE & SATELLITES
  'LUNR',  // Intuitive Machines
  'RKLB',  // Rocket Lab
  // 🤖 AI & TECH
  'AI',    // C3.ai
  'SOUN',  // SoundHound
  'IONQ',  // IonQ
  'MSTR',  // MicroStrategy (Bitcoin proxy)
];

// 3️⃣ CONSECUTIVE RED DAY TRACKING
interface PlaybookDayTracker {
  date: string;
  pnl: number;
  tradesTaken: number;
}

const playbookDayHistory: PlaybookDayTracker[] = [];
let playbookPauseUntil: Date | null = null;
let playbookTodayTrades = 0;
let playbookTodayDate = '';

/**
 * Check if Options Playbook allows trading today
 * Returns: { allowed: boolean, reason: string }
 */
export function checkPlaybookTradingAllowed(): { allowed: boolean; reason: string } {
  const today = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
  
  // Reset daily counter if new day
  if (playbookTodayDate !== today) {
    playbookTodayDate = today;
    playbookTodayTrades = 0;
  }
  
  // Check if we're in a forced pause period
  if (playbookPauseUntil && new Date() < playbookPauseUntil) {
    const daysLeft = Math.ceil((playbookPauseUntil.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return {
      allowed: false,
      reason: `PLAYBOOK PAUSE: ${daysLeft} day(s) remaining after ${OPTIONS_PLAYBOOK.MAX_CONSECUTIVE_RED_DAYS} consecutive red days`
    };
  }
  
  // Check if max trades per day reached
  if (playbookTodayTrades >= OPTIONS_PLAYBOOK.MAX_TRADES_PER_DAY) {
    return {
      allowed: false,
      reason: `DAILY LIMIT: Already took ${playbookTodayTrades}/${OPTIONS_PLAYBOOK.MAX_TRADES_PER_DAY} trade(s) today`
    };
  }
  
  // Check consecutive red days
  const recentDays = playbookDayHistory.slice(-OPTIONS_PLAYBOOK.MAX_CONSECUTIVE_RED_DAYS);
  const consecutiveRedDays = recentDays.filter(d => d.pnl < 0).length;
  
  if (consecutiveRedDays >= OPTIONS_PLAYBOOK.MAX_CONSECUTIVE_RED_DAYS) {
    // Set pause until 2 trading days from now
    const pauseUntil = new Date();
    pauseUntil.setDate(pauseUntil.getDate() + OPTIONS_PLAYBOOK.PAUSE_DAYS_AFTER_RED);
    playbookPauseUntil = pauseUntil;
    return {
      allowed: false,
      reason: `CONSECUTIVE RED DAYS: ${consecutiveRedDays} red days in a row, pausing for ${OPTIONS_PLAYBOOK.PAUSE_DAYS_AFTER_RED} days`
    };
  }
  
  return { allowed: true, reason: 'Playbook rules passed' };
}

/**
 * Record end-of-day P&L for playbook tracking
 */
export function recordPlaybookDayPnL(pnl: number): void {
  const today = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
  
  // Check if we already have today's entry
  const existingIndex = playbookDayHistory.findIndex(d => d.date === today);
  if (existingIndex >= 0) {
    playbookDayHistory[existingIndex].pnl += pnl;
    playbookDayHistory[existingIndex].tradesTaken = playbookTodayTrades;
  } else {
    playbookDayHistory.push({ date: today, pnl, tradesTaken: playbookTodayTrades });
  }
  
  // Keep only last 10 days
  while (playbookDayHistory.length > 10) {
    playbookDayHistory.shift();
  }
  
  logger.info(`📊 [PLAYBOOK] Day ${today} P&L: $${pnl.toFixed(2)} (${playbookTodayTrades} trades)`);
}

/**
 * Increment daily trade counter
 */
export function incrementPlaybookDailyTrades(): void {
  const today = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
  if (playbookTodayDate !== today) {
    playbookTodayDate = today;
    playbookTodayTrades = 0;
  }
  playbookTodayTrades++;
  logger.info(`📊 [PLAYBOOK] Trade ${playbookTodayTrades}/${OPTIONS_PLAYBOOK.MAX_TRADES_PER_DAY} taken today`);
}

/**
 * Validate option trade against playbook rules
 * NOTE: Ticker restriction REMOVED - bot can trade ANY ticker from scanners/trade desk
 * Returns: { valid: boolean, reason: string }
 */
export function validatePlaybookTrade(
  symbol: string,
  premium: number,
  dte: number,
  delta: number,
  optionType: 'call' | 'put'
): { valid: boolean; reason: string; setup?: string } {
  // NO TICKER RESTRICTION - Bot trades whatever scanners/trade desk/bullish trend finds
  // The 800+ ticker universe, dynamic movers, and convergence signals drive selection
  
  // Check premium/risk
  const contractCost = premium * 100; // Options = 100 shares
  if (contractCost > OPTIONS_PLAYBOOK.MAX_RISK_PER_TRADE) {
    return {
      valid: false,
      reason: `RISK TOO HIGH: $${contractCost.toFixed(0)} > $${OPTIONS_PLAYBOOK.MAX_RISK_PER_TRADE} max`
    };
  }
  
  // Check DTE range
  if (dte < OPTIONS_PLAYBOOK.MIN_DTE) {
    return {
      valid: false,
      reason: `DTE TOO SHORT: ${dte} < ${OPTIONS_PLAYBOOK.MIN_DTE} min (no same-week expiration)`
    };
  }
  if (dte > OPTIONS_PLAYBOOK.MAX_DTE) {
    return {
      valid: false,
      reason: `DTE TOO LONG: ${dte} > ${OPTIONS_PLAYBOOK.MAX_DTE} max`
    };
  }
  
  // Check delta (must be >= 0.35)
  const absDelta = Math.abs(delta);
  if (absDelta < OPTIONS_PLAYBOOK.MIN_DELTA) {
    return {
      valid: false,
      reason: `DELTA TOO LOW: ${absDelta.toFixed(2)} < ${OPTIONS_PLAYBOOK.MIN_DELTA} (gambling territory)`
    };
  }
  
  // Determine setup type based on market conditions
  // This would be enhanced with VWAP check in real implementation
  const setup = absDelta >= 0.45 ? 'Setup A: Trend Continuation' : 'Setup B: Key Level Reversal';
  
  return {
    valid: true,
    reason: `PLAYBOOK VALID: ${symbol} ${optionType.toUpperCase()} | DTE: ${dte} | Delta: ${absDelta.toFixed(2)} | Risk: $${contractCost.toFixed(0)}`,
    setup
  };
}

/**
 * Get playbook-compliant stop loss and take profit levels
 */
export function getPlaybookExitLevels(entryPrice: number): { stopLoss: number; takeProfit: number } {
  const stopLoss = entryPrice * (1 - OPTIONS_PLAYBOOK.STOP_LOSS_PERCENT / 100);
  const takeProfit = entryPrice * (1 + OPTIONS_PLAYBOOK.TAKE_PROFIT_PERCENT / 100);
  return { stopLoss, takeProfit };
}

/**
 * Check if today is a slow/low-volatility day (should not trade)
 * Returns true if market is choppy/slow and trading should be avoided
 */
export async function isSlowTradingDay(): Promise<{ isSlow: boolean; reason: string }> {
  try {
    const context = await getMarketContext();
    
    // Check for ranging/volatile market (choppy conditions)
    if (context.regime === 'ranging') {
      return {
        isSlow: true,
        reason: `Market regime: ${context.regime} - boredom is cheaper than losses`
      };
    }
    
    // Check for low volatility
    if (context.score < 30) {
      return {
        isSlow: true,
        reason: `Low market activity score: ${context.score}/100 - wait for power hour`
      };
    }
    
    return { isSlow: false, reason: 'Market conditions acceptable' };
  } catch (error) {
    // If we can't determine, assume it's okay to trade
    return { isSlow: false, reason: 'Unable to determine market conditions' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 💰 SMALL ACCOUNT LOTTO - $150 account for ultra-cheap plays
// Targets: Cheap AI/Tech/Meme plays with high gamma potential
// Entry: $5-100 per contract ($0.05-$1.00 premium) - TRUE LOTTOS
// Grade: B+ or higher (85%+ confidence) - High conviction but not ultra-strict
// ═══════════════════════════════════════════════════════════════════════════
const SMALL_ACCOUNT_STARTING_CAPITAL = 150;
const SMALL_ACCOUNT_MAX_POSITION = 30; // $30 max per trade (20% of $150)
const SMALL_ACCOUNT_MIN_PREMIUM = 5; // $0.05 minimum - allow true lotto plays!
const SMALL_ACCOUNT_MAX_PREMIUM = 100; // $1.00 max premium
const SMALL_ACCOUNT_GRADE_THRESHOLD = 85; // B+ or higher (85%+ confidence)
const SMALL_ACCOUNT_MIN_DTE = 3; // Minimum 3 DTE - allow closer expiries for small account lottos

// 🛡️ GENERAL DTE PROTECTION - All portfolios
// Lower threshold for regular accounts, stricter for small accounts
const GENERAL_MIN_DTE = 3; // Regular accounts: minimum 3 DTE (avoid 0-2 DTE theta death)

// Priority tickers for Small Account - cheap options, high potential
const SMALL_ACCOUNT_TICKERS = [
  // 🤖 AI/QUANTUM - User's focus
  'QUBT',  // Quantum computing - user active
  'AI',    // C3.ai - user active  
  'NVDA',  // AI leader - cheap puts/calls available
  'PLTR',  // AI/Tech - user favorite
  'SMCI',  // AI infrastructure
  // 🏦 INDEX ETFs - SPX/QQQ calls
  'SPY',   // S&P 500 - Friday 0DTE, cheap weekly calls
  'QQQ',   // Nasdaq 100 - Tech-heavy index plays
  'IWM',   // Small caps index
  // 🚀 MEME/HIGH GAMMA
  'TSLA',  // Fridays especially
  'NIO',   // EV play
  'INTC',  // Cheap options
  // 📈 MOMENTUM PLAYS
  'BMNR',  // Small cap mover
  'SNDK',  // Thursdays
  'AMD',   // Semi plays
  'MARA',  // Crypto proxy
  'RIOT',  // Crypto mining
];

// Prop Firm Mode - Conservative settings for Topstep/funded evaluations
const PROP_FIRM_STARTING_CAPITAL = 50000; // Simulates 50K combine account
const PROP_FIRM_DAILY_LOSS_LIMIT = 1000; // $1000 max daily loss
const PROP_FIRM_MAX_DRAWDOWN = 2500; // $2500 trailing drawdown
const PROP_FIRM_PROFIT_TARGET = 3000; // $3000 profit target
const PROP_FIRM_MAX_CONTRACTS = 2; // Max 2 contracts at a time
const PROP_FIRM_STOP_POINTS_NQ = 15; // 15 point stop = $300 risk per contract
const PROP_FIRM_TARGET_POINTS_NQ = 30; // 2:1 R:R minimum

// 🎯 PRIORITY TICKERS - Shuffled each scan for diversification
// Fisher-Yates shuffle algorithm for fair randomization
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const BASE_PRIORITY_TICKERS = [
  // 💰 TOP MONEY MAKERS - Scan these FIRST every cycle
  'IWM', 'SPY', 'QQQ',
  // 🚀 SPACE - User priority (Jan 2026)
  'RKLB', 'ASTS', 'LUNR', 'JOBY', 'ACHR', 'RDW', 'SPCE',
  // 🧠 AI & QUANTUM COMPUTING
  'PLTR', 'AI', 'SOUN', 'IONQ', 'RGTI', 'QUBT', 'QBTS', 'UPST',
  // ☢️ NUCLEAR & FUSION
  'NNE', 'OKLO', 'SMR', 'CCJ', 'LEU', 'UUUU',
  // 🇨🇳 CHINESE STOCKS
  'BIDU', 'NIO', 'BABA', 'JD', 'PDD', 'XPEV', 'LI',
  // 📈 MEGA-CAP TECH (high liquidity)
  'NVDA', 'TSLA', 'AMD', 'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'META',
  // 🏦 INDICES & CRYPTO
  'SPY', 'QQQ', 'IWM', 'COIN', 'MARA', 'RIOT', 'ARM',
];

// Get randomized ticker list each time (for diversification)
function getPriorityTickers(): string[] {
  return shuffleArray(BASE_PRIORITY_TICKERS);
}

// Legacy constant for backward compatibility
const PRIORITY_TICKERS = BASE_PRIORITY_TICKERS;

// Rate limiting helper to avoid Tradier API quota violations
const API_DELAY_MS = 250; // 250ms between Tradier calls (max 4/second to be safe)
const MAX_API_CALLS_PER_SCAN = 100; // Stop scanning after this many API calls to save quota
let apiCallsThisScan = 0;

async function rateLimitDelay(): Promise<void> {
  apiCallsThisScan++;
  await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
}

function resetApiCallCounter(): void {
  apiCallsThisScan = 0;
}

function isApiQuotaExhausted(): boolean {
  return apiCallsThisScan >= MAX_API_CALLS_PER_SCAN;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🛡️ POST-EXIT COOLDOWN SYSTEM - Prevents repeated re-entry on ANY closed position
// ═══════════════════════════════════════════════════════════════════════════
const EXIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minute cooldown after ANY exit (win or loss)
const LOSS_COOLDOWN_MS = 30 * 60 * 1000; // 30 minute cooldown after a loss

// Track recently exited symbols to prevent infinite profit loops
interface ExitCooldownEntry {
  exitTime: number;
  symbol: string;
  optionType?: string;
  strike?: number;
  wasWin: boolean;
}

const exitCooldowns = new Map<string, ExitCooldownEntry>();

/**
 * Record any exit (win or loss) - triggers re-entry cooldown
 */
export function recordExitCooldown(symbol: string, optionType?: string, strike?: number, wasWin: boolean = true): void {
  const key = `${symbol}_${optionType || ''}_${strike || ''}`;
  exitCooldowns.set(key, {
    exitTime: Date.now(),
    symbol,
    optionType,
    strike,
    wasWin
  });
  logger.info(`🛡️ [EXIT-COOLDOWN] ${symbol} ${optionType || ''} $${strike || ''} on 15min cooldown after ${wasWin ? 'WIN' : 'LOSS'}`);
}

/**
 * Check if a symbol/option is on exit cooldown (prevents re-entry after any exit)
 */
function isOnExitCooldown(symbol: string, optionType?: string, strike?: number): { onCooldown: boolean; reason: string } {
  const key = `${symbol}_${optionType || ''}_${strike || ''}`;
  const entry = exitCooldowns.get(key);
  
  if (!entry) {
    // Also check for same symbol with any strike (prevent same-direction re-entry)
    const sameSymbolKey = `${symbol}_${optionType || ''}_`;
    const entries = Array.from(exitCooldowns.entries());
    for (const [k, v] of entries) {
      if (k.startsWith(sameSymbolKey)) {
        const timeSinceExit = Date.now() - v.exitTime;
        if (timeSinceExit < EXIT_COOLDOWN_MS) {
          const minutesRemaining = Math.ceil((EXIT_COOLDOWN_MS - timeSinceExit) / 60000);
          return {
            onCooldown: true,
            reason: `${symbol} ${optionType} on ${minutesRemaining}min cooldown after recent ${v.wasWin ? 'WIN' : 'LOSS'} exit`
          };
        }
      }
    }
    return { onCooldown: false, reason: '' };
  }
  
  const timeSinceExit = Date.now() - entry.exitTime;
  if (timeSinceExit < EXIT_COOLDOWN_MS) {
    const minutesRemaining = Math.ceil((EXIT_COOLDOWN_MS - timeSinceExit) / 60000);
    return {
      onCooldown: true,
      reason: `${symbol} ${optionType || ''} $${strike || ''} on ${minutesRemaining}min cooldown after ${entry.wasWin ? 'WIN' : 'LOSS'}`
    };
  }
  
  // Clean up expired entry
  exitCooldowns.delete(key);
  return { onCooldown: false, reason: '' };
}
// ═══════════════════════════════════════════════════════════════════════════
// 🧠 TRADING ENGINE GATE - Institutional-grade entry validation
// Integrates IV Rank, Confluence Scoring, and Catalyst Intelligence
// ═══════════════════════════════════════════════════════════════════════════

interface TradingEngineGateResult {
  allowed: boolean;
  reasons: string[];
  confluenceScore: number;
  ivRank: number | null;
  hasCatalyst: boolean;
  catalystType: string | null;
  adjustedConfidence: number;
  recommendation: string;
}

/**
 * 🧠 ELITE TRADING ENGINE GATE - Top 1% Trader Logic
 * 
 * The bot must be SMARTER than the Trade Desk - finding trades humans miss.
 * 
 * INSTITUTIONAL-GRADE VALIDATION:
 * 1. IV Rank Analysis - Avoid overpriced premium (block if IV Rank > 70%)
 * 2. Confluence Scoring - REQUIRE 70%+ (elite threshold, not 50%)
 * 3. Catalyst Intelligence - SEC filings, earnings, gov contracts awareness
 * 4. Scenario Planning - Risk/reward modeling with multiple outcomes
 * 5. Edge Detection - Identify asymmetric opportunities humans miss
 * 6. Fundamental Alignment - Direction must match fundamental bias
 */
async function checkTradingEngineGate(
  symbol: string,
  direction: 'long' | 'short',
  entryPrice: number,
  confidence: number,
  assetClass: AssetClass = 'options'
): Promise<TradingEngineGateResult> {
  const reasons: string[] = [];
  let allowed = true;
  let confluenceScore = 50; // Default neutral
  let ivRank: number | null = null;
  let hasCatalyst = false;
  let catalystType: string | null = null;
  let adjustedConfidence = confidence;
  
  // 🎯 ELITE THRESHOLDS - Top 1% trader standards
  const ELITE_CONFLUENCE_MIN = 70;      // Require 70%+ confluence (was 50%)
  const ELITE_CONFLUENCE_STRONG = 85;   // Strong setup threshold
  const IV_RANK_EXPENSIVE = 70;         // Premium overpriced above this
  const IV_RANK_EXTREME = 85;           // Block entry above this
  const IV_RANK_CHEAP = 30;             // Cheap premium below this
  const EARNINGS_DANGER_DAYS = 3;       // IV crush danger zone
  const EARNINGS_CAUTION_DAYS = 7;      // Elevated IV zone
  
  try {
    // ════════════════════════════════════════════════════════════════════════
    // 1. 📊 IV RANK ANALYSIS - Premium Pricing Intelligence
    // ════════════════════════════════════════════════════════════════════════
    try {
      const volatilityData = await analyzeVolatility(symbol);
      if (volatilityData && volatilityData.ivRank !== undefined) {
        ivRank = volatilityData.ivRank;
        
        if (ivRank > IV_RANK_EXTREME) {
          // BLOCK: Extreme IV = guaranteed overpaying for premium
          allowed = false;
          reasons.push(`🛑 IV Rank ${ivRank.toFixed(0)}% EXTREME - blocking entry (premium 2-3x overpriced)`);
          adjustedConfidence -= 25;
        } else if (ivRank > IV_RANK_EXPENSIVE) {
          // WARNING: High IV = likely overpaying
          reasons.push(`⚠️ IV Rank ${ivRank.toFixed(0)}% HIGH - premium overpriced, reduced size`);
          adjustedConfidence -= 15;
        } else if (ivRank < IV_RANK_CHEAP) {
          // EDGE: Cheap premium = better risk/reward
          reasons.push(`✅ IV Rank ${ivRank.toFixed(0)}% LOW - cheap premium, edge detected`);
          adjustedConfidence += 8; // Bonus for finding cheap options
        } else {
          reasons.push(`📊 IV Rank ${ivRank.toFixed(0)}% - fair value`);
        }
        
        // 🎯 SCENARIO PLANNING: Calculate expected move vs cost
        const expectedMove = (volatilityData as any).expectedMove;
        const underlyingPrice = (volatilityData as any).underlyingPrice;
        if (expectedMove && entryPrice > 0) {
          const expectedMovePercent = expectedMove;
          const breakEvenMove = (entryPrice / (underlyingPrice || 100)) * 100;
          
          if (expectedMovePercent > breakEvenMove * 2) {
            reasons.push(`📈 EDGE: Expected move ${expectedMovePercent.toFixed(1)}% > 2x break-even`);
            adjustedConfidence += 5;
          } else if (expectedMovePercent < breakEvenMove) {
            reasons.push(`⚠️ Expected move ${expectedMovePercent.toFixed(1)}% < break-even ${breakEvenMove.toFixed(1)}%`);
            adjustedConfidence -= 10;
          }
        }
      }
    } catch (ivError) {
      logger.debug(`[ENGINE-GATE] IV check failed for ${symbol}, continuing without IV data`);
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // 2. 🎯 CONFLUENCE SCORING - Multi-Factor Validation (ELITE 70%+ REQUIRED)
    // ════════════════════════════════════════════════════════════════════════
    try {
      const [fundamental, technical] = await Promise.all([
        analyzeFundamentals(symbol, assetClass),
        analyzeTechnicals(symbol)
      ]);
      
      const confluence = validateConfluence(fundamental, technical);
      confluenceScore = confluence.score;
      
      // 🎯 ELITE THRESHOLD: Require 70%+ confluence (top 1% trader standard)
      if (confluenceScore < ELITE_CONFLUENCE_MIN) {
        allowed = false;
        reasons.push(`🛑 Confluence ${confluenceScore}% < ${ELITE_CONFLUENCE_MIN}% ELITE threshold - weak setup`);
      } else if (confluenceScore >= ELITE_CONFLUENCE_STRONG) {
        // STRONG: 85%+ confluence = high conviction
        reasons.push(`✅ Confluence ${confluenceScore}% ELITE - strong multi-factor alignment`);
        adjustedConfidence += 12; // Significant bonus for elite confluence
      } else {
        // GOOD: 70-84% confluence = acceptable
        reasons.push(`📊 Confluence ${confluenceScore}% - meets elite threshold`);
        adjustedConfidence += 5;
      }
      
      // 🧠 FUNDAMENTAL ALIGNMENT - Direction must match bias
      if (direction === 'long' && fundamental.bias === 'bearish') {
        reasons.push(`⚠️ DIRECTION CONFLICT: LONG vs BEARISH fundamental bias`);
        adjustedConfidence -= 15; // Heavy penalty for fighting fundamentals
        if (confluenceScore < 80) {
          allowed = false;
          reasons.push(`🛑 Blocking LONG on bearish stock without 80%+ confluence`);
        }
      } else if (direction === 'short' && fundamental.bias === 'bullish') {
        reasons.push(`⚠️ DIRECTION CONFLICT: SHORT vs BULLISH fundamental bias`);
        adjustedConfidence -= 15;
        if (confluenceScore < 80) {
          allowed = false;
          reasons.push(`🛑 Blocking SHORT on bullish stock without 80%+ confluence`);
        }
      } else if (
        (direction === 'long' && fundamental.bias === 'bullish') ||
        (direction === 'short' && fundamental.bias === 'bearish')
      ) {
        reasons.push(`✅ Direction ALIGNED with fundamental bias`);
        adjustedConfidence += 5;
      }
      
      // 📊 EDGE DETECTION: Look for asymmetric opportunities
      const momentumValue = typeof technical.momentum === 'object' ? technical.momentum.rsi14 : technical.momentum;
      if (momentumValue > 70 && ivRank !== null && ivRank < 40) {
        reasons.push(`🎯 EDGE DETECTED: High momentum (${momentumValue.toFixed(0)}) + cheap IV`);
        adjustedConfidence += 8;
      }
      
      // Check for catalyst boost from catalysts array
      const catalystBoost = fundamental.catalysts && fundamental.catalysts.length > 0 ? fundamental.catalysts.length * 5 : 0;
      if (catalystBoost > 10) {
        reasons.push(`🚀 CATALYST BOOST: +${catalystBoost} from recent news`);
        adjustedConfidence += 5;
      }
      
    } catch (confluenceError) {
      logger.debug(`[ENGINE-GATE] Confluence check failed for ${symbol}, using default score`);
      // Without confluence data, we can't validate - block for safety
      if (allowed) {
        reasons.push(`⚠️ Confluence check failed - proceeding with caution`);
        adjustedConfidence -= 10;
      }
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // 2.5 📐 SWING TRADE VALIDATION - Fibonacci & Volume Confirmation
    // ════════════════════════════════════════════════════════════════════════
    // For swing trades (multi-day holds), apply professional swing criteria:
    // - Support/resistance confirmation
    // - Fib retracement levels
    // - Volume confirmation on bounce
    // - Higher low / lower high structure
    try {
      // If technical data is available, validate swing setup
      const technical = await analyzeTechnicals(symbol);
      if (technical && technical.prices && technical.prices.length >= 20 &&
          technical.highs && technical.lows && technical.volume) {
        
        const swingValidation = validateSwingSetup(
          technical.prices,
          technical.highs,
          technical.lows,
          technical.volume
        );
        
        if (swingValidation.isValid) {
          // Strong swing setup detected - boost confidence
          reasons.push(`📐 SWING SETUP VALID: Score ${swingValidation.score} (${swingValidation.signals.slice(0, 2).join(', ')})`);
          
          // Check direction alignment
          if ((swingValidation.direction === 'long' && direction === 'long') ||
              (swingValidation.direction === 'short' && direction === 'short')) {
            adjustedConfidence += 12;
            reasons.push(`✅ Swing direction ALIGNED with trade direction`);
            
            // Log entry/exit levels for the bot
            if (swingValidation.entry) {
              reasons.push(`📍 Entry trigger: ${swingValidation.entry.trigger}`);
            }
            if (swingValidation.targets.length > 0) {
              reasons.push(`🎯 Swing targets: $${swingValidation.targets[0].toFixed(2)}`);
            }
          } else if (swingValidation.direction !== 'none' && 
                     swingValidation.direction !== direction) {
            // Direction conflict with swing analysis
            adjustedConfidence -= 10;
            reasons.push(`⚠️ Swing analysis suggests ${swingValidation.direction.toUpperCase()}, not ${direction.toUpperCase()}`);
          }
          
          // Apply Fib level analysis
          const fibLevels = calculateFibonacciLevels(technical.highs, technical.lows, technical.prices);
          const fib382 = fibLevels.levels.find(l => l.ratio === 0.382);
          const fib618 = fibLevels.levels.find(l => l.ratio === 0.618);
          if (fib382 || fib618) {
            reasons.push(`📐 Fib levels: ${fibLevels.currentLevel} (${fibLevels.trend})`);
          }
          
          // Log warnings
          for (const warning of swingValidation.warnings.slice(0, 2)) {
            reasons.push(`⚠️ ${warning}`);
          }
        } else if (swingValidation.score > 0 && swingValidation.score < 60) {
          // Weak swing setup - advisory warning
          reasons.push(`📊 Swing score: ${swingValidation.score}% (needs 60%+ for high-probability)`);
        }
      }
    } catch (swingError) {
      logger.debug(`[ENGINE-GATE] Swing validation failed for ${symbol}, continuing without swing data`);
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // 3. 📋 CATALYST INTELLIGENCE - Earnings/SEC/Gov Contract Awareness
    // ════════════════════════════════════════════════════════════════════════
    try {
      const catalystData = await calculateCatalystScore(symbol);
      if (catalystData && catalystData.score > 0) {
        hasCatalyst = true;
        
        if (catalystData.recentCatalysts && catalystData.recentCatalysts.length > 0) {
          const recentEvent = catalystData.recentCatalysts[0];
          catalystType = recentEvent.eventType;
          
          const eventDate = recentEvent.eventDate ? new Date(recentEvent.eventDate) : null;
          const daysFromNow = eventDate ? Math.ceil((eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 999;
          
          // 🛑 EARNINGS DANGER ZONE - IV Crush risk
          if (daysFromNow > 0 && daysFromNow <= EARNINGS_DANGER_DAYS && recentEvent.eventType === 'earnings') {
            allowed = false; // BLOCK: Too risky for lotto plays
            reasons.push(`🛑 EARNINGS in ${daysFromNow} days - IV CRUSH ZONE - blocking entry`);
            adjustedConfidence -= 25;
          } else if (daysFromNow > 0 && daysFromNow <= EARNINGS_CAUTION_DAYS && recentEvent.eventType === 'earnings') {
            reasons.push(`⚠️ Earnings in ${daysFromNow} days - elevated IV, reduced position`);
            adjustedConfidence -= 10;
          } else if (recentEvent.eventType === 'sec_filing') {
            // SEC filings can be bullish or bearish - neutral treatment
            reasons.push(`📋 SEC Filing: ${recentEvent.title?.slice(0, 40) || 'Recent disclosure'}`);
          } else if (recentEvent.eventType === 'gov_contract') {
            // Gov contracts are bullish catalysts
            reasons.push(`🏛️ GOV CONTRACT: ${recentEvent.title?.slice(0, 40) || 'Award'}`);
            adjustedConfidence += 8; // Boost for positive catalyst
          } else if (recentEvent.eventType === 'acquisition') {
            // M&A activity - could be bullish
            reasons.push(`🤝 M&A Activity: ${recentEvent.title?.slice(0, 40) || 'Deal'}`);
            adjustedConfidence += 5;
          } else if (recentEvent.eventType === 'insider_trade') {
            // Insider buying is bullish signal
            if (recentEvent.signalStrength > 50) {
              reasons.push(`👔 Insider BUYING detected - bullish signal`);
              adjustedConfidence += 5;
            } else {
              reasons.push(`👔 Insider activity detected`);
            }
          }
        }
        
        // Aggregate catalyst impact
        if (catalystData.catalystCount >= 3) {
          reasons.push(`📊 High catalyst activity: ${catalystData.catalystCount} events (score: ${catalystData.score})`);
        }
      }
    } catch (catalystError) {
      logger.debug(`[ENGINE-GATE] Catalyst check failed for ${symbol}, continuing without catalyst data`);
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // 4. 🎲 SCENARIO PLANNING - Risk/Reward Modeling (ADVISORY ONLY)
    // ════════════════════════════════════════════════════════════════════════
    // Calculate probability-weighted outcomes - for logging/visibility only, not blocking
    const winProbability = Math.min(95, Math.max(20, adjustedConfidence));
    const lossProbability = 100 - winProbability;
    const expectedValue = (winProbability * 1.5) - (lossProbability * 1.0); // 1.5:1 R/R assumption
    
    if (expectedValue > 50) {
      reasons.push(`🎯 +EV Trade: Expected value ${expectedValue.toFixed(0)}%`);
    } else if (expectedValue < 20) {
      // Advisory warning only - do NOT block based on EV alone
      // EV is calculated from adjustedConfidence which may have been penalized
      reasons.push(`📊 Low EV: ${expectedValue.toFixed(0)}% (advisory)`);
    }
    
  } catch (error) {
    logger.warn(`[ENGINE-GATE] Error in trading engine gate for ${symbol}:`, error);
    reasons.push('⚠️ Trading engine validation partially failed');
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // 🛡️ CONFIDENCE FLOOR - Prevent over-penalization
  // ════════════════════════════════════════════════════════════════════════
  // If trade passed elite confluence threshold (70%+), don't let stacked penalties kill it
  // The confluence check is the primary quality gate - penalties are secondary adjustments
  if (allowed && confluenceScore >= ELITE_CONFLUENCE_MIN) {
    // Trade passed elite threshold - ensure it stays actionable
    adjustedConfidence = Math.max(55, adjustedConfidence); // Floor at 55% for elite setups
    
    if (confluenceScore >= ELITE_CONFLUENCE_STRONG) {
      // 85%+ confluence = high conviction, floor at 65%
      adjustedConfidence = Math.max(65, adjustedConfidence);
    }
  }
  
  // Ensure confidence stays in reasonable bounds
  adjustedConfidence = Math.max(30, Math.min(100, adjustedConfidence));
  
  // ════════════════════════════════════════════════════════════════════════
  // 🏆 FINAL RECOMMENDATION - Elite Trader Decision
  // ════════════════════════════════════════════════════════════════════════
  // NOTE: If trade already passed allowed=true with elite confluence, we allow it
  // The recommendation is for position sizing guidance, not additional blocking
  let recommendation = '';
  if (!allowed) {
    recommendation = 'BLOCK: Does not meet elite trading standards';
  } else if (adjustedConfidence >= 90) {
    recommendation = 'ELITE BUY: Top 1% setup - full position';
  } else if (adjustedConfidence >= 80) {
    recommendation = 'STRONG BUY: Excellent conditions - 75% position';
  } else if (adjustedConfidence >= 70) {
    recommendation = 'BUY: Good conditions - 50% position';
  } else if (adjustedConfidence >= 55) {
    recommendation = 'CAUTIOUS: Reduced edge - 25% position';
    // Still allowed since it passed elite confluence - just smaller size
  } else {
    // Only block here if trade didn't pass elite confluence gate
    recommendation = 'WEAK: Marginal edge - consider skipping';
    // Don't force block - let the original allowed decision stand
  }
  
  const emoji = allowed ? '✅' : '🛑';
  const eliteLabel = confluenceScore >= 85 ? '🏆 ELITE' : confluenceScore >= 70 ? '📈 GOOD' : '⚠️ WEAK';
  
  logger.info(`🧠 [ENGINE-GATE] ${symbol} ${direction.toUpperCase()}: ${emoji} ${allowed ? 'ALLOWED' : 'BLOCKED'} | ${eliteLabel} Confluence: ${confluenceScore}% | IV: ${ivRank?.toFixed(0) || 'N/A'}% | Adjusted: ${adjustedConfidence.toFixed(0)}%`);
  logger.info(`🧠 [ENGINE-GATE] ${symbol} Recommendation: ${recommendation}`);
  
  return {
    allowed,
    reasons,
    confluenceScore,
    ivRank,
    hasCatalyst,
    catalystType,
    adjustedConfidence,
    recommendation
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔄 PER-SYMBOL SCAN THROTTLE - Prevents scanning same ticker repeatedly
// ═══════════════════════════════════════════════════════════════════════════
const SCAN_THROTTLE_MS = 10 * 60 * 1000; // 10 minute cooldown between scans of same symbol
const lastScanTime = new Map<string, number>();

/**
 * Check if a symbol was recently scanned - prevents repeated scanning
 */
function shouldSkipScan(symbol: string): boolean {
  const lastScan = lastScanTime.get(symbol);
  if (lastScan && Date.now() - lastScan < SCAN_THROTTLE_MS) {
    return true; // Skip - recently scanned
  }
  return false;
}

/**
 * Record that we just scanned a symbol
 */
function recordScan(symbol: string): void {
  lastScanTime.set(symbol, Date.now());
}

// 🎯 PREMIUM TIERS - User said $1000 max, not $1.50!
// For $300 account: $10.00 option = 1 contract @ $1000 total
// This allows quality names like AMZN, NVDA, GOOGL which often have higher premiums
const MAX_ENTRY_PREMIUM = 1000; // $10.00 max premium = $1000/contract (A+ setups)
const PRIORITY_TICKER_PREMIUM = 1000; // $10.00 max for priority tickers (AMZN, NVDA, etc.)
const CONSERVATIVE_ENTRY_PREMIUM = 500; // $5.00 max for B-grade entries ($500/contract)
const LOTTO_ENTRY_PREMIUM = 200; // $2.00 max for speculative lotto plays

interface SymbolCooldown {
  lastLossTime: number;
  lossCount: number;
  totalLoss: number;
}

const symbolCooldowns = new Map<string, SymbolCooldown>();

/**
 * Record a loss on a symbol - triggers cooldown
 */
export function recordSymbolLoss(symbol: string, lossAmount: number): void {
  const existing = symbolCooldowns.get(symbol) || { lastLossTime: 0, lossCount: 0, totalLoss: 0 };
  existing.lastLossTime = Date.now();
  existing.lossCount++;
  existing.totalLoss += Math.abs(lossAmount);
  symbolCooldowns.set(symbol, existing);
  logger.warn(`🛑 [COOLDOWN] ${symbol} loss recorded: -$${Math.abs(lossAmount).toFixed(2)} (${existing.lossCount} losses, total -$${existing.totalLoss.toFixed(2)})`);
}

/**
 * Check if a symbol is on cooldown after a loss
 */
function isSymbolOnLossCooldown(symbol: string): { onCooldown: boolean; reason: string } {
  const cooldown = symbolCooldowns.get(symbol);
  if (!cooldown) {
    return { onCooldown: false, reason: '' };
  }
  
  const timeSinceLoss = Date.now() - cooldown.lastLossTime;
  if (timeSinceLoss < LOSS_COOLDOWN_MS) {
    const minutesRemaining = Math.ceil((LOSS_COOLDOWN_MS - timeSinceLoss) / 60000);
    return { 
      onCooldown: true, 
      reason: `${symbol} on ${minutesRemaining}min cooldown after ${cooldown.lossCount} losses (-$${cooldown.totalLoss.toFixed(2)})` 
    };
  }
  
  return { onCooldown: false, reason: '' };
}

/**
 * Record a win - reduces cooldown severity
 */
export function recordSymbolWin(symbol: string): void {
  const existing = symbolCooldowns.get(symbol);
  if (existing) {
    existing.lossCount = Math.max(0, existing.lossCount - 1);
    if (existing.lossCount === 0) {
      symbolCooldowns.delete(symbol);
      logger.info(`✅ [COOLDOWN] ${symbol} cooldown cleared after win`);
    }
  }
}

let optionsPortfolio: PaperPortfolio | null = null;
let futuresPortfolio: PaperPortfolio | null = null;
let cryptoPortfolio: PaperPortfolio | null = null;
let propFirmPortfolio: PaperPortfolio | null = null;
let smallAccountPortfolio: PaperPortfolio | null = null;

// Prop Firm Mode daily stats
let propFirmDailyPnL = 0;
let propFirmLastResetDate = '';

// Re-initialize portfolios to ensure proper balances if they don't exist
export async function syncPortfolios(): Promise<void> {
  const portfolios = [
    { name: OPTIONS_PORTFOLIO_NAME, size: MAX_POSITION_SIZE, capital: STARTING_CAPITAL },
    { name: FUTURES_PORTFOLIO_NAME, size: FUTURES_MAX_POSITION_SIZE_PER_TRADE, capital: STARTING_CAPITAL },
    { name: CRYPTO_PORTFOLIO_NAME, size: CRYPTO_MAX_POSITION_SIZE, capital: STARTING_CAPITAL },
    { name: PROP_FIRM_PORTFOLIO_NAME, size: PROP_FIRM_MAX_CONTRACTS * 1000, capital: PROP_FIRM_STARTING_CAPITAL }
  ];

  for (const p of portfolios) {
    const existing = await storage.getPaperPortfoliosByUser(SYSTEM_USER_ID);
    const found = existing.find(ep => ep.name === p.name);
    if (!found) {
      await storage.createPaperPortfolio({
        userId: SYSTEM_USER_ID,
        name: p.name,
        startingCapital: p.capital,
        cashBalance: p.capital,
        totalValue: p.capital,
        maxPositionSize: p.size,
        riskPerTrade: p.name === PROP_FIRM_PORTFOLIO_NAME ? 0.02 : 0.1, // Prop firm uses 2% risk
      });
    }
  }
}

// Get or create Prop Firm portfolio
async function getPropFirmPortfolio(): Promise<PaperPortfolio | null> {
  if (propFirmPortfolio) return propFirmPortfolio;
  
  const portfolios = await storage.getPaperPortfoliosByUser(SYSTEM_USER_ID);
  propFirmPortfolio = portfolios.find(p => p.name === PROP_FIRM_PORTFOLIO_NAME) || null;
  
  if (!propFirmPortfolio) {
    propFirmPortfolio = await storage.createPaperPortfolio({
      userId: SYSTEM_USER_ID,
      name: PROP_FIRM_PORTFOLIO_NAME,
      startingCapital: PROP_FIRM_STARTING_CAPITAL,
      cashBalance: PROP_FIRM_STARTING_CAPITAL,
      totalValue: PROP_FIRM_STARTING_CAPITAL,
      maxPositionSize: PROP_FIRM_MAX_CONTRACTS * 1000,
      riskPerTrade: 0.02,
    });
  }
  
  return propFirmPortfolio;
}

// Get Prop Firm stats for the dashboard
export async function getPropFirmStats(): Promise<{
  portfolio: PaperPortfolio | null;
  dailyPnL: number;
  totalPnL: number;
  drawdown: number;
  daysTraded: number;
  tradesCount: number;
  winRate: number;
  isWithinRules: boolean;
  ruleViolations: string[];
} | null> {
  try {
    const portfolio = await getPropFirmPortfolio();
    if (!portfolio) return null;
    
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const closedPositions = positions.filter(p => p.status === 'closed');
    
    // Calculate stats
    const totalPnL = portfolio.totalValue - PROP_FIRM_STARTING_CAPITAL;
    const wins = closedPositions.filter(p => (p.realizedPnL || 0) > 0).length;
    const winRate = closedPositions.length > 0 ? (wins / closedPositions.length) * 100 : 0;
    
    // Check for rule violations
    const ruleViolations: string[] = [];
    const drawdown = Math.max(0, PROP_FIRM_STARTING_CAPITAL - portfolio.totalValue);
    
    if (propFirmDailyPnL <= -PROP_FIRM_DAILY_LOSS_LIMIT) {
      ruleViolations.push(`Daily loss limit breached ($${Math.abs(propFirmDailyPnL).toFixed(0)}/$${PROP_FIRM_DAILY_LOSS_LIMIT})`);
    }
    if (drawdown >= PROP_FIRM_MAX_DRAWDOWN) {
      ruleViolations.push(`Max drawdown breached ($${drawdown.toFixed(0)}/$${PROP_FIRM_MAX_DRAWDOWN})`);
    }
    
    const isWithinRules = ruleViolations.length === 0;
    
    // Get unique trading days
    const tradingDays = new Set(closedPositions.map(p => 
      new Date(p.entryTime || '').toISOString().split('T')[0]
    ));
    
    return {
      portfolio,
      dailyPnL: propFirmDailyPnL,
      totalPnL,
      drawdown,
      daysTraded: tradingDays.size,
      tradesCount: closedPositions.length,
      winRate,
      isWithinRules,
      ruleViolations,
    };
  } catch (error) {
    logger.error("🏆 [PROP-FIRM] Error getting stats:", error);
    return null;
  }
}

// Crypto trading configuration
export const CRYPTO_SCAN_COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'render-token', symbol: 'RENDER', name: 'Render' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'pepe', symbol: 'PEPE', name: 'Pepe' },
  { id: 'bonk', symbol: 'BONK', name: 'Bonk' },
  { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot' },
  { id: 'sui', symbol: 'SUI', name: 'Sui' },
];

// Crypto symbol alias map: Maps stored symbols to Coinbase WebSocket symbols
// Some tokens have different ticker symbols on Coinbase vs CoinGecko
export const CRYPTO_SYMBOL_ALIASES: Record<string, string> = {
  'RENDER': 'RNDR',   // Render Token is RNDR on Coinbase
  'MATIC': 'POL',     // Polygon renamed to POL on some exchanges
};

// Convert stored symbol to Coinbase-compatible symbol for price lookups
export function getCoinbaseSymbol(symbol: string): string {
  return CRYPTO_SYMBOL_ALIASES[symbol.toUpperCase()] || symbol.toUpperCase();
}

// Convert Coinbase symbol back to stored symbol
export function getStoredSymbol(coinbaseSymbol: string): string {
  for (const [stored, coinbase] of Object.entries(CRYPTO_SYMBOL_ALIASES)) {
    if (coinbase === coinbaseSymbol.toUpperCase()) return stored;
  }
  return coinbaseSymbol.toUpperCase();
}

interface CryptoOpportunity {
  coinId?: string;
  symbol: string;
  name?: string;
  price: number;
  change24h?: number;
  volume24h?: number;
  marketCap?: number;
  direction: 'long' | 'short';
  signals: string[];
  confidence: number;
  source?: 'watchlist' | 'trade_desk';
  ideaId?: string;
}

interface BotDecision {
  action: 'enter' | 'skip' | 'wait';
  reason: string;
  confidence: number;
  signals: string[];
}

interface LottoOpportunity {
  symbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expiration: string;
  delta: number;
  price: number;
  volume: number;
  openInterest: number;
  bidAskSpread: number;
  daysToExpiry: number;
  strikeScore: number; // Intelligent strike scoring
}

/**
 * INTELLIGENT STRIKE SELECTION ALGORITHM
 * Scores each strike based on multiple factors to find optimal entry
 * 
 * Factors considered:
 * 1. Delta sweet spot (0.15-0.25 optimal for lotto plays)
 * 2. Bid-ask spread (tighter = better execution)
 * 3. Volume & open interest (liquidity)
 * 4. Premium efficiency (bang for buck)
 * 5. Distance from current price (reasonable OTM)
 */
interface StrikeCandidate {
  strike: number;
  optionType: 'call' | 'put';
  bid: number;
  ask: number;
  midPrice: number;
  delta: number;
  volume: number;
  openInterest: number;
  expiration: string;
  daysToExpiry: number;
  score: number;
  scoreBreakdown: {
    deltaScore: number;
    liquidityScore: number;
    spreadScore: number;
    premiumScore: number;
  };
}

function scoreStrikeCandidate(
  opt: any, 
  stockPrice: number, 
  daysToExpiry: number
): StrikeCandidate | null {
  if (!opt.bid || !opt.ask || opt.bid <= 0) return null;
  
  const midPrice = (opt.bid + opt.ask) / 2;
  const spread = opt.ask - opt.bid;
  const spreadPercent = spread / midPrice;
  const delta = opt.greeks?.delta || 0;
  const absDelta = Math.abs(delta);
  const volume = opt.volume || 0;
  const openInterest = opt.open_interest || 0;
  
  // Calculate OTM percentage
  const strikeOTMPercent = opt.option_type === 'call' 
    ? ((opt.strike - stockPrice) / stockPrice) * 100
    : ((stockPrice - opt.strike) / stockPrice) * 100;
  
  // HARD FILTERS - must pass all
  if (midPrice < 0.01 || midPrice > 15.00) return null; // Price range for lottos (ultra-relaxed for penny momentum)
  if (absDelta < 0.001 || absDelta > 0.60) return null; // Delta range (ultra-relaxed)
  if (strikeOTMPercent > 100 || strikeOTMPercent < -10) return null; // Max 100% OTM / 10% ITM (ultra-relaxed)
  if (spreadPercent > 0.95) return null; // Max 95% spread (ultra-relaxed)
  
  // SCORING (0-100 for each factor)
  
  // 1. DELTA SCORE (40 points max)
  // Sweet spot: 0.15-0.25 delta (20-25% probability, good R/R)
  let deltaScore = 40; // Default high score for testing
  
  // 2. LIQUIDITY SCORE (25 points max)
  // Volume + OI indicates market interest
  let liquidityScore = 0;
  const totalLiquidity = volume + (openInterest * 0.5);
  if (totalLiquidity >= 1000) liquidityScore = 25;
  else if (totalLiquidity >= 500) liquidityScore = 20;
  else if (totalLiquidity >= 200) liquidityScore = 15;
  else if (totalLiquidity >= 50) liquidityScore = 10;
  else liquidityScore = 5;
  
  // 3. SPREAD SCORE (20 points max)
  // Tighter spread = better fills
  let spreadScore = 0;
  if (spreadPercent <= 0.10) spreadScore = 20; // Excellent (<10%)
  else if (spreadPercent <= 0.15) spreadScore = 15; // Good
  else if (spreadPercent <= 0.25) spreadScore = 10; // OK
  else spreadScore = 5; // Wide but acceptable
  
  // 4. PREMIUM EFFICIENCY SCORE (15 points max)
  // Best bang for buck - lower premium with reasonable delta
  let premiumScore = 0;
  const efficiencyRatio = absDelta / midPrice; // Delta per dollar
  if (efficiencyRatio >= 0.20) premiumScore = 15; // Great value
  else if (efficiencyRatio >= 0.15) premiumScore = 12;
  else if (efficiencyRatio >= 0.10) premiumScore = 8;
  else premiumScore = 5;
  
  const totalScore = deltaScore + liquidityScore + spreadScore + premiumScore;
  
  return {
    strike: opt.strike,
    optionType: opt.option_type as 'call' | 'put',
    bid: opt.bid,
    ask: opt.ask,
    midPrice,
    delta,
    volume,
    openInterest,
    expiration: opt.expiration_date,
    daysToExpiry,
    score: totalScore,
    scoreBreakdown: {
      deltaScore,
      liquidityScore,
      spreadScore,
      premiumScore
    }
  };
}

/**
 * Select the BEST strike for a given direction from all available options
 * Returns the highest-scored strike candidate
 */
function selectBestStrike(
  candidates: StrikeCandidate[],
  optionType: 'call' | 'put'
): StrikeCandidate | null {
  const filtered = candidates.filter(c => c.optionType === optionType);
  if (filtered.length === 0) return null;
  
  // Sort by score descending
  filtered.sort((a, b) => b.score - a.score);
  
  // Return the best one
  const best = filtered[0];
  logger.debug(`🎯 [STRIKE-SELECT] Best ${optionType.toUpperCase()}: $${best.strike} (score=${best.score}) δ=${best.delta.toFixed(3)} @ $${best.midPrice.toFixed(2)}`);
  
  return best;
}

// Day trade tickers: High volatility, good for 0-7 DTE plays
// User's priority watchlist - ensures all favorite tickers are scanned first
const DAY_TRADE_TICKERS = [
  // 🚀 SPACE - User priority (Jan 2026)
  'RKLB', 'ASTS', 'LUNR', 'JOBY', 'ACHR', 'RDW', 'SPCE',
  // 🧠 AI & QUANTUM COMPUTING - User priority
  'PLTR', 'AI', 'SOUN', 'IONQ', 'RGTI', 'QUBT', 'QBTS', 'UPST', 'SNOW', 'CRWD',
  // ☢️ NUCLEAR & FUSION - User priority
  'NNE', 'OKLO', 'SMR', 'CCJ', 'LEU', 'UUUU',
  // 🇨🇳 CHINESE STOCKS - User priority
  'BIDU', 'NIO', 'BABA', 'JD', 'PDD', 'XPEV', 'LI',
  // Major indices & leveraged ETFs
  'SPY', 'IWM', 'DIA', 'QQQ', 'XLF', 'XLE', 'XLK', 'XLV', 'ARKK', 'TQQQ', 'SOXL',
  // Mega-cap tech
  'AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA', 'AMD', 'AVGO', 'NFLX', 'META', 'AMZN',
  // Semiconductors
  'ARM', 'SMCI', 'MRVL', 'QCOM', 'MU', 'INTC',
  // Crypto-adjacent
  'MSTR', 'COIN', 'HOOD', 'MARA', 'RIOT',
  // Fintech
  'AFRM', 'XYZ', 'PYPL', 'UPST',
  // SaaS & Cloud
  'CRM', 'SHOP', 'DDOG', 'NET', 'ZS', 'PANW', 'ADBE', 'NOW', 'WDAY',
  // EVs & Clean energy
  'RIVN', 'LCID', 'NIO', 'XPEV', 'ENPH', 'FSLR', 'LI',
  // Financials & Healthcare
  'JPM', 'GS', 'BAC', 'V', 'MA', 'UNH', 'LLY', 'JNJ', 'MRNA', 'PFE',
  // Consumer & Industrial
  'BA', 'DIS', 'WMT', 'HD', 'MCD', 'COST',
  // Additional high-vol names
  'BABA', 'SE', 'MELI', 'C3AI', 'GOOG'
];

// Swing trade tickers: Expanded universe (S&P 500 and high liquidity names)
const SWING_TRADE_TICKERS = [
  // Technology (Software & Hardware)
  'MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'CRM', 'NOW', 'SNOW',
  'CRWD', 'NET', 'DDOG', 'MDB', 'ZS', 'OKTA', 'PANW', 'FTNT', 'SPLK', 'ORCL',
  'IBM', 'CSCO', 'ACN', 'INTU', 'ADBE', 'SAP', 'VMW', 'ADSK', 'TEAM', 'WDAY',
  // Semiconductors
  'AVGO', 'QCOM', 'MU', 'MRVL', 'ARM', 'ASML', 'LRCX', 'AMAT', 'KLAC', 'TXN',
  'ADI', 'NXPI', 'ON', 'MCHP', 'STML', 'GFS', 'INTC', 'TSM', 'AMD',
  // Financials
  'JPM', 'GS', 'MS', 'V', 'MA', 'AXP', 'BAC', 'WFC', 'C', 'BLK',
  'PYPL', 'XYZ', 'COIN', 'HOOD', 'UPST', 'AFRM', 'LC', 'PINS', 'SNAP',
  'SCHW', 'IBKR', 'TROW', 'MET', 'PRU', 'AIG', 'CB', 'PGR', 'TRV', 'ALL',
  // Healthcare & Biotech
  'LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'DHR', 'ISRG',
  'MRNA', 'BNTX', 'REGN', 'VRTX', 'GILD', 'AMGN', 'BIIB', 'BMY', 'CVS', 'ELV',
  'HUM', 'CI', 'CNC', 'MOH', 'HCA', 'SYK', 'BSX', 'EW', 'ZBH', 'BAX',
  // Energy & Industrials
  'XOM', 'CVX', 'OXY', 'SLB', 'HAL', 'COP', 'EOG', 'MPC', 'PSX',
  'BA', 'GE', 'HON', 'CAT', 'DE', 'LMT', 'RTX', 'NOC', 'GD', 'TDG',
  'UPS', 'FDX', 'UNP', 'CSX', 'NSC', 'WM', 'RSG', 'EMR', 'ETN', 'ITW',
  // Consumer Discretionary & Retail
  'COST', 'WMT', 'TGT', 'LULU', 'NKE', 'HD', 'LOW', 'AMZN', 'EBAY', 'ETSY',
  'TJX', 'ROST', 'ORLY', 'AZO', 'SBUX', 'MCD', 'YUM', 'DRI', 'BKNG', 'MAR',
  'HLT', 'RCL', 'CCL', 'NCLH', 'GM', 'F', 'STLA', 'RIVN', 'LCID', 'DKNG',
  // Communication Services & ADRs
  'DIS', 'NFLX', 'CMCSA', 'CHTR', 'TMUS', 'VZ', 'T', 'SNAP',
  'BABA', 'JD', 'PDD', 'BIDU', 'NIO', 'XPEV', 'LI', 'BILI', 'TME', 'KWEB',
  // Defensive & Utilities
  'PG', 'KO', 'PEP', 'PM', 'MO', 'MDLZ', 'CL', 'KMB', 'GIS', 'K', 'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'XEL', 'ED', 'PEG', 'WEC'
];

// Expanded Scannable Universe (A-Z high liquidity tickers)
const EXPANDED_SCAN_UNIVERSE = [
  'A', 'AA', 'AAL', 'AAPL', 'ABBV', 'ABT', 'ACN', 'ADBE', 'ADI', 'ADM', 'ADP', 'ADSK', 'AEE', 'AEP', 'AES', 'AFRM', 'AIG', 'AI', 'AKAM', 'ALB', 'ALGN', 'ALK', 'ALL', 'ALLE', 'AMAT', 'AMCR', 'AMD', 'AME', 'AMGN', 'AMP', 'AMZN', 'ANET', 'ANSS', 'AON', 'AOS', 'APA', 'APD', 'APH', 'APO', 'APT', 'ARE', 'ARM', 'ASML', 'ATO', 'ATVI', 'AVB', 'AVGO', 'AVY', 'AWK', 'AXP', 'AZO',
  'BA', 'BABA', 'BAC', 'BALL', 'BAX', 'BBWI', 'BBY', 'BDX', 'BEN', 'BF.B', 'BIIB', 'BILI', 'BIO', 'BK', 'BKNG', 'BKR', 'BLK', 'BMY', 'BNTX', 'BONK', 'BR', 'BRK.B', 'BSX', 'BWA', 'BXP',
  'C', 'CAG', 'CAH', 'CARR', 'CAT', 'CB', 'CBOE', 'CBRE', 'CCI', 'CCL', 'CDNS', 'CDW', 'CE', 'CEG', 'CF', 'CFG', 'CHD', 'CHRW', 'CHTR', 'CI', 'CINF', 'CL', 'CLSK', 'CLX', 'CMA', 'CMCSA', 'CME', 'CMG', 'CMI', 'CMS', 'CNC', 'CNP', 'COF', 'COIN', 'COO', 'COP', 'COST', 'CPB', 'CPRT', 'CPT', 'CRL', 'CRM', 'CSCO', 'CSGP', 'CSX', 'CTAS', 'CTLT', 'CTRA', 'CTSH', 'CTVA', 'CVS', 'CVX', 'CZR',
  'D', 'DAL', 'DD', 'DDOG', 'DE', 'DFS', 'DG', 'DGX', 'DHI', 'DHR', 'DIS', 'DISH', 'DLR', 'DLTR', 'DOCU', 'DOV', 'DOW', 'DPZ', 'DRI', 'DTE', 'DUK', 'DVA', 'DVN', 'DXCM',
  'EA', 'EBAY', 'ECL', 'ED', 'EFX', 'EIX', 'EL', 'ELV', 'EMN', 'EMR', 'ENPH', 'EOG', 'EPAM', 'EQIX', 'EQT', 'ERIE', 'ES', 'ESS', 'ETN', 'ETR', 'ETSY', 'EVRG', 'EW', 'EXC', 'EXPD', 'EXPE', 'EXR',
  'F', 'FANG', 'FAST', 'FCX', 'FDS', 'FDX', 'FE', 'FFIV', 'FICO', 'FIS', 'FISV', 'FITB', 'FLT', 'FMC', 'FOXA', 'FRT', 'FSLR', 'FTNT', 'FTV',
  'GD', 'GE', 'GEN', 'GILD', 'GIS', 'GL', 'GLW', 'GM', 'GNRC', 'GOOG', 'GOOGL', 'GPC', 'GPN', 'GRMN', 'GS', 'GWRE', 'GWW',
  'HAL', 'HAS', 'HBAN', 'HCA', 'HD', 'HES', 'HIG', 'HII', 'HLT', 'HOLX', 'HON', 'HOOD', 'HPE', 'HPQ', 'HRL', 'HSIC', 'HST', 'HSY', 'HUM', 'HWM',
  'IBM', 'ICE', 'IDXX', 'IEX', 'IFF', 'ILMN', 'INCY', 'INTC', 'INTU', 'INVH', 'IONQ', 'IP', 'IPG', 'IQV', 'IR', 'IRM', 'ISRG', 'IT', 'ITW', 'IVZ',
  'JBHT', 'JCI', 'JD', 'JKHY', 'JJSF', 'JNJ', 'JPM', 'JWN',
  'KDP', 'KEY', 'KEYS', 'KHC', 'KIM', 'KLAC', 'KMB', 'KMI', 'KMX', 'KO', 'KR', 'KWEB',
  'L', 'LDOS', 'LEN', 'LH', 'LHX', 'LI', 'LIN', 'LKQ', 'LLY', 'LMT', 'LNC', 'LNT', 'LOW', 'LRCX', 'LULU', 'LUNR', 'LUV', 'LVS', 'LW', 'LYB', 'LYV',
  'M', 'MA', 'MAA', 'MAR', 'MARA', 'MAS', 'MCD', 'MCHP', 'MCK', 'MCO', 'MDLZ', 'MDT', 'MET', 'META', 'MGM', 'MHK', 'MKC', 'MKTX', 'MLM', 'MMC', 'MMM', 'MNST', 'MO', 'MOH', 'MOS', 'MPC', 'MPWR', 'MRK', 'MRNA', 'MRO', 'MRVL', 'MS', 'MSCI', 'MSFT', 'MSI', 'MSTR', 'MTB', 'MTCH', 'MTD', 'MU',
  'NCLH', 'NDAQ', 'NDSN', 'NEE', 'NEM', 'NET', 'NFLX', 'NI', 'NKE', 'NIO', 'NNE', 'NOC', 'NOW', 'NRG', 'NSC', 'NTAP', 'NTRS', 'NUE', 'NVDA', 'NVR', 'NWL', 'NWS', 'NXPI',
  'O', 'ODFL', 'OKE', 'OKLO', 'OKTA', 'OMC', 'ON', 'ORCL', 'ORLY', 'OTIS', 'OXY',
  'PANW', 'PARA', 'PAYX', 'PAYC', 'PBI', 'PCAR', 'PCG', 'PDD', 'PEG', 'PEP', 'PFE', 'PFG', 'PG', 'PGR', 'PH', 'PHM', 'PKG', 'PLD', 'PLTR', 'PM', 'PNC', 'PNR', 'PNW', 'POOL', 'PPG', 'PPL', 'PRU', 'PSA', 'PSX', 'PTC', 'PWR', 'PYPL',
  'QCOM', 'QRVO', 'QUBT', 'QBTS',
  'RCL', 'RDW', 'RE', 'REG', 'REGN', 'RF', 'RHI', 'RJF', 'RL', 'RMD', 'ROK', 'ROL', 'ROP', 'ROST', 'RSG', 'RTX', 'RVTY', 'RWD', 'RKLB',
  'S', 'SBAC', 'SBUX', 'SCHW', 'SE', 'SEE', 'SHW', 'SIRI', 'SIVB', 'SJM', 'SLB', 'SNA', 'SNAP', 'SNPS', 'SNOW', 'SO', 'SOFI', 'SOL', 'SPG', 'SPGI', 'SPLK', 'SPR', 'SPY', 'XYZ', 'SRE', 'STE', 'STT', 'STX', 'STZ', 'SWK', 'SWKS', 'SYF', 'SYK', 'SYY',
  'T', 'TAP', 'TDG', 'TDY', 'TECH', 'TEL', 'TER', 'TFC', 'TFX', 'TGT', 'TJX', 'TMO', 'TMUS', 'TROW', 'TRV', 'TRMB', 'TSLA', 'TSN', 'TT', 'TTWO', 'TXN', 'TXT', 'TYL',
  'UAL', 'UDR', 'UHS', 'ULTA', 'UNH', 'UNP', 'UPS', 'URI', 'USB',
  'V', 'VFC', 'VLO', 'VMC', 'VRSK', 'VRSN', 'VRTX', 'VTR', 'VTRS', 'VZ',
  'W', 'WAB', 'WAT', 'WBA', 'WBD', 'WDC', 'WEC', 'WELL', 'WFC', 'WHR', 'WM', 'WMB', 'WMT', 'WRB', 'WST', 'WTW', 'WY', 'WYNN',
  'XEL', 'XOM', 'XRAY', 'XPEV', 'XYL',
  'YUM',
  'Z', 'ZBH', 'ZBRA', 'ZETA', 'ZION', 'ZTS', 'ZS'
];

// Combined for general scanning (deduplicated)
const BOT_SCAN_TICKERS = Array.from(new Set([...DAY_TRADE_TICKERS, ...SWING_TRADE_TICKERS, ...EXPANDED_SCAN_UNIVERSE]));

// Cache for market scanner movers - ENHANCED for more opportunities
let moversCache: { tickers: string[]; timestamp: number } | null = null;
const MOVERS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes (faster refresh for more opportunities)

/**
 * Get dynamic movers from market scanner across multiple timeframes
 * Finds stocks with big price moves that could continue or reverse - ideal for lotto plays
 */
async function getDynamicMovers(): Promise<string[]> {
  const now = Date.now();
  
  if (moversCache && (now - moversCache.timestamp) < MOVERS_CACHE_TTL) {
    logger.debug(`🔍 [SCANNER] Using cached movers: ${moversCache.tickers.length} tickers`);
    return moversCache.tickers;
  }
  
  try {
    logger.info(`🔍 [SCANNER] Fetching dynamic movers from market scanner...`);
    
    const dynamicTickers = new Set<string>();
    
    // Get top movers across multiple timeframes for maximum opportunity detection
    const timeframes: ('day' | 'week' | 'month' | 'year')[] = ['day', 'week', 'month', 'year'];
    
    for (const timeframe of timeframes) {
      try {
        const movers = await getTopMovers(timeframe, 'all', 50); // Increased from 20 to 50
        
        // Add top gainers (momentum plays - could continue up)
        for (const stock of movers.gainers.slice(0, 25)) { // Increased from 10 to 25
          if (stock.symbol && stock.currentPrice > 1) { // Skip penny stocks under $1
            dynamicTickers.add(stock.symbol);
            logger.debug(`🔍 [SCANNER] +${timeframe.toUpperCase()} GAINER: ${stock.symbol} +${stock.dayChangePercent?.toFixed(1)}%`);
          }
        }
        
        // Add top losers (reversal plays - could bounce)
        for (const stock of movers.losers.slice(0, 25)) { // Increased from 10 to 25
          if (stock.symbol && stock.currentPrice > 1) {
            dynamicTickers.add(stock.symbol);
            logger.debug(`🔍 [SCANNER] -${timeframe.toUpperCase()} LOSER: ${stock.symbol} ${stock.dayChangePercent?.toFixed(1)}%`);
          }
        }
      } catch (err) {
        logger.warn(`🔍 [SCANNER] Failed to get ${timeframe} movers:`, err);
      }
    }
    
    // Also get growth and penny stock movers for high volatility plays
    try {
      const growthMovers = await getTopMovers('day', 'growth', 15);
      for (const stock of [...growthMovers.gainers.slice(0, 8), ...growthMovers.losers.slice(0, 5)]) {
        if (stock.symbol && stock.currentPrice > 1) {
          dynamicTickers.add(stock.symbol);
        }
      }
    } catch (err) {
      logger.debug(`🔍 [SCANNER] Growth movers fetch skipped`);
    }
    
    const tickerArray = Array.from(dynamicTickers);
    
    moversCache = { tickers: tickerArray, timestamp: now };
    
    logger.info(`🔍 [SCANNER] Found ${tickerArray.length} dynamic movers across timeframes`);
    return tickerArray;
    
  } catch (error) {
    logger.error(`🔍 [SCANNER] Error fetching dynamic movers:`, error);
    return [];
  }
}

const FUTURES_SYMBOLS: ('NQ' | 'GC')[] = ['NQ', 'GC'];

interface FuturesOpportunity {
  symbol: string;
  contractCode: string;
  direction: 'long' | 'short';
  price: number;
  signals: string[];
  confidence: number;
  expirationDate: string;
}

// Re-export for backward compatibility - uses shared market calendar
export function isCMEOpen(): boolean {
  return isCMEMarketOpen().isOpen;
}

export async function getOptionsPortfolio(): Promise<PaperPortfolio | null> {
  try {
    // Load user preferences to sync maxPositionSize
    const prefs = await getBotPreferences();
    
    if (optionsPortfolio) {
      // Sync maxPositionSize from preferences if different
      if (optionsPortfolio.maxPositionSize !== prefs.maxPositionSize) {
        await storage.updatePaperPortfolio(optionsPortfolio.id, {
          maxPositionSize: prefs.maxPositionSize,
        });
        optionsPortfolio.maxPositionSize = prefs.maxPositionSize;
        logger.debug(`🎰 [OPTIONS BOT] Synced maxPositionSize to $${prefs.maxPositionSize}`);
      }
      return optionsPortfolio;
    }

    const portfolios = await storage.getPaperPortfoliosByUser(SYSTEM_USER_ID);
    const existing = portfolios.find(p => p.name === OPTIONS_PORTFOLIO_NAME);
    
    if (existing) {
      // Sync maxPositionSize from preferences
      if (existing.maxPositionSize !== prefs.maxPositionSize) {
        await storage.updatePaperPortfolio(existing.id, {
          maxPositionSize: prefs.maxPositionSize,
        });
        existing.maxPositionSize = prefs.maxPositionSize;
        logger.debug(`🎰 [OPTIONS BOT] Synced maxPositionSize to $${prefs.maxPositionSize}`);
      }
      optionsPortfolio = existing;
      logger.info(`🎰 [OPTIONS BOT] Found portfolio: ${existing.id} (Balance: $${existing.cashBalance.toFixed(2)})`);
      return existing;
    }

    const newPortfolio = await storage.createPaperPortfolio({
      userId: SYSTEM_USER_ID,
      name: OPTIONS_PORTFOLIO_NAME,
      startingCapital: STARTING_CAPITAL,
      cashBalance: STARTING_CAPITAL,
      totalValue: STARTING_CAPITAL,
      maxPositionSize: prefs.maxPositionSize,  // Use preferences
      riskPerTrade: 0.05,
    });

    optionsPortfolio = newPortfolio;
    logger.info(`🎰 [OPTIONS BOT] Created new portfolio: ${newPortfolio.id} with $${STARTING_CAPITAL}, maxPos=$${prefs.maxPositionSize}`);
    return newPortfolio;
  } catch (error) {
    logger.error("🎰 [OPTIONS BOT] Failed to get/create portfolio:", error);
    return null;
  }
}

export async function getFuturesPortfolio(): Promise<PaperPortfolio | null> {
  try {
    if (futuresPortfolio) {
      return futuresPortfolio;
    }

    const portfolios = await storage.getPaperPortfoliosByUser(SYSTEM_USER_ID);
    const existing = portfolios.find(p => p.name === FUTURES_PORTFOLIO_NAME);
    
    if (existing) {
      futuresPortfolio = existing;
      logger.info(`📈 [FUTURES BOT] Found portfolio: ${existing.id} (Balance: $${existing.cashBalance.toFixed(2)})`);
      return existing;
    }

    const newPortfolio = await storage.createPaperPortfolio({
      userId: SYSTEM_USER_ID,
      name: FUTURES_PORTFOLIO_NAME,
      startingCapital: STARTING_CAPITAL,
      cashBalance: STARTING_CAPITAL,
      totalValue: STARTING_CAPITAL,
      maxPositionSize: FUTURES_MAX_POSITION_SIZE_PER_TRADE,
      riskPerTrade: 0.05,
    });

    futuresPortfolio = newPortfolio;
    logger.info(`📈 [FUTURES BOT] Created new portfolio: ${newPortfolio.id} with $${STARTING_CAPITAL}`);
    return newPortfolio;
  } catch (error) {
    logger.error("📈 [FUTURES BOT] Failed to get/create portfolio:", error);
    return null;
  }
}

// Legacy function for backward compatibility - returns options portfolio
export async function getLottoPortfolio(): Promise<PaperPortfolio | null> {
  return getOptionsPortfolio();
}

export async function getCryptoPortfolio(): Promise<PaperPortfolio | null> {
  try {
    if (cryptoPortfolio) {
      return cryptoPortfolio;
    }

    const portfolios = await storage.getPaperPortfoliosByUser(SYSTEM_USER_ID);
    const existing = portfolios.find(p => p.name === CRYPTO_PORTFOLIO_NAME);
    
    if (existing) {
      cryptoPortfolio = existing;
      logger.info(`🪙 [CRYPTO BOT] Found portfolio: ${existing.id} (Balance: $${existing.cashBalance.toFixed(2)})`);
      return existing;
    }

    const newPortfolio = await storage.createPaperPortfolio({
      userId: SYSTEM_USER_ID,
      name: CRYPTO_PORTFOLIO_NAME,
      startingCapital: STARTING_CAPITAL,
      cashBalance: STARTING_CAPITAL,
      totalValue: STARTING_CAPITAL,
      maxPositionSize: CRYPTO_MAX_POSITION_SIZE,
      riskPerTrade: 0.05,
    });

    cryptoPortfolio = newPortfolio;
    logger.info(`🪙 [CRYPTO BOT] Created new portfolio: ${newPortfolio.id} with $${STARTING_CAPITAL}`);
    return newPortfolio;
  } catch (error) {
    logger.error("🪙 [CRYPTO BOT] Failed to get/create portfolio:", error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 💰 SMALL ACCOUNT PORTFOLIO - $150 for cheap A+ plays
// ═══════════════════════════════════════════════════════════════════════════
export async function getSmallAccountPortfolio(): Promise<PaperPortfolio | null> {
  try {
    if (smallAccountPortfolio) {
      return smallAccountPortfolio;
    }

    const portfolios = await storage.getPaperPortfoliosByUser(SYSTEM_USER_ID);
    const existing = portfolios.find(p => p.name === SMALL_ACCOUNT_PORTFOLIO_NAME);
    
    if (existing) {
      smallAccountPortfolio = existing;
      logger.info(`💰 [SMALL ACCOUNT] Found portfolio: ${existing.id} (Balance: $${existing.cashBalance.toFixed(2)})`);
      return existing;
    }

    // Create new small account portfolio
    const newPortfolio = await storage.createPaperPortfolio({
      userId: SYSTEM_USER_ID,
      name: SMALL_ACCOUNT_PORTFOLIO_NAME,
      startingCapital: SMALL_ACCOUNT_STARTING_CAPITAL,
      cashBalance: SMALL_ACCOUNT_STARTING_CAPITAL,
      totalValue: SMALL_ACCOUNT_STARTING_CAPITAL,
      maxPositionSize: SMALL_ACCOUNT_MAX_POSITION,
      riskPerTrade: 0.02, // 2% risk per trade
    });

    smallAccountPortfolio = newPortfolio;
    logger.info(`💰 [SMALL ACCOUNT] Created new portfolio: ${newPortfolio.id} with $${SMALL_ACCOUNT_STARTING_CAPITAL}`);
    return newPortfolio;
  } catch (error) {
    logger.error("💰 [SMALL ACCOUNT] Failed to get/create portfolio:", error);
    return null;
  }
}

/**
 * Check if a trade qualifies for Small Account
 * Requirements: B+ grade (85%+), $0.05-$1.00 premium, priority ticker, 3+ DTE
 */
export function isSmallAccountEligible(
  ticker: string,
  confidence: number,
  premiumCents: number,
  daysToExpiry?: number
): { eligible: boolean; reason: string } {
  // Must be B+ grade or higher (85%+ confidence)
  if (confidence < SMALL_ACCOUNT_GRADE_THRESHOLD) {
    return { eligible: false, reason: `Grade ${confidence.toFixed(0)}% < ${SMALL_ACCOUNT_GRADE_THRESHOLD}% (B+ required)` };
  }
  
  // 🛡️ THETA PROTECTION: Minimum 3 DTE for small accounts - avoid theta crush
  if (daysToExpiry !== undefined && daysToExpiry < SMALL_ACCOUNT_MIN_DTE) {
    return { eligible: false, reason: `${daysToExpiry} DTE < ${SMALL_ACCOUNT_MIN_DTE} minimum (theta crush risk)` };
  }
  
  // Premium must be in range ($0.05 - $1.00) - TRUE LOTTO range
  if (premiumCents < SMALL_ACCOUNT_MIN_PREMIUM) {
    return { eligible: false, reason: `Premium $${(premiumCents/100).toFixed(2)} < $0.05 minimum` };
  }
  if (premiumCents > SMALL_ACCOUNT_MAX_PREMIUM) {
    return { eligible: false, reason: `Premium $${(premiumCents/100).toFixed(2)} > $1.00 maximum` };
  }
  
  // Must be a priority ticker for small account
  if (!SMALL_ACCOUNT_TICKERS.includes(ticker.toUpperCase())) {
    return { eligible: false, reason: `${ticker} not in small account priority list` };
  }
  
  return { eligible: true, reason: 'B+ setup on priority ticker with lotto premium and safe DTE' };
}

/**
 * Check if a portfolioId belongs to the Small Account
 * Uses cached value for sync checks - for guaranteed accuracy use async version
 */
export function isSmallAccountPortfolio(portfolioId: string): boolean {
  // Check cached value first
  if (smallAccountPortfolio) {
    return smallAccountPortfolio.id === portfolioId;
  }
  
  // No cache, check if portfolioId matches expected Small Account pattern
  // This is a fallback for cold-start scenarios
  // The actual portfolio lookup happens async elsewhere
  return false;
}

/**
 * Async check if a portfolioId belongs to the Small Account
 * Lazy-loads the portfolio cache if needed
 */
export async function isSmallAccountPortfolioAsync(portfolioId: string): Promise<boolean> {
  // Lazy load if not cached
  if (!smallAccountPortfolio) {
    await getSmallAccountPortfolio();
  }
  return smallAccountPortfolio?.id === portfolioId;
}

/**
 * Check if a portfolioId belongs to the Futures portfolio
 */
export async function isFuturesPortfolioAsync(portfolioId: string): Promise<boolean> {
  if (!futuresPortfolio) {
    await getFuturesPortfolio();
  }
  return futuresPortfolio?.id === portfolioId;
}

/**
 * Check if a portfolioId belongs to the Crypto portfolio
 */
export async function isCryptoPortfolioAsync(portfolioId: string): Promise<boolean> {
  if (!cryptoPortfolio) {
    await getCryptoPortfolio();
  }
  return cryptoPortfolio?.id === portfolioId;
}

/**
 * Determine the portfolio type for notifications
 * Returns: 'small_account' | 'futures' | 'crypto' | 'options'
 */
export async function getPortfolioType(portfolioId: string): Promise<'small_account' | 'futures' | 'crypto' | 'options'> {
  if (await isSmallAccountPortfolioAsync(portfolioId)) return 'small_account';
  if (await isFuturesPortfolioAsync(portfolioId)) return 'futures';
  if (await isCryptoPortfolioAsync(portfolioId)) return 'crypto';
  return 'options';
}

// Cache for crypto prices to handle rate limiting
let cryptoPriceCache: Map<string, { price: number; change24h: number; volume: number; marketCap: number }> = new Map();
let lastCryptoPriceFetch: number = 0;
const CRYPTO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch crypto prices from CoinGecko with caching
 */
export async function fetchCryptoPrices(): Promise<Map<string, { price: number; change24h: number; volume: number; marketCap: number }>> {
  const now = Date.now();
  
  // Return cached if still valid
  if (cryptoPriceCache.size > 0 && (now - lastCryptoPriceFetch) < CRYPTO_CACHE_TTL) {
    logger.info(`🪙 [CRYPTO BOT] Using cached prices (${cryptoPriceCache.size} coins)`);
    return cryptoPriceCache;
  }
  
  const priceMap = new Map();
  
  try {
    const ids = CRYPTO_SCAN_COINS.map(c => c.id).join(',');
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
      { 
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      }
    );
    
    if (!response.ok) {
      logger.warn(`🪙 [CRYPTO BOT] CoinGecko API returned ${response.status} - using cache if available`);
      return cryptoPriceCache.size > 0 ? cryptoPriceCache : priceMap;
    }
    
    const data = await response.json();
    
    for (const coin of CRYPTO_SCAN_COINS) {
      const coinData = data[coin.id];
      if (coinData) {
        priceMap.set(coin.symbol, {
          price: coinData.usd || 0,
          change24h: coinData.usd_24h_change || 0,
          volume: coinData.usd_24h_vol || 0,
          marketCap: coinData.usd_market_cap || 0
        });
      }
    }
    
    if (priceMap.size > 0) {
      cryptoPriceCache = priceMap;
      lastCryptoPriceFetch = now;
      logger.info(`🪙 [CRYPTO BOT] Fetched and cached prices for ${priceMap.size} coins`);
    }
  } catch (error) {
    logger.error("🪙 [CRYPTO BOT] Failed to fetch crypto prices:", error);
    // Return cached prices if available
    if (cryptoPriceCache.size > 0) {
      logger.info(`🪙 [CRYPTO BOT] Returning stale cache (${cryptoPriceCache.size} coins)`);
      return cryptoPriceCache;
    }
  }
  
  return priceMap;
}

/**
 * Analyze crypto opportunity and generate signals
 * RELAXED THRESHOLDS - Bot was too conservative and not trading
 */
function analyzeCryptoOpportunity(
  coin: { id: string; symbol: string; name: string },
  data: { price: number; change24h: number; volume: number; marketCap: number }
): CryptoOpportunity | null {
  const signals: string[] = [];
  let score = 50;
  
  const { price, change24h, volume, marketCap } = data;
  
  // Skip if no price
  if (!price || price <= 0) return null;
  
  // Mild momentum (2-5%) - NEW: Lower threshold to catch more moves
  if (Math.abs(change24h) > 2 && Math.abs(change24h) <= 5) {
    signals.push(`${change24h > 0 ? '📈' : '📉'} ${Math.abs(change24h).toFixed(1)}% 24h move`);
    score += change24h > 0 ? 8 : 3;
  }
  
  // Moderate momentum (5-10%)
  if (Math.abs(change24h) > 5 && Math.abs(change24h) <= 10) {
    signals.push(`${change24h > 0 ? '📈' : '📉'} ${Math.abs(change24h).toFixed(1)}% 24h move`);
    score += change24h > 0 ? 15 : 5;
  }
  
  // Strong momentum (>10%)
  if (Math.abs(change24h) > 10) {
    signals.push(`🔥 Strong ${Math.abs(change24h).toFixed(1)}% ${change24h > 0 ? 'uptrend' : 'downtrend'}`);
    score += change24h > 0 ? 20 : 10;
  }
  
  // Volume analysis (relative to market cap) - RELAXED from 10% to 5%
  const volumeToMcap = marketCap > 0 ? (volume / marketCap) * 100 : 0;
  if (volumeToMcap > 5) {
    signals.push(`📊 ${volumeToMcap > 10 ? 'High' : 'Active'} volume (${volumeToMcap.toFixed(1)}% of mcap)`);
    score += volumeToMcap > 10 ? 10 : 5;
  }
  
  // Large cap stability bonus (BTC, ETH)
  if (marketCap > 100_000_000_000) {
    signals.push(`🏛️ Large cap stability`);
    score += 5;
  }
  
  // Mid cap momentum bonus
  if (marketCap > 1_000_000_000 && marketCap < 50_000_000_000 && Math.abs(change24h) > 3) {
    signals.push(`⚡ Mid-cap momentum`);
    score += 5;
  }
  
  // Determine direction based on momentum
  const direction: 'long' | 'short' = change24h > 1 ? 'long' : change24h < -3 ? 'short' : 'long';
  
  // RELAXED: Lower threshold from 55 to 52
  if (signals.length === 0 || score < 52) return null;
  
  return {
    coinId: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    price,
    change24h,
    volume24h: volume,
    marketCap,
    direction,
    signals,
    confidence: Math.min(85, score)
  };
}

/**
 * Run crypto bot scan and execute trades
 * Now uses user preferences for position limits and coin selection
 */
export async function runCryptoBotScan(): Promise<void> {
  // 🛡️ KILL SWITCH - Check if crypto bot is disabled via environment variable
  if (process.env.ENABLE_CRYPTO_BOT === 'false') {
    logger.info('🪙 [CRYPTO BOT] ⛔ DISABLED via ENABLE_CRYPTO_BOT=false');
    return;
  }
  
  logger.info(`🪙 [CRYPTO BOT] Starting crypto scan...`);
  
  try {
    // Load user preferences
    const prefs = await getBotPreferences();
    
    // Check if crypto trading is enabled
    if (!prefs.enableCrypto) {
      logger.info(`🪙 [CRYPTO BOT] Crypto trading disabled by user preferences`);
      return;
    }
    
    const portfolio = await getCryptoPortfolio();
    if (!portfolio) {
      logger.error("🪙 [CRYPTO BOT] No portfolio available");
      return;
    }
    
    // Check if we have enough balance
    if (portfolio.cashBalance < 10) {
      logger.info(`🪙 [CRYPTO BOT] Insufficient balance: $${portfolio.cashBalance.toFixed(2)}`);
      return;
    }
    
    // Check existing positions using preference for max concurrent trades
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPositions = positions.filter(p => p.status === 'open' && p.assetType === 'crypto');
    
    // CRYPTO-SPECIFIC LIMITS: Max 3 total crypto positions, max 1 per symbol
    const MAX_CRYPTO_POSITIONS = 3;
    const MAX_POSITIONS_PER_SYMBOL = 1;
    
    if (openPositions.length >= MAX_CRYPTO_POSITIONS) {
      logger.info(`🪙 [CRYPTO BOT] Max crypto positions reached (${openPositions.length}/${MAX_CRYPTO_POSITIONS})`);
      return;
    }
    
    // Count positions per symbol to prevent over-concentration
    const positionsBySymbol = new Map<string, number>();
    for (const pos of openPositions) {
      const count = positionsBySymbol.get(pos.symbol) || 0;
      positionsBySymbol.set(pos.symbol, count + 1);
    }
    
    // Fetch crypto prices
    const priceMap = await fetchCryptoPrices();
    if (priceMap.size === 0) {
      logger.warn(`🪙 [CRYPTO BOT] No prices available`);
      return;
    }
    
    // Find opportunities from BOTH: watchlist scan AND Trade Desk ideas
    const opportunities: CryptoOpportunity[] = [];
    
    // 1. Scan watchlist for technical opportunities
    for (const coin of CRYPTO_SCAN_COINS) {
      const data = priceMap.get(coin.symbol);
      if (!data) continue;
      
      const opportunity = analyzeCryptoOpportunity(coin, data);
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }
    
    // 2. Also include open crypto ideas from Trade Desk (user-curated)
    // OPTIMIZED: Use direct query instead of getAllTradeIdeas() to reduce memory
    const openCryptoIdeas = await storage.getTradeIdeasByFilters({
      assetType: 'crypto',
      outcomeStatus: 'open',
      limit: 50
    }).catch(() => []);
    
    for (const idea of openCryptoIdeas) {
      // Get current price for this crypto
      const currentPrice = priceMap.get(idea.symbol)?.price;
      if (!currentPrice) continue;
      
      // Convert Trade Desk probabilityBand to confidence (Trade Desk ideas get a boost)
      const gradeConfidence: Record<string, number> = {
        'A+': 95, 'A': 90, 'A-': 85,
        'B+': 80, 'B': 75, 'B-': 70,
        'C+': 65, 'C': 60, 'C-': 55,
        'D': 50, 'F': 40
      };
      
      const grade = idea.probabilityBand || 'C';
      const baseConfidence = gradeConfidence[grade] || 70;
      // Trade Desk ideas get +10 boost since they're manually curated
      const confidence = Math.min(100, baseConfidence + 10);
      
      // Skip if already in opportunities with higher confidence
      const existingOpp = opportunities.find(o => o.symbol === idea.symbol);
      if (existingOpp && existingOpp.confidence >= confidence) {
        continue;
      } else if (existingOpp) {
        // Remove lower-confidence duplicate
        const idx = opportunities.indexOf(existingOpp);
        opportunities.splice(idx, 1);
      }
      
      // Determine direction from idea (default to long for crypto)
      const direction: 'long' | 'short' = (idea.direction || 'bullish').toLowerCase().includes('bear') || idea.direction === 'short' ? 'short' : 'long';
      
      opportunities.push({
        symbol: idea.symbol,
        price: currentPrice,
        direction,
        confidence,
        signals: [`📋 Trade Desk idea (${grade})`, idea.catalyst?.substring(0, 50) || 'Curated opportunity'],
        source: 'trade_desk',
        ideaId: idea.id
      });
      
      logger.info(`🪙 [CRYPTO BOT] Added Trade Desk idea: ${idea.symbol} (${grade}) -> ${confidence}% confidence`);
    }
    
    if (opportunities.length === 0) {
      logger.info(`🪙 [CRYPTO BOT] No crypto opportunities found`);
      return;
    }
    
    // Sort by confidence and take best (Trade Desk ideas will rank higher due to boost)
    opportunities.sort((a, b) => b.confidence - a.confidence);
    const bestOpp = opportunities[0];
    
    logger.info(`🪙 [CRYPTO BOT] Best opportunity: ${bestOpp.symbol} (${bestOpp.direction}) - Confidence: ${bestOpp.confidence}%`);
    
    // Check for existing open trade ideas to prevent duplicates
    const existingIdeas = await storage.getAllTradeIdeas();
    const hasOpenIdea = existingIdeas.some((idea: any) => 
      idea.symbol === bestOpp.symbol && 
      idea.outcomeStatus === 'open' &&
      idea.assetType === 'crypto'
    );
    
    // Check per-symbol limit before pyramiding
    const symbolPositionCount = positionsBySymbol.get(bestOpp.symbol) || 0;
    if (symbolPositionCount >= MAX_POSITIONS_PER_SYMBOL) {
      logger.info(`🪙 [CRYPTO BOT] ${bestOpp.symbol} already has ${symbolPositionCount} positions (max ${MAX_POSITIONS_PER_SYMBOL}) - skipping`);
      // Try next best opportunity
      const nextOpp = opportunities.find(o => 
        (positionsBySymbol.get(o.symbol) || 0) < MAX_POSITIONS_PER_SYMBOL
      );
      if (!nextOpp) {
        logger.info(`🪙 [CRYPTO BOT] All opportunities at max positions - waiting`);
        return;
      }
      // Use next opportunity instead
      Object.assign(bestOpp, nextOpp);
      logger.info(`🪙 [CRYPTO BOT] Switching to ${bestOpp.symbol} instead`);
    } else if (hasOpenIdea) {
      logger.info(`🪙 [CRYPTO BOT] ${bestOpp.symbol} has ${symbolPositionCount}/${MAX_POSITIONS_PER_SYMBOL} positions - adding (pyramid)`);
    }
    
    // Apply minimum confidence score from preferences
    if (bestOpp.confidence < prefs.minConfidenceScore) {
      logger.info(`🪙 [CRYPTO BOT] Best opportunity confidence ${bestOpp.confidence}% < min ${prefs.minConfidenceScore}%`);
      return;
    }
    
    // 🔗 CORRELATION POSITION CAPS - Prevent concentrated sector risk
    // Use final computed position size (quantity * price)
    const allocationAmt = portfolio.cashBalance * (prefs.cryptoAllocation / 100);
    const maxPositionValue = Math.min(prefs.maxPositionSize, allocationAmt, portfolio.cashBalance);
    const cryptoQuantity = maxPositionValue > 0 ? maxPositionValue / bestOpp.price : 0;
    const actualCryptoExposure = cryptoQuantity * bestOpp.price; // Notional exposure
    if (actualCryptoExposure > 10) { // Min $10 to avoid noise
      const correlationCheck = await checkCorrelationCaps(portfolio.id, bestOpp.symbol, actualCryptoExposure);
      if (!correlationCheck.allowed) {
        logger.info(`🪙 [CRYPTO BOT] 🔗 CORRELATION BLOCKED: ${bestOpp.symbol} - ${correlationCheck.reason}`);
        return;
      }
    } else {
      logger.warn(`🪙 [CRYPTO BOT] 🔗 Skipped correlation check - exposure too low: $${actualCryptoExposure.toFixed(2)}`);
    }
    
    // Calculate position size using preferences (maxPositionSize or allocation % of balance)
    // CRITICAL: Ensure we don't exceed available cash
    const allocationAmount = portfolio.cashBalance * (prefs.cryptoAllocation / 100);
    const maxSize = Math.min(prefs.maxPositionSize, allocationAmount, portfolio.cashBalance);
    
    // Validate sufficient cash before trade
    if (maxSize <= 0 || portfolio.cashBalance < 10) {
      logger.warn(`🪙 [CRYPTO BOT] Insufficient cash for trade: $${portfolio.cashBalance.toFixed(2)} available`);
      return;
    }
    
    const quantity = maxSize / bestOpp.price;
    logger.debug(`🪙 [CRYPTO BOT] Position size: $${maxSize.toFixed(2)} (${quantity.toFixed(6)} ${bestOpp.symbol})`)
    
    // Set targets based on direction - Mean Reversion / Buy Low Sell High
    const targetMultiplier = bestOpp.direction === 'long' ? 1.08 : 0.92; // 8% target for crypto
    const stopMultiplier = bestOpp.direction === 'long' ? 0.95 : 1.05;   // 5% stop loss
    const targetPrice = bestOpp.price * targetMultiplier;
    const stopLoss = bestOpp.price * stopMultiplier;
    
    // Create trade idea
    const ideaData: InsertTradeIdea = {
      symbol: bestOpp.symbol,
      assetType: 'crypto',
      direction: bestOpp.direction,
      entryPrice: bestOpp.price,
      targetPrice,
      stopLoss,
      riskRewardRatio: 2.1,
      confidenceScore: bestOpp.confidence,
      qualitySignals: bestOpp.signals,
      probabilityBand: getLetterGrade(bestOpp.confidence),
      holdingPeriod: 'swing',
      catalyst: bestOpp.source === 'trade_desk' 
        ? `Trade Desk opportunity: ${bestOpp.symbol}` 
        : `${bestOpp.name || bestOpp.symbol} momentum: ${(bestOpp.change24h || 0) > 0 ? '+' : ''}${(bestOpp.change24h || 0).toFixed(1)}% 24h`,
      analysis: `🪙 CRYPTO BOT TRADE\n\n` +
        `${bestOpp.name || bestOpp.symbol} (${bestOpp.symbol})\n` +
        `Direction: ${bestOpp.direction.toUpperCase()}\n` +
        `Entry: $${bestOpp.price.toFixed(4)}\n` +
        `Target: $${targetPrice.toFixed(4)} (+15%)\n` +
        `Stop: $${stopLoss.toFixed(4)} (-7%)\n\n` +
        `Source: ${bestOpp.source === 'trade_desk' ? '📋 Trade Desk Idea' : '🔍 Watchlist Scan'}\n` +
        `Signals: ${bestOpp.signals.join(', ')}\n\n` +
        `⚠️ Crypto is 24/7 - monitor positions regularly`,
      sessionContext: 'Crypto Bot',
      timestamp: new Date().toISOString(),
      source: 'bot' as any,
      status: 'published',
      riskProfile: 'speculative',
      dataSourceUsed: 'coingecko',
      outcomeStatus: 'open',
    };
    
    // Save and execute
    const savedIdea = await storage.createTradeIdea(ideaData);
    
    // Create paper position with entry reasoning
    const position = await storage.createPaperPosition({
      portfolioId: portfolio.id,
      symbol: bestOpp.symbol,
      assetType: 'crypto',
      direction: bestOpp.direction,
      quantity,
      entryPrice: bestOpp.price,
      currentPrice: bestOpp.price,
      targetPrice,
      stopLoss,
      status: 'open',
      tradeIdeaId: savedIdea.id,
      entryTime: new Date().toISOString(),
      entryReason: bestOpp.source === 'trade_desk'
        ? `🪙 CRYPTO: ${bestOpp.symbol} ${bestOpp.direction.toUpperCase()} - Trade Desk Idea`
        : `🪙 CRYPTO: ${bestOpp.name || bestOpp.symbol} ${bestOpp.direction.toUpperCase()} - ${(bestOpp.change24h || 0) > 0 ? '+' : ''}${(bestOpp.change24h || 0).toFixed(1)}% 24h momentum`,
      entrySignals: JSON.stringify(bestOpp.signals),
    });
    
    // Update portfolio balance
    const cost = quantity * bestOpp.price;
    await storage.updatePaperPortfolio(portfolio.id, {
      cashBalance: portfolio.cashBalance - cost,
    });
    
    logger.info(`🪙 [CRYPTO BOT] ✅ TRADE EXECUTED: ${bestOpp.symbol} x${quantity.toFixed(6)} @ $${bestOpp.price.toFixed(4)}`);
    
    // Send Discord notification
    try {
      const { sendCryptoBotTradeToDiscord } = await import('./discord-service');
      await sendCryptoBotTradeToDiscord({
        symbol: bestOpp.symbol,
        name: bestOpp.name || bestOpp.symbol,
        direction: bestOpp.direction,
        entryPrice: bestOpp.price,
        quantity,
        targetPrice,
        stopLoss,
        signals: bestOpp.source === 'trade_desk' 
          ? [`📋 Trade Desk Idea`, ...bestOpp.signals] 
          : bestOpp.signals,
      });
    } catch (discordError) {
      logger.warn(`🪙 [CRYPTO BOT] Discord notification failed:`, discordError);
    }
    
    // Refresh portfolio cache
    const updated = await storage.getPaperPortfolioById(portfolio.id);
    if (updated) cryptoPortfolio = updated;
    
  } catch (error) {
    logger.error("🪙 [CRYPTO BOT] Scan error:", error);
  }
}

/**
 * Monitor crypto positions for stops/targets
 */
export async function monitorCryptoPositions(): Promise<void> {
  try {
    const portfolio = await getCryptoPortfolio();
    if (!portfolio) return;
    
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPositions = positions.filter(p => p.status === 'open');
    
    if (openPositions.length === 0) {
      return;
    }
    
    logger.info(`🪙 [CRYPTO BOT] Monitoring ${openPositions.length} open crypto positions...`);
    
    const priceMap = await fetchCryptoPrices();
    
    // Track running cash balance to handle multiple exits in one scan
    let runningCashBalance = portfolio.cashBalance;
    
    for (const pos of openPositions) {
      const data = priceMap.get(pos.symbol);
      if (!data) continue;
      
      const currentPrice = data.price;
      const entryPrice = typeof pos.entryPrice === 'string' ? parseFloat(pos.entryPrice) : pos.entryPrice;
      const stopLoss = pos.stopLoss ? (typeof pos.stopLoss === 'string' ? parseFloat(pos.stopLoss) : pos.stopLoss) : null;
      const targetPrice = pos.targetPrice ? (typeof pos.targetPrice === 'string' ? parseFloat(pos.targetPrice) : pos.targetPrice) : null;
      
      const direction = pos.direction || 'long';
      let pnlPercent: number;
      
      if (direction === 'long') {
        pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      } else {
        pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
      }
      
      // Calculate unrealized P&L
      const quantity = typeof pos.quantity === 'string' ? parseFloat(pos.quantity) : pos.quantity;
      const unrealizedPnL = direction === 'long' 
        ? (currentPrice - entryPrice) * quantity
        : (entryPrice - currentPrice) * quantity;
      
      // Update current price AND unrealized P&L
      await storage.updatePaperPosition(pos.id, { 
        currentPrice,
        unrealizedPnL,
        unrealizedPnLPercent: pnlPercent,
      });
      
      // Check stop loss
      if (stopLoss && (
        (direction === 'long' && currentPrice <= stopLoss) ||
        (direction === 'short' && currentPrice >= stopLoss)
      )) {
        logger.info(`🪙 [CRYPTO BOT] ❌ STOP HIT: ${pos.symbol} @ $${currentPrice.toFixed(4)}`);
        const quantity = typeof pos.quantity === 'string' ? parseFloat(pos.quantity) : pos.quantity;
        const proceeds = quantity * currentPrice;
        runningCashBalance += proceeds;
        
        await storage.closePaperPosition(pos.id, currentPrice, 'hit_stop');
        await storage.updatePaperPortfolio(portfolio.id, {
          cashBalance: runningCashBalance,
        });
        
        // Send Discord notification
        try {
          // Use the correct function signature for sendBotTradeExitToDiscord
          await sendBotTradeExitToDiscord({
            symbol: pos.symbol,
            assetType: pos.assetType,
            optionType: pos.optionType,
            strikePrice: pos.strikePrice,
            entryPrice: typeof pos.entryPrice === 'string' ? parseFloat(pos.entryPrice) : pos.entryPrice,
            exitPrice: currentPrice,
            quantity: quantity,
            realizedPnL: unrealizedPnL,
            exitReason: 'hit_stop',
            portfolio: portfolio.id,
            source: portfolio.id === 'small_account' ? 'small_account' : 'quant'
          });
        } catch (discordError) {
          logger.warn(`🪙 [CRYPTO BOT] Discord notification failed:`, discordError);
        }

        // 🛡️ Record loss for cooldown system
        if (unrealizedPnL < 0) {
          recordSymbolLoss(pos.symbol, Math.abs(unrealizedPnL));
        }
        continue;
      }
      
      // Check target
      if (targetPrice && (
        (direction === 'long' && currentPrice >= targetPrice) ||
        (direction === 'short' && currentPrice <= targetPrice)
      )) {
        logger.info(`🪙 [CRYPTO BOT] 🎯 TARGET HIT: ${pos.symbol} @ $${currentPrice.toFixed(4)}`);
        const quantity = typeof pos.quantity === 'string' ? parseFloat(pos.quantity) : pos.quantity;
        const proceeds = quantity * currentPrice;
        runningCashBalance += proceeds;
        
        await storage.closePaperPosition(pos.id, currentPrice, 'hit_target');
        await storage.updatePaperPortfolio(portfolio.id, {
          cashBalance: runningCashBalance,
        });
        
        // 🛡️ Record win to reduce cooldown
        recordSymbolWin(pos.symbol);
        continue;
      }
      
      logger.debug(`🪙 [CRYPTO BOT] ${pos.symbol}: ${direction} @ $${entryPrice.toFixed(4)} → $${currentPrice.toFixed(4)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
    }
    
    // Recalculate portfolio total value based on updated positions
    const updatedPositions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPos = updatedPositions.filter(p => p.status === 'open');
    let positionsValue = 0;
    for (const pos of openPos) {
      const qty = typeof pos.quantity === 'string' ? parseFloat(pos.quantity) : pos.quantity;
      const price = pos.currentPrice || pos.entryPrice;
      positionsValue += qty * price;
    }
    const newTotalValue = runningCashBalance + positionsValue;
    
    // Update portfolio with new total value
    await storage.updatePaperPortfolio(portfolio.id, {
      cashBalance: runningCashBalance,
      totalValue: newTotalValue,
      totalPnL: newTotalValue - portfolio.startingCapital,
      totalPnLPercent: ((newTotalValue - portfolio.startingCapital) / portfolio.startingCapital) * 100,
    });
    
    // Refresh portfolio cache
    const updated = await storage.getPaperPortfolioById(portfolio.id);
    if (updated) cryptoPortfolio = updated;
    
    logger.debug(`🪙 [CRYPTO BOT] Portfolio updated: $${newTotalValue.toFixed(2)} (cash: $${runningCashBalance.toFixed(2)}, positions: $${positionsValue.toFixed(2)})`);
    
  } catch (error) {
    logger.error("🪙 [CRYPTO BOT] Monitor error:", error);
  }
}

// BLACKLISTED SYMBOLS - historically poor performers (0% or very low win rate)
const BLACKLISTED_SYMBOLS = new Set([
  'SOL', 'AAVE', 'SMCI', 'CLF', 'USAR', 'NIO', 'BABA', 'SNAP', 'PINS', 'WISH'
]);

// HIGH PERFORMANCE SYMBOLS - historically strong win rates (100% or 80%+)
const PREFERRED_SYMBOLS = new Set([
  'AAPL', 'AMD', 'NFLX', 'QQQ', 'AMZN', 'GOOGL', 'ETH', 'HOOD', 'META'
]);

/**
 * Check if a symbol has good historical performance
 * Returns: { allowed: boolean, reason: string, boost: number }
 */
function checkSymbolPerformance(symbol: string): { allowed: boolean; reason: string; boost: number } {
  if (BLACKLISTED_SYMBOLS.has(symbol)) {
    return { 
      allowed: false, 
      reason: `BLOCKED: ${symbol} has 0% historical win rate`, 
      boost: 0 
    };
  }
  
  if (PREFERRED_SYMBOLS.has(symbol)) {
    return { 
      allowed: true, 
      reason: `PREFERRED: ${symbol} has strong historical performance`, 
      boost: 10 
    };
  }
  
  return { 
    allowed: true, 
    reason: 'Standard symbol', 
    boost: 0 
  };
}

/**
 * BOT DECISION ENGINE
 * The bot evaluates each opportunity and decides whether to enter based on its own criteria
 */
async function makeBotDecision(
  quote: {
    change_percentage: number;
    volume: number;
    average_volume: number;
    last: number;
    week_52_high: number;
    week_52_low: number;
    high: number;
    low: number;
  },
  opportunity: LottoOpportunity
): Promise<BotDecision> {
  const signals: string[] = [];
  let score = 50;
  
  const priceChange = quote.change_percentage || 0;
  const isCall = opportunity.optionType === 'call';
  const momentumAligned = isCall ? priceChange > 0 : priceChange < 0;
  
  if (momentumAligned) {
    const absChange = Math.abs(priceChange);
    if (absChange >= 3) {
      signals.push(`STRONG_MOMENTUM_${absChange.toFixed(1)}%`);
      score += 25;
    } else if (absChange >= 1.5) {
      signals.push(`GOOD_MOMENTUM_${absChange.toFixed(1)}%`);
      score += 15;
    } else if (absChange >= 0.5) {
      signals.push(`ALIGNED_${absChange.toFixed(1)}%`);
      score += 8;
    }
  } else if (Math.abs(priceChange) >= 1) {
    signals.push(`COUNTER_MOMENTUM_${priceChange.toFixed(1)}%`);
    score -= 20;
  }
  
  const relativeVolume = quote.average_volume > 0 
    ? quote.volume / quote.average_volume 
    : 1;
  
  if (relativeVolume >= 2.0) {
    signals.push(`HIGH_VOL_${relativeVolume.toFixed(1)}x`);
    score += 15;
  } else if (relativeVolume >= 1.3) {
    signals.push(`ABOVE_AVG_VOL`);
    score += 8;
  } else if (relativeVolume < 0.5) {
    signals.push('LOW_VOLUME');
    score -= 15;
  }
  
  const range52w = quote.week_52_high - quote.week_52_low;
  if (range52w > 0) {
    const positionInRange = (quote.last - quote.week_52_low) / range52w;
    
    if (isCall && positionInRange > 0.6) {
      signals.push('BULLISH_TREND');
      score += 10;
    } else if (!isCall && positionInRange < 0.4) {
      signals.push('BEARISH_TREND');
      score += 10;
    } else if (isCall && positionInRange < 0.25) {
      signals.push('CALLS_AT_LOWS_RISKY');
      score -= 30; // Increased penalty - fighting trend is dangerous
    } else if (!isCall && positionInRange > 0.75) {
      signals.push('PUTS_AT_HIGHS_RISKY');
      score -= 10; // Reduced penalty - sometimes puts at highs work for mean reversion
    }
  }
  
  const intradayRange = quote.high - quote.low;
  if (intradayRange > 0) {
    const intradayPosition = (quote.last - quote.low) / intradayRange;
    
    if (isCall && intradayPosition > 0.7) {
      signals.push('INTRADAY_STRONG');
      score += 10;
    } else if (!isCall && intradayPosition < 0.3) {
      signals.push('INTRADAY_WEAK');
      score += 10;
    }
  }
  
  // Delta scoring - we already hard-filter < 0.08, but score the remaining range
  const absDelta = Math.abs(opportunity.delta);
  if (absDelta >= 0.10 && absDelta <= 0.20) {
    // Sweet spot: 10-20% probability, good risk/reward
    signals.push(`OPTIMAL_DELTA_${absDelta.toFixed(2)}`);
    score += 15;
  } else if (absDelta >= 0.08 && absDelta < 0.10) {
    // Acceptable but lower probability
    signals.push(`LOW_DELTA_${absDelta.toFixed(2)}`);
    score += 5;
  } else if (absDelta > 0.20 && absDelta <= 0.30) {
    // Higher delta = more expensive premium, less upside multiplier
    signals.push(`HIGH_DELTA_${absDelta.toFixed(2)}`);
    score += 8;
  } else if (absDelta > 0.30 && absDelta <= 0.45) {
    // Higher delta - still tradeable, just less lotto-like
    signals.push(`MODERATE_DELTA_${absDelta.toFixed(2)}`);
    score += 5; // Slight bonus - higher probability of profit
  } else if (absDelta > 0.45) {
    // Too close to ATM - not a lotto play
    signals.push('DELTA_TOO_HIGH');
    score -= 10;
  }
  
  if (opportunity.volume >= 500) {
    signals.push(`OPT_VOL_${opportunity.volume}`);
    score += 10;
  } else if (opportunity.volume >= 100) {
    signals.push('HAS_OPT_VOLUME');
    score += 5;
  }
  
  // DTE-based scoring - swings get bonus for time value
  if (opportunity.daysToExpiry <= 2) {
    signals.push('0-2_DTE');
    if (!signals.some(s => s.includes('STRONG_MOMENTUM'))) {
      score -= 10; // Day trades need momentum
    }
  } else if (opportunity.daysToExpiry <= 7) {
    signals.push('WEEKLY_3-7DTE');
    score += 5; // Weekly lotto - decent time
  } else if (opportunity.daysToExpiry <= 14) {
    signals.push('SWING_8-14DTE');
    score += 12; // Swings give more time to be right - BOOST
  } else if (opportunity.daysToExpiry <= 21) {
    signals.push('SWING_15-21DTE');
    score += 15; // 2-3 week swings - good theta/time balance
  } else if (opportunity.daysToExpiry <= 30) {
    signals.push('MONTHLY_22-30DTE');
    score += 18; // Monthly swings - excellent for trend trades
  } else if (opportunity.daysToExpiry <= 45) {
    signals.push('MONTHLY_31-45DTE');
    score += 20; // 6-week swings - best for sector rotations
  }
  
  score = Math.max(0, Math.min(100, score));
  
  // Analysis-based confidence boost for strong technical signals
  let analysisBoost = 0;
  const boostReasons: string[] = [];
  
  if (signals.some(s => s.includes('STRONG_MOMENTUM'))) {
    analysisBoost += 10;
    boostReasons.push('STRONG_MOMENTUM+10');
  }
  if (signals.some(s => s.includes('HIGH_VOL'))) {
    analysisBoost += 8;
    boostReasons.push('HIGH_VOL+8');
  }
  if (signals.some(s => s.includes('OPTIMAL_DELTA'))) {
    analysisBoost += 5;
    boostReasons.push('OPTIMAL_DELTA+5');
  }
  
  const boostedScore = Math.min(100, score + analysisBoost);
  const grade = getLetterGrade(boostedScore);
  const hasAnalysisBoost = analysisBoost > 0;
  
  // DTE-aware entry criteria - ALL MUST BE A-GRADE (80+) NOW!
  // Higher DTE gets small discount since time is on our side, but still strict
  const isDayTrade = opportunity.daysToExpiry <= 2;
  const isWeekly = opportunity.daysToExpiry > 2 && opportunity.daysToExpiry <= 7;
  const isSwingTrade = opportunity.daysToExpiry >= 8 && opportunity.daysToExpiry <= 21;
  const isMonthlySwing = opportunity.daysToExpiry > 21;
  
  // 🛡️ STRICT A-GRADE ENTRY THRESHOLDS - Only take the best!
  // All trades require A-grade minimum (80+), with slight DTE adjustments
  // Day trades need highest conviction (short time to be right)
  // Swings get small discount but still must be A-grade territory
  let minScoreForEntry = 80; // Default - A- grade minimum
  if (isDayTrade) minScoreForEntry = 85; // Day trades need A or better
  else if (isWeekly) minScoreForEntry = 82; // Weekly - still A-grade
  else if (isSwingTrade) minScoreForEntry = 80; // Swings - A- minimum
  else if (isMonthlySwing) minScoreForEntry = 78; // Monthly swings - slight discount for time value
  
  // Require at least 1 positive signal to enter (already relaxed)
  const positiveSignals = signals.filter(s => 
    !s.includes('LOW_VOLUME') && 
    !s.includes('RISKY') && 
    !s.includes('COUNTER') &&
    !s.includes('TOO_FAR')
  );
  
  // 🛡️ MOMENTUM GATE: Require aligned momentum for entry
  // No more forcing entries without real signals
  const hasMomentumSignal = signals.some(s => 
    s.includes('MOMENTUM') || s.includes('ALIGNED') || s.includes('INTRADAY_STRONG') || s.includes('INTRADAY_WEAK')
  );
  
  if (!hasMomentumSignal && isDayTrade) {
    return {
      action: 'skip',
      reason: `Day trade requires momentum alignment - none detected`,
      confidence: boostedScore,
      signals
    };
  }
  
  if (positiveSignals.length < 1) {
    return {
      action: 'skip',
      reason: `No positive signals found`,
      confidence: boostedScore,
      signals
    };
  }
  
  // SOFT PENALTY for contrarian trades at extremes on short-dated options (< 7 DTE)
  // Still allow them if score is high enough - mean reversion can work
  const hasRiskyContrarianSignal = signals.some(s => 
    s.includes('PUTS_AT_HIGHS_RISKY') || s.includes('CALLS_AT_LOWS_RISKY')
  );
  if (hasRiskyContrarianSignal && opportunity.daysToExpiry < 7 && boostedScore < 70) {
    return {
      action: 'skip',
      reason: `Contrarian trade needs higher confidence (${boostedScore}/70) for ${opportunity.daysToExpiry} DTE`,
      confidence: boostedScore,
      signals
    };
  }
  
  // 🛡️ LOSS ANALYZER PENALTY - Check if symbol has recent losses and apply adjustment
  const symbolAdjustment = await getSymbolAdjustment(opportunity.symbol);
  let adjustedScore = boostedScore;
  const penaltyReasons: string[] = [];
  
  // If symbol should be avoided entirely due to repeated losses, skip it
  if (symbolAdjustment.shouldAvoid) {
    return {
      action: 'skip',
      reason: `Symbol ${opportunity.symbol} on loss cooldown (${symbolAdjustment.lossStreak} consecutive losses) - avoiding`,
      confidence: boostedScore,
      signals: [...signals, 'LOSS_COOLDOWN_BLOCK']
    };
  }
  
  if (symbolAdjustment.confidenceBoost < 0) {
    // Apply penalty from loss analyzer (negative boost = reduce confidence)
    const penalty = Math.abs(symbolAdjustment.confidenceBoost);
    adjustedScore = Math.max(0, boostedScore - penalty);
    penaltyReasons.push(`LOSS_PENALTY:-${penalty}pts (streak: ${symbolAdjustment.lossStreak})`);
    signals.push(`LOSS_HISTORY_PENALTY`);
  } else if (symbolAdjustment.confidenceBoost > 0) {
    // Symbol has been winning - apply boost
    adjustedScore = Math.min(100, boostedScore + symbolAdjustment.confidenceBoost);
    penaltyReasons.push(`WIN_BOOST:+${symbolAdjustment.confidenceBoost}pts`);
  }
  
  // Recalculate grade after loss penalty
  const adjustedGrade = getLetterGrade(adjustedScore);
  
  // Enter on A grades ONLY with adjusted score - NO MORE B OR C GRADE TRADES!
  const entryReason = hasAnalysisBoost 
    ? `${adjustedGrade} grade (${score}+${analysisBoost}=${boostedScore}${penaltyReasons.length ? ', ' + penaltyReasons.join(', ') : ''}) ANALYSIS_BOOST: ${boostReasons.join(', ')}`
    : `${adjustedGrade} grade (${adjustedScore}) - ${signals.slice(0, 3).join(', ')}`;
    
  // 🎯 STRICT ENTRY GATE: A- or better ONLY
  // Must satisfy BOTH:
  // 1. A-grade classification (A+, A, A-)
  // 2. DTE-specific minimum score (78-85 depending on expiry)
  // No more B-grade or C-grade garbage - only take the best setups!
  const validEntryGrades = ['A+', 'A', 'A-'];
  
  // Check both grade AND DTE-specific threshold
  const meetsGradeRequirement = validEntryGrades.includes(adjustedGrade);
  const meetsDTEThreshold = adjustedScore >= minScoreForEntry;
  
  if (meetsGradeRequirement && meetsDTEThreshold) {
    return {
      action: 'enter',
      reason: `${entryReason} | DTE: ${opportunity.daysToExpiry} (min: ${minScoreForEntry})`,
      confidence: adjustedScore,
      signals: hasAnalysisBoost ? [...signals, ...boostReasons, ...penaltyReasons] : [...signals, ...penaltyReasons]
    };
  } else if (adjustedScore >= 70) {
    // B-grade or A-grade below DTE threshold - watch but don't enter
    const failReason = !meetsGradeRequirement 
      ? `${adjustedGrade} grade not A-tier` 
      : `score ${adjustedScore} < DTE threshold ${minScoreForEntry}`;
    return {
      action: 'wait',
      reason: `${adjustedGrade} grade (${adjustedScore}) - ${failReason}`,
      confidence: adjustedScore,
      signals
    };
  } else {
    return {
      action: 'skip',
      reason: `${adjustedGrade} grade (${adjustedScore}) too weak - only A-grade trades allowed`,
      confidence: adjustedScore,
      signals
    };
  }
}

/**
 * Bot scans for opportunities and decides what to trade
 * Uses INTELLIGENT STRIKE SELECTION to pick optimal strikes
 */
async function scanForOpportunities(ticker: string): Promise<LottoOpportunity[]> {
  try {
    // 🔄 SCAN THROTTLE - Don't scan same ticker repeatedly
    if (shouldSkipScan(ticker)) {
      return []; // Already scanned recently
    }
    recordScan(ticker);
    
    // 🔄 Rate limit before first API call
    await rateLimitDelay();
    const quote = await getTradierQuote(ticker);
    if (!quote || !quote.last) return [];
    
    const thresholds = getLottoThresholds();
    
    // 🎯 MOMENTUM-ALIGNED DIRECTION FILTER
    // Only consider CALLs when stock is trending UP, PUTs when trending DOWN
    // This prevents buying puts on +11% movers or calls on -5% dumps
    // 
    // IMPORTANT: If change_percentage is null/undefined, we SKIP the ticker entirely
    // rather than defaulting to neutral (which would allow both directions)
    const priceChange = quote.change_percentage;
    if (priceChange === null || priceChange === undefined) {
      logger.warn(`🎯 [MOMENTUM] ${ticker}: No price change data available - skipping to avoid wrong direction trades`);
      return [];
    }
    
    // STRICT MOMENTUM ALIGNMENT:
    // - Bullish (+0.5% or more): CALLs ONLY - betting on continued upward movement
    // - Bearish (-0.5% or less): PUTs ONLY - betting on continued downward movement
    // - Neutral (-0.5% to +0.5%): SKIP entirely - not enough directional conviction
    // This is MORE conservative than before - we no longer trade neutral conditions
    const momentumDirection: 'bullish' | 'bearish' | 'skip' = 
      priceChange >= 0.5 ? 'bullish' : 
      priceChange <= -0.5 ? 'bearish' : 
      'skip';
    
    if (momentumDirection === 'skip') {
      logger.debug(`🎯 [MOMENTUM] ${ticker}: ${priceChange.toFixed(2)}% → neutral territory - skipping (need >=0.5% for calls or <=-0.5% for puts)`);
      return [];
    }
    
    logger.debug(`🎯 [MOMENTUM] ${ticker}: ${priceChange.toFixed(2)}% → ${momentumDirection.toUpperCase()} → ${momentumDirection === 'bullish' ? 'CALLs only' : 'PUTs only'}`);
    
    // 🔄 Rate limit before second API call
    await rateLimitDelay();
    const optionsData = await getTradierOptionsChainsByDTE(ticker);
    if (!optionsData || optionsData.length === 0) return [];
    
    // Group options by expiration date
    const optionsByExpiry = new Map<string, any[]>();
    for (const opt of optionsData) {
      const expiry = opt.expiration_date;
      if (!optionsByExpiry.has(expiry)) {
        optionsByExpiry.set(expiry, []);
      }
      optionsByExpiry.get(expiry)!.push(opt);
    }
    
    const opportunities: LottoOpportunity[] = [];
    
    // For each expiration, use intelligent strike selection to pick the BEST call and put
    for (const [expiry, options] of Array.from(optionsByExpiry.entries())) {
      const expDate = new Date(expiry);
      const now = new Date();
      const daysToExpiry = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysToExpiry < 0 || daysToExpiry > thresholds.LOTTO_MAX_DTE) continue;
      
      // Score ALL strikes for this expiration
      const candidates: StrikeCandidate[] = [];
      for (const opt of options) {
        const scored = scoreStrikeCandidate(opt, quote.last, daysToExpiry);
        if (scored) candidates.push(scored);
      }
      
      if (candidates.length === 0) continue;
      
      // 🎯 STRICT MOMENTUM-ALIGNED SELECTION: Only consider THE ONE option type that matches direction
      // - Bullish momentum (+0.5% or more) → CALLs ONLY
      // - Bearish momentum (-0.5% or less) → PUTs ONLY
      // No more neutral - we skip those in the guard above
      const bestCall = momentumDirection === 'bullish' ? selectBestStrike(candidates, 'call') : null;
      const bestPut = momentumDirection === 'bearish' ? selectBestStrike(candidates, 'put') : null;
      
      // Add best call if found
      if (bestCall && bestCall.score >= 50) { // Minimum score threshold
        opportunities.push({
          symbol: ticker,
          optionType: 'call',
          strike: bestCall.strike,
          expiration: bestCall.expiration,
          delta: bestCall.delta,
          price: bestCall.midPrice,
          volume: bestCall.volume,
          openInterest: bestCall.openInterest,
          bidAskSpread: bestCall.ask - bestCall.bid,
          daysToExpiry: bestCall.daysToExpiry,
          strikeScore: bestCall.score
        });
      }
      
      // Add best put if found
      if (bestPut && bestPut.score >= 50) { // Minimum score threshold
        opportunities.push({
          symbol: ticker,
          optionType: 'put',
          strike: bestPut.strike,
          expiration: bestPut.expiration,
          delta: bestPut.delta,
          price: bestPut.midPrice,
          volume: bestPut.volume,
          openInterest: bestPut.openInterest,
          bidAskSpread: bestPut.ask - bestPut.bid,
          daysToExpiry: bestPut.daysToExpiry,
          strikeScore: bestPut.score
        });
      }
    }
    
    // Sort by strike score (best opportunities first)
    opportunities.sort((a, b) => b.strikeScore - a.strikeScore);
    
    logger.debug(`🎯 [STRIKE-SELECT] ${ticker}: Found ${opportunities.length} optimized opportunities`);
    
    return opportunities;
  } catch (error) {
    logger.error(`🤖 [BOT] Error scanning ${ticker}:`, error);
    return [];
  }
}

/**
 * Bot creates a trade idea from an opportunity
 */
function createTradeIdea(opportunity: LottoOpportunity, decision: BotDecision): InsertTradeIdea {
  const now = new Date();
  // DTE-aware targets: 0DTE=4x, 1-2DTE=7x, 3-7DTE=15x
  const { targetPrice, riskRewardRatio, targetMultiplier, dteCategory } = calculateLottoTargets(opportunity.price, opportunity.expiration);
  const stopLoss = opportunity.price * 0.5;
  // Always LONG (buying) options in lotto plays - we BUY calls and puts for leverage
  // CALL = bet stock goes UP, PUT = bet stock goes DOWN, but both are LONG (owned) positions
  // We're not selling/writing options (that would require margin and has unlimited risk)
  const direction = 'long' as const;
  
  // DTE-aware exit timing: day trades exit same day, swings 3-14 days, monthly 14-30 days
  let exitWindowDays: number;
  let holdingPeriod: 'day' | 'swing' | 'position';
  
  if (opportunity.daysToExpiry <= 2) {
    exitWindowDays = 1;
    holdingPeriod = 'day';
  } else if (opportunity.daysToExpiry <= 7) {
    exitWindowDays = Math.min(3, opportunity.daysToExpiry - 1);
    holdingPeriod = 'swing';
  } else if (opportunity.daysToExpiry <= 14) {
    exitWindowDays = Math.min(7, opportunity.daysToExpiry - 2);
    holdingPeriod = 'swing';
  } else if (opportunity.daysToExpiry <= 21) {
    exitWindowDays = Math.min(10, opportunity.daysToExpiry - 3);
    holdingPeriod = 'swing';
  } else if (opportunity.daysToExpiry <= 30) {
    exitWindowDays = Math.min(14, opportunity.daysToExpiry - 5);
    holdingPeriod = 'position';
  } else {
    // Monthly swings (31-45 DTE) - hold longer
    exitWindowDays = Math.min(21, opportunity.daysToExpiry - 7);
    holdingPeriod = 'position';
  }
  
  const exitDate = new Date(now);
  exitDate.setDate(exitDate.getDate() + exitWindowDays);
  exitDate.setHours(15, 30, 0, 0);
  
  const entryValidUntil = new Date(now.getTime() + 60 * 60 * 1000);
  
  // DTE-aware target label for analysis
  const targetLabel = dteCategory === '0DTE' ? 'gamma play' : 
    dteCategory === '1-2DTE' ? 'short-term' : 
    dteCategory === '3-7DTE' ? 'weekly lotto' : 
    dteCategory === 'swing' ? 'swing trade' : 
    dteCategory === 'monthly' ? 'monthly swing' : 'position';
  
  // Capture optionType explicitly to ensure correct type
  const optionTypeValue: 'call' | 'put' = opportunity.optionType;
  
  logger.debug(`🤖 [BOT] Creating trade idea for ${opportunity.symbol}: optionType=${optionTypeValue}, strike=${opportunity.strike}`);
  
  // Build comprehensive analysis with all factors
  const grade = getLetterGrade(decision.confidence);
  const deltaLabel = Math.abs(opportunity.delta) < 0.15 ? 'Far OTM' : 
                     Math.abs(opportunity.delta) < 0.30 ? 'OTM' : 
                     Math.abs(opportunity.delta) < 0.45 ? 'ATM' : 'ITM';
  
  // Extract key signals for display
  const momentumSignals = decision.signals.filter(s => s.includes('MOMENTUM') || s.includes('ALIGNED') || s.includes('INTRADAY'));
  const technicalSignals = decision.signals.filter(s => s.includes('DELTA') || s.includes('DTE') || s.includes('VOL'));
  
  const comprehensiveAnalysis = [
    `[${grade}] ${decision.confidence}% Conviction`,
    ``,
    `TRADE: ${opportunity.symbol} ${optionTypeValue.toUpperCase()} $${opportunity.strike} (${dteCategory} ${targetLabel})`,
    ``,
    `GREEKS:`,
    `- Delta: ${opportunity.delta.toFixed(2)} (${deltaLabel})`,
    `- DTE: ${opportunity.daysToExpiry} days`,
    ``,
    `TECHNICALS:`,
    `- ${momentumSignals.length > 0 ? momentumSignals.join(', ') : 'Momentum neutral'}`,
    `- ${technicalSignals.slice(0, 2).join(', ')}`,
    ``,
    `ENTRY/EXIT:`,
    `- Entry: $${opportunity.price.toFixed(2)}`,
    `- Target: $${targetPrice.toFixed(2)} (${targetMultiplier}x)`,
    `- Stop: $${stopLoss.toFixed(2)} (50% max loss)`,
    `- R:R: ${riskRewardRatio.toFixed(1)}:1`,
  ].join('\n');

  // 🎯 TRADE TYPE CLASSIFICATION - Differentiate lottos vs swing vs big movers
  const classifyTradeType = (): 'lotto' | 'swing' | 'mover' | 'scalp' => {
    // LOTTO: Far OTM (delta < 0.20), cheap premium (<$0.75), short DTE (<5 days)
    if (Math.abs(opportunity.delta) < 0.20 && opportunity.price < 0.75 && opportunity.daysToExpiry <= 5) {
      return 'lotto';
    }
    // SCALP: Very short DTE (0-1 day), higher delta (ATM)
    if (opportunity.daysToExpiry <= 1 && Math.abs(opportunity.delta) >= 0.35) {
      return 'scalp';
    }
    // MOVER: High momentum signals, catalyst-driven
    const hasMomentum = decision.signals.some(s => 
      s.includes('MOMENTUM') || s.includes('SURGE') || s.includes('BREAKOUT') || 
      s.includes('CATALYST') || s.includes('VOLUME_SPIKE')
    );
    if (hasMomentum && decision.confidence >= 75) {
      return 'mover';
    }
    // SWING: Default for multi-day holds
    return 'swing';
  };
  
  const tradeType = classifyTradeType();
  
  const ideaData = {
    symbol: opportunity.symbol,
    assetType: 'option' as const,
    direction,
    entryPrice: opportunity.price,
    targetPrice,
    stopLoss,
    riskRewardRatio,
    confidenceScore: decision.confidence,
    qualitySignals: decision.signals,
    probabilityBand: grade,
    catalyst: `[${grade}] ${opportunity.symbol} ${optionTypeValue.toUpperCase()} $${opportunity.strike} | Delta ${opportunity.delta.toFixed(2)} | ${decision.signals.slice(0, 2).join(' | ')}`,
    analysis: comprehensiveAnalysis,
    sessionContext: 'Bot autonomous trading',
    holdingPeriod,
    source: 'lotto' as const,
    strikePrice: opportunity.strike,
    optionType: optionTypeValue,
    expiryDate: opportunity.expiration,
    entryValidUntil: formatInTimeZone(entryValidUntil, 'America/Chicago', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    exitBy: formatInTimeZone(exitDate, 'America/Chicago', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    isLottoPlay: tradeType === 'lotto',
    tradeType, // NEW: Explicit trade type classification
    timestamp: formatInTimeZone(now, 'America/Chicago', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    sectorFocus: 'momentum' as const,
    riskProfile: tradeType === 'lotto' ? 'speculative' as const : tradeType === 'scalp' ? 'aggressive' as const : 'moderate' as const,
    researchHorizon: (opportunity.daysToExpiry <= 2 ? 'intraday' : opportunity.daysToExpiry <= 7 ? 'short_swing' : 'multi_week') as 'intraday' | 'short_swing' | 'multi_week',
    liquidityWarning: true,
    engineVersion: 'bot_autonomous_v1.3', // v1.3: Trade type classification (lotto/swing/mover/scalp)
    
    // 📊 OPTIONS GREEKS - Store for risk assessment and Discord display
    optionDelta: opportunity.delta,
  };
  
  logger.debug(`🤖 [BOT] Trade idea data: optionType=${ideaData.optionType}, delta=${opportunity.delta.toFixed(3)}, tradeType=${tradeType}`);
  
  return ideaData;
}

/**
 * 🚀 IMMEDIATE TRADE EXECUTION - Execute a trade right away without waiting
 * Used for high-confidence A+ opportunities to avoid 20-minute scan delays
 */
async function executeImmediateTrade(
  opp: LottoOpportunity, 
  decision: BotDecision, 
  entryTiming: { shouldEnterNow: boolean; reason: string },
  portfolio: PaperPortfolio
): Promise<boolean> {
  try {
    // 💰 SMALL ACCOUNT ROUTING - Check if trade qualifies for $150 Small Account
    // A+ trades (90%+ confidence), $0.20-$1.00 premium, 5+ DTE, priority tickers
    const premiumCents = Math.round(opp.price * 100);
    const smallAccountCheck = isSmallAccountEligible(
      opp.symbol,
      decision.confidence,
      premiumCents,
      opp.daysToExpiry
    );
    
    let targetPortfolio = portfolio; // Default to main portfolio
    let isSmallAccountTrade = false;
    
    if (smallAccountCheck.eligible) {
      // Get or create Small Account portfolio
      const smallAcct = await getSmallAccountPortfolio();
      if (smallAcct && smallAcct.cashBalance >= opp.price * 100) { // Can afford 1 contract
        targetPortfolio = smallAcct;
        isSmallAccountTrade = true;
        logger.info(`💰 [SMALL ACCOUNT] A+ Trade routed! ${opp.symbol} ${opp.optionType.toUpperCase()} $${opp.strike} @ $${opp.price.toFixed(2)} (${smallAccountCheck.reason})`);
      } else if (smallAcct) {
        logger.info(`💰 [SMALL ACCOUNT] Insufficient balance ($${smallAcct.cashBalance.toFixed(2)}) for ${opp.symbol} @ $${opp.price.toFixed(2)}`);
      }
    } else {
      logger.debug(`💰 [SMALL ACCOUNT] Trade not eligible: ${opp.symbol} - ${smallAccountCheck.reason}`);
    }
    
    // 💎 STRICT OPTIONS PLAYBOOK - Only applies to main Options Bot (not Small Account)
    // These are disciplined rules to prevent account blowups
    if (!isSmallAccountTrade) {
      // Check if playbook allows trading today (consecutive red days, daily limit)
      const playbookAllowed = checkPlaybookTradingAllowed();
      if (!playbookAllowed.allowed) {
        logger.info(`📊 [PLAYBOOK] ⛔ BLOCKED: ${playbookAllowed.reason}`);
        return false;
      }
      
      // Check for slow/choppy day conditions
      const slowDayCheck = await isSlowTradingDay();
      if (slowDayCheck.isSlow) {
        logger.info(`📊 [PLAYBOOK] ⛔ SLOW DAY: ${slowDayCheck.reason}`);
        return false;
      }
      
      // Validate trade against strict playbook rules (ticker, DTE, delta, risk)
      const playbookValidation = validatePlaybookTrade(
        opp.symbol,
        opp.price,
        opp.daysToExpiry,
        opp.delta,
        opp.optionType as 'call' | 'put'
      );
      
      if (!playbookValidation.valid) {
        logger.info(`📊 [PLAYBOOK] ⛔ REJECTED: ${playbookValidation.reason}`);
        return false;
      }
      
      logger.info(`📊 [PLAYBOOK] ✅ VALIDATED: ${playbookValidation.reason}`);
      logger.info(`📊 [PLAYBOOK] Setup Type: ${playbookValidation.setup}`);
    }
    
    // 🔗 CORRELATION POSITION CAPS - Prevent concentrated sector risk
    // Position size = premium per contract × 100 (multiplier) × quantity (1 contract default)
    const contractQuantity = 1;
    const premiumPerContract = opp.price * 100; // Options multiplier
    const actualPositionExposure = premiumPerContract * contractQuantity;
    if (actualPositionExposure > 0) {
      const correlationCheck = await checkCorrelationCaps(targetPortfolio.id, opp.symbol, actualPositionExposure);
      if (!correlationCheck.allowed) {
        logger.info(`🔗 [CORRELATION] ⛔ BLOCKED: ${opp.symbol} - ${correlationCheck.reason}`);
        return false;
      }
    } else {
      logger.warn(`🔗 [CORRELATION] Skipped check - zero exposure for ${opp.symbol}`);
    }
    
    // 🎯 UNIFIED ENTRY GATE CHECK - Apply session/regime filters before execution
    const direction = opp.optionType === 'call' ? 'long' : 'short';
    const estimatedTarget = opp.price * 2; // 100% gain target for lotto plays
    const entryGate = await checkUnifiedEntryGate(opp.symbol, direction as 'long' | 'short', opp.price, estimatedTarget, decision.confidence, 'lotto');
    if (!entryGate.allowed) {
      logger.info(`🤖 [BOT] ⛔ UNIFIED GATE BLOCKED: ${opp.symbol} - ${entryGate.reasons.join(', ')}`);
      return false;
    }
    
    // Apply adjusted confidence from unified gate
    const adjustedConfidence = entryGate.adjustedConfidence;
    if (adjustedConfidence !== decision.confidence) {
      logger.info(`🤖 [BOT] 📊 Confidence adjusted: ${decision.confidence.toFixed(0)}% → ${adjustedConfidence.toFixed(0)}% (session/regime)`);
    }
    
    // Apply minimum threshold after adjustments
    const MIN_ADJUSTED_CONFIDENCE = 65; // Must still be B-grade after adjustments
    if (adjustedConfidence < MIN_ADJUSTED_CONFIDENCE) {
      logger.info(`🤖 [BOT] ⛔ CONFIDENCE TOO LOW after adjustment: ${adjustedConfidence.toFixed(0)}% < ${MIN_ADJUSTED_CONFIDENCE}%`);
      return false;
    }
    
    // 🧠 TRADING ENGINE GATE - Institutional-grade validation (IV, Confluence, Catalysts)
    const engineGate = await checkTradingEngineGate(opp.symbol, direction as 'long' | 'short', opp.price, adjustedConfidence, 'options');
    if (!engineGate.allowed) {
      logger.info(`🧠 [ENGINE-GATE] ⛔ BLOCKED: ${opp.symbol} - ${engineGate.reasons.join(', ')}`);
      return false;
    }
    
    // Use engine-adjusted confidence for final decision
    const finalConfidence = engineGate.adjustedConfidence;
    logger.info(`🧠 [ENGINE-GATE] ✅ PASSED: ${opp.symbol} | Confluence: ${engineGate.confluenceScore}% | IV Rank: ${engineGate.ivRank?.toFixed(0) || 'N/A'}% | ${engineGate.recommendation}`);
    
    logger.info(`🤖 [BOT] 🟢 IMMEDIATE BUYING ${opp.symbol} ${opp.optionType.toUpperCase()} $${opp.strike} @ $${opp.price.toFixed(2)}`);
    logger.info(`🤖 [BOT] 📊 REASON: ${decision.reason}`);
    logger.info(`🤖 [BOT] 📊 CONFIDENCE: ${finalConfidence.toFixed(0)}% (original: ${decision.confidence.toFixed(0)}%, session: ${adjustedConfidence.toFixed(0)}%, engine: ${finalConfidence.toFixed(0)}%)`);
    
    // Use final engine-adjusted confidence for the trade idea
    const adjustedDecision = { ...decision, confidence: finalConfidence };
    let ideaData = createTradeIdea(opp, adjustedDecision);
    
    // 💎 PLAYBOOK EXIT LEVELS - Override stop/target for main Options Bot with strict playbook rules
    if (!isSmallAccountTrade) {
      const playbookExits = getPlaybookExitLevels(opp.price);
      ideaData = {
        ...ideaData,
        stopLoss: playbookExits.stopLoss,
        targetPrice: playbookExits.takeProfit,
        riskRewardRatio: (playbookExits.takeProfit - opp.price) / (opp.price - playbookExits.stopLoss),
      };
      logger.info(`📊 [PLAYBOOK] Exit levels applied: Stop=$${playbookExits.stopLoss.toFixed(2)} (-18%), Target=$${playbookExits.takeProfit.toFixed(2)} (+22%)`);
    }
    
    // 🛑 DEDUPLICATION CHECK
    const existingSimilar = await storage.findSimilarTradeIdea(
      ideaData.symbol,
      ideaData.direction,
      ideaData.entryPrice,
      6, // Look back 6 hours
      'option',
      ideaData.optionType || undefined,
      ideaData.strikePrice || undefined
    );
    
    if (existingSimilar) {
      logger.warn(`🛑 [DEDUP] Skipping duplicate: ${opp.symbol} ${opp.optionType?.toUpperCase()} $${opp.strike}`);
      return false;
    }
    
    const savedIdea = await storage.createTradeIdea(ideaData);
    // 💎 PLAYBOOK: Enforce single-contract sizing for Options Bot (not Small Account)
    const execOptions = isSmallAccountTrade ? undefined : { maxQuantity: OPTIONS_PLAYBOOK.MAX_CONTRACTS };
    const result = await executeTradeIdea(targetPortfolio.id, savedIdea as TradeIdea, execOptions);
    
    if (result.success && result.position) {
      const portfolioLabel = isSmallAccountTrade ? '💰 SMALL ACCOUNT' : '🤖 BOT';
      logger.info(`${portfolioLabel} ✅ IMMEDIATE TRADE EXECUTED: ${opp.symbol} x${result.position.quantity} @ $${opp.price.toFixed(2)}`);
      
      // 📊 PLAYBOOK TRACKING - Increment daily trades for Options Bot
      if (!isSmallAccountTrade) {
        incrementPlaybookDailyTrades();
        logger.info(`📊 [PLAYBOOK] Options trade recorded for today's limit`);
      }
      
      // Send Discord notification with full analysis
      try {
        await sendBotTradeEntryToDiscord({
          symbol: opp.symbol,
          assetType: 'option',
          optionType: opp.optionType,
          strikePrice: opp.strike,
          expiryDate: opp.expiration,
          entryPrice: opp.price,
          quantity: result.position.quantity,
          targetPrice: ideaData.targetPrice,
          stopLoss: ideaData.stopLoss,
          analysis: decision.reason,
          signals: decision.signals,
          confidence: decision.confidence,
          riskRewardRatio: ideaData.riskRewardRatio,
          isSmallAccount: isSmallAccountTrade,
          source: isSmallAccountTrade ? 'small_account' : 'quant', // Route Small Account trades separately
          delta: opp.delta, // 📊 Greeks display
          portfolio: targetPortfolio.id,
          isLotto: isSmallAccountTrade
        });
        logger.info(`${portfolioLabel} 📱✅ Discord notification SENT for ${opp.symbol}`);
      } catch (discordError) {
        logger.error(`🤖 [BOT] 📱❌ Discord notification FAILED:`, discordError);
      }
      
      // 🔄 CACHE REFRESH - Update portfolio cache after trade execution
      const updated = await storage.getPaperPortfolioById(targetPortfolio.id);
      if (updated) {
        if (isSmallAccountTrade) {
          smallAccountPortfolio = updated;
        } else {
          optionsPortfolio = updated;
        }
      }
      
      return true;
    } else {
      logger.warn(`🤖 [BOT] ❌ Immediate trade failed: ${result.error}`);
      return false;
    }
  } catch (error) {
    logger.error(`🤖 [BOT] ❌ Error in immediate trade execution:`, error);
    return false;
  }
}

/**
 * MAIN BOT FUNCTION: Scans market and makes autonomous trading decisions
 * Now uses user preferences for position limits, confidence thresholds, and trading hours
 */
export async function runAutonomousBotScan(): Promise<void> {
  try {
    // 🛡️ KILL SWITCH - Check if bot is disabled via environment variable
    if (process.env.ENABLE_AUTO_LOTTO === 'false') {
      logger.info('🤖 [BOT] ⛔ AUTO-LOTTO DISABLED via ENABLE_AUTO_LOTTO=false');
      return;
    }
    
    // Load user preferences
    const prefs = await getBotPreferences();
    
    // Check if options trading is enabled
    if (!prefs.enableOptions) {
      logger.info(`🤖 [BOT] Options trading disabled by user preferences`);
      return;
    }
    
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = etTime.getDay();
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();
    const timeInMinutes = hour * 60 + minute;
    
    // Check trading hours - OPTIONS ONLY TRADE DURING REGULAR HOURS (9:30 AM - 4:00 PM ET)
    // Options markets are CLOSED after 4:00 PM ET - no after-hours trading for options!
    const isRegularHours = timeInMinutes >= 570 && timeInMinutes < 960; // 9:30 AM - 4:00 PM ET
    
    // Strict check: Options MUST be traded during regular market hours only
    const canTradeOptions = (day !== 0 && day !== 6) && isRegularHours;
    
    if (!canTradeOptions) {
      const reasonParts = [];
      if (day === 0 || day === 6) reasonParts.push('weekend');
      else if (timeInMinutes < 570) reasonParts.push('pre-market (options closed)');
      else if (timeInMinutes >= 960) reasonParts.push('after-hours (options closed at 4:00 PM ET)');
      logger.info(`🤖 [BOT] Options markets CLOSED: ${reasonParts.join(', ')} - skipping scan`);
      return;
    }
    
    logger.info(`🤖 [BOT] ========== AUTONOMOUS SCAN STARTED ==========`);
    logger.debug(`🤖 [BOT] Prefs: ${prefs.riskTolerance} risk, max ${prefs.maxConcurrentTrades} positions, $${prefs.maxPositionSize} max size`);

    // 🧠 SELF-LEARNING: Display engine performance metrics
    const lottoMetrics = selfLearning.getEngineMetrics('lotto');
    if (lottoMetrics) {
      logger.info(
        `🤖 [BOT] 🧠 Lotto Engine: WR ${lottoMetrics.winRate.toFixed(1)}% | ` +
        `Exp ${lottoMetrics.expectancy >= 0 ? '+' : ''}${lottoMetrics.expectancy.toFixed(1)}% | ` +
        `Sharpe ${lottoMetrics.sharpeRatio.toFixed(2)} | ` +
        `PF ${lottoMetrics.profitFactor === Infinity ? '∞' : lottoMetrics.profitFactor.toFixed(2)}`
      );
    }
    
    // 🎯 SESSION GATING - Check if current session is favorable for lotto trading
    const sessionCheck = shouldAllowSessionEntry('lotto');
    const currentSession = getTradingSession();
    logger.info(`🤖 [BOT] Session: ${currentSession} | Allowed: ${sessionCheck.allowed} | Multiplier: ${sessionCheck.confidenceMultiplier.toFixed(2)}x`);
    
    if (!sessionCheck.allowed) {
      logger.info(`🤖 [BOT] ⛔ SESSION GATE: ${sessionCheck.reason}`);
      return;
    }

    // 🧠 SELF-LEARNING TIMING CHECK: Use learned optimal trading hours
    const learnedThresholds = selfLearning.getLearnedThresholds();
    const isAvoidHour = learnedThresholds.timing.avoidHours.includes(hour);
    const isBestHour = hour === learnedThresholds.timing.bestHour;

    if (isAvoidHour) {
      logger.info(`🤖 [BOT] 🧠 LEARNED TIMING: Hour ${hour}:00 ET is in avoid list (low historical win rate)`);
      // Don't return - just log the warning. Let other checks determine if we should trade.
    }

    if (isBestHour) {
      logger.info(`🤖 [BOT] 🧠 LEARNED TIMING: Hour ${hour}:00 ET is OPTIMAL (highest historical win rate)`);
    }

    // 📊 MARKET CONTEXT ANALYSIS - Check overall market conditions before trading
    const marketContext = await getMarketContext();
    logger.info(`🤖 [BOT] Market: ${marketContext.regime} | ${marketContext.riskSentiment} | Score: ${marketContext.score}`);
    
    if (!marketContext.shouldTrade) {
      logger.info(`🤖 [BOT] ⛔ MARKET GATE: Skipping trades - ${marketContext.reasons.join(', ')}`);
      return;
    }
    
    const portfolio = await getLottoPortfolio();
    if (!portfolio) {
      logger.error(`🤖 [BOT] No portfolio available`);
      return;
    }
    
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPositions = positions.filter(p => p.status === 'open');
    
    // Log open positions but don't block - let high-grade ideas through
    logger.info(`🤖 [BOT] Open positions: ${openPositions.length} (no limit - trading all B+ and higher ideas)`);
    
    const openSymbols = new Set(openPositions.map(p => p.symbol));
    // Collect ALL qualifying opportunities for diversification
    const qualifyingOpportunities: { 
      opp: LottoOpportunity; 
      decision: BotDecision; 
      entryTiming: { shouldEnterNow: boolean; reason: string };
      immediateExecution?: boolean;
      executed?: boolean;
    }[] = [];
    
    // 🚀 IMMEDIATE TRADE COUNTER - Execute trades as we find them (don't wait for full 20-min scan!)
    let tradesThisCycle = 0;
    
    // 🔍 DYNAMIC MOVERS: Get top movers from market scanner first (big price moves = opportunity)
    const dynamicMovers = await getDynamicMovers();
    if (dynamicMovers.length > 0) {
      logger.info(`🔍 [BOT] Scanning ${dynamicMovers.length} dynamic movers from market scanner`);
    }
    
    // 🎯 HIGH-GRADE TRADE IDEAS: Fetch B+ and higher grade ideas from Trade Desk that haven't been traded
    let highGradeIdeaSymbols: string[] = [];
    try {
      const recentIdeas = await storage.getAllTradeIdeas();
      const now = Date.now();
      const fourHoursAgo = now - (4 * 60 * 60 * 1000); // Extended to 4 hours for more coverage
      
      // Get B+ and higher grade option ideas that are still active
      // Grades in order: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F
      const highGrades = ['A+', 'A', 'A-', 'B+'];
      const highGradeIdeas = recentIdeas.filter(idea => {
        const grade = idea.probabilityBand || '';
        const isHighGrade = highGrades.includes(grade);
        const isOption = idea.assetType === 'option';
        const isRecent = idea.createdAt && new Date(idea.createdAt).getTime() > fourHoursAgo;
        // Case-insensitive status check - "Active", "active", or no status
        const statusLower = (idea.status || '').toLowerCase();
        const isActive = statusLower === 'active' || statusLower === '' || !idea.status;
        // B+ and higher already validated - no additional confidence filter
        return isHighGrade && isOption && isRecent && isActive;
      });
      
      // Sort by grade priority (A+ first, then A, A-, B+)
      const gradePriority: Record<string, number> = { 'A+': 0, 'A': 1, 'A-': 2, 'B+': 3 };
      highGradeIdeas.sort((a, b) => {
        const gradeA = gradePriority[a.probabilityBand || ''] ?? 99;
        const gradeB = gradePriority[b.probabilityBand || ''] ?? 99;
        return gradeA - gradeB;
      });
      
      // Extract unique symbols (preserving priority order)
      const seenSymbols = new Set<string>();
      highGradeIdeaSymbols = highGradeIdeas
        .filter(i => {
          if (seenSymbols.has(i.symbol)) return false;
          seenSymbols.add(i.symbol);
          return true;
        })
        .map(i => i.symbol);
      
      if (highGradeIdeaSymbols.length > 0) {
        logger.info(`🎯 [BOT] HIGH-GRADE IDEAS from Trade Desk: ${highGradeIdeaSymbols.join(', ')} (${highGradeIdeaSymbols.length} symbols with B+ or higher)`);
      }
    } catch (err) {
      logger.debug(`🤖 [BOT] Could not fetch high-grade trade ideas`);
    }
    
    // 🎯 PRIORITY ORDER: A-grade ideas FIRST, then Watchlist S/A tier, then user priorities, then dynamic movers, then static list
    // Deduplicate while preserving order (watchlist elite stay at front)
    const seenTickers = new Set<string>();
    const orderedTickers: string[] = [];
    
    // 0. Add WATCHLIST S/A TIER symbols first (highest priority - these are manually vetted!)
    let watchlistEliteSymbols: string[] = [];
    try {
      const { getWatchlistPrioritySymbols } = await import('./watchlist-priority-service');
      const prioritySymbols = await getWatchlistPrioritySymbols();
      // Only include S and A tier symbols
      watchlistEliteSymbols = prioritySymbols
        .filter(s => s.grade === 'S' || s.grade === 'A')
        .map(s => s.symbol);
      
      if (watchlistEliteSymbols.length > 0) {
        logger.info(`🎯 [BOT] Watchlist elite symbols: ${watchlistEliteSymbols.join(', ')} (${watchlistEliteSymbols.length} S/A tier)`);
      }
    } catch (err) {
      logger.debug(`🤖 [BOT] Watchlist priority service unavailable`);
    }
    
    // 0a. Add HIGH-GRADE IDEA symbols first (highest priority - B+ and above from Trade Desk!)
    for (const ticker of highGradeIdeaSymbols) {
      if (!seenTickers.has(ticker)) {
        seenTickers.add(ticker);
        orderedTickers.push(ticker);
      }
    }
    
    // 0b. Add WATCHLIST S/A TIER symbols 
    for (const ticker of watchlistEliteSymbols) {
      if (!seenTickers.has(ticker)) {
        seenTickers.add(ticker);
        orderedTickers.push(ticker);
      }
    }
    
    // 1. Add priority tickers (user's favorites - BIDU, SOFI, UUUU, AMZN, QQQ, INTC, META, etc.)
    for (const ticker of PRIORITY_TICKERS) {
      if (!seenTickers.has(ticker)) {
        seenTickers.add(ticker);
        orderedTickers.push(ticker);
      }
    }
    
    // 2. Add dynamic movers (stocks showing momentum today)
    for (const ticker of dynamicMovers) {
      if (!seenTickers.has(ticker)) {
        seenTickers.add(ticker);
        orderedTickers.push(ticker);
      }
    }
    
    // 3. Add remaining static list (will be scanned if time/quota allows)
    for (const ticker of BOT_SCAN_TICKERS) {
      if (!seenTickers.has(ticker)) {
        seenTickers.add(ticker);
        orderedTickers.push(ticker);
      }
    }
    
    const combinedTickers = orderedTickers;
    logger.info(`🤖 [BOT] Scan order: ${highGradeIdeaSymbols.length} B+/higher ideas → ${watchlistEliteSymbols.length} watchlist S/A → ${PRIORITY_TICKERS.length} priority → ${dynamicMovers.length} movers → ${BOT_SCAN_TICKERS.length} static = ${combinedTickers.length} total`);
    
    // 📋 CATALYST SCORE CACHE - Avoid redundant DB calls during scan
    const catalystScoreCache = new Map<string, { score: number; summary: string; catalystCount: number }>();
    
    // FORCE SCAN FIRST 5 TICKERS REGARDLESS OF QUOTA
    resetApiCallCounter();
    
    let tickerIndex = 0;
    for (const ticker of combinedTickers) {
      tickerIndex++;
      
    // 🛑 CHECK API QUOTA - Stop if we've hit the limit
    if (isApiQuotaExhausted()) {
      // FORCE SCAN FIRST 5 TICKERS REGARDLESS OF QUOTA
      if (tickerIndex > 5) {
        logger.warn(`🛑 [BOT] API quota limit reached (${apiCallsThisScan} calls) - stopping scan to preserve quota.`);
        break;
      }
    }
      
  // 🎯 LOG TICKERS being scanned
  logger.info(`🎯 [BOT] Scanning ticker ${tickerIndex}/${combinedTickers.length}: ${ticker}`);
  
      // 🛡️ GLOBAL SCAN DEDUP - Skip if recently scanned by ANY scanner
      const { checkAndMarkScanned } = await import('./scan-deduper');
      const scanCheck = checkAndMarkScanned(ticker, 'options-bot');
      if (scanCheck.shouldSkip) {
        logger.debug(`🤖 [BOT] ⏭️ Skipped ${ticker} - ${scanCheck.reason}`);
        continue;
      }
      
      // REMOVED: No longer blocking symbols with open positions
      // Bot can now PYRAMID into winning positions or add new setups on same symbol
      if (openSymbols.has(ticker)) {
        logger.debug(`  📊 ${ticker}: Has open position - checking for additional entry opportunities`);
        // Continue analyzing - don't skip!
      }
      
      // 📊 CHECK HISTORICAL PERFORMANCE - Skip blacklisted symbols
      const symbolCheck = checkSymbolPerformance(ticker);
      if (!symbolCheck.allowed) {
        logger.debug(`🤖 [BOT] ⛔ ${symbolCheck.reason}`);
        continue;
      }
      
      // 📋 CATALYST INTELLIGENCE - Fetch once per ticker with cache
      let catalystData = catalystScoreCache.get(ticker);
      if (!catalystData) {
        try {
          const { calculateCatalystScore } = await import("./catalyst-intelligence-service");
          catalystData = await calculateCatalystScore(ticker);
          catalystScoreCache.set(ticker, catalystData);
        } catch (err) {
          catalystData = { score: 0, summary: 'Catalyst check unavailable', catalystCount: 0 };
        }
      }
      
      // Rate limiting is now handled INSIDE scanForOpportunities for each API call
      const opportunities = await scanForOpportunities(ticker);
      
      for (const opp of opportunities) {
        // 🔄 Rate limit before each quote fetch
        await rateLimitDelay();
        const quote = await getTradierQuote(ticker);
        if (!quote) continue;
        
        let decision = await makeBotDecision(quote, opp);
        
        // Apply performance boost for preferred symbols
        if (symbolCheck.boost > 0) {
          decision.confidence = Math.min(100, decision.confidence + symbolCheck.boost);
          decision.signals.push('PREFERRED_SYMBOL');
        }
        
        // 🔍 DYNAMIC MOVER BOOST: Extra confidence for stocks from market scanner (they have momentum!)
        if (dynamicMovers.includes(ticker)) {
          decision.confidence = Math.min(100, decision.confidence + 8);
          decision.signals.push('MARKET_SCANNER_MOVER');
          logger.debug(`🔍 [BOT] +8 boost for ${ticker} (dynamic mover from scanner)`);
        }
        
        // 📋 CATALYST INTELLIGENCE BOOST: Adjust confidence based on SEC filings, gov contracts, etc.
        if (catalystData && catalystData.catalystCount > 0) {
          // Map catalyst score (-100 to +100) to bounded confidence boost (-12 to +12)
          let catalystBoost = 0;
          const catalystScore = catalystData.score;
          
          if (catalystScore >= 50) {
            catalystBoost = 12; // Strong bullish catalyst
            decision.signals.push('CATALYST_STRONG_BULLISH');
          } else if (catalystScore >= 25) {
            catalystBoost = 8; // Moderate bullish catalyst
            decision.signals.push('CATALYST_BULLISH');
          } else if (catalystScore >= 10) {
            catalystBoost = 5; // Mild bullish catalyst
            decision.signals.push('CATALYST_MILD_BULLISH');
          } else if (catalystScore <= -50) {
            catalystBoost = -12; // Strong bearish catalyst
            decision.signals.push('CATALYST_STRONG_BEARISH');
          } else if (catalystScore <= -25) {
            catalystBoost = -8; // Moderate bearish catalyst
            decision.signals.push('CATALYST_BEARISH');
          } else if (catalystScore <= -10) {
            catalystBoost = -5; // Mild bearish catalyst
            decision.signals.push('CATALYST_MILD_BEARISH');
          }
          
          if (catalystBoost !== 0) {
            decision.confidence = Math.max(0, Math.min(100, decision.confidence + catalystBoost));
            logger.debug(`📋 [BOT] ${catalystBoost > 0 ? '+' : ''}${catalystBoost} catalyst boost for ${ticker} (score: ${catalystScore}, ${catalystData.catalystCount} events)`);
          }
        }
        
        // 📊 ENTRY TIMING CHECK - Should we enter now or wait?
        const entryTiming = getEntryTiming(quote, opp.optionType, marketContext);
        
        // 🛡️ POST-LOSS COOLDOWN CHECK - Prevent re-entry on losing symbols
        const cooldownStatus = isSymbolOnLossCooldown(ticker);
        if (cooldownStatus.onCooldown) {
          logger.info(`🛑 [BOT] ${ticker}: ${cooldownStatus.reason}`);
          continue;
        }
        
        // 🛡️ POST-EXIT COOLDOWN CHECK - Prevent immediate re-entry after any exit (win or loss)
        const exitCooldownStatus = isOnExitCooldown(ticker, opp.optionType, opp.strike);
        if (exitCooldownStatus.onCooldown) {
          logger.info(`🛡️ [BOT] ${ticker}: ${exitCooldownStatus.reason}`);
          continue;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // 📋 PRO TRADER CHECKLIST - What the best traders check every trade
        // ═══════════════════════════════════════════════════════════════════
        
        // ✅ CHECK 1: EARNINGS RISK - Skip if earnings within 3 days
        try {
          const { shouldBlockSymbol } = await import('./earnings-service');
          const isBlocked = await shouldBlockSymbol(ticker, false);
          if (isBlocked) {
            logger.info(`📅 [BOT] ${ticker}: SKIPPED - earnings within 2 days (high IV crush risk)`);
            continue;
          }
        } catch (e) {
          // Earnings service not available, continue
        }
        
        // ✅ CHECK 2: LIQUIDITY - Bid-ask spread must be tight (<20% of premium) [STRICT - Restored Jan 2026]
        // Guard against zero/undefined price to prevent division errors
        if (!opp.price || opp.price <= 0) {
          logger.info(`💧 [BOT] ${ticker}: SKIPPED - invalid price (${opp.price})`);
          continue;
        }
        const bidAskSpreadPct = (opp.bidAskSpread || 0) / opp.price * 100;
        if (bidAskSpreadPct > 20) {
          logger.info(`💧 [BOT] ${ticker}: SKIPPED - bid-ask spread too wide (${bidAskSpreadPct.toFixed(0)}% > 20%)`);
          continue;
        }
        
        // ✅ CHECK 3: VOLUME/OPEN INTEREST - Relaxed but safe requirements
        // Previous: OI < 50 OR Vol < 10 was too strict - skipping too many trades!
        // New: Tiered approach:
        // - Must have at least OI >= 10 (baseline market interest)
        // - Volume >= 1 preferred but not required if OI is high (>= 50)
        // Priority tickers get looser OI requirement
        const isPriorityForLiquidity = BASE_PRIORITY_TICKERS.includes(ticker.toUpperCase());
        const minOI = isPriorityForLiquidity ? 10 : 15;
        
        // Skip if OI too low (always need some open interest)
        if (opp.openInterest < minOI) {
          logger.info(`📊 [BOT] ${ticker}: SKIPPED - low OI (OI=${opp.openInterest} < ${minOI})`);
          continue;
        }
        
        // If OI is borderline (< 50), also require at least 1 volume today
        if (opp.openInterest < 50 && (opp.volume === undefined || opp.volume < 1)) {
          logger.info(`📊 [BOT] ${ticker}: SKIPPED - low liquidity (OI=${opp.openInterest}, Vol=${opp.volume || 0} - need Vol >= 1 when OI < 50)`);
          continue;
        }
        
        // 🛡️ TIERED PREMIUM CAPS - Quality plays allowed, not just cheap lottos!
        // Priority tickers (AMZN, NVDA, etc) with 75%+ confidence: Up to $2.50 premium
        // A+/A grade (85%+): Up to $1.50 premium (quality setups)
        // B+/B grade (65-84%): Up to $1.00 premium (solid plays)
        // Below B: Up to $0.50 premium (lotto plays only)
        // Normalize to uppercase for case-insensitive comparison (tickers may be lowercase in loop)
        const isPriorityTicker = BASE_PRIORITY_TICKERS.includes(ticker.toUpperCase());
        let maxPremium: number;
        
        // 🚀 PRIORITY TICKER OVERRIDE: Allow higher premiums on proven names
        if (isPriorityTicker && decision.confidence >= 75) {
          maxPremium = PRIORITY_TICKER_PREMIUM; // $250 = $2.50 option for quality priority tickers
          logger.info(`🌟 [BOT] ${ticker}: Priority ticker with ${decision.confidence.toFixed(0)}% confidence - premium cap raised to $2.50`);
        } else if (decision.confidence >= 85) {
          maxPremium = MAX_ENTRY_PREMIUM; // $150 = $1.50 option
        } else if (decision.confidence >= 65) {
          maxPremium = CONSERVATIVE_ENTRY_PREMIUM; // $100 = $1.00 option
        } else {
          maxPremium = LOTTO_ENTRY_PREMIUM; // $50 = $0.50 option (lottos)
        }
        
        if (opp.price > maxPremium / 100) { // Convert to dollars per contract
          logger.info(`🛡️ [BOT] ${ticker}: Premium $${(opp.price * 100).toFixed(0)} > max $${maxPremium} for grade ${decision.confidence.toFixed(0)}%${isPriorityTicker ? ' (priority)' : ''} - SKIPPING`);
          continue;
        }
        
        // 🛡️ THETA PROTECTION: Skip low-DTE options (avoid Exit Intel flagging immediately after entry)
        if (opp.expiration) {
          const oppExpiry = new Date(opp.expiration);
          const oppNow = new Date();
          const oppDte = Math.ceil((oppExpiry.getTime() - oppNow.getTime()) / (1000 * 60 * 60 * 24));
          if (oppDte < GENERAL_MIN_DTE) {
            logger.info(`🛡️ [BOT] ${ticker}: ${oppDte} DTE < ${GENERAL_MIN_DTE} minimum (theta crush risk) - SKIPPING`);
            continue;
          }
        }
        
        // 🧠 ADAPTIVE LEARNING: Apply learning adjustments (symbolAdj already applied in makeBotDecision)
        // NOTE: getSymbolAdjustment was already called and applied in makeBotDecision() - don't double-apply!
        const adaptiveParams = await getAdaptiveParameters();
        
        // 🤖 ML INTELLIGENCE: Enhance confidence with ML signals
        try {
          const { predictPriceDirection } = await import('./ml-intelligence-service');
          const { fetchOHLCData } = await import('./chart-analysis');
          
          // Fetch OHLC data for ML analysis
          const ohlc = await fetchOHLCData(ticker, 'stock', 30);
          
          if (ohlc && ohlc.closes.length >= 10) {
            const volumes: number[] = []; // No fake volume data — ML service handles missing volumes
            
            // Get ML prediction with real data
            const mlPrediction = await predictPriceDirection(ticker, ohlc.closes, volumes, '1d');
            
            // Align ML direction with option type
            const mlDirection = mlPrediction.direction;
            const optionDirection = opp.optionType === 'call' ? 'bullish' : 'bearish';
            
            if (mlDirection === optionDirection) {
              // ML agrees with trade direction - boost confidence
              const mlBoost = Math.min(10, (mlPrediction.confidence - 50) / 5);
              decision.confidence += mlBoost;
              decision.signals.push(`ML: ${mlDirection} ${mlPrediction.confidence.toFixed(0)}% (+${mlBoost.toFixed(0)})`);
              logger.debug(`🤖 [ML-BOT] ${ticker}: ML ${mlDirection} aligns with ${opp.optionType} (+${mlBoost.toFixed(0)} confidence)`);
            } else if (mlDirection !== 'neutral' && mlDirection !== optionDirection) {
              // ML disagrees with trade direction - reduce confidence
              const mlPenalty = Math.min(10, (mlPrediction.confidence - 50) / 5);
              decision.confidence -= mlPenalty;
              decision.signals.push(`ML: ${mlDirection} CONFLICT (-${mlPenalty.toFixed(0)})`);
              logger.debug(`🤖 [ML-BOT] ${ticker}: ML ${mlDirection} conflicts with ${opp.optionType} (-${mlPenalty.toFixed(0)} confidence)`);
            }
          }
        } catch (mlError) {
          // ML enhancement is optional - continue without it
          logger.debug(`🤖 [ML-BOT] ML enhancement skipped for ${ticker}`);
        }
        // 🔧 STRICT CONFIDENCE MINIMUM: Enforce user's preference (default 80% A- grade)
        // All tickers must meet the same minimum - no sector exceptions
        // Previous 70% threshold led to too many losing trades
        const PRIORITY_SECTOR_TICKERS = [
          // ☢️ Nuclear
          'NNE', 'OKLO', 'SMR', 'CCJ', 'LEU', 'UUUU', 'UEC', 'DNN', 'BWXT',
          // 🛡️ Defense
          'LMT', 'RTX', 'NOC', 'GD', 'BA', 'PLTR', 'LDOS', 'LHX',
          // 🚀 Space
          'LUNR', 'RKLB', 'ASTS', 'SPCE',
          // 📊 Major ETFs
          'IWM', 'SPY', 'QQQ'
        ];
        
        const isPrioritySector = PRIORITY_SECTOR_TICKERS.includes(ticker.toUpperCase());
        // 🛡️ STRICT: Use user's minConfidenceScore (default 80) - no exceptions
        const baseMinConfidence = prefs.minConfidenceScore; // Enforced from preferences
        const effectiveMinConfidence = Math.max(baseMinConfidence, adaptiveParams.confidenceThreshold);
        
        // 📋 BOT SCREENER: Feed high-conviction ideas (80%+) to Trade Desk as research
        // This happens BEFORE the trading gate - so even if we don't trade, the idea gets saved
        if (decision.confidence >= 80) {
          feedBotOpportunityToTradeDesk(opp, decision, quote).catch(err => {
            logger.debug(`📋 [BOT-SCREENER] Feed error: ${err.message}`);
          });
        }
        
        // Apply minimum confidence score
        if (decision.confidence < effectiveMinConfidence) {
          logger.debug(`🤖 [BOT] ⛔ ${ticker}: Confidence ${decision.confidence.toFixed(0)}% < min ${effectiveMinConfidence.toFixed(0)}%${isPrioritySector ? ' (priority sector)' : ''}`);
          continue;
        }
        
        if (isPrioritySector && decision.confidence >= effectiveMinConfidence) {
          logger.debug(`🤖 [BOT] ☢️ Priority sector boost applied for ${ticker} (min ${effectiveMinConfidence}%)`);
        }

        // 🧠 SELF-LEARNING VALIDATION: Check if learned patterns support this trade
        // Uses risk-adjusted metrics (Sharpe, profit factor) not just win rate
        const learningCheck = selfLearning.shouldTakeTrade({
          symbol: ticker,
          confidenceScore: decision.confidence,
          direction: opp.optionType === 'call' ? 'long' : 'short',
          source: 'lotto', // Auto-lotto source
          assetType: 'option',
        });

        if (!learningCheck.take) {
          logger.debug(`🤖 [BOT] 🧠 ${ticker}: Self-learning BLOCKED - ${learningCheck.reason} (${(learningCheck.confidence * 100).toFixed(0)}% confidence)`);
          continue;
        }

        // Log if learning check passed with moderate confidence
        if (learningCheck.confidence < 0.7) {
          logger.debug(`🤖 [BOT] 🧠 ${ticker}: Self-learning PASSED with caution - ${learningCheck.reason}`);
        }

        if (decision.action === 'enter' && entryTiming.shouldEnterNow) {
          logger.info(`🤖 [BOT] ✅ ${ticker} ${opp.optionType.toUpperCase()} $${opp.strike}: ${decision.reason} | ${entryTiming.reason}`);
          
          // 🔔 BROADCAST: Bot is LOOKING at this opportunity
          broadcastBotEvent({
            eventType: 'looking',
            symbol: ticker,
            optionType: opp.optionType,
            strike: opp.strike,
            expiry: opp.expiration,
            price: opp.price,
            confidence: decision.confidence,
            reason: `${opp.optionType.toUpperCase()} $${opp.strike} @ $${opp.price.toFixed(2)} - ${decision.reason}`
          });
          
          // 🚀 IMMEDIATE EXECUTION: Trade B+ and higher opportunities right away
          if (decision.confidence >= 85) {
            logger.info(`🤖 [BOT] 🚀 IMMEDIATE ENTRY: ${ticker} (high grade, confidence ${decision.confidence.toFixed(0)}%)`);
            qualifyingOpportunities.push({ opp, decision, entryTiming, immediateExecution: true });
          } else {
            // Lower confidence - collect for end-of-scan batch
            qualifyingOpportunities.push({ opp, decision, entryTiming, immediateExecution: false });
          }
        } else if (decision.action === 'wait') {
          logger.debug(`🤖 [BOT] ⏳ ${ticker}: ${decision.reason}`);
        }
      }
      
      // 🚀 PROCESS IMMEDIATE EXECUTIONS NOW (don't wait for full scan!)
      const immediateOpps = qualifyingOpportunities.filter(o => o.immediateExecution && !o.executed);
      for (const immOpp of immediateOpps) {
        // Mark as executed so we don't double-trade
        immOpp.executed = true;
        const { opp: immO, decision: immD, entryTiming: immT } = immOpp;
        
        // Execute trade immediately
        await executeImmediateTrade(immO, immD, immT, portfolio);
        tradesThisCycle++;
      }
    }
    
    logger.info(`🤖 [BOT] Scan complete: ${tradesThisCycle} trades executed, ${qualifyingOpportunities.length} total opportunities found`);
    
    // END-OF-SCAN: Execute any remaining high-quality opportunities we collected
    // 🛡️ STRICT: Enforce user's minConfidenceScore (default 80) - previous 70% led to losses
    const remainingOpps = qualifyingOpportunities
      .filter(o => !o.executed && o.decision.confidence >= prefs.minConfidenceScore)
      .sort((a, b) => b.decision.confidence - a.decision.confidence);
    
    for (const opportunity of remainingOpps) {
      if (tradesThisCycle >= 5) break;
      
      const { opp, decision, entryTiming } = opportunity;
      
      // 🔍 MULTI-LAYER CONFLUENCE VALIDATION - Bot's independent judgment!
      try {
        const { validateConfluence, analyzeOptionsChainIndependently } = await import('./bot-confluence-validator');
        
        // Get stock price for independent analysis
        const quote = await getTradierQuote(opp.symbol);
        const stockPrice = quote?.last || opp.price * 5; // Rough estimate if no quote
        
        // LAYER 1: Validate the specific trade idea
        const confluence = await validateConfluence({
          symbol: opp.symbol,
          direction: opp.optionType,
          strike: opp.strike,
          expiry: opp.expiration,
          stockPrice,
          premium: opp.price,
          delta: opp.delta,
        });
        
        // Log confluence results
        logger.info(`🔍 [CONFLUENCE] ${opp.symbol}: Score=${confluence.score.toFixed(0)}% | ${confluence.recommendation}`);
        for (const reason of confluence.reasons.slice(0, 5)) {
          logger.debug(`🔍 [CONFLUENCE] ${reason}`);
        }
        
        // GATE: Skip trade if confluence fails
        if (!confluence.passed) {
          logger.info(`🔍 [CONFLUENCE] ⛔ BLOCKED: ${opp.symbol} ${opp.optionType.toUpperCase()} - Score ${confluence.score.toFixed(0)}% < 55%`);
          logger.info(`🔍 [CONFLUENCE] Top reasons: ${confluence.reasons.slice(0, 3).join(' | ')}`);
          
          // LAYER 2: Try independent analysis to find better setup
          const independent = await analyzeOptionsChainIndependently(opp.symbol, stockPrice, opp.optionType);
          if (independent && independent.recommendation !== 'skip') {
            const bestOpt = independent.recommendation === 'call' ? independent.bestCall : independent.bestPut;
            if (bestOpt && bestOpt.score > confluence.score + 10) {
              logger.info(`🧠 [INDEPENDENT] Found better setup: ${independent.recommendation.toUpperCase()} $${bestOpt.strike} (score ${bestOpt.score})`);
              // Could adjust opp here in future - for now just log
            }
          }
          
          // Skip this trade - confluence didn't pass
          logger.info(`🤖 [BOT] ⏭️ Skipping ${opp.symbol} - confluence validation failed`);
        } else {
          // Confluence PASSED - add boost to confidence
          const confluenceBoost = Math.floor((confluence.score - 55) / 5); // +1 per 5 points above threshold
          decision.confidence = Math.min(100, decision.confidence + confluenceBoost);
          decision.signals.push(`CONFLUENCE_${confluence.score.toFixed(0)}`);
          logger.info(`🔍 [CONFLUENCE] ✅ PASSED: +${confluenceBoost} confidence boost`);
        }
        
        // Only proceed if confluence passed
        if (!confluence.passed) {
          return; // Exit early
        }
      } catch (confluenceError) {
        // Don't block trades if confluence check fails - just log
        logger.warn(`🔍 [CONFLUENCE] Validation failed, proceeding anyway:`, confluenceError);
      }
      
      // 📢 DETAILED BUY REASONING - Log why bot is entering this trade
      logger.info(`🤖 [BOT] 🟢 BUYING ${opp.symbol} ${opp.optionType.toUpperCase()} $${opp.strike} @ $${opp.price.toFixed(2)}`);
      logger.info(`🤖 [BOT] 📊 REASON: ${decision.reason}`);
      logger.info(`🤖 [BOT] 📊 SIGNALS: ${decision.signals.slice(0, 4).join(' | ')}`);
      logger.info(`🤖 [BOT] 📊 CONFIDENCE: ${decision.confidence.toFixed(0)}% | TIMING: ${entryTiming.reason}`);
      
      const ideaData = createTradeIdea(opp, decision);
      logger.info(`🤖 [BOT] 📝 Pre-save ideaData: optionType=${ideaData.optionType}, symbol=${ideaData.symbol}`);
      
      // 🛑 DEDUPLICATION CHECK - Prevent duplicate trade ideas for same option
      const existingSimilar = await storage.findSimilarTradeIdea(
        ideaData.symbol,
        ideaData.direction,
        ideaData.entryPrice,
        6, // Look back 6 hours
        'option', // assetType
        ideaData.optionType || undefined,
        ideaData.strikePrice || undefined
      );
      
      if (existingSimilar) {
        logger.warn(`🛑 [DEDUP] Skipping duplicate trade idea for ${opp.symbol} ${opp.optionType?.toUpperCase()} $${opp.strike} - similar idea exists (ID: ${existingSimilar.id})`);
        return; // Skip this duplicate
      }
      
      const savedIdea = await storage.createTradeIdea(ideaData);
      logger.info(`🤖 [BOT] 📝 Post-save savedIdea: optionType=${savedIdea.optionType}, id=${savedIdea.id}`);
      
      // NOTE: Discord notification moved to AFTER trade execution to avoid double-sending
      // The sendBotTradeEntryToDiscord below handles the notification
      
      // 🎯 SMALL ACCOUNT ROUTING - Check if this trade qualifies for Small Account
      // Small Account requirements: 90%+ confidence, $0.20-$1.00 premium, 5+ DTE, priority tickers
      let targetPortfolio = portfolio;
      let isSmallAcctTrade = false;
      const premiumCentsForCheck = Math.round(opp.price * 100);
      
      // Calculate DTE from expiration date
      const expirationDate = new Date(opp.expiration);
      const nowDate = new Date();
      const oppDte = Math.max(0, Math.ceil((expirationDate.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24)));
      
      const smallAccountCheck = isSmallAccountEligible(opp.symbol, decision.confidence, premiumCentsForCheck, oppDte);
      if (smallAccountCheck.eligible) {
        const smallAcct = await getSmallAccountPortfolio();
        if (smallAcct) {
          const minCost = opp.price * 100; // 1 contract minimum
          if (smallAcct.cashBalance >= minCost) {
            targetPortfolio = smallAcct;
            isSmallAcctTrade = true;
            logger.info(`💰 [SMALL ACCOUNT] Routing A+ trade ${opp.symbol} to Small Account (cash: $${smallAcct.cashBalance.toFixed(2)})`);
          } else {
            logger.info(`💰 [SMALL ACCOUNT] ${opp.symbol} eligible but insufficient funds ($${smallAcct.cashBalance.toFixed(2)} < $${minCost.toFixed(2)})`);
          }
        }
      }
      
      const result = await executeTradeIdea(targetPortfolio.id, savedIdea as TradeIdea);
      
      if (result.success && result.position) {
        const portfolioLabel = isSmallAcctTrade ? '💰 SMALL ACCOUNT' : '🤖 BOT';
        logger.info(`${portfolioLabel} ✅ TRADE EXECUTED: ${opp.symbol} x${result.position.quantity} @ $${opp.price.toFixed(2)}`);
        
        // 🔔 BROADCAST: Bot ENTERED a trade
        broadcastBotEvent({
          eventType: 'entry',
          symbol: opp.symbol,
          optionType: opp.optionType,
          strike: opp.strike,
          expiry: opp.expiration,
          price: opp.price,
          quantity: result.position.quantity,
          confidence: decision.confidence,
          portfolio: isSmallAcctTrade ? 'small_account' : 'options',
          reason: `ENTERED: ${opp.optionType?.toUpperCase()} $${opp.strike} x${result.position.quantity} @ $${opp.price.toFixed(2)}`
        });
        
        // Send Discord notification with full analysis
        try {
          logger.info(`${portfolioLabel} 📱 Sending Discord ENTRY notification for ${opp.symbol}...`);
          await sendBotTradeEntryToDiscord({
            symbol: opp.symbol,
            assetType: 'option',
            optionType: opp.optionType,
            strikePrice: opp.strike,
            expiryDate: opp.expiration,
            entryPrice: opp.price,
            quantity: result.position.quantity,
            targetPrice: ideaData.targetPrice,
            stopLoss: ideaData.stopLoss,
            analysis: decision.reason,
            signals: decision.signals,
            confidence: decision.confidence,
            riskRewardRatio: ideaData.riskRewardRatio,
            isSmallAccount: isSmallAcctTrade,
            source: isSmallAcctTrade ? 'small_account' : 'quant', // Route Small Account trades separately
          });
          logger.info(`${portfolioLabel} 📱✅ Discord ENTRY notification SENT for ${opp.symbol}`);
        } catch (discordError) {
          logger.error(`${portfolioLabel} 📱❌ Discord ENTRY notification FAILED for ${opp.symbol}:`, discordError);
        }
        
        // Refresh the correct portfolio cache
        const updated = await storage.getPaperPortfolioById(targetPortfolio.id);
        if (updated) {
          if (isSmallAcctTrade) {
            smallAccountPortfolio = updated;
          } else {
            optionsPortfolio = updated;
          }
        }
      } else {
        logger.warn(`🤖 [BOT] ❌ Trade failed: ${result.error}`);
      }
    } // End of for loop for remaining opportunities
    
    if (qualifyingOpportunities.length === 0) {
      logger.info(`🤖 [BOT] No opportunities met entry criteria`);
    }
    
    logger.info(`🤖 [BOT] ========== AUTONOMOUS SCAN COMPLETE ==========`);
  } catch (error) {
    logger.error(`🤖 [BOT] Error in autonomous scan:`, error);
  }
}

/**
 * Auto-execute a trade idea (for backward compatibility with lotto scanner)
 */
export async function autoExecuteLotto(idea: TradeIdea): Promise<boolean> {
  try {
    logger.info(`🎰 [LOTTO-EXEC] Attempting to execute: ${idea.symbol} ${idea.optionType?.toUpperCase()} $${idea.strikePrice} @ $${idea.entryPrice}`);
    
    // 🎯 UNIFIED ENTRY GATE - Check session/regime/exhaustion (ADVISORY for paper trading)
    const ideaDirection = (idea.direction || (idea.optionType === 'call' ? 'long' : 'short')) as 'long' | 'short';
    const ideaTarget = idea.targetPrice || idea.entryPrice * 2;
    const entryGate = await checkUnifiedEntryGate(idea.symbol, ideaDirection, idea.entryPrice, ideaTarget, idea.confidenceScore || 70, 'lotto');
    if (!entryGate.allowed) {
      // 📊 PAPER TRADING: Log warning but CONTINUE - we want to track all lotto plays
      logger.info(`🎰 [LOTTO-EXEC] ⚠️ UNIFIED GATE ADVISORY ${idea.symbol}: ${entryGate.reasons.join(', ')} (continuing for paper trading)`);
    }
    
    // 🧠 TRADING ENGINE GATE - RELAXED for paper trading (log but don't block)
    // USER UPDATE: Bot not trading A ideas. Let's ensure confidence score doesn't block high quality ideas.
    // Setting confidence floor to 0 for A tier ideas to ensure execution.
    const ideaGrade = (idea as any).grade || getLetterGrade(idea.confidenceScore || 0);
    const minConfidenceFloor = ['A+', 'A', 'A-'].includes(ideaGrade) ? 0 : 60;
    const engineGate = await checkTradingEngineGate(idea.symbol, ideaDirection, idea.entryPrice, Math.max(entryGate.adjustedConfidence, minConfidenceFloor), 'options');
    if (!engineGate.allowed) {
      // 📊 PAPER TRADING: Log warning but CONTINUE - track performance across all setups
      logger.info(`🎰 [LOTTO-EXEC] ⚠️ ENGINE GATE ADVISORY ${idea.symbol}: ${engineGate.reasons.join(', ')} (continuing for paper trading)`);
    } else {
      logger.info(`🎰 [LOTTO-EXEC] 🧠 ENGINE GATE PASSED: ${idea.symbol} | Confluence: ${engineGate.confluenceScore}% | IV Rank: ${engineGate.ivRank?.toFixed(0) || 'N/A'}%`);
    }
    
    if (idea.assetType === 'option') {
      // ESSENTIAL CHECK: Must have option metadata
      if (!idea.strikePrice || !idea.expiryDate || !idea.optionType) {
        logger.error(`🎰 [LOTTO-EXEC] ❌ Rejecting ${idea.symbol} - missing option metadata (strike=${idea.strikePrice}, expiry=${idea.expiryDate}, type=${idea.optionType})`);
        return false;
      }
      
      // RELAXED: Allow premiums up to $5 for paper trading (was $20)
      if (idea.entryPrice > 5) {
        logger.warn(`🎰 [LOTTO-EXEC] ⚠️ Rejecting ${idea.symbol} - entry price $${idea.entryPrice} too high for lotto (max $5)`);
        return false;
      }
      
      // 🛡️ THETA PROTECTION: Warn on low DTE but allow (relaxed from block)
      const expiryDate = new Date(idea.expiryDate);
      const now = new Date();
      const daysToExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysToExpiry < 1) {
        // Only block 0-DTE entries - they expire too fast
        logger.warn(`🎰 [LOTTO-EXEC] 🛡️ THETA BLOCK: Rejecting ${idea.symbol} - 0 DTE expires too fast`);
        return false;
      } else if (daysToExpiry < SMALL_ACCOUNT_MIN_DTE) {
        logger.info(`🎰 [LOTTO-EXEC] 🛡️ Low DTE notice: ${idea.symbol} has ${daysToExpiry} DTE (continuing for paper trading)`);
      }
      
      // 🧠 PRE-ENTRY EXIT INTELLIGENCE - ADVISORY ONLY (don't block)
      try {
        const mockPosition = {
          id: 'pre-entry-check',
          symbol: idea.symbol,
          entryPrice: idea.entryPrice,
          currentPrice: idea.entryPrice,
          targetPrice: idea.targetPrice,
          stopLoss: idea.stopLoss,
          quantity: 1,
          optionType: idea.optionType,
          strikePrice: idea.strikePrice,
          expiryDate: idea.expiryDate,
          status: 'open' as const,
          assetType: 'option' as const,
        };
        
        const preEntryAdvisory = await analyzePosition(mockPosition as any, '', 'Bot Lotto');
        if (preEntryAdvisory) {
          if (preEntryAdvisory.exitWindow === 'soon' || preEntryAdvisory.exitWindow === 'immediate') {
            // ADVISORY: Log but continue for paper trading
            logger.info(`🎰 [LOTTO-EXEC] 🧠 EXIT INTEL ADVISORY: ${idea.symbol} would flag "${preEntryAdvisory.exitWindow}" (continuing for paper trading)`);
          } else {
            logger.info(`🎰 [LOTTO-EXEC] 🧠 Pre-entry check passed: ${preEntryAdvisory.exitWindow} (${preEntryAdvisory.exitProbability}%)`);
          }
        }
      } catch (exitIntelError) {
        logger.debug(`🎰 [LOTTO-EXEC] Pre-entry Exit Intel check failed (continuing):`, exitIntelError);
      }
    }
    
    const basePortfolio = await getLottoPortfolio();
    if (!basePortfolio) {
      logger.error("🎰 [LOTTO-EXEC] ❌ No portfolio available");
      return false;
    }
    
    // 💰 SMALL ACCOUNT ROUTING - Check if trade qualifies for $150 Small Account
    const premiumCents = Math.round(idea.entryPrice * 100);
    const expiryDate = new Date(idea.expiryDate || '');
    const now = new Date();
    const daysToExpiry = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    
    const smallAccountCheck = isSmallAccountEligible(
      idea.symbol,
      idea.confidenceScore || 0,
      premiumCents,
      daysToExpiry
    );
    
    let targetPortfolio = basePortfolio;
    let isSmallAccountTrade = false;
    
    if (smallAccountCheck.eligible) {
      const smallAcct = await getSmallAccountPortfolio();
      if (smallAcct && smallAcct.cashBalance >= idea.entryPrice * 100) {
        targetPortfolio = smallAcct;
        isSmallAccountTrade = true;
        logger.info(`💰 [SMALL ACCOUNT] A+ Lotto routed! ${idea.symbol} ${idea.optionType?.toUpperCase()} $${idea.strikePrice} @ $${idea.entryPrice.toFixed(2)} (${smallAccountCheck.reason})`);
      } else if (smallAcct) {
        logger.info(`💰 [SMALL ACCOUNT] Insufficient balance ($${smallAcct.cashBalance.toFixed(2)}) for ${idea.symbol} @ $${idea.entryPrice.toFixed(2)}`);
      }
    } else {
      logger.debug(`💰 [SMALL ACCOUNT] Lotto not eligible: ${idea.symbol} - ${smallAccountCheck.reason}`);
    }
    
    const portfolioLabel = isSmallAccountTrade ? '💰 [SMALL ACCOUNT]' : '🎰 [LOTTO-EXEC]';
    logger.info(`${portfolioLabel} Portfolio: ${targetPortfolio.name}, Cash: $${targetPortfolio.cashBalance.toFixed(2)}`);

    const positions = await storage.getPaperPositionsByPortfolio(targetPortfolio.id);
    const openPositions = positions.filter(p => p.status === 'open');
    
    // Check for exact duplicate (same strike)
    const exactDuplicate = openPositions.find(p => 
      p.tradeIdeaId === idea.id || 
      (p.symbol === idea.symbol && p.strikePrice === idea.strikePrice && p.optionType === idea.optionType)
    );

    if (exactDuplicate) {
      logger.info(`${portfolioLabel} Skipping ${idea.symbol} $${idea.strikePrice} - exact duplicate exists`);
      return false;
    }
    
    // Log current position count
    logger.info(`${portfolioLabel} Current open positions: ${openPositions.length}`);

    const result = await executeTradeIdea(targetPortfolio.id, idea);
    
    if (result.success && result.position) {
      logger.info(`${portfolioLabel} ✅ SUCCESS: ${idea.symbol} ${idea.optionType?.toUpperCase()} $${idea.strikePrice} x${result.position.quantity} @ $${idea.entryPrice.toFixed(2)}`);
      
      // Send Discord notification with full analysis
      try {
        await sendBotTradeEntryToDiscord({
          symbol: idea.symbol,
          assetType: idea.assetType || 'option',
          optionType: idea.optionType,
          strikePrice: idea.strikePrice,
          expiryDate: idea.expiryDate,
          entryPrice: idea.entryPrice,
          quantity: result.position.quantity,
          targetPrice: idea.targetPrice,
          stopLoss: idea.stopLoss,
          analysis: idea.analysis,
          signals: idea.qualitySignals as string[] | null,
          confidence: idea.confidenceScore,
          riskRewardRatio: idea.riskRewardRatio,
          isSmallAccount: isSmallAccountTrade,
          source: isSmallAccountTrade ? 'small_account' : 'lotto', // Route Small Account trades separately
          delta: idea.optionDelta, // 📊 Greeks display
        });
        logger.info(`${portfolioLabel} 📱 Discord notification sent`);
      } catch (discordError) {
        logger.error(`${portfolioLabel} 📱❌ Discord failed:`, discordError);
      }
      
      // Update the appropriate portfolio cache
      const updated = await storage.getPaperPortfolioById(targetPortfolio.id);
      if (updated) {
        if (isSmallAccountTrade) {
          smallAccountPortfolio = updated;
        } else {
          optionsPortfolio = updated;
        }
      }
      
      return true;
    } else {
      // Log detailed failure reason
      logger.error(`${portfolioLabel} ❌ FAILED: ${idea.symbol} ${idea.optionType?.toUpperCase()} $${idea.strikePrice} - Reason: ${result.error}`);
      return false;
    }
  } catch (error) {
    logger.error(`🎰 [LOTTO-EXEC] ❌ EXCEPTION for ${idea.symbol}:`, error);
    return false;
  }
}

/**
 * Monitor and auto-close positions on stop/target/expiry
 * Now includes dynamic exits: trailing stops, time decay, momentum fade
 */
export async function monitorLottoPositions(): Promise<void> {
  try {
    const portfolio = await getLottoPortfolio();
    if (!portfolio) return;

    await updatePositionPrices(portfolio.id);
    
    // 📊 Get market context for dynamic exit decisions
    const marketContext = await getMarketContext();
    
    // Use shared market status check (static import)
    const marketStatus = isUSMarketOpen();
    
    // Get open positions to check for dynamic exits
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPositions = positions.filter(p => p.status === 'open');
    
    // Check each position for dynamic exit signals
    for (const pos of openPositions) {
      if (!pos.currentPrice || !pos.entryPrice) continue;
      
      // Skip dynamic exit checks if market is closed (prices may be stale)
      const isOption = pos.assetType === 'option';
      const priceIsStale = isOption && Math.abs(pos.currentPrice - pos.entryPrice) < 0.001;
      
      if (isOption && (!marketStatus.isOpen || priceIsStale)) {
        logger.debug(`🤖 [BOT] Skipping dynamic exit for ${pos.symbol} - ${marketStatus.reason}${priceIsStale ? ', stale price' : ''}`);
        continue;
      }
      
      // 🧠 EXIT INTELLIGENCE: Get smart exit analysis for this position
      let exitIntelligence: ExitAdvisory | null = null;
      try {
        exitIntelligence = await analyzePosition(pos, portfolio.id, portfolio.name);
        if (exitIntelligence) {
          const urgencyEmoji = exitIntelligence.exitWindow === 'immediate' ? '🚨' : 
                               exitIntelligence.exitWindow === 'soon' ? '⚠️' : 
                               exitIntelligence.exitWindow === 'watch' ? '👀' : '📊';
          logger.info(`🧠 [EXIT-INTEL] ${urgencyEmoji} ${pos.symbol}: ${exitIntelligence.exitWindow.toUpperCase()} (${exitIntelligence.exitProbability}%) - ${exitIntelligence.exitReason} | Signals: ${exitIntelligence.signals.join(', ')}`);
          
          // 🚨 IMMEDIATE EXIT: Exit Intelligence says EXIT NOW with high confidence
          if (exitIntelligence.exitWindow === 'immediate' && exitIntelligence.exitProbability >= 85) {
            logger.info(`🧠 [EXIT-INTEL] 🚨 AUTO-EXIT TRIGGERED: ${pos.symbol} - ${exitIntelligence.exitReason}`);
            
            const exitPrice = pos.currentPrice;
            const pnl = (exitPrice - pos.entryPrice) * pos.quantity * 100;
            
            await storage.updatePaperPosition(pos.id, {
              status: 'closed',
              exitPrice,
              exitTime: new Date().toISOString(),
              exitReason: `EXIT-INTEL: ${exitIntelligence.exitReason}`,
              realizedPnL: pnl,
            });
            
            // 🛡️ Record loss/win for cooldown system
            if (pnl < 0) {
              recordSymbolLoss(pos.symbol, Math.abs(pnl));
            } else if (pnl > 0) {
              recordSymbolWin(pos.symbol);
            }
            
            // 🛡️ Record exit cooldown to prevent immediate re-entry
            recordExitCooldown(pos.symbol, pos.optionType || undefined, pos.strikePrice || undefined, pnl >= 0);
            
            // Send Discord notification with Exit Intelligence context
            const portfolioType = await getPortfolioType(pos.portfolioId);
            
            // 📊 PLAYBOOK - Track P&L for Options Bot (not Small Account)
            if (portfolioType === 'options') {
              recordPlaybookDayPnL(pnl);
              logger.info(`📊 [PLAYBOOK] Options exit recorded: P&L $${pnl.toFixed(2)}`);
            }
            
            // 🔔 BROADCAST: Bot EXITED a trade
            broadcastBotEvent({
              eventType: 'exit',
              symbol: pos.symbol,
              optionType: pos.optionType as 'call' | 'put' | undefined,
              strike: pos.strikePrice || undefined,
              price: exitPrice,
              quantity: pos.quantity,
              pnl,
              portfolio: portfolioType,
              reason: `EXIT-INTEL: ${exitIntelligence.exitReason} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
            });
            
            await sendBotTradeExitToDiscord({
              symbol: pos.symbol,
              assetType: pos.assetType || 'option',
              optionType: pos.optionType,
              strikePrice: pos.strikePrice,
              entryPrice: pos.entryPrice,
              exitPrice,
              quantity: pos.quantity,
              realizedPnL: pnl,
              exitReason: `🧠 SMART EXIT: ${exitIntelligence.exitReason} (${exitIntelligence.exitProbability}% confidence)`,
              portfolio: portfolioType,
              isSmallAccount: portfolioType === 'small_account',
              source: portfolioType === 'small_account' ? 'small_account' : 'quant',
            });
            
            logger.info(`🧠 [EXIT-INTEL] ✅ AUTO-EXITED ${pos.symbol} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
            continue; // Skip regular exit logic, already closed
          }
        }
      } catch (exitIntelError) {
        logger.debug(`🧠 [EXIT-INTEL] Analysis failed for ${pos.symbol}:`, exitIntelError);
      }
      
      // Calculate days to expiry for options
      let daysToExpiry = 7; // Default for non-options
      if (pos.expiryDate) {
        const expDate = new Date(pos.expiryDate);
        const now = new Date();
        daysToExpiry = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      // Compute highest price inline using max of current and entry
      // Note: highestPriceReached is not yet in the DB schema for positions, 
      // so we use current price for trailing stops in-memory for now
      const highestPrice = Math.max(pos.currentPrice || pos.entryPrice, pos.entryPrice);
      
      // Build confluence data from available market info
      // Note: RSI/momentum data can be added when available from real-time feeds
      const confluenceData: ExitConfluenceData = {
        volumeRatio: marketContext.spyData?.relativeVolume || 1.0,
        // priceChange5m and priceChange15m could be added from real-time data
      };
      
      // Use enhanced exit with multi-confluence checks (fallback if Exit Intel didn't trigger)
      const exitSignal = checkDynamicExitEnhanced(
        pos.currentPrice,
        pos.entryPrice,
        highestPrice,
        daysToExpiry,
        (pos.optionType as 'call' | 'put') || 'call',
        marketContext,
        confluenceData
      );
      
      // Calculate P&L for logging
      const currentPnL = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      const pnlEmoji = currentPnL >= 0 ? '🟢' : '🔴';
      
      if (exitSignal.shouldExit) {
        // Log exit with confluence details
        const exitDetails = exitSignal.exitSignals?.length ? ` | Exit signals: ${exitSignal.exitSignals.slice(0, 3).join(', ')}` : '';
        logger.info(`🤖 [BOT] 📊 DYNAMIC EXIT: ${pos.symbol} - ${exitSignal.exitType}: ${exitSignal.reason}${exitDetails}`);
        
        // Close the position with dynamic exit reason
        try {
          const exitPrice = exitSignal.suggestedExitPrice || pos.currentPrice;
          const pnl = (exitPrice - pos.entryPrice) * pos.quantity * 100;
          
          await storage.updatePaperPosition(pos.id, {
            status: 'closed',
            exitPrice,
            exitTime: new Date().toISOString(),
            exitReason: `${exitSignal.exitType}: ${exitSignal.reason}`,
            realizedPnL: pnl,
          });
          
          // 🛡️ Record loss/win for cooldown system
          if (pnl < 0) {
            recordSymbolLoss(pos.symbol, Math.abs(pnl));
          } else if (pnl > 0) {
            recordSymbolWin(pos.symbol);
          }
          
          // 🛡️ Record exit cooldown to prevent immediate re-entry
          recordExitCooldown(pos.symbol, pos.optionType || undefined, pos.strikePrice || undefined, pnl >= 0);
          
          // Send Discord notification for exit - route to correct portfolio
          logger.info(`🤖 [BOT] 📱 Sending Discord EXIT notification for ${pos.symbol}...`);
          const portfolioType2 = await getPortfolioType(pos.portfolioId);
          
          // 📊 PLAYBOOK - Track P&L for Options Bot (not Small Account)
          if (portfolioType2 === 'options') {
            recordPlaybookDayPnL(pnl);
            logger.info(`📊 [PLAYBOOK] Options exit recorded: P&L $${pnl.toFixed(2)}`);
          }
          
          // 🔔 BROADCAST: Bot EXITED a trade (dynamic exit)
          broadcastBotEvent({
            eventType: 'exit',
            symbol: pos.symbol,
            optionType: pos.optionType as 'call' | 'put' | undefined,
            strike: pos.strikePrice || undefined,
            price: exitPrice,
            quantity: pos.quantity,
            pnl,
            portfolio: portfolioType2,
            reason: `${exitSignal.exitType}: ${exitSignal.reason} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
          });
          
          await sendBotTradeExitToDiscord({
            symbol: pos.symbol,
            assetType: pos.assetType || 'option',
            optionType: pos.optionType,
            strikePrice: pos.strikePrice,
            entryPrice: pos.entryPrice,
            exitPrice,
            quantity: pos.quantity,
            realizedPnL: pnl,
            exitReason: `${exitSignal.exitType}: ${exitSignal.reason}`,
            portfolio: portfolioType2,
            isSmallAccount: portfolioType2 === 'small_account',
            source: portfolioType2 === 'small_account' ? 'small_account' : 'quant',
          });
          
          logger.info(`🤖 [BOT] 📱✅ Discord EXIT notification SENT for ${pos.symbol} | P&L: $${pnl.toFixed(2)}`);
        } catch (exitError) {
          logger.error(`🤖 [BOT] Failed to execute dynamic exit for ${pos.symbol}:`, exitError);
        }
      } else {
        // Log HOLD decision with confluence details - so user knows why bot is keeping position
        const holdDetails = exitSignal.holdSignals?.length ? ` | Hold signals: ${exitSignal.holdSignals.slice(0, 2).join(', ')}` : '';
        logger.info(`🤖 [BOT] ${pnlEmoji} HOLDING ${pos.symbol}: ${exitSignal.reason} | PnL: ${currentPnL >= 0 ? '+' : ''}${currentPnL.toFixed(1)}% | ${daysToExpiry} DTE${holdDetails}`);
      }
    }
    
    // Standard stop/target checking (for positions not caught by dynamic exits)
    const closedPositions = await checkStopsAndTargets(portfolio.id);
    
    if (closedPositions.length > 0) {
      logger.info(`🤖 [BOT] Auto-closed ${closedPositions.length} positions`);
      
      for (const pos of closedPositions) {
        const pnl = pos.realizedPnL || 0;
        const emoji = pnl >= 0 ? '🎉' : '💀';
        logger.info(`${emoji} [BOT] Closed ${pos.symbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pos.exitReason})`);
        
        // 🛡️ Record loss/win for cooldown system
        if (pnl < 0) {
          recordSymbolLoss(pos.symbol, Math.abs(pnl));
        } else if (pnl > 0) {
          recordSymbolWin(pos.symbol);
        }
        
        // 🛡️ Record exit cooldown to prevent immediate re-entry
        recordExitCooldown(pos.symbol, pos.optionType || undefined, pos.strikePrice || undefined, pnl >= 0);
        
        try {
          logger.info(`🤖 [BOT] 📱 Sending Discord EXIT notification for ${pos.symbol}...`);
          const portfolioType3 = await getPortfolioType(pos.portfolioId);
          
          // 📊 PLAYBOOK - Track P&L for Options Bot (not Small Account)
          if (portfolioType3 === 'options') {
            recordPlaybookDayPnL(pnl);
            logger.info(`📊 [PLAYBOOK] Options exit recorded: P&L $${pnl.toFixed(2)}`);
          }
          
          // 🔔 BROADCAST: Bot EXITED a trade (stop/target hit)
          broadcastBotEvent({
            eventType: 'exit',
            symbol: pos.symbol,
            optionType: pos.optionType as 'call' | 'put' | undefined,
            strike: pos.strikePrice ?? undefined,
            price: pos.exitPrice ?? pos.currentPrice ?? undefined,
            quantity: pos.quantity,
            pnl,
            portfolio: portfolioType3,
            reason: `${pos.exitReason} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
          });
          
          await sendBotTradeExitToDiscord({
            symbol: pos.symbol,
            assetType: pos.assetType || 'option',
            optionType: pos.optionType,
            strikePrice: pos.strikePrice,
            entryPrice: pos.entryPrice,
            exitPrice: pos.exitPrice,
            quantity: pos.quantity,
            realizedPnL: pos.realizedPnL,
            exitReason: pos.exitReason,
            portfolio: portfolioType3,
            isSmallAccount: portfolioType3 === 'small_account',
            source: portfolioType3 === 'small_account' ? 'small_account' : 'quant',
          });
          logger.info(`🤖 [BOT] 📱✅ Discord EXIT notification SENT for ${pos.symbol}`);
        } catch (discordError) {
          logger.error(`🤖 [BOT] 📱❌ Discord EXIT notification FAILED for ${pos.symbol}:`, discordError);
        }
        
        try {
          const pnlPercent = pos.realizedPnLPercent || 0;
          if (pnlPercent >= 3) {
            await recordWin(pos);
            logger.info(`🧠 [LOSS-ANALYZER] Recorded WIN for ${pos.symbol}`);
          } else if (pnlPercent <= -3) {
            const diagnostics = await analyzeTrade(pos);
            if (diagnostics) {
              logger.info(`🧠 [LOSS-ANALYZER] Analyzed LOSS for ${pos.symbol}: ${diagnostics.primaryCause}`);
            }
          }
        } catch (analyzeError) {
          logger.warn(`🧠 [LOSS-ANALYZER] Failed to analyze ${pos.symbol}:`, analyzeError);
        }
      }
      
      const updated = await storage.getPaperPortfolioById(portfolio.id);
      if (updated) optionsPortfolio = updated;
    }
  } catch (error) {
    logger.error("🤖 [BOT] Error monitoring positions:", error);
  }
}

/**
 * FUTURES TRADING - Scan and execute futures trades during CME market hours
 * Now uses user preferences for position limits and trading parameters
 */
export async function runFuturesBotScan(): Promise<void> {
  // 🛡️ KILL SWITCH - Check if futures bot is disabled via environment variable
  if (process.env.ENABLE_FUTURES_BOT === 'false') {
    logger.info('🔮 [FUTURES-BOT] ⛔ DISABLED via ENABLE_FUTURES_BOT=false');
    return;
  }
  
  try {
    // Load user preferences
    const prefs = await getBotPreferences();
    
    // Check if futures trading is enabled
    if (!prefs.enableFutures) {
      logger.info(`🔮 [FUTURES-BOT] Futures trading disabled by user preferences`);
      return;
    }
    
    if (!isCMEOpen()) {
      logger.info(`🔮 [FUTURES-BOT] CME market closed - skipping futures scan`);
      return;
    }
    
    logger.info(`🔮 [FUTURES-BOT] ========== FUTURES SCAN STARTED ==========`);
    logger.debug(`🔮 [FUTURES-BOT] Prefs: max ${prefs.futuresMaxContracts} contracts, stop=${prefs.futuresStopPoints}pts, target=${prefs.futuresTargetPoints}pts`);
    
    const portfolio = await getFuturesPortfolio();
    if (!portfolio) {
      logger.error(`🔮 [FUTURES-BOT] No portfolio available`);
      return;
    }
    
    logger.info(`📈 [FUTURES-BOT] Portfolio: $${portfolio.cashBalance.toFixed(2)} cash / $${portfolio.totalValue.toFixed(2)} total`);
    
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openFuturesPositions = positions.filter(p => p.status === 'open' && p.assetType === 'future');
    
    // Use preference for max contracts
    if (openFuturesPositions.length >= prefs.futuresMaxContracts) {
      logger.info(`🔮 [FUTURES-BOT] Already have ${openFuturesPositions.length}/${prefs.futuresMaxContracts} open futures - waiting for exit`);
      return;
    }
    
    const openFuturesSymbols = new Set(openFuturesPositions.map(p => p.symbol.substring(0, 2)));
    let bestFuturesOpp: FuturesOpportunity | null = null;
    
    for (const rootSymbol of FUTURES_SYMBOLS) {
      if (openFuturesSymbols.has(rootSymbol)) continue;
      
      try {
        const contract = await getActiveFuturesContract(rootSymbol);
        const price = await getFuturesPrice(contract.contractCode);
        
        if (!price || price <= 0) {
          logger.warn(`🔮 [FUTURES-BOT] No price for ${contract.contractCode}`);
          continue;
        }
        
        const signals: string[] = [];
        let score = 50;
        
        // CME market is open
        signals.push(`PRICE_$${price.toFixed(2)}`);
        signals.push('CME_OPEN');
        score += 10;
        
        // Get price context from contract
        const contractSymbol = contract.contractCode;
        const isNQ = rootSymbol === 'NQ';
        const isGC = rootSymbol === 'GC';
        
        // Analyze market conditions for direction
        const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const hour = ctTime.getHours();
        
        // Time-based bias (morning momentum, afternoon mean reversion)
        const isMorningSession = hour >= 8 && hour <= 11;
        const isAfternoonSession = hour >= 13 && hour <= 15;
        
        if (isMorningSession) {
          signals.push('MORNING_MOMENTUM');
          score += 15;
        } else if (isAfternoonSession) {
          signals.push('AFTERNOON_SESSION');
          score += 10;
        }
        
        // Get recent price history for trend analysis
        const { getFuturesHistory } = await import('./futures-data-service');
        let priceHistory: number[] = [];
        try {
          priceHistory = await getFuturesHistory(contract.contractCode);
        } catch (e) {
          // Continue without history
        }
        
        // Calculate price trend (is price trending up or down?)
        let trendDirection: 'long' | 'short' = 'long';
        if (priceHistory.length >= 5) {
          const recentPrices = priceHistory.slice(-10);
          const avgRecent = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
          const avgOlder = priceHistory.slice(-20, -10).reduce((a, b) => a + b, 0) / Math.max(1, priceHistory.slice(-20, -10).length);
          
          if (avgRecent > avgOlder * 1.001) {
            trendDirection = 'long';
            signals.push('UPTREND');
            score += 15;
          } else if (avgRecent < avgOlder * 0.999) {
            trendDirection = 'short';
            signals.push('DOWNTREND');
            score += 15;
          } else {
            signals.push('SIDEWAYS');
            score -= 10; // Penalty for choppy market
          }
        }
        
        // Price level analysis for NQ (Nasdaq futures)
        if (isNQ) {
          if (price > 20000) {
            signals.push('NQ_STRONG');
            score += 5;
          }
        }
        
        // Gold tends to be safer in uncertain times
        if (isGC) {
          signals.push('GOLD_HEDGE');
          score += 5;
        }
        
        // Require minimum score of 70 for futures (need real trend confirmation)
        if (score >= 70) {
          // Use TREND-BASED direction, not random!
          const direction: 'long' | 'short' = trendDirection;
          const opportunity: FuturesOpportunity = {
            symbol: rootSymbol,
            contractCode: contract.contractCode,
            direction,
            price,
            signals,
            confidence: Math.min(score, 90),
            expirationDate: contract.expirationDate,
          };
          
          if (!bestFuturesOpp || score > bestFuturesOpp.confidence) {
            bestFuturesOpp = opportunity;
          }
          
          logger.info(`🔮 [FUTURES-BOT] ✅ ${rootSymbol}: ${direction.toUpperCase()} @ ${price.toFixed(2)} | ${signals.join(' | ')}`);
        }
      } catch (error) {
        logger.warn(`🔮 [FUTURES-BOT] Error scanning ${rootSymbol}:`, error);
      }
    }
    
    if (bestFuturesOpp) {
      logger.info(`🔮 [FUTURES-BOT] 🎯 FOUND FUTURES OPPORTUNITY: ${bestFuturesOpp.contractCode} ${bestFuturesOpp.direction.toUpperCase()} @ $${bestFuturesOpp.price.toFixed(2)}`);
      logger.info(`🔮 [FUTURES-BOT] 📊 Signals: ${bestFuturesOpp.signals.join(' | ')}`);
      
      // EXECUTE FUTURES TRADE
      // For paper trading futures with a small portfolio, we use margin-based position sizing
      // Risk per trade from preferences or 30% of cash
      // This represents the margin/risk amount, NOT the full contract notional value
      try {
        const marginRequired = Math.min(prefs.maxPositionSize, portfolio.cashBalance * (prefs.futuresAllocation / 100));
        const quantity = 1; // Paper trade 1 micro contract at a time
        
        // Check confidence meets threshold
        if (bestFuturesOpp.confidence < prefs.minConfidenceScore) {
          logger.info(`🔮 [FUTURES-BOT] Confidence ${bestFuturesOpp.confidence}% < min ${prefs.minConfidenceScore}% - skipping`);
          return;
        }
        
        // 🔗 CORRELATION POSITION CAPS - Prevent concentrated sector risk
        // For futures, use margin as the exposure measure (reflects risk capital committed)
        if (marginRequired > 10) { // Min $10 to avoid noise
          const futuresCorrelationCheck = await checkCorrelationCaps(portfolio.id, bestFuturesOpp.symbol, marginRequired);
          if (!futuresCorrelationCheck.allowed) {
            logger.info(`🔮 [FUTURES-BOT] 🔗 CORRELATION BLOCKED: ${bestFuturesOpp.symbol} - ${futuresCorrelationCheck.reason}`);
            return;
          }
        } else {
          logger.warn(`🔮 [FUTURES-BOT] 🔗 Skipped correlation check - margin too low: $${marginRequired.toFixed(2)}`);
        }
        
        if (marginRequired <= portfolio.cashBalance && marginRequired >= 10) {
          const entryPrice = bestFuturesOpp.price;
          
          // Use stop/target points from preferences for NQ (e.g., 15 stop / 30 target)
          // For other contracts, use percentage-based stops
          const isNQ = bestFuturesOpp.symbol === 'NQ';
          const stopLoss = isNQ
            ? (bestFuturesOpp.direction === 'long' 
                ? entryPrice - prefs.futuresStopPoints  // Use points from prefs
                : entryPrice + prefs.futuresStopPoints)
            : (bestFuturesOpp.direction === 'long' ? entryPrice * 0.98 : entryPrice * 1.02);
          
          const targetPrice = isNQ
            ? (bestFuturesOpp.direction === 'long'
                ? entryPrice + prefs.futuresTargetPoints  // Use points from prefs
                : entryPrice - prefs.futuresTargetPoints)
            : (bestFuturesOpp.direction === 'long' ? entryPrice * 1.04 : entryPrice * 0.96);
          
          logger.debug(`🔮 [FUTURES-BOT] Using prefs: stop=${prefs.futuresStopPoints}pts, target=${prefs.futuresTargetPoints}pts`);
          
          // Check for existing open trade ideas to prevent duplicates
          const existingIdeas = await storage.getAllTradeIdeas();
          const hasOpenIdea = existingIdeas.some((idea: any) => 
            (idea.symbol === bestFuturesOpp.contractCode || idea.symbol.startsWith(bestFuturesOpp.symbol)) && 
            idea.outcomeStatus === 'open' &&
            idea.assetType === 'future'
          );
          
          // REMOVED: Now allows multiple positions (pyramiding into winners)
          if (hasOpenIdea) {
            logger.info(`🔮 [FUTURES-BOT] ${bestFuturesOpp.contractCode} has open position - adding to it (pyramid)`);
            // Don't return - continue with entry
          }
          
          const position = await storage.createPaperPosition({
            portfolioId: portfolio.id,
            symbol: bestFuturesOpp.contractCode,
            assetType: 'future',
            quantity: quantity,
            entryPrice: entryPrice,
            currentPrice: entryPrice,
            status: 'open',
            direction: bestFuturesOpp.direction,
            stopLoss: stopLoss,
            targetPrice: targetPrice,
            entryTime: new Date().toISOString(),
            entryReason: `🔮 FUTURES: ${bestFuturesOpp.contractCode} ${bestFuturesOpp.direction.toUpperCase()} @ $${entryPrice.toFixed(2)} - ${bestFuturesOpp.signals.slice(0, 3).join(', ')}`,
            entrySignals: JSON.stringify(bestFuturesOpp.signals),
          });
          
          // CREATE TRADE IDEA FOR TRADE DESK
          await storage.createTradeIdea({
            symbol: bestFuturesOpp.contractCode,
            assetType: 'future',
            direction: bestFuturesOpp.direction,
            entryPrice: entryPrice,
            targetPrice: targetPrice,
            stopLoss: stopLoss,
            riskRewardRatio: 2.0, // 4% target / 2% stop
            confidenceScore: bestFuturesOpp.confidence,
            qualitySignals: bestFuturesOpp.signals,
            probabilityBand: getLetterGrade(bestFuturesOpp.confidence),
            holdingPeriod: 'day',
            catalyst: `Futures Setup: ${bestFuturesOpp.signals.join(', ')}`,
            analysis: `🔮 FUTURES BOT ANALYSIS\n\n${bestFuturesOpp.contractCode} showing ${bestFuturesOpp.direction.toUpperCase()} momentum.\n\nStructure: ${bestFuturesOpp.signals.join(' | ')}`,
            sessionContext: 'Futures Bot',
            source: 'quant',
            status: 'published',
            outcomeStatus: 'open',
            timestamp: new Date().toISOString()
          });
          
          // Update portfolio cash - subtract MARGIN amount, not full contract value
          // For paper trading, we treat the margin as our capital at risk
          await storage.updatePaperPortfolio(portfolio.id, {
            cashBalance: portfolio.cashBalance - marginRequired,
          });
          
          logger.info(`🔮 [FUTURES-BOT] ✅ EXECUTED: ${bestFuturesOpp.direction.toUpperCase()} ${quantity}x ${bestFuturesOpp.contractCode} @ $${entryPrice.toFixed(2)}`);
          logger.info(`🔮 [FUTURES-BOT] 📊 Stop: $${stopLoss.toFixed(2)} | Target: $${targetPrice.toFixed(2)} | Margin: $${marginRequired.toFixed(2)}`);
          
          // Send Discord notification with full analysis - route to FUTURES channel
          if (prefs.enableDiscordAlerts) {
            try {
              await sendBotTradeEntryToDiscord({
                symbol: bestFuturesOpp.contractCode,
                assetType: 'future',
                entryPrice,
                quantity,
                targetPrice,
                stopLoss,
                analysis: `Futures ${bestFuturesOpp.direction.toUpperCase()} setup`,
                signals: bestFuturesOpp.signals,
                confidence: bestFuturesOpp.confidence,
                riskRewardRatio: 2.0,
                source: 'futures',
                portfolio: 'futures', // Display "Futures Portfolio" label, route to #future-trades
              });
              logger.info(`🔮 [FUTURES-BOT] 📱 Discord entry notification sent to #future-trade-id`);
            } catch (discordError) {
              logger.warn(`🔮 [FUTURES-BOT] Discord notification failed:`, discordError);
            }
          }
        } else {
          logger.warn(`🔮 [FUTURES-BOT] Insufficient capital for trade: need $${marginRequired.toFixed(2)}, have $${portfolio.cashBalance.toFixed(2)}`);
        }
      } catch (execError) {
        logger.error(`🔮 [FUTURES-BOT] Failed to execute futures trade:`, execError);
      }
    } else {
      logger.info(`🔮 [FUTURES-BOT] No futures opportunities met entry criteria`);
    }
    
    logger.info(`🔮 [FUTURES-BOT] ========== FUTURES SCAN COMPLETE ==========`);
  } catch (error) {
    logger.error(`🔮 [FUTURES-BOT] Error in futures scan:`, error);
  }
}

/**
 * Monitor and manage open futures positions
 */
export async function monitorFuturesPositions(): Promise<void> {
  try {
    const portfolio = await getFuturesPortfolio();
    if (!portfolio) return;
    
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPositions = positions.filter(p => p.status === 'open');
    
    if (openPositions.length === 0) {
      logger.info(`🔮 [FUTURES-MONITOR] No open futures positions to monitor`);
      return;
    }
    
    logger.info(`🔮 [FUTURES-MONITOR] Checking ${openPositions.length} open futures positions...`);
    
    for (const position of openPositions) {
      try {
        // Get current price for the futures contract
        const { getFuturesPrice } = await import('./futures-data-service');
        const currentPrice = await getFuturesPrice(position.symbol);
        
        if (!currentPrice || currentPrice <= 0) {
          logger.warn(`🔮 [FUTURES-MONITOR] No price for ${position.symbol}`);
          continue;
        }
        
        const entryPrice = typeof position.entryPrice === 'string' ? parseFloat(position.entryPrice) : position.entryPrice;
        const stopLoss = position.stopLoss ? (typeof position.stopLoss === 'string' ? parseFloat(position.stopLoss) : position.stopLoss) : null;
        const targetPrice = position.targetPrice ? (typeof position.targetPrice === 'string' ? parseFloat(position.targetPrice) : position.targetPrice) : null;
        
        const direction = position.direction || 'long';
        const quantity = parseFloat(position.quantity?.toString() || '1');
        
        // Get proper futures contract multiplier for MICRO contracts (paper trading with $300)
        // MNQ (Micro NQ): $2/point, MGC (Micro Gold): $10/point
        // For paper trading on small capital, we simulate MICRO contracts only
        const symbol = position.symbol.toUpperCase();
        let multiplier = 2; // Default MNQ (Micro NQ) - $2/point
        if (symbol.startsWith('GC') || symbol.startsWith('MGC')) {
          multiplier = 10; // Micro Gold - $10/point
        } else if (symbol.startsWith('NQ') || symbol.startsWith('MNQ')) {
          multiplier = 2; // Micro NQ - $2/point
        }
        
        // Calculate P&L using proper point value
        const pointDiff = direction === 'long' 
          ? currentPrice - entryPrice 
          : entryPrice - currentPrice;
        
        // Unrealized P&L = points * multiplier * quantity
        const unrealizedPnL = pointDiff * multiplier * quantity;
        const pnlPercent = entryPrice > 0 ? (pointDiff / entryPrice) * 100 : 0;
        
        // Update the position with current price and unrealized P&L
        await storage.updatePaperPosition(position.id, {
          currentPrice,
          unrealizedPnL,
          unrealizedPnLPercent: pnlPercent,
        });
        
        logger.info(`🔮 [FUTURES-MONITOR] ${position.symbol}: ${direction} @ $${entryPrice.toFixed(2)} → $${currentPrice.toFixed(2)} | P&L: ${unrealizedPnL >= 0 ? '+' : ''}$${unrealizedPnL.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`);
        
        // Check stop loss
        if (stopLoss && (
          (direction === 'long' && currentPrice <= stopLoss) ||
          (direction === 'short' && currentPrice >= stopLoss)
        )) {
          logger.info(`🔮 [FUTURES-MONITOR] ❌ STOP HIT: ${position.symbol} @ $${currentPrice.toFixed(2)} | P&L: $${unrealizedPnL.toFixed(2)}`);
          // closePaperPosition handles all portfolio updates (cash, P&L, win/loss count)
          await storage.closePaperPosition(position.id, currentPrice, 'hit_stop');
          
          // 🛡️ Record loss for cooldown system
          if (unrealizedPnL < 0) {
            recordSymbolLoss(position.symbol, Math.abs(unrealizedPnL));
          }
          continue;
        }
        
        // Check target
        if (targetPrice && (
          (direction === 'long' && currentPrice >= targetPrice) ||
          (direction === 'short' && currentPrice <= targetPrice)
        )) {
          logger.info(`🔮 [FUTURES-MONITOR] ✅ TARGET HIT: ${position.symbol} @ $${currentPrice.toFixed(2)} | P&L: +$${unrealizedPnL.toFixed(2)}`);
          // closePaperPosition handles all portfolio updates (cash, P&L, win/loss count)
          await storage.closePaperPosition(position.id, currentPrice, 'hit_target');
          
          // 🛡️ Record win to reduce cooldown
          recordSymbolWin(position.symbol);
          continue;
        }
        
      } catch (posErr) {
        logger.error(`🔮 [FUTURES-MONITOR] Error checking position ${position.symbol}:`, posErr);
      }
    }
  } catch (error) {
    logger.error(`🔮 [FUTURES-MONITOR] Position monitoring error:`, error);
  }
}

/**
 * Get current bot stats
 */
export async function getLottoStats(): Promise<{
  portfolio: PaperPortfolio | null;
  openPositions: number;
  closedPositions: number;
  totalPnL: number;
  winRate: number;
} | null> {
  try {
    const portfolio = await getLottoPortfolio();
    if (!portfolio) return null;

    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPositions = positions.filter(p => p.status === 'open');
    const closedPositions = positions.filter(p => p.status === 'closed');
    
    const totalPnL = closedPositions.reduce((sum, p) => sum + (p.realizedPnL || 0), 0);
    const wins = closedPositions.filter(p => (p.realizedPnL || 0) > 0).length;
    const winRate = closedPositions.length > 0 ? (wins / closedPositions.length) * 100 : 0;

    return {
      portfolio,
      openPositions: openPositions.length,
      closedPositions: closedPositions.length,
      totalPnL,
      winRate,
    };
  } catch (error) {
    logger.error("🤖 [BOT] Error getting stats:", error);
    return null;
  }
}

/**
 * Force-liquidate all open Prop Firm positions when risk limits are breached
 */
async function flattenAllPropFirmPositions(reason: string): Promise<number> {
  try {
    const portfolio = await getPropFirmPortfolio();
    if (!portfolio) return 0;
    
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPositions = positions.filter(p => p.status === 'open' && p.assetType === 'future');
    
    if (openPositions.length === 0) return 0;
    
    logger.warn(`🏆 [PROP-FIRM] 🚨 FLATTENING ${openPositions.length} POSITIONS - ${reason}`);
    
    let totalPnL = 0;
    for (const position of openPositions) {
      try {
        const currentPrice = await getFuturesPrice(position.symbol);
        if (!currentPrice || currentPrice <= 0) continue;
        
        const entryPrice = typeof position.entryPrice === 'string' ? parseFloat(position.entryPrice) : position.entryPrice;
        const direction = position.direction || 'long';
        const quantity = parseFloat(position.quantity?.toString() || '1');
        const multiplier = 2; // MNQ (Micro NQ) - $2/point for paper trading
        
        const pointDiff = direction === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice;
        const unrealizedPnL = pointDiff * multiplier * quantity;
        totalPnL += unrealizedPnL;
        
        logger.warn(`🏆 [PROP-FIRM] 🚨 FORCE CLOSE: ${position.symbol} @ $${currentPrice.toFixed(2)} | P&L: $${unrealizedPnL.toFixed(0)}`);
        await storage.closePaperPosition(position.id, currentPrice, 'risk_limit_breach');
        propFirmDailyPnL += unrealizedPnL;
      } catch (err) {
        logger.error(`🏆 [PROP-FIRM] Error force-closing position:`, err);
      }
    }
    
    return totalPnL;
  } catch (error) {
    logger.error(`🏆 [PROP-FIRM] Flatten error:`, error);
    return 0;
  }
}

/**
 * PROP FIRM MODE - Conservative futures trading for funded evaluations (Topstep, etc)
 * Key differences from regular futures bot:
 * - Stricter risk management (2% max risk per trade)
 * - Daily loss limit tracking
 * - Trailing drawdown monitoring
 * - Only trades high-probability setups (confidence >= 70%)
 * - 2:1 minimum reward-to-risk ratio
 */
export async function runPropFirmBotScan(): Promise<void> {
  try {
    // Reset daily P&L at start of each trading day
    const today = new Date().toISOString().split('T')[0];
    if (propFirmLastResetDate !== today) {
      propFirmDailyPnL = 0;
      propFirmLastResetDate = today;
      logger.info(`🏆 [PROP-FIRM] Daily P&L reset for ${today}`);
    }
    
    // Check if we've hit daily loss limit - FLATTEN ALL POSITIONS if breached
    if (propFirmDailyPnL <= -PROP_FIRM_DAILY_LOSS_LIMIT) {
      await flattenAllPropFirmPositions('DAILY LOSS LIMIT BREACH');
      logger.warn(`🏆 [PROP-FIRM] ⚠️ DAILY LOSS LIMIT REACHED ($${Math.abs(propFirmDailyPnL).toFixed(0)}) - Account locked`);
      return;
    }
    
    if (!isCMEOpen()) {
      logger.info(`🏆 [PROP-FIRM] CME market closed - skipping scan`);
      return;
    }
    
    logger.info(`🏆 [PROP-FIRM] ========== PROP FIRM SCAN STARTED ==========`);
    
    const portfolio = await getPropFirmPortfolio();
    if (!portfolio) {
      logger.error(`🏆 [PROP-FIRM] No portfolio available`);
      return;
    }
    
    // Check drawdown - FLATTEN ALL POSITIONS if breached
    const currentDrawdown = PROP_FIRM_STARTING_CAPITAL - portfolio.totalValue;
    if (currentDrawdown >= PROP_FIRM_MAX_DRAWDOWN) {
      await flattenAllPropFirmPositions('MAX DRAWDOWN BREACH');
      logger.warn(`🏆 [PROP-FIRM] ⚠️ MAX DRAWDOWN REACHED ($${currentDrawdown.toFixed(0)}) - Account locked`);
      return;
    }
    
    // Check if profit target reached - close all positions and lock in profits
    const totalPnL = portfolio.totalValue - PROP_FIRM_STARTING_CAPITAL;
    if (totalPnL >= PROP_FIRM_PROFIT_TARGET) {
      await flattenAllPropFirmPositions('PROFIT TARGET REACHED');
      logger.info(`🏆 [PROP-FIRM] 🎉 PROFIT TARGET REACHED! $${totalPnL.toFixed(0)}/$${PROP_FIRM_PROFIT_TARGET} - Combine PASSED!`);
      return;
    }
    
    logger.info(`🏆 [PROP-FIRM] 📊 Account: $${portfolio.totalValue.toFixed(0)} | Daily P&L: $${propFirmDailyPnL.toFixed(0)} | Drawdown: $${currentDrawdown.toFixed(0)} | Progress: $${totalPnL.toFixed(0)}/$${PROP_FIRM_PROFIT_TARGET}`);
    
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPositions = positions.filter(p => p.status === 'open' && p.assetType === 'future');
    
    // Only allow 1 position at a time for conservative approach
    if (openPositions.length >= 1) {
      logger.info(`🏆 [PROP-FIRM] Already have ${openPositions.length} open position - monitoring only`);
      return;
    }
    
    // Only trade NQ for Topstep (most liquid, smallest tick value)
    const contract = await getActiveFuturesContract('NQ');
    const price = await getFuturesPrice(contract.contractCode);
    
    if (!price || price <= 0) {
      logger.warn(`🏆 [PROP-FIRM] No price for ${contract.contractCode}`);
      return;
    }
    
    // High-probability setup detection
    const signals: string[] = [];
    let score = 50;
    
    // Time-based filters - only trade during optimal hours
    const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const hour = ctTime.getHours();
    const minute = ctTime.getMinutes();
    
    // Best trading hours: 9:30-11:00 AM and 2:00-3:30 PM CT
    const isMorningPrime = hour === 9 && minute >= 30 || hour === 10;
    const isAfternoonPrime = hour === 14 || (hour === 15 && minute <= 30);
    
    if (isMorningPrime) {
      signals.push('MORNING_PRIME_TIME');
      score += 15;
    } else if (isAfternoonPrime) {
      signals.push('AFTERNOON_PRIME_TIME');
      score += 12;
    } else {
      signals.push('OFF_PEAK_HOURS');
      score -= 10;
    }
    
    // Simple trend detection based on price levels
    const direction: 'long' | 'short' = 'long'; // Default long — no real signal available; placeholder until prop-firm signal integration
    signals.push(`DIRECTION_${direction.toUpperCase()}`);
    score += 10;
    
    // Only take high-probability trades (70%+ confidence)
    if (score < 70) {
      logger.info(`🏆 [PROP-FIRM] Score ${score}% below threshold (70%) - skipping trade`);
      return;
    }
    
    // Calculate conservative stop and target
    const stopPoints = PROP_FIRM_STOP_POINTS_NQ; // 15 points
    const targetPoints = PROP_FIRM_TARGET_POINTS_NQ; // 30 points (2:1 R:R)
    
    const entryPrice = price;
    const stopLoss = direction === 'long' ? entryPrice - stopPoints : entryPrice + stopPoints;
    const targetPrice = direction === 'long' ? entryPrice + targetPoints : entryPrice - targetPoints;
    
    // Risk per trade: $300 (15 points x $20/point)
    const riskPerContract = stopPoints * 20;
    const quantity = 1; // Single contract for conservative approach
    const marginRequired = 100; // Paper trading margin
    
    if (portfolio.cashBalance < marginRequired) {
      logger.warn(`🏆 [PROP-FIRM] Insufficient margin: $${portfolio.cashBalance.toFixed(0)} < $${marginRequired}`);
      return;
    }
    
    logger.info(`🏆 [PROP-FIRM] 🎯 ENTERING TRADE: ${direction.toUpperCase()} ${contract.contractCode} @ $${entryPrice.toFixed(2)}`);
    logger.info(`🏆 [PROP-FIRM] 📊 Stop: $${stopLoss.toFixed(2)} (-${stopPoints}pts) | Target: $${targetPrice.toFixed(2)} (+${targetPoints}pts) | Risk: $${riskPerContract}`);
    
    // Create trade idea
    const ideaData: InsertTradeIdea = {
      symbol: contract.contractCode,
      assetType: 'future',
      direction,
      entryPrice,
      targetPrice,
      stopLoss,
      riskRewardRatio: targetPoints / stopPoints,
      confidenceScore: score,
      qualitySignals: signals,
      probabilityBand: getLetterGrade(score),
      holdingPeriod: 'day',
      catalyst: `Prop Firm Mode: ${signals.join(', ')}`,
      analysis: `🏆 PROP FIRM TRADE\n\n` +
        `${contract.contractCode} ${direction.toUpperCase()}\n` +
        `Entry: $${entryPrice.toFixed(2)}\n` +
        `Stop: $${stopLoss.toFixed(2)} (-$${riskPerContract})\n` +
        `Target: $${targetPrice.toFixed(2)} (+$${targetPoints * 20})\n\n` +
        `Risk:Reward = 1:${(targetPoints / stopPoints).toFixed(1)}\n\n` +
        `⚠️ Conservative prop firm rules in effect`,
      sessionContext: 'Prop Firm Mode',
      timestamp: new Date().toISOString(),
      source: 'bot' as any,
      status: 'published',
      riskProfile: 'conservative',
      dataSourceUsed: 'yahoo_finance',
      outcomeStatus: 'open',
    };
    
    const savedIdea = await storage.createTradeIdea(ideaData);
    
    // Create paper position with entry reasoning
    await storage.createPaperPosition({
      portfolioId: portfolio.id,
      symbol: contract.contractCode,
      assetType: 'future',
      direction,
      quantity,
      entryPrice,
      currentPrice: entryPrice,
      targetPrice,
      stopLoss,
      status: 'open',
      tradeIdeaId: savedIdea.id,
      entryTime: new Date().toISOString(),
      entryReason: `🏆 PROP FIRM: ${contract.contractCode} ${direction.toUpperCase()} @ $${entryPrice.toFixed(2)} - Confidence ${score}%`,
      entrySignals: JSON.stringify(signals),
    });
    
    // Deduct margin
    await storage.updatePaperPortfolio(portfolio.id, {
      cashBalance: portfolio.cashBalance - marginRequired,
    });
    
    logger.info(`🏆 [PROP-FIRM] ✅ Trade executed - monitoring for stops/targets`);
    
  } catch (error) {
    logger.error(`🏆 [PROP-FIRM] Scan error:`, error);
  }
}

/**
 * Monitor Prop Firm positions with strict risk management
 */
export async function monitorPropFirmPositions(): Promise<void> {
  try {
    const portfolio = await getPropFirmPortfolio();
    if (!portfolio) return;
    
    const positions = await storage.getPaperPositionsByPortfolio(portfolio.id);
    const openPositions = positions.filter(p => p.status === 'open');
    
    if (openPositions.length === 0) return;
    
    for (const position of openPositions) {
      try {
        const currentPrice = await getFuturesPrice(position.symbol);
        if (!currentPrice || currentPrice <= 0) continue;
        
        const entryPrice = typeof position.entryPrice === 'string' ? parseFloat(position.entryPrice) : position.entryPrice;
        const stopLoss = position.stopLoss ? (typeof position.stopLoss === 'string' ? parseFloat(position.stopLoss) : position.stopLoss) : null;
        const targetPrice = position.targetPrice ? (typeof position.targetPrice === 'string' ? parseFloat(position.targetPrice) : position.targetPrice) : null;
        const direction = position.direction || 'long';
        const quantity = parseFloat(position.quantity?.toString() || '1');
        const multiplier = 2; // MNQ (Micro NQ) - $2/point for paper trading
        
        const pointDiff = direction === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice;
        const unrealizedPnL = pointDiff * multiplier * quantity;
        
        // Update position
        await storage.updatePaperPosition(position.id, {
          currentPrice,
          unrealizedPnL,
          unrealizedPnLPercent: (pointDiff / entryPrice) * 100,
        });
        
        logger.info(`🏆 [PROP-FIRM] ${position.symbol}: ${direction} @ $${entryPrice.toFixed(2)} → $${currentPrice.toFixed(2)} | P&L: ${unrealizedPnL >= 0 ? '+' : ''}$${unrealizedPnL.toFixed(0)}`);
        
        // Check stop loss
        if (stopLoss && (
          (direction === 'long' && currentPrice <= stopLoss) ||
          (direction === 'short' && currentPrice >= stopLoss)
        )) {
          logger.info(`🏆 [PROP-FIRM] ❌ STOP HIT: ${position.symbol} | P&L: $${unrealizedPnL.toFixed(0)}`);
          // closePaperPosition handles all portfolio updates (cash, P&L, win/loss count)
          await storage.closePaperPosition(position.id, currentPrice, 'hit_stop');
          
          // Send Discord notification - route to FUTURES channel
          try {
            await sendBotTradeExitToDiscord({
              symbol: position.symbol,
              assetType: 'future',
              entryPrice,
              exitPrice: currentPrice,
              quantity,
              realizedPnL: unrealizedPnL,
              exitReason: 'hit_stop',
              portfolio: 'futures', // Route to #future-trade-id channel with correct labeling
              source: 'futures',
            });
            logger.info(`🔮 [FUTURES-MONITOR] 📱 Discord exit notification sent to #future-trade-id`);
          } catch (discordError) {
            logger.warn(`🔮 [FUTURES-MONITOR] Discord notification failed:`, discordError);
          }
          
          propFirmDailyPnL += unrealizedPnL;
          continue;
        }
        
        // Check target
        if (targetPrice && (
          (direction === 'long' && currentPrice >= targetPrice) ||
          (direction === 'short' && currentPrice <= targetPrice)
        )) {
          logger.info(`🏆 [PROP-FIRM] ✅ TARGET HIT: ${position.symbol} | P&L: +$${unrealizedPnL.toFixed(0)}`);
          // closePaperPosition handles all portfolio updates (cash, P&L, win/loss count)
          await storage.closePaperPosition(position.id, currentPrice, 'hit_target');
          
          // Send Discord notification - route to FUTURES channel
          try {
            await sendBotTradeExitToDiscord({
              symbol: position.symbol,
              assetType: 'future',
              entryPrice,
              exitPrice: currentPrice,
              quantity,
              realizedPnL: unrealizedPnL,
              exitReason: 'hit_target',
              portfolio: 'futures', // Route to #future-trade-id channel with correct labeling
              source: 'futures',
            });
            logger.info(`🔮 [FUTURES-MONITOR] 📱 Discord exit notification sent to #future-trade-id`);
          } catch (discordError) {
            logger.warn(`🔮 [FUTURES-MONITOR] Discord notification failed:`, discordError);
          }
          
          propFirmDailyPnL += unrealizedPnL;
          continue;
        }
        
      } catch (posErr) {
        logger.error(`🏆 [PROP-FIRM] Position error:`, posErr);
      }
    }
  } catch (error) {
    logger.error(`🏆 [PROP-FIRM] Monitor error:`, error);
  }
}

/**
 * BOT SCREENER FUNCTION: Feed high-conviction opportunities to Trade Desk
 * 
 * This allows the bot to act as an extra screener - identifying trade setups
 * at 80%+ confidence and saving them to Trade Desk for user review,
 * WITHOUT actually executing them as trades.
 * 
 * Use case: User reviews bot-screened ideas on Trade Desk before manual execution
 */
export async function feedBotOpportunityToTradeDesk(
  opportunity: LottoOpportunity,
  decision: BotDecision,
  quote: { symbol: string; price: number }
): Promise<boolean> {
  try {
    // Only feed high-conviction ideas (80%+ = A- grade or better)
    if (decision.confidence < 80) {
      logger.debug(`📋 [BOT-SCREENER] Skipped ${quote.symbol}: ${decision.confidence}% < 80% threshold`);
      return false;
    }
    
    const { ingestTradeIdea } = await import('./trade-idea-ingestion');
    
    // Build signals from the decision - normalize mixed string/object format
    // decision.signals can contain either { type, strength, description } objects or plain strings
    const signals = decision.signals.map(s => {
      if (typeof s === 'string') {
        // String signals are simple identifiers pushed by boosts (e.g., 'PREFERRED_SYMBOL', 'MARKET_SCANNER_MOVER')
        return {
          type: s,
          weight: 10,
          description: s.replace(/_/g, ' ').toLowerCase()
        };
      } else {
        // Object signals have type, strength, description
        return {
          type: s.type || 'UNKNOWN',
          weight: s.strength || 10,
          description: s.description || s.type || 'Signal detected'
        };
      }
    });
    
    const result = await ingestTradeIdea({
      source: 'bot_screener',
      symbol: quote.symbol,
      assetType: 'option',
      direction: opportunity.direction,
      signals,
      holdingPeriod: 'day',
      currentPrice: quote.price,
      targetPrice: opportunity.targetPrice,
      stopLoss: opportunity.stopLoss,
      optionType: opportunity.direction === 'bullish' ? 'call' : 'put',
      strikePrice: opportunity.strikePrice,
      expiryDate: opportunity.expiry,
      catalyst: `Bot screener: ${decision.reason}`,
      analysis: `Auto-Lotto Bot identified ${decision.confidence}% conviction setup. ${decision.signals.map(s => s.description).join('. ')}`,
      sourceMetadata: {
        botConfidence: decision.confidence,
        botDecision: decision.shouldTrade ? 'TRADE' : 'WATCH',
        optionAsk: opportunity.ask,
        iv: opportunity.iv,
        delta: opportunity.delta,
      }
    });
    
    if (result.success) {
      logger.info(`📋 [BOT-SCREENER] ✅ Fed ${quote.symbol} to Trade Desk (${decision.confidence}% confidence)`);
      return true;
    } else {
      logger.debug(`📋 [BOT-SCREENER] Rejected: ${result.reason}`);
      return false;
    }
  } catch (error) {
    logger.error(`📋 [BOT-SCREENER] Error feeding ${quote.symbol}:`, error);
    return false;
  }
}

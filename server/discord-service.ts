// Discord webhook service for automated trade alerts
import type { TradeIdea } from "@shared/schema";
import { getSignalLabel } from "@shared/constants";
import { logger } from './logger';
import { getLetterGrade as canonicalLetterGrade } from './grading';
import { isOptionsMarketOpen } from './paper-trading-service';
import { formatInTimeZone } from 'date-fns-tz';
import { createHash } from 'node:crypto';

// GLOBAL DISABLE FLAG - Set to true to stop all Discord notifications
const DISCORD_DISABLED = false;

// One boundary for every Discord publisher. Historically each scanner called its
// webhook directly, so enabling several workers multiplied the channel volume.
// Limits are per webhook/channel: important bot traffic in #quantbot does not
// consume the research channel's allowance.
const DISCORD_WINDOW_MS = 10 * 60 * 1000;
const DISCORD_MAX_PER_WINDOW = Math.max(1, Number(process.env.DISCORD_MAX_PER_10_MIN ?? 6));
const DISCORD_MIN_INTERVAL_MS = Math.max(0, Number(process.env.DISCORD_MIN_INTERVAL_MS ?? 4_000));
const DISCORD_DUPLICATE_TTL_MS = 6 * 60 * 60 * 1000;
const webhookTraffic = new Map<string, { sentAt: number[]; signatures: Map<string, number> }>();

function messageSignature(init?: RequestInit): string | null {
  if (typeof init?.body !== 'string') return null;
  try {
    const payload = JSON.parse(init.body);
    // Discord timestamps change on every build and previously defeated exact-body
    // dedupe. They do not change the meaning of an alert.
    for (const embed of payload?.embeds ?? []) delete embed.timestamp;
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  } catch {
    return createHash('sha256').update(init.body).digest('hex');
  }
}

export async function postDiscordWebhook(webhookUrl: string, init?: RequestInit): Promise<Response> {
  const now = Date.now();
  const state = webhookTraffic.get(webhookUrl) ?? { sentAt: [], signatures: new Map<string, number>() };
  state.sentAt = state.sentAt.filter((at) => now - at < DISCORD_WINDOW_MS);
  for (const [signature, at] of state.signatures) if (now - at >= DISCORD_DUPLICATE_TTL_MS) state.signatures.delete(signature);
  const signature = messageSignature(init);

  if (signature && state.signatures.has(signature)) {
    logger.info('[DISCORD] duplicate suppressed at webhook boundary');
    webhookTraffic.set(webhookUrl, state);
    return new Response(null, { status: 204 });
  }
  const lastSent = state.sentAt.at(-1) ?? 0;
  if (state.sentAt.length >= DISCORD_MAX_PER_WINDOW || now - lastSent < DISCORD_MIN_INTERVAL_MS) {
    logger.warn(`[DISCORD] rate gate suppressed send (${state.sentAt.length}/${DISCORD_MAX_PER_WINDOW} in 10m)`);
    webhookTraffic.set(webhookUrl, state);
    return new Response(null, { status: 204 });
  }

  const response = await fetch(webhookUrl, init);
  if (response.ok) {
    state.sentAt.push(now);
    if (signature) state.signatures.set(signature, now);
    webhookTraffic.set(webhookUrl, state);
  }
  return response;
}

// OPTIONS PLAY RELEVANCE VALIDATION
// Prevents sending outdated, expired, or stale options alerts
interface OptionPlayValidation {
  symbol: string;
  expiryDate?: string | null;
  strikePrice?: number | null;
  optionType?: string | null;
  entryPrice?: number;
  generatedAt?: Date | string;
  assetType?: string | null;
  strategyContext?: string | null;
}

function isOptionPlayStillRelevant(play: OptionPlayValidation): { valid: boolean; reason: string } {
  const now = new Date();
  const chicagoTime = formatInTimeZone(now, 'America/Chicago', 'HH:mm');
  const [hours, mins] = chicagoTime.split(':').map(Number);
  const marketMinutes = hours * 60 + mins;
  
  // Market hours in minutes: 8:30 AM = 510, 3:00 PM = 900
  const MARKET_OPEN = 8 * 60 + 30;  // 8:30 AM CT
  const MARKET_CLOSE = 15 * 60;      // 3:00 PM CT
  const SAFE_0DTE_CUTOFF = MARKET_OPEN + 60; // conservative default lane
  
  // Check 1: Only validate options
  if (play.assetType && play.assetType !== 'option') {
    return { valid: true, reason: 'Not an option, no expiry validation needed' };
  }
  
  // Check 2: Expired options - never send
  if (play.expiryDate) {
    const expiry = new Date(play.expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    
    if (expiry < today) {
      return { valid: false, reason: `Option expired on ${play.expiryDate}` };
    }
    
    // Check 3: 0 DTE plays - only valid before market open + 1 hour
    const isToday = expiry.getTime() === today.getTime();
    if (isToday) {
      const isIndexClosingDrive = /(?:SPX|SPY|QQQ|IWM)/.test(play.symbol.toUpperCase()) &&
        /closing[ _-]?drive|power[ _-]?hour|index_scalp/i.test(play.strategyContext || '');

      // The old blanket cutoff made a deliberately late-session strategy
      // impossible to alert. Keep a narrow exception, not an all-day loophole:
      // 14:25–14:50 CT equals 15:25–15:50 ET. No fresh entry after that.
      if (isIndexClosingDrive) {
        const closingWindowOpen = 14 * 60 + 25;
        const closingWindowClose = 14 * 60 + 50;
        if (marketMinutes < closingWindowOpen || marketMinutes > closingWindowClose) {
          return { valid: false, reason: 'Closing-drive 0DTE alert outside 3:25–3:50 PM ET entry window' };
        }
        return { valid: true, reason: 'Verified index closing-drive window' };
      }

      // 0 DTE: Only send in pre-market or first hour of trading
      if (marketMinutes > SAFE_0DTE_CUTOFF) {
        return { valid: false, reason: `0 DTE option after ${Math.floor(SAFE_0DTE_CUTOFF / 60)}:${(SAFE_0DTE_CUTOFF % 60).toString().padStart(2, '0')} CT cutoff` };
      }
      
      // 0 DTE after 2 PM - absolutely never
      if (marketMinutes >= 14 * 60) {
        return { valid: false, reason: '0 DTE option too close to expiry (after 2 PM)' };
      }
    }
  }
  
  // Check 4: Worthless options - don't send if price is too low
  const minPrice = 0.05; // $5 minimum for options
  if (play.entryPrice !== undefined && play.entryPrice < minPrice) {
    return { valid: false, reason: `Option price $${play.entryPrice} below $${minPrice} minimum` };
  }
  
  // Check 5: Stale plays - don't send if generated more than 30 minutes ago
  if (play.generatedAt) {
    const generatedTime = new Date(play.generatedAt);
    const ageMinutes = (now.getTime() - generatedTime.getTime()) / (1000 * 60);
    
    if (ageMinutes > 30) {
      return { valid: false, reason: `Play is ${Math.round(ageMinutes)} minutes old (max 30 min)` };
    }
  }
  
  return { valid: true, reason: 'Play passes all relevance checks' };
}

// STRICT MODE - Controls auto-notifications
// When true: Disables batch summaries, market movers, flow alerts
// When false: Allows all auto-notifications based on quality gates
const STRICT_PREMIUM_ONLY = false;

// QUALITY GATE - B GRADE MINIMUM (70+ confidence, 3+ signals)
const MIN_SIGNALS_REQUIRED = 3;
const MIN_CONFIDENCE_REQUIRED = 70;

// Maximum option premium cost
const MAX_PREMIUM_COST = 1000;

// Valid grades for Discord alerts - A and B tier (A+, A, A-, B+, B)
export const VALID_DISCORD_GRADES = ['A+', 'A', 'A-', 'B+', 'B'];
// Secondary tier for less critical channels
export const SECONDARY_DISCORD_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-'];

// Color codes for Discord embeds
const COLORS = {
  LONG: 0x22c55e,    // Green for long/buy
  SHORT: 0xef4444,   // Red for short/sell
  AI: 0xa855f7,      // Purple for AI signals
  QUANT: 0x3b82f6,   // Blue for quant signals
  HYBRID: 0x10b981,  // Emerald for hybrid (AI + Quant)
  MANUAL: 0x64748b,  // Gray for manual trades
  LOTTO: 0xfacc15,   // Amber for Lotto
};

// DEDUPLICATION CACHE - Prevent sending same trade ideas to Discord multiple times
// Key format: "SYMBOL:DIRECTION:ASSETTYPE:OPTIONTYPE:STRIKE" -> timestamp when sent
// Enhanced to include option type and strike for more precise deduplication
const sentTradeIdeasCache = new Map<string, Date>();
const DEDUP_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours between same trade alerts

function getTradeDedupeKey(
  symbol: string, 
  direction: string, 
  assetType: string,
  optionType?: string | null,
  strikePrice?: number | null
): string {
  // Include option type and strike for options to prevent KOLD PUT $25 being confused with KOLD PUT $26
  const optionPart = assetType === 'option' && optionType ? `:${optionType}` : '';
  const strikePart = assetType === 'option' && strikePrice ? `:${strikePrice}` : '';
  return `${symbol}:${direction}:${assetType}${optionPart}${strikePart}`.toUpperCase();
}

function shouldSendTradeIdea(
  symbol: string, 
  direction: string, 
  assetType: string,
  optionType?: string | null,
  strikePrice?: number | null
): boolean {
  const key = getTradeDedupeKey(symbol, direction, assetType, optionType, strikePrice);
  const lastSent = sentTradeIdeasCache.get(key);
  
  if (!lastSent) return true;
  
  const timeSinceLastSent = Date.now() - lastSent.getTime();
  return timeSinceLastSent >= DEDUP_COOLDOWN_MS;
}

function markTradeIdeaSent(
  symbol: string, 
  direction: string, 
  assetType: string,
  optionType?: string | null,
  strikePrice?: number | null
): void {
  const key = getTradeDedupeKey(symbol, direction, assetType, optionType, strikePrice);
  sentTradeIdeasCache.set(key, new Date());
  
  // Clean up old entries (older than 24 hours)
  const now = Date.now();
  const keysToDelete: string[] = [];
  sentTradeIdeasCache.forEach((v, k) => {
    if (now - v.getTime() > 24 * 60 * 60 * 1000) {
      keysToDelete.push(k);
    }
  });
  keysToDelete.forEach(k => sentTradeIdeasCache.delete(k));
}

// Helper to convert confidence score to letter grade.
// Delegates to the platform-canonical scale so Discord alerts show the SAME
// grade the app does (was a divergent 7-step ladder).
function getLetterGrade(score: number): string {
  return canonicalLetterGrade(score);
}

// Map portfolio IDs to display names and emojis
const PORTFOLIO_METADATA: Record<string, { name: string; emoji: string }> = {
  'options': { name: 'Options Portfolio', emoji: '🎯' },
  'small_account': { name: 'Small Account Lotto', emoji: '🎰' },
  'futures': { name: 'Futures Portfolio', emoji: '📈' },
  'crypto': { name: 'Crypto Portfolio', emoji: '₿' },
};

const CHANNEL_HEADERS = {
  OPTIONS_TRADES: '📈 #OPTIONS-TRADES',
  STOCK_SHARES: '💵 #STOCK-SHARES',
  TRADE_ALERTS: '📊 #TRADE-ALERTS',
  QUANTBOT: '✨ #QUANTBOT',
  LOTTO: '🎰 #LOTTO',
  GAINS: '💰 #GAINS',
  FUTURES: '📈 #FUTURES',
  CHART_ANALYSIS: '📉 #CHART-ANALYSIS',
  WEEKLY_WATCHLIST: '📋 #WEEKLY-WATCHLIST',
};

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
  image?: { url: string };
}

interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
}

export async function sendBotTradeEntryToDiscord(trade: {
  symbol: string;
  assetType?: string | null;
  optionType?: string | null;
  strikePrice?: number | null;
  expiryDate?: string | null;
  entryPrice: number;
  quantity: number;
  targetPrice?: number | null;
  stopLoss?: number | null;
  analysis?: string | null;
  confidence?: number | null;
  portfolio?: string;
  isSmallAccount?: boolean;
  source?: string;
  isLotto?: boolean;
  delta?: number | null;
  riskRewardRatio?: number | null;
  signals?: string[] | null;
}): Promise<void> {
  if (DISCORD_DISABLED) return;

  // RELEVANCE CHECK: Validate option play is still actionable (not expired, not stale, not 0 DTE after cutoff)
  const relevanceCheck = isOptionPlayStillRelevant({
    symbol: trade.symbol,
    expiryDate: trade.expiryDate,
    strikePrice: trade.strikePrice,
    optionType: trade.optionType,
    entryPrice: trade.entryPrice,
    assetType: trade.assetType,
  });
  
  if (!relevanceCheck.valid) {
    logger.info(`[DISCORD] ⛔ BLOCKED outdated alert: ${trade.symbol} ${trade.optionType} $${trade.strikePrice} - ${relevanceCheck.reason}`);
    return;
  }

  // STRICT GRADE FILTER: Only A/A+ bot entries go to Discord
  const grade = trade.confidence ? getLetterGrade(trade.confidence) : 'D';
  if (!VALID_DISCORD_GRADES.includes(grade)) {
    logger.debug(`[DISCORD] Skipped bot entry ${trade.symbol} - grade ${grade} not in A/A+ tier`);
    return;
  }
  
  // DEDUPLICATION: Prevent same symbol/direction/assetType/strike from being sent multiple times
  const direction = trade.optionType === 'call' ? 'long' : 'short';
  const assetType = trade.assetType || 'option';
  if (!shouldSendTradeIdea(trade.symbol, direction, assetType, trade.optionType, trade.strikePrice)) {
    logger.debug(`[DISCORD] Skipped duplicate bot entry ${trade.symbol} ${direction} ${assetType} ${trade.optionType} $${trade.strikePrice} - sent within last 4 hours`);
    return;
  }

  // Auto-detect portfolio from assetType/source if not explicitly set
  let portfolioId = trade.portfolio || (trade.isSmallAccount ? 'small_account' : 'options');
  // Override to 'futures' if assetType or source indicates futures trade
  if (trade.assetType === 'future' || trade.source === 'futures') {
    portfolioId = 'futures';
  }
  const meta = PORTFOLIO_METADATA[portfolioId] || { name: 'Bot Portfolio', emoji: '🤖' };
  const isSmallAccount = trade.isSmallAccount || portfolioId === 'small_account';
  // Lotto branding only for actual lotto plays, NOT for small account portfolio
  const isLotto = (trade.isLotto || trade.source === 'lotto') && !isSmallAccount;

  // SINGLE CHANNEL ROUTING - No duplication
  // QuantBot = Alpaca paper trading bot entries/exits ONLY
  let webhookUrl: string | undefined;
  const source = trade.source || (trade.assetType === 'future' ? 'futures' : 'quant');

  if (source === 'futures' || trade.assetType === 'future') {
    // Futures go to #future-trades ONLY
    webhookUrl = process.env.DISCORD_WEBHOOK_FUTURE_TRADES;
  } else {
    // ALL bot entries (options, small account, etc) go to #quantbot ONLY
    // QuantBot = Alpaca paper trading channel
    webhookUrl = process.env.DISCORD_WEBHOOK_QUANTBOT;
  }

  if (!webhookUrl) return;

  try {
    const isCall = trade.optionType === 'call';
    const color = isLotto ? COLORS.LOTTO : (isCall ? 0x22c55e : 0xef4444);
    
    // Confidence grade
    const grade = trade.confidence ? getLetterGrade(trade.confidence) : '';
    
    // Greeks/Delta
    let deltaDisplay = '';
    if (trade.delta !== undefined && trade.delta !== null) {
      const absDelta = Math.abs(trade.delta);
      const deltaLabel = absDelta < 0.15 ? '🎰 Far OTM' : 
                         absDelta < 0.30 ? '📈 OTM' : 
                         absDelta < 0.45 ? '⚖️ ATM' : '💪 ITM';
      deltaDisplay = `δ=${absDelta.toFixed(2)} ${deltaLabel}`;
    }

    // CLEAR direction statement - no ambiguity
    const directionEmoji = isCall ? '📈' : '📉';
    const directionLabel = isCall ? 'BULLISH (CALL)' : 'BEARISH (PUT)';
    const cleanAnalysis = trade.analysis 
      ? `**${directionEmoji} ${directionLabel}** - ${trade.analysis}`
      : `**${directionEmoji} ${directionLabel}** - ${meta.name} position opened.`;

    // Format grade with confidence
    const gradeWithConfidence = trade.confidence 
      ? `${grade} (${trade.confidence}%)` 
      : grade || 'N/A';

    const embed: DiscordEmbed = {
      title: `${meta.emoji} ${isSmallAccount ? '💰 SMALL ACCOUNT' : '🤖 BOT'} ENTRY: ${trade.symbol} ${trade.optionType?.toUpperCase() || ''} ${trade.strikePrice ? '$' + trade.strikePrice : ''} [${grade}] ${trade.confidence || ''}%`,
      description: cleanAnalysis,
      color: isSmallAccount ? 0xfbbf24 : color,
      fields: [
        { name: '💰 Entry', value: `$${trade.entryPrice.toFixed(2)}`, inline: true },
        { name: '🎯 Target', value: trade.targetPrice ? `$${trade.targetPrice.toFixed(2)}` : 'N/A', inline: true },
        { name: '🛑 Stop', value: trade.stopLoss ? `$${trade.stopLoss.toFixed(2)}` : 'N/A', inline: true },
        { name: '⚖️ R:R', value: trade.riskRewardRatio ? `${trade.riskRewardRatio.toFixed(1)}:1` : 'N/A', inline: true },
        { name: '🎯 Grade', value: gradeWithConfidence, inline: true },
        { name: '📊 Details', value: deltaDisplay || `Qty: ${trade.quantity}`, inline: true }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: `Quant Edge Labs • ${meta.name} | ${gradeWithConfidence}` }
    };

    if (trade.expiryDate) {
      embed.fields.push({ name: '📅 Expiry', value: trade.expiryDate, inline: true });
    }

    const message: DiscordMessage = {
      content: `🚀 **BOT ENTRY**: ${trade.symbol} (${meta.name})`,
      embeds: [embed]
    };

    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    
    // Mark as sent to prevent duplicate alerts (including option type and strike)
    markTradeIdeaSent(trade.symbol, direction, assetType, trade.optionType, trade.strikePrice);
    logger.info(`[DISCORD] Sent bot trade entry: ${trade.symbol} ${direction} ${assetType} ${trade.optionType || ''} $${trade.strikePrice || ''}`);
  } catch (error) {
    logger.error('❌ Failed to send Discord bot alert:', error);
  }
}

export async function sendBotTradeExitToDiscord(exit: {
  symbol: string;
  assetType?: string | null;
  optionType?: string | null;
  strikePrice?: number | null;
  entryPrice: number;
  exitPrice?: number | null;
  quantity: number;
  realizedPnL?: number | null;
  exitReason?: string | null;
  portfolio?: string;
  isSmallAccount?: boolean;
  source?: string;
  price?: number;
  pnl?: number;
  reason?: string;
}): Promise<void> {
  if (DISCORD_DISABLED) return;

  // Determine portfolio type - handle both type strings ('futures') and UUIDs
  // Auto-detect from assetType if portfolio not provided or is a UUID (not a known type)
  let portfolioId = exit.portfolio || (exit.isSmallAccount ? 'small_account' : 'options');
  
  // If portfolioId is not a known type (probably a UUID), infer from assetType
  const knownTypes = ['options', 'small_account', 'futures', 'crypto'];
  if (!knownTypes.includes(portfolioId)) {
    // Infer from asset type or symbol
    if (exit.assetType === 'future' || exit.assetType === 'futures') {
      portfolioId = 'futures';
    } else if (exit.assetType === 'crypto') {
      portfolioId = 'crypto';
    } else if (exit.isSmallAccount || exit.source === 'small_account') {
      portfolioId = 'small_account';
    } else if (exit.symbol?.match(/^(NQ|GC|ES|CL|MNQ|MGC|MES|MCL)/i)) {
      // Futures contract symbols start with NQ, GC, ES, CL, etc.
      portfolioId = 'futures';
    } else {
      portfolioId = 'options';
    }
    logger.debug(`📱 [DISCORD] Auto-detected portfolio type: ${portfolioId} for ${exit.symbol} (asset: ${exit.assetType})`);
  }
  
  const meta = PORTFOLIO_METADATA[portfolioId] || { name: 'Bot Portfolio', emoji: '🤖' };
  
  // Small Account entries/exits go to #quantbot channel (per user request)
  // Only pure lotto plays (not small account) go to lotto channel
  const isSmallAccountExit = exit.isSmallAccount || portfolioId === 'small_account';
  const isLottoExit = exit.source === 'lotto' && !isSmallAccountExit;
  const webhookUrl = isLottoExit 
    ? (process.env.DISCORD_WEBHOOK_LOTTO || process.env.DISCORD_WEBHOOK_QUANTBOT)
    : process.env.DISCORD_WEBHOOK_QUANTBOT;

  if (!webhookUrl) return;

  try {
    const realizedPnL = exit.realizedPnL ?? exit.pnl ?? 0;
    const isProfit = realizedPnL > 0;
    const color = isProfit ? COLORS.LONG : COLORS.SHORT;
    const exitPrice = exit.exitPrice ?? exit.price ?? 0;
    const exitReason = exit.exitReason ?? exit.reason ?? 'Unknown';
    const pnlPercent = exit.entryPrice > 0 
      ? (exitPrice - exit.entryPrice) / exit.entryPrice * 100 
      : 0;
    
    // Determine portfolio label based on portfolioId
    const portfolioLabel = portfolioId === 'small_account' ? '💰 SMALL ACCOUNT' 
      : portfolioId === 'futures' ? '📈 FUTURES'
      : portfolioId === 'crypto' ? '₿ CRYPTO'
      : '🤖 BOT';
    
    const embed: DiscordEmbed = {
      title: `${isProfit ? '🎉' : '💀'} ${portfolioLabel} EXIT: ${exit.symbol} (${isProfit ? 'PROFIT' : 'LOSS'})`,
      description: `**${meta.name}** closed position - ${exitReason}`,
      color: portfolioId === 'small_account' ? 0xfbbf24 : portfolioId === 'futures' ? 0x3b82f6 : color,
      fields: [
        { name: '💵 Entry', value: `$${exit.entryPrice.toFixed(2)}`, inline: true },
        { name: '🚪 Exit', value: `$${exitPrice.toFixed(2)}`, inline: true },
        { name: '📊 P&L', value: `${isProfit ? '+' : ''}$${realizedPnL.toFixed(2)} (${pnlPercent.toFixed(1)}%)`, inline: true },
        { name: '📋 Reason', value: exitReason, inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: `Quant Edge Labs • ${meta.name}` }
    };

    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `${isProfit ? '✅' : '❌'} **BOT EXIT**: ${exit.symbol} (${meta.name})`,
        embeds: [embed]
      }),
    });
  } catch (error) {
    logger.error('❌ Failed to send Discord bot exit alert:', error);
  }
}

export function meetsQualityThreshold(idea: any): boolean {
  const signalCount = idea.qualitySignals?.length || 0;
  const confidence = idea.confidenceScore || 50;
  return confidence >= MIN_CONFIDENCE_REQUIRED && signalCount >= MIN_SIGNALS_REQUIRED;
}

export async function sendTradeIdeaToDiscord(idea: TradeIdea, options?: { forceBypassFilters?: boolean }): Promise<void> {
  if (DISCORD_DISABLED) return;
  
  const forceBypass = options?.forceBypassFilters ?? false;
  
  // RELEVANCE CHECK: Validate option play is still actionable (skip if force bypass)
  if (!forceBypass && idea.assetType === 'option') {
    const relevanceCheck = isOptionPlayStillRelevant({
      symbol: idea.symbol,
      expiryDate: (idea as any).expiryDate || (idea as any).expiry,
      strikePrice: (idea as any).strikePrice || (idea as any).strike,
      optionType: (idea as any).optionType,
      entryPrice: idea.entryPrice,
      assetType: idea.assetType,
      generatedAt: idea.timestamp,
      strategyContext: `${(idea as any).dataSourceUsed || ''} ${(idea as any).catalyst || ''} ${(idea as any).analysis || ''}`,
    });
    
    if (!relevanceCheck.valid) {
      logger.info(`[DISCORD] ⛔ BLOCKED outdated trade idea: ${idea.symbol} - ${relevanceCheck.reason}`);
      return;
    }
  }
  
  // STRICT GRADE FILTER: Only A/A+ trades go to Discord (skip if force bypass for manual shares)
  // SPX scanner signals use relaxed grade filter (B- and above) since scanners already pre-filter
  if (!forceBypass) {
    const grade = (idea as any).grade || getLetterGrade((idea as any).confidenceScore || 0);
    const source = (idea as any).source || '';
    const isSPXSource = source === 'orb_scanner' || source === 'spx_session';
    const allowedGrades = isSPXSource ? SECONDARY_DISCORD_GRADES : VALID_DISCORD_GRADES;
    if (!allowedGrades.includes(grade)) {
      logger.debug(`[DISCORD] Skipped ${idea.symbol} - grade ${grade} not in ${isSPXSource ? 'SPX' : 'A/A+'} tier`);
      return;
    }
  }
  
  // DEDUPLICATION: Prevent same symbol/direction/assetType/strike from being sent multiple times (skip if force bypass)
  const direction = idea.direction || 'long';
  const assetType = idea.assetType || 'stock';
  const optionType = (idea as any).optionType;
  const strikePrice = (idea as any).strikePrice || (idea as any).strike;
  if (!forceBypass && !shouldSendTradeIdea(idea.symbol, direction, assetType, optionType, strikePrice)) {
    logger.debug(`[DISCORD] Skipped duplicate ${idea.symbol} ${direction} ${assetType} ${optionType || ''} $${strikePrice || ''} - sent within last 4 hours`);
    return;
  }
  
  // Route to appropriate Discord channel based on asset type
  let webhookUrl: string | undefined;
  const assetTypeStr = String(idea.assetType || 'stock');
  const ideaSource = (idea as any).source || '';
  const isSPXPlay = ideaSource === 'orb_scanner' || ideaSource === 'spx_session' ||
    (['SPX', 'SPY', 'SPXW'].includes(idea.symbol) && assetTypeStr === 'option');

  if (ideaSource === 'oracle-signal' && process.env.DISCORD_WEBHOOK_ORACLE_SIGNALS) {
    // Oracle is the published research stream. Keep it separate from generic
    // options traffic so a reader can distinguish a called signal from a bot fill.
    webhookUrl = process.env.DISCORD_WEBHOOK_ORACLE_SIGNALS;
  } else if (isSPXPlay && process.env.DISCORD_WEBHOOK_SPX) {
    // SPX/0DTE plays go to dedicated SPX channel
    webhookUrl = process.env.DISCORD_WEBHOOK_SPX;
  } else if (assetTypeStr === 'option') {
    webhookUrl = process.env.DISCORD_WEBHOOK_OPTIONSTRADES;
  } else if (assetTypeStr === 'future' || assetTypeStr === 'futures') {
    webhookUrl = process.env.DISCORD_WEBHOOK_FUTURE_TRADES;
  } else {
    // Stocks, crypto, and other assets go to quant-floor
    webhookUrl = process.env.DISCORD_WEBHOOK_QUANTFLOOR;
  }
  if (!webhookUrl) {
    logger.warn(`[DISCORD] No webhook URL configured for ${idea.symbol} (${idea.assetType})`);
    return;
  }
  try {
    const isLong = idea.direction === 'long';
    const isTVSignal = ideaSource === 'tradingview';
    const color = isTVSignal ? 0xa855f7 : (isLong ? COLORS.LONG : COLORS.SHORT); // Purple for TV signals
    const isOracleSignal = ideaSource === 'oracle-signal';
    const titleEmoji = isTVSignal ? '📺' : isOracleSignal ? '✦' : (isLong ? '🟢' : '🔴');
    const titlePrefix = isTVSignal ? 'TV SIGNAL' : isOracleSignal ? 'ORACLE SIGNAL' : idea.direction.toUpperCase();
    const embed: DiscordEmbed = {
      title: `${titleEmoji} ${titlePrefix}: ${idea.symbol} ${idea.direction.toUpperCase()}`,
      description: idea.analysis || 'New trade idea detected.',
      color,
      fields: [
        { name: '💰 Entry', value: `$${idea.entryPrice.toFixed(2)}`, inline: true },
        { name: '🎯 Target', value: `$${idea.targetPrice.toFixed(2)}`, inline: true },
        { name: '🛡️ Stop', value: idea.stopLoss ? `$${idea.stopLoss.toFixed(2)}` : 'N/A', inline: true },
        ...(isOracleSignal ? [{ name: '🧠 Confidence', value: `${Number((idea as any).confidenceScore ?? 0)}/100`, inline: true }] : []),
      ],
      footer: isTVSignal ? { text: `TradingView Strategy Signal • ${(idea as any).sessionContext || 'v15'}` } : undefined,
      timestamp: new Date().toISOString()
    };
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: isTVSignal ? `📺 **TV SIGNAL**: ${idea.symbol} ${idea.direction.toUpperCase()} — backtested strategy alert` : undefined,
        embeds: [embed],
      }),
    });
    
    // Mark as sent to prevent duplicate alerts (including option type and strike)
    markTradeIdeaSent(idea.symbol, direction, assetType, optionType, strikePrice);
    logger.info(`[DISCORD] Sent trade idea: ${idea.symbol} ${direction} ${assetType} ${optionType || ''} $${strikePrice || ''}`);
  } catch (e) { logger.error(e); }
}

/**
 * Resolve the Discord webhook for a trade idea using the same asset-type routing
 * as sendTradeIdeaToDiscord (options → OPTIONSTRADES, futures → FUTURE_TRADES,
 * SPX/0DTE → SPX, else QUANTFLOOR). Returns undefined if none configured.
 */
function resolveTradeWebhook(idea: TradeIdea): string | undefined {
  const assetTypeStr = String(idea.assetType || 'stock');
  const ideaSource = (idea as any).source || '';

  // Board signals go to their own channel. Checked FIRST: routing them by asset
  // type scattered them across the options and futures channels alongside manual
  // pushes, so there was no single place to watch what the board actually said.
  if (ideaSource === 'oracle-signal' && process.env.DISCORD_WEBHOOK_ORACLE_SIGNALS) {
    return process.env.DISCORD_WEBHOOK_ORACLE_SIGNALS;
  }
  const isSPXPlay = ideaSource === 'orb_scanner' || ideaSource === 'spx_session' ||
    (['SPX', 'SPY', 'SPXW'].includes(idea.symbol) && assetTypeStr === 'option');
  if (isSPXPlay && process.env.DISCORD_WEBHOOK_SPX) return process.env.DISCORD_WEBHOOK_SPX;
  if (assetTypeStr === 'option') return process.env.DISCORD_WEBHOOK_OPTIONSTRADES;
  if (assetTypeStr === 'future' || assetTypeStr === 'futures') return process.env.DISCORD_WEBHOOK_FUTURE_TRADES;
  return process.env.DISCORD_WEBHOOK_QUANTFLOOR;
}

/**
 * Post a rendered trade-card IMAGE to Discord as a real file attachment, shown
 * inline via an embed (attachment:// reference). The image is the visual card the
 * user composed in the Trade Desk — never fabricated. A compact embed carries the
 * symbol/direction + entry/target/stop so the message reads well even on mobile.
 *
 * Uses Node's global FormData/Blob (Node 18+) to build the multipart body Discord
 * webhooks require for file uploads.
 */
export async function sendTradeCardImageToDiscord(
  idea: TradeIdea,
  image: Buffer,
  filename = 'trade-card.png',
): Promise<{ success: boolean; channel?: string; error?: string }> {
  if (DISCORD_DISABLED) return { success: false, error: 'Discord disabled' };

  // A dedicated Trade-Desk card webhook (if set) overrides asset-type routing, so
  // every manual "Share card" lands in one channel the user picked.
  const webhookUrl = process.env.DISCORD_WEBHOOK_TRADEDESK_CARD || resolveTradeWebhook(idea);
  if (!webhookUrl) {
    logger.warn(`[DISCORD] No webhook configured for ${idea.symbol} (${idea.assetType}) card share`);
    return { success: false, error: 'No Discord webhook configured for this asset type' };
  }

  // Normalize the filename Discord will reference (no spaces / odd chars).
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const isLong = String(idea.direction).toLowerCase() === 'long';
  const opt = idea as any;
  const contractLine = idea.assetType === 'option' && opt.optionType
    ? `${opt.optionType.toUpperCase()}${opt.strikePrice ? ` $${opt.strikePrice}` : ''}${opt.expiryDate ? ` exp ${opt.expiryDate}` : ''}`
    : null;

  const embed: DiscordEmbed = {
    title: `${isLong ? '🟢' : '🔴'} ${String(idea.direction).toUpperCase()}: ${idea.symbol}${contractLine ? ` · ${contractLine}` : ''}`,
    color: isLong ? COLORS.LONG : COLORS.SHORT,
    fields: [
      { name: '💰 Entry', value: `$${Number(idea.entryPrice).toFixed(2)}`, inline: true },
      { name: '🎯 Target', value: `$${Number(idea.targetPrice).toFixed(2)}`, inline: true },
      { name: '🛡️ Stop', value: idea.stopLoss != null ? `$${Number(idea.stopLoss).toFixed(2)}` : 'N/A', inline: true },
    ],
    image: { url: `attachment://${safeName}` },
    timestamp: new Date().toISOString(),
  };

  try {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ embeds: [embed] }));
    form.append('files[0]', new Blob([new Uint8Array(image)], { type: 'image/png' }), safeName);

    const res = await postDiscordWebhook(webhookUrl, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error(`[DISCORD] Card upload failed (${res.status}) for ${idea.symbol}: ${body.slice(0, 200)}`);
      return { success: false, error: `Discord rejected the upload (${res.status})` };
    }
    logger.info(`[DISCORD] Sent trade CARD image: ${idea.symbol} ${idea.direction} (${idea.assetType})`);
    return { success: true };
  } catch (e) {
    logger.error(`[DISCORD] Card upload threw for ${idea.symbol}:`, e);
    return { success: false, error: (e as Error).message };
  }
}

export async function sendChartAnalysisToDiscord(analysis: any): Promise<boolean> {
  if (DISCORD_DISABLED) return false;
  const webhookUrl = process.env.DISCORD_WEBHOOK_CHARTANALYSIS || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return false;
  try {
    const color = analysis.sentiment === 'bullish' ? 0x22c55e : 0xef4444;
    const embed: DiscordEmbed = {
      title: `📊 Chart Analysis: ${analysis.symbol}`,
      description: analysis.analysis,
      color,
      fields: [
        { name: 'Sentiment', value: analysis.sentiment, inline: true },
        { name: 'Confidence', value: `${analysis.confidence}%`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    return true;
  } catch (e) { return false; }
}

export async function sendLottoToDiscord(idea: TradeIdea): Promise<void> {
  if (DISCORD_DISABLED) return;
  
  // RELEVANCE CHECK: Validate lotto option is still actionable (critical for 0 DTE plays)
  const relevanceCheck = isOptionPlayStillRelevant({
    symbol: idea.symbol,
    expiryDate: (idea as any).expiryDate || (idea as any).expirationDate,
    strikePrice: (idea as any).strikePrice,
    optionType: (idea as any).optionType,
    entryPrice: idea.entryPrice,
    assetType: 'option',
    generatedAt: idea.timestamp,
  });
  
  if (!relevanceCheck.valid) {
    logger.info(`[DISCORD] ⛔ BLOCKED outdated lotto: ${idea.symbol} - ${relevanceCheck.reason}`);
    return;
  }
  
  // STRICT GRADE FILTER: Only A/A+ lotto trades go to Discord
  const grade = (idea as any).grade || getLetterGrade((idea as any).confidenceScore || 0);
  if (!VALID_DISCORD_GRADES.includes(grade)) {
    logger.debug(`[DISCORD] Skipped lotto ${idea.symbol} - grade ${grade} not in A/A+ tier`);
    return;
  }
  
  // DEDUPLICATION: Prevent same lotto from being sent multiple times
  // Include option type AND strike to prevent spam of same option
  const optionTypeLower = ((idea as any).optionType || 'call').toLowerCase();
  const strikeKey = (idea as any).strikePrice ? `_${(idea as any).strikePrice}` : '';
  const direction = `${optionTypeLower}${strikeKey}`; // e.g. "put_25" or "call_100"
  const assetType = 'lotto';
  if (!shouldSendTradeIdea(idea.symbol, direction, assetType)) {
    logger.debug(`[DISCORD] Skipped duplicate lotto ${idea.symbol} ${direction} - sent within last 4 hours`);
    return;
  }
  
  // SINGLE CHANNEL: Lottos go to #lotto ONLY (no duplication)
  const webhookUrl = process.env.DISCORD_WEBHOOK_LOTTO;
  if (!webhookUrl) return;
  
  try {
    // Build title with option details if available
    const optionType = (idea as any).optionType ? (idea as any).optionType.toUpperCase() : '';
    const strike = (idea as any).strikePrice ? `$${(idea as any).strikePrice}` : '';
    const rawExpiry = (idea as any).expiryDate || (idea as any).expirationDate;
    const expiry = rawExpiry ? `exp ${String(rawExpiry).split('T')[0]}` : '';
    
    // Format: 🎰 LOTTO: INTC CALL $25 (exp 2026-01-09)
    const titleSuffix = (optionType && strike) 
      ? ` ${optionType} ${strike} ${expiry ? `(${expiry})` : ''}`
      : '';
    
    const confidence = (idea as any).confidenceScore || 0;
    const grade = getLetterGrade(confidence);
    
    const embed: DiscordEmbed = {
      title: `🎰 LOTTO: ${idea.symbol}${titleSuffix}`,
      description: idea.analysis || 'New lotto detected',
      color: COLORS.LOTTO,
      fields: [
        { name: 'Entry', value: `$${idea.entryPrice.toFixed(2)}`, inline: true },
        { name: 'Target', value: idea.targetPrice ? `$${idea.targetPrice.toFixed(2)}` : 'N/A', inline: true },
        { name: 'Confidence', value: `${confidence}% (${grade})`, inline: true }
      ],
      footer: { text: '🎰 Small Account Lotto Bot' },
      timestamp: new Date().toISOString()
    };
    
    // Send to lotto channel only
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    
    // Mark as sent to prevent duplicate alerts
    markTradeIdeaSent(idea.symbol, direction, assetType);
    logger.info(`[DISCORD] Sent lotto: ${idea.symbol} ${optionTypeLower.toUpperCase()}${strikeKey}`);
  } catch (e) {
    logger.warn(`[DISCORD] Lotto notification error: ${e}`);
  }
}

export async function sendBatchTradeIdeasToDiscord(ideas: TradeIdea[], source: string): Promise<void> {
  if (DISCORD_DISABLED || ideas.length === 0) return;
  
  // STRICT GRADE FILTER: Only A/A+ ideas in batches
  const qualityIdeas = ideas.filter((i: any) => {
    const grade = i.grade || getLetterGrade(i.confidenceScore || 0);
    return VALID_DISCORD_GRADES.includes(grade);
  });
  
  if (qualityIdeas.length === 0) {
    logger.debug(`[DISCORD] Batch skipped - no A/A+ grade ideas in ${ideas.length} total`);
    return;
  }
  
  const webhookUrl = process.env.DISCORD_WEBHOOK_OPTIONSTRADES || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    const description = qualityIdeas.slice(0, 10).map((i: any) => {
      const optionType = i.optionType ? i.optionType.toUpperCase() : '';
      const strike = i.strikePrice ? `$${i.strikePrice}` : '';
      // Support both expiryDate and expirationDate field names
      const rawExpiry = i.expiryDate || i.expirationDate;
      const expiry = rawExpiry ? `exp ${String(rawExpiry).split('T')[0]}` : '';
      // Format price properly - avoid "$N/A"
      const priceStr = i.entryPrice != null ? `$${Number(i.entryPrice).toFixed(2)}` : 'N/A';
      
      // Format: INTC CALL $25 @ $0.48 (exp 2026-01-09)
      if (i.assetType === 'option' && optionType && strike) {
        return `${i.symbol} ${optionType} ${strike} @ ${priceStr} ${expiry ? `(${expiry})` : ''}`;
      }
      return `${i.symbol}: ${priceStr}`;
    }).join('\n');
    
    const embed: DiscordEmbed = {
      title: `📢 BATCH: ${source.toUpperCase()} - ${qualityIdeas.length} A/A+ Ideas`,
      description,
      color: COLORS.QUANT,
      fields: [],
      timestamp: new Date().toISOString()
    };
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (e) {}
}

// Send generic Discord alert to QUANTFLOOR (main channel)
export async function sendDiscordAlert(content: string, type: 'info' | 'warn' | 'error' = 'info'): Promise<void> {
  if (DISCORD_DISABLED) return;
  const webhookUrl = process.env.DISCORD_WEBHOOK_QUANTFLOOR;
  if (!webhookUrl) return;

  try {
    const color = type === 'error' ? COLORS.SHORT : type === 'warn' ? 0xf59e0b : 0x3b82f6;
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `${type === 'error' ? '❌' : type === 'warn' ? '⚠️' : 'ℹ️'} ${content}`,
        embeds: [{
          description: content,
          color,
          timestamp: new Date().toISOString()
        }]
      }),
    });
  } catch (e) { logger.error(e); }
}

export async function sendWatchlistToQuantBot(items: any[]): Promise<any> {
  return { success: true };
}

export async function sendWeeklyWatchlistToDiscord(items: any[]): Promise<void> {
  if (DISCORD_DISABLED || !items || items.length === 0) return;
  const webhookUrl = process.env.DISCORD_WEBHOOK_WEEKLYWATCHLISTS;
  if (!webhookUrl) return;

  try {
    const bullish = items.filter((i: any) => i.sentiment === 'bullish' || i.direction === 'long');
    const bearish = items.filter((i: any) => i.sentiment === 'bearish' || i.direction === 'short');

    const formatItem = (item: any) => {
      const grade = item.grade || '';
      const conf = item.confidence ? `${item.confidence}%` : '';
      const price = item.price ? `$${item.price.toFixed(2)}` : '';
      return `**${item.symbol}** ${grade} ${conf} ${price}`.trim();
    };

    const fields: { name: string; value: string; inline?: boolean }[] = [];

    if (bullish.length > 0) {
      fields.push({
        name: '🟢 BULLISH WATCHLIST',
        value: bullish.slice(0, 10).map(formatItem).join('\n') || 'None',
        inline: false
      });
    }

    if (bearish.length > 0) {
      fields.push({
        name: '🔴 BEARISH WATCHLIST',
        value: bearish.slice(0, 10).map(formatItem).join('\n') || 'None',
        inline: false
      });
    }

    const embed: DiscordEmbed = {
      title: `📋 WEEKLY WATCHLIST - ${items.length} Stocks`,
      description: `Top picks for the week ahead. B grade or higher.`,
      color: COLORS.QUANT,
      fields,
      footer: { text: 'Quant Edge Labs Weekly Watchlist' },
      timestamp: new Date().toISOString()
    };

    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    logger.info(`[DISCORD] Sent weekly watchlist: ${items.length} items`);
  } catch (e) {
    logger.error(`[DISCORD] Failed to send weekly watchlist: ${e}`);
  }
}

export async function sendNextWeekPicksToDiscord(picks: any[], range: any): Promise<void> {
  if (DISCORD_DISABLED || !picks || picks.length === 0) return;
  const webhookUrl = process.env.DISCORD_WEBHOOK_WEEKLYWATCHLISTS;
  if (!webhookUrl) return;

  try {
    const description = picks.slice(0, 15).map((p: any) => {
      const emoji = p.direction === 'long' ? '🟢' : '🔴';
      const grade = p.grade ? `[${p.grade}]` : '';
      const price = p.entryPrice ? `@ $${p.entryPrice.toFixed(2)}` : '';
      return `${emoji} **${p.symbol}** ${grade} ${price}`;
    }).join('\n');

    const embed: DiscordEmbed = {
      title: `🎯 NEXT WEEK PICKS - ${range?.start || ''} to ${range?.end || ''}`,
      description: description || 'No picks available',
      color: COLORS.QUANT,
      fields: [
        { name: 'Total Picks', value: `${picks.length}`, inline: true },
        { name: 'Bullish', value: `${picks.filter((p: any) => p.direction === 'long').length}`, inline: true },
        { name: 'Bearish', value: `${picks.filter((p: any) => p.direction === 'short').length}`, inline: true }
      ],
      footer: { text: 'Quant Edge Labs Weekly Picks' },
      timestamp: new Date().toISOString()
    };

    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    logger.info(`[DISCORD] Sent next week picks: ${picks.length} picks`);
  } catch (e) {
    logger.error(`[DISCORD] Failed to send next week picks: ${e}`);
  }
}

export async function sendDailySummaryToDiscord(ideas: any[]): Promise<void> {
  // Daily summaries go to QUANTFLOOR
  if (DISCORD_DISABLED || !ideas || ideas.length === 0) return;
  const webhookUrl = process.env.DISCORD_WEBHOOK_QUANTFLOOR;
  if (!webhookUrl) return;

  try {
    const topIdeas = ideas
      .filter((i: any) => VALID_DISCORD_GRADES.includes(i.grade))
      .slice(0, 10);

    if (topIdeas.length === 0) return;

    const description = topIdeas.map((i: any) => {
      const emoji = i.direction === 'long' ? '🟢' : '🔴';
      const optionType = i.optionType ? i.optionType.toUpperCase() : '';
      const strike = i.strikePrice ? `$${i.strikePrice}` : '';
      const price = i.entryPrice ? `@ $${i.entryPrice.toFixed(2)}` : '';
      const grade = i.grade ? `[${i.grade}]` : '';

      if (i.assetType === 'option' && optionType && strike) {
        return `${emoji} **${i.symbol}** ${optionType} ${strike} ${price} ${grade}`;
      }
      return `${emoji} **${i.symbol}** ${price} ${grade}`;
    }).join('\n');

    const embed: DiscordEmbed = {
      title: `☀️ DAILY PREVIEW - ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
      description,
      color: COLORS.QUANT,
      fields: [
        { name: 'Total Ideas', value: `${ideas.length}`, inline: true },
        { name: 'B+ Grade', value: `${ideas.filter((i: any) => ['A+', 'A', 'A-', 'B+'].includes(i.grade)).length}`, inline: true },
        { name: 'Options', value: `${ideas.filter((i: any) => i.assetType === 'option').length}`, inline: true }
      ],
      footer: { text: 'Quant Edge Labs • Daily Preview at 8:00 AM ET' },
      timestamp: new Date().toISOString()
    };

    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '☀️ **GOOD MORNING!** Here are today\'s top trade ideas:',
        embeds: [embed]
      }),
    });

    logger.info(`[DISCORD] Sent daily summary: ${topIdeas.length} ideas to QuantFloor`);
  } catch (e) {
    logger.error(`[DISCORD] Failed to send daily summary: ${e}`);
  }
}
export async function sendAnnualBreakoutsToDiscord(items: any[]): Promise<any> { return { success: true }; }
export async function sendCryptoBotTradeToDiscord(trade: any): Promise<void> {}
export async function sendReportNotificationToDiscord(report: any): Promise<void> {
  if (DISCORD_DISABLED) return;
  // Reports are allowed to QUANTFLOOR as announcements
  const webhookUrl = process.env.DISCORD_WEBHOOK_QUANTFLOOR || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    const embed: DiscordEmbed = {
      title: `📊 Platform Report: ${report.period || 'daily'}`,
      description: report.summary || 'New platform report available',
      color: COLORS.LONG,
      fields: [
        { name: 'Period', value: report.period || 'daily', inline: true },
        { name: 'Date', value: report.reportDate || new Date().toISOString().split('T')[0], inline: true }
      ],
      timestamp: new Date().toISOString()
    };
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (e) { logger.error(e); }
}
export async function sendFuturesTradesToDiscord(ideas: any[]): Promise<void> {
  if (DISCORD_DISABLED || ideas.length === 0) return;
  
  const webhookUrl = process.env.DISCORD_WEBHOOK_FUTURE_TRADES || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const embed: DiscordEmbed = {
      title: `🔮 FUTURES TRADE ALERTS - ${ideas.length} New Setups`,
      description: ideas.map((i: any) => {
        const emoji = i.direction === 'long' ? '🟢' : '🔴';
        const priceStr = i.entryPrice != null ? `$${Number(i.entryPrice).toFixed(2)}` : 'N/A';
        return `${emoji} **${i.symbol}** @ ${priceStr} [${i.grade || 'N/A'}]`;
      }).join('\n'),
      fields: [],
      color: COLORS.QUANT,
      timestamp: new Date().toISOString()
    };
    
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (e) {
    logger.error(`[DISCORD] Failed to send futures trades: ${e}`);
  }
}
// Track recently sent quant ideas to prevent spam - key is "symbol:strike:optionType:expiry"
const recentQuantIdeas = new Map<string, number>();
const QUANT_IDEA_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown per unique idea

// ============ PENNY SCANNER NOTIFICATION DEDUPLICATION ============
// Prevents spam from penny/sub-penny scanners sending duplicate Discord messages
const pennyScannerLastNotification = new Map<string, number>(); // key: "standard" or "subpenny" -> timestamp
const PENNY_SCANNER_GLOBAL_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours between penny scanner notifications
const pennyScannerSymbolCache = new Map<string, number>(); // key: symbol -> timestamp
const PENNY_SYMBOL_COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8 hours between same symbol notifications

/**
 * Check if penny scanner notification can be sent (global + per-symbol cooldown)
 */
export function canSendPennyScannerNotification(scannerType: 'standard' | 'subpenny', symbols: string[]): {
  canSend: boolean;
  reason: string;
  filteredSymbols: string[];
} {
  const now = Date.now();

  // Check global cooldown for this scanner type
  const lastNotification = pennyScannerLastNotification.get(scannerType);
  if (lastNotification && now - lastNotification < PENNY_SCANNER_GLOBAL_COOLDOWN_MS) {
    const remainingMins = Math.round((PENNY_SCANNER_GLOBAL_COOLDOWN_MS - (now - lastNotification)) / 60000);
    return {
      canSend: false,
      reason: `Global cooldown - ${remainingMins}min remaining for ${scannerType} scanner`,
      filteredSymbols: []
    };
  }

  // Filter out symbols that were recently notified
  const filteredSymbols = symbols.filter(symbol => {
    const lastSymbolNotify = pennyScannerSymbolCache.get(symbol);
    if (lastSymbolNotify && now - lastSymbolNotify < PENNY_SYMBOL_COOLDOWN_MS) {
      return false; // Skip - recently notified
    }
    return true;
  });

  // Clean up old cache entries
  if (pennyScannerSymbolCache.size > 500) {
    const entries = Array.from(pennyScannerSymbolCache.entries());
    for (const [key, timestamp] of entries) {
      if (now - timestamp > PENNY_SYMBOL_COOLDOWN_MS) {
        pennyScannerSymbolCache.delete(key);
      }
    }
  }

  if (filteredSymbols.length === 0) {
    return {
      canSend: false,
      reason: 'All symbols were recently notified',
      filteredSymbols: []
    };
  }

  return {
    canSend: true,
    reason: 'OK',
    filteredSymbols
  };
}

/**
 * Mark penny scanner notification as sent
 */
export function markPennyScannerNotificationSent(scannerType: 'standard' | 'subpenny', symbols: string[]): void {
  const now = Date.now();
  pennyScannerLastNotification.set(scannerType, now);

  for (const symbol of symbols) {
    pennyScannerSymbolCache.set(symbol, now);
  }

  logger.info(`[DISCORD] Marked ${scannerType} penny scanner notification sent for ${symbols.length} symbols`);
}

/**
 * Get penny scanner notification stats (for debugging)
 */
export function getPennyScannerNotificationStats(): {
  standardLastSent: string | null;
  subpennyLastSent: string | null;
  symbolCacheSize: number;
} {
  const standardLast = pennyScannerLastNotification.get('standard');
  const subpennyLast = pennyScannerLastNotification.get('subpenny');

  return {
    standardLastSent: standardLast ? new Date(standardLast).toISOString() : null,
    subpennyLastSent: subpennyLast ? new Date(subpennyLast).toISOString() : null,
    symbolCacheSize: pennyScannerSymbolCache.size
  };
}

// ============ UNIVERSAL SCANNER NOTIFICATION DEDUPLICATION ============
// Prevents spam from ALL scanner types sending duplicate Discord messages
type ScannerType = 'options_flow' | 'social_sentiment' | 'swing_trade' | 'breakout';
const scannerLastNotification = new Map<ScannerType, number>();
const SCANNER_GLOBAL_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours between scanner notifications
const scannerSymbolCache = new Map<string, number>(); // key: "scannerType:symbol" -> timestamp
const SCANNER_SYMBOL_COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8 hours between same symbol notifications

/**
 * Check if a scanner notification can be sent (global + per-symbol cooldown)
 */
export function canSendScannerNotification(scannerType: ScannerType, symbols: string[]): {
  canSend: boolean;
  reason: string;
  filteredSymbols: string[];
} {
  const now = Date.now();

  // Check global cooldown for this scanner type
  const lastNotification = scannerLastNotification.get(scannerType);
  if (lastNotification && now - lastNotification < SCANNER_GLOBAL_COOLDOWN_MS) {
    const remainingMins = Math.round((SCANNER_GLOBAL_COOLDOWN_MS - (now - lastNotification)) / 60000);
    return {
      canSend: false,
      reason: `Global cooldown - ${remainingMins}min remaining for ${scannerType}`,
      filteredSymbols: []
    };
  }

  // Filter out symbols that were recently notified for this scanner type
  const filteredSymbols = symbols.filter(symbol => {
    const cacheKey = `${scannerType}:${symbol}`;
    const lastSymbolNotify = scannerSymbolCache.get(cacheKey);
    if (lastSymbolNotify && now - lastSymbolNotify < SCANNER_SYMBOL_COOLDOWN_MS) {
      return false; // Skip - recently notified
    }
    return true;
  });

  // Clean up old cache entries
  if (scannerSymbolCache.size > 1000) {
    const entries = Array.from(scannerSymbolCache.entries());
    for (const [key, timestamp] of entries) {
      if (now - timestamp > SCANNER_SYMBOL_COOLDOWN_MS) {
        scannerSymbolCache.delete(key);
      }
    }
  }

  if (filteredSymbols.length === 0) {
    return {
      canSend: false,
      reason: 'All symbols were recently notified',
      filteredSymbols: []
    };
  }

  return {
    canSend: true,
    reason: 'OK',
    filteredSymbols
  };
}

/**
 * Mark scanner notification as sent
 */
export function markScannerNotificationSent(scannerType: ScannerType, symbols: string[]): void {
  const now = Date.now();
  scannerLastNotification.set(scannerType, now);

  for (const symbol of symbols) {
    const cacheKey = `${scannerType}:${symbol}`;
    scannerSymbolCache.set(cacheKey, now);
  }

  logger.info(`[DISCORD] Marked ${scannerType} notification sent for ${symbols.length} symbols`);
}

/**
 * Get all scanner notification stats (for debugging)
 */
export function getAllScannerNotificationStats(): Record<string, any> {
  const stats: Record<string, any> = {};

  for (const scannerType of ['options_flow', 'social_sentiment', 'swing_trade', 'breakout'] as ScannerType[]) {
    const lastSent = scannerLastNotification.get(scannerType);
    stats[scannerType] = {
      lastSent: lastSent ? new Date(lastSent).toISOString() : null,
      cooldownRemaining: lastSent ? Math.max(0, SCANNER_GLOBAL_COOLDOWN_MS - (Date.now() - lastSent)) / 60000 : 0
    };
  }

  stats.symbolCacheSize = scannerSymbolCache.size;
  return stats;
}

// Global QUANTFLOOR cooldown to prevent burst spam  
let lastQuantFloorBatchTime = 0;
const QUANTFLOOR_BATCH_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 HOURS between batch summaries

// Daily symbol cache for quant ideas - never send same symbol twice in a day
const dailyQuantSymbols = new Set<string>();
let lastQuantDailyReset = 0;

export async function sendBatchSummaryToDiscord(ideas: any[], type?: string): Promise<void> {
  // In strict mode, batch summaries are disabled - only premium trades go through
  // Batch summaries go to QUANTFLOOR (main channel)
  if (DISCORD_DISABLED || STRICT_PREMIUM_ONLY || !ideas || ideas.length === 0) return;
  const webhookUrl = process.env.DISCORD_WEBHOOK_QUANTFLOOR;
  if (!webhookUrl) return;
  try {
    const now = Date.now();
    
    // Reset daily cache at 4 AM CT each day
    const todayReset = new Date().setHours(4, 0, 0, 0);
    if (todayReset > lastQuantDailyReset) {
      dailyQuantSymbols.clear();
      lastQuantDailyReset = todayReset;
      logger.debug(`[DISCORD] Daily quant symbol cache reset`);
    }
    
    // Global cooldown - prevent batch spam (2 hours)
    if (now - lastQuantFloorBatchTime < QUANTFLOOR_BATCH_COOLDOWN_MS) {
      logger.debug(`[DISCORD] Batch summary skipped - global cooldown (${Math.round((QUANTFLOOR_BATCH_COOLDOWN_MS - (now - lastQuantFloorBatchTime)) / 60000)}min remaining)`);
      return;
    }
    
    // Clean up old entries
    Array.from(recentQuantIdeas.entries()).forEach(([key, timestamp]) => {
      if (now - timestamp > QUANT_IDEA_COOLDOWN_MS) {
        recentQuantIdeas.delete(key);
      }
    });
    
    // Filter for quality: B grade or higher (70%+ confidence)
    const qualityIdeas = ideas.filter((i: any) => {
      const grade = i.grade || '';
      const confidence = i.confidence || 0;
      // B grade and above with 70%+ confidence
      return VALID_DISCORD_GRADES.includes(grade) && confidence >= 70;
    });
    
    // Don't send if no quality ideas
    if (qualityIdeas.length === 0) {
      logger.debug(`[DISCORD] ${type || 'BATCH'} summary skipped - no A/A+ grade ideas`);
      return;
    }
    
    // Filter out ideas that were sent recently OR whose symbol was already sent today
    const newIdeas = qualityIdeas.filter((i: any) => {
      // Skip if this symbol was already alerted today
      if (dailyQuantSymbols.has(i.symbol)) {
        return false;
      }
      
      const rawExpiry = i.expiryDate || i.expirationDate || '';
      const expiry = String(rawExpiry).split('T')[0];
      const key = `${i.symbol}:${i.strikePrice || ''}:${i.optionType || ''}:${expiry}`;
      
      if (recentQuantIdeas.has(key)) {
        return false; // Skip - already sent this idea recently
      }
      
      // Mark as sent
      recentQuantIdeas.set(key, now);
      dailyQuantSymbols.add(i.symbol); // Never send same symbol again today
      return true;
    });
    
    // Don't send if all ideas were duplicates
    if (newIdeas.length === 0) {
      logger.debug(`[DISCORD] ${type || 'BATCH'} summary skipped - all ideas were duplicates or already sent today`);
      return;
    }
    
    // Update global cooldown
    lastQuantFloorBatchTime = now;
    logger.info(`[DISCORD] Batch: Sending ${newIdeas.length} new ideas (daily cache: ${dailyQuantSymbols.size} symbols)`);
    
    // Limit to top 3 ideas to reduce spam
    const summary = newIdeas.slice(0, 3).map((i: any) => {
      const emoji = i.direction === 'long' ? '🟢' : '🔴';
      const optionType = i.optionType ? i.optionType.toUpperCase() : '';
      const strike = i.strikePrice ? `$${i.strikePrice}` : '';
      // Support both expiryDate and expirationDate field names
      const rawExpiry = i.expiryDate || i.expirationDate;
      const expiry = rawExpiry ? `exp ${String(rawExpiry).split('T')[0]}` : '';
      // Format price properly - avoid "$N/A"
      const priceStr = i.entryPrice != null ? `$${Number(i.entryPrice).toFixed(2)}` : 'N/A';
      
      // Format: 🟢 INTC CALL $25 @ $0.48 (exp 2026-01-09)
      if (i.assetType === 'option' && optionType && strike) {
        return `${emoji} **${i.symbol}** ${optionType} ${strike} @ ${priceStr} ${expiry ? `(${expiry})` : ''}`;
      }
      // Fallback for non-options
      return `${emoji} **${i.symbol}** ${priceStr}`;
    }).join('\n');
    
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: `📊 **${type || 'BATCH'}**: ${newIdeas.length} ideas\n${summary}` 
      }),
    });
  } catch (e) {}
}
// Flow alert cooldown to prevent spam (45 min per symbol - increased from 15 min)
const flowAlertCooldown = new Map<string, number>();
const FLOW_ALERT_COOLDOWN_MS = 45 * 60 * 1000;

// Global flow alert cooldown (1 alert per 10 min max)
let lastFlowAlertTime = 0;
const FLOW_GLOBAL_COOLDOWN_MS = 10 * 60 * 1000;

export async function sendFlowAlertToDiscord(flow: any): Promise<void> {
  // In strict mode, flow alerts are disabled - only premium trades go through
  // Flow alerts go to QUANTFLOOR (main channel)
  if (DISCORD_DISABLED || STRICT_PREMIUM_ONLY) return;
  const webhookUrl = process.env.DISCORD_WEBHOOK_QUANTFLOOR;
  if (!webhookUrl) return;
  
  // Skip alerts with missing data (N/A spam prevention)
  if (!flow.symbol) return;
  
  const now = Date.now();
  
  // Global cooldown - max 1 flow alert per 10 min
  if (now - lastFlowAlertTime < FLOW_GLOBAL_COOLDOWN_MS) {
    logger.debug(`[DISCORD] Flow alert for ${flow.symbol} skipped - global cooldown`);
    return;
  }
  
  // Skip if this symbol was alerted recently (spam prevention)
  const lastAlert = flowAlertCooldown.get(flow.symbol);
  if (lastAlert && now - lastAlert < FLOW_ALERT_COOLDOWN_MS) return;
  
  // Only alert for B grade or higher (VALID_DISCORD_GRADES includes B/B+)
  if (flow.grade && !VALID_DISCORD_GRADES.includes(flow.grade)) return;

  // Require minimum confidence of 70%
  if (flow.confidence && flow.confidence < MIN_CONFIDENCE_REQUIRED) return;
  
  try {
    // Build description based on available data
    const optionType = flow.optionType?.toUpperCase() || '';
    const strike = flow.strikePrice ? `$${flow.strikePrice}` : '';
    const expiry = flow.expiryDate ? `exp ${flow.expiryDate.split('T')[0]}` : '';
    const entry = flow.entryPrice ? `@ $${Number(flow.entryPrice).toFixed(2)}` : '';
    const target = flow.targetPrice ? `Target: $${Number(flow.targetPrice).toFixed(2)}` : '';
    const rr = flow.riskReward ? `R:R ${flow.riskReward}:1` : '';
    const gradeStr = flow.grade ? `[${flow.grade}]` : '';
    
    const description = `${optionType} ${strike} ${entry} ${expiry}\n${target} ${rr}`.trim();
    
    // Skip if no meaningful content
    if (!description || description.length < 5) return;
    
    // Build confidence display
    const confidenceDisplay = flow.confidence 
      ? `${flow.grade || getLetterGrade(flow.confidence)} (${flow.confidence}%)`
      : flow.grade || 'N/A';
    
    const embed: DiscordEmbed = {
      title: `📊 Flow Alert: ${flow.symbol} ${gradeStr} ${flow.confidence ? `${flow.confidence}%` : ''}`,
      description,
      color: flow.optionType === 'call' ? COLORS.LONG : COLORS.SHORT,
      fields: [],
      timestamp: new Date().toISOString(),
      footer: { text: `Quant Edge Labs • Confidence: ${confidenceDisplay}` }
    };
    
    // Add confidence field first
    embed.fields!.push({ name: '🎯 Confidence', value: confidenceDisplay, inline: true });
    
    // Only add volume/premium if they have real values
    if (flow.volume && flow.volume > 0) {
      embed.fields!.push({ name: 'Volume', value: flow.volume.toLocaleString(), inline: true });
    }
    if (flow.premium && flow.premium > 0) {
      embed.fields!.push({ name: 'Premium', value: `$${(flow.premium / 1000).toFixed(0)}k`, inline: true });
    }
    
    // Mark as alerted and update global cooldown
    flowAlertCooldown.set(flow.symbol, now);
    lastFlowAlertTime = now;
    
    // Clean up old cooldowns
    Array.from(flowAlertCooldown.entries()).forEach(([sym, ts]) => {
      if (now - ts > FLOW_ALERT_COOLDOWN_MS) flowAlertCooldown.delete(sym);
    });
    
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (e) {}
}

// Track recently alerted symbols to prevent duplicates - store timestamp AND last % change
const recentAlertedSymbols = new Map<string, { timestamp: number; changePercent: number }>();
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 HOURS cooldown per symbol (was 60 min)
const GLOBAL_ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 HOURS between Market Movers alerts (was 30 min)
const MIN_CHANGE_DIFF_PCT = 25; // Only re-alert if % change differs by 25+ points (was 10)
const MIN_NEW_MOVERS = 3; // Need at least 3 NEW symbols to warrant alert (was 2)
let lastMarketMoversAlertTime = 0;

// Daily symbol cache - never alert same symbol twice in a trading day
const dailyAlertedSymbols = new Set<string>();
let lastDailyReset = 0;

export async function sendMarketMoversAlertToDiscord(movers: {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  alertType: 'surge' | 'drop' | 'volume_spike';
  grade?: string;
  confidence?: number;
}[]): Promise<void> {
  // In strict mode, market movers are disabled - only premium trades go through
  // Market movers go to QUANTFLOOR (main channel)
  if (DISCORD_DISABLED || STRICT_PREMIUM_ONLY || !movers || movers.length === 0) return;
  const webhookUrl = process.env.DISCORD_WEBHOOK_QUANTFLOOR;
  if (!webhookUrl) return;
  
  try {
    const now = Date.now();
    
    // Reset daily cache at 4 AM CT each day
    const todayReset = new Date().setHours(4, 0, 0, 0);
    if (todayReset > lastDailyReset) {
      dailyAlertedSymbols.clear();
      lastDailyReset = todayReset;
      logger.debug(`[DISCORD] Daily symbol cache reset`);
    }
    
    // Global cooldown - don't spam Market Movers alerts (2 hours)
    if (now - lastMarketMoversAlertTime < GLOBAL_ALERT_COOLDOWN_MS) {
      logger.debug(`[DISCORD] Market Movers alert skipped - global cooldown (${Math.round((GLOBAL_ALERT_COOLDOWN_MS - (now - lastMarketMoversAlertTime)) / 60000)}min remaining)`);
      return;
    }
    
    // Clean up old entries
    Array.from(recentAlertedSymbols.entries()).forEach(([symbol, data]) => {
      if (now - data.timestamp > ALERT_COOLDOWN_MS) {
        recentAlertedSymbols.delete(symbol);
      }
    });
    
    // Filter to only >10% moves AND are B grade or higher AND not alerted today
    const filteredMovers = movers.filter(m => {
      const absChange = Math.abs(m.changePercent);
      // Require at least 10% move (was 5%)
      if (absChange < 10) return false;

      // Send B grade and above to Discord
      if (!m.grade || !VALID_DISCORD_GRADES.includes(m.grade)) return false;
      
      // Skip if already alerted this symbol TODAY
      if (dailyAlertedSymbols.has(m.symbol)) return false;
      
      // Check if already alerted recently with similar % change
      const prevAlert = recentAlertedSymbols.get(m.symbol);
      if (prevAlert) {
        const changeDiff = Math.abs(m.changePercent - prevAlert.changePercent);
        if (changeDiff < MIN_CHANGE_DIFF_PCT) {
          return false; // Skip - not enough change since last alert
        }
      }
      
      return true;
    });
    
    // Need at least MIN_NEW_MOVERS to warrant an alert
    if (filteredMovers.length < MIN_NEW_MOVERS) {
      logger.debug(`[DISCORD] Market Movers skipped - only ${filteredMovers.length} new movers (need ${MIN_NEW_MOVERS}+)`);
      return;
    }
    
    // Mark these symbols as alerted with their current % change + add to daily cache
    filteredMovers.forEach(m => {
      recentAlertedSymbols.set(m.symbol, { timestamp: now, changePercent: m.changePercent });
      dailyAlertedSymbols.add(m.symbol); // Never alert same symbol again today
    });
    lastMarketMoversAlertTime = now;
    logger.info(`[DISCORD] Market Movers: Alerting ${filteredMovers.length} new movers (daily cache: ${dailyAlertedSymbols.size} symbols)`);
    
    const surges = filteredMovers.filter(m => m.alertType === 'surge');
    const drops = filteredMovers.filter(m => m.alertType === 'drop');
    
    if (surges.length === 0 && drops.length === 0) return;
    
    const fields: { name: string; value: string; inline?: boolean }[] = [];
    
    if (surges.length > 0) {
      const surgeList = surges.slice(0, 5).map(s => {
        const gradeStr = s.grade ? ` [${s.grade}]` : '';
        const confStr = s.confidence ? ` ${s.confidence}%` : '';
        return `**${s.symbol}**${gradeStr}${confStr} +${s.changePercent.toFixed(1)}% @ $${s.price.toFixed(2)}`;
      }).join('\n');
      fields.push({ name: 'Major Surges', value: surgeList, inline: false });
    }
    
    if (drops.length > 0) {
      const dropList = drops.slice(0, 3).map(s => {
        const gradeStr = s.grade ? ` [${s.grade}]` : '';
        const confStr = s.confidence ? ` ${s.confidence}%` : '';
        return `**${s.symbol}**${gradeStr}${confStr} ${s.changePercent.toFixed(1)}% @ $${s.price.toFixed(2)}`;
      }).join('\n');
      fields.push({ name: 'Major Drops', value: dropList, inline: false });
    }
    
    const embed: DiscordEmbed = {
      title: 'Market Movers Alert',
      description: `${filteredMovers.length} stocks with >5% moves detected`,
      color: surges.length > drops.length ? COLORS.LONG : COLORS.SHORT,
      fields,
      footer: { text: 'Quant Edge Labs Real-time Scanner' },
      timestamp: new Date().toISOString()
    };
    
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    
    logger.info(`[DISCORD] Sent market movers alert: ${surges.length} surges, ${drops.length} drops`);
  } catch (e) {
    logger.error(`[DISCORD] Failed to send market movers alert: ${e}`);
  }
}

// Pre-Move Signal Alert - Detects potential moves before news/market close
export async function sendPreMoveAlertToDiscord(signal: {
  symbol: string;
  signalType: string;
  confidence: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  details: string;
  timestamp: Date;
  metrics: {
    currentPrice?: number;
    volumeRatio?: number;
    ivChange?: number;
    optionPremium?: number;
    contractValue?: number;
  };
}): Promise<void> {
  if (DISCORD_DISABLED) return;

  // Pre-move signals go to QUANTFLOOR (main channel)
  const webhookUrl = process.env.DISCORD_WEBHOOK_QUANTFLOOR;
  if (!webhookUrl) return;
  
  // Only alert for B grade and above (70%+ confidence)
  if (signal.confidence < 70) return;
  
  try {
    const grade = getLetterGrade(signal.confidence);
    const gradeDisplay = `${grade} (${signal.confidence}%)`;
    
    // Signal type emoji mapping
    const typeEmojis: Record<string, string> = {
      'late_day_sweep': '🔥',
      'volume_spike': '📊',
      'iv_expansion': '⚡',
      'defense_contract': '🇺🇸',
      'unusual_accumulation': '🐋',
      'sector_momentum': '📈'
    };
    
    // Direction colors
    const directionColors: Record<string, number> = {
      'bullish': COLORS.LONG,
      'bearish': COLORS.SHORT,
      'neutral': COLORS.AI
    };
    
    const emoji = typeEmojis[signal.signalType] || '⚠️';
    const color = directionColors[signal.direction] || COLORS.QUANT;
    
    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: '🎯 Confidence', value: gradeDisplay, inline: true },
      { name: '📍 Direction', value: signal.direction.toUpperCase(), inline: true }
    ];
    
    if (signal.metrics.currentPrice) {
      fields.push({ name: '💵 Price', value: `$${signal.metrics.currentPrice.toFixed(2)}`, inline: true });
    }
    
    if (signal.metrics.volumeRatio) {
      fields.push({ name: '📊 Volume', value: `${signal.metrics.volumeRatio.toFixed(1)}x avg`, inline: true });
    }
    
    if (signal.metrics.ivChange) {
      fields.push({ name: '⚡ IV Change', value: `+${signal.metrics.ivChange.toFixed(1)}%`, inline: true });
    }
    
    if (signal.metrics.optionPremium) {
      fields.push({ name: '💰 Premium', value: `$${(signal.metrics.optionPremium / 1000000).toFixed(2)}M`, inline: true });
    }
    
    if (signal.metrics.contractValue) {
      fields.push({ name: '📋 Contract', value: `$${(signal.metrics.contractValue / 1000000).toFixed(1)}M`, inline: true });
    }
    
    const embed: DiscordEmbed = {
      title: `${emoji} PRE-MOVE ALERT: ${signal.symbol} [${grade}] ${signal.confidence}%`,
      description: signal.details,
      color,
      fields,
      footer: { text: `Quant Edge Labs Pre-Move Detection • ${gradeDisplay}` },
      timestamp: signal.timestamp.toISOString()
    };
    
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: `🚨 **PRE-MOVE SIGNAL**: ${signal.symbol} - ${signal.signalType.replace(/_/g, ' ').toUpperCase()}`,
        embeds: [embed] 
      }),
    });
    
    logger.info(`[DISCORD] Sent pre-move alert: ${signal.symbol} ${signal.signalType} (${signal.confidence}%)`);
  } catch (e) {
    logger.error(`[DISCORD] Failed to send pre-move alert: ${e}`);
  }
}

// PREMIUM OPTIONS ALERT - Premium template for B grade and above options trades
export async function sendPremiumOptionsAlertToDiscord(trade: {
  symbol: string;
  optionType: 'call' | 'put';
  strikePrice: number;
  expiryDate: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  confidence: number;
  grade: string;
  delta?: number;
  dte?: number;
  tradeType?: 'day' | 'swing' | 'lotto';
  signals?: string[];
  analysis?: string;
  source?: string;
  directionReason?: string;
}): Promise<void> {
  if (DISCORD_DISABLED) return;
  
  // RELEVANCE CHECK: Validate option play is still actionable (critical - prevents 0 DTE after cutoff)
  const relevanceCheck = isOptionPlayStillRelevant({
    symbol: trade.symbol,
    expiryDate: trade.expiryDate,
    strikePrice: trade.strikePrice,
    optionType: trade.optionType,
    entryPrice: trade.entryPrice,
    assetType: 'option',
  });
  
  if (!relevanceCheck.valid) {
    logger.info(`[DISCORD] ⛔ BLOCKED outdated premium alert: ${trade.symbol} ${trade.optionType} $${trade.strikePrice} - ${relevanceCheck.reason}`);
    return;
  }
  
  // Only send B grade and above with this premium format
  if (!VALID_DISCORD_GRADES.includes(trade.grade)) {
    logger.debug(`[DISCORD] Skipping premium format for ${trade.symbol} - grade ${trade.grade} below B`);
    return;
  }
  
  // DEDUPLICATION: Prevent same symbol/optionType/strike from being sent multiple times
  const direction = trade.optionType === 'call' ? 'long' : 'short';
  if (!shouldSendTradeIdea(trade.symbol, direction, 'option', trade.optionType, trade.strikePrice)) {
    logger.info(`[DISCORD] ⏭️ Skipped duplicate premium alert: ${trade.symbol} ${trade.optionType.toUpperCase()} $${trade.strikePrice} - sent within last 4 hours`);
    return;
  }
  
  // Premium options alerts go to OPTIONSTRADES channel, not QUANTFLOOR
  // Bot fills are a separate stream from hand-pushed option trades — mixing them
  // makes it impossible to tell what the bot did on its own.
  const webhookUrl = process.env.DISCORD_WEBHOOK_BOT_ENTRIES || process.env.DISCORD_WEBHOOK_OPTIONSTRADES || process.env.DISCORD_WEBHOOK_QUANTBOT || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  
  try {
    const isCall = trade.optionType === 'call';
    const directionEmoji = isCall ? '🟢' : '🔴';
    const directionLabel = isCall ? 'BULLISH' : 'BEARISH';
    const sourceLabel = trade.source?.toUpperCase() || 'QUANT';
    
    // Calculate R:R and multiplier
    const riskAmount = trade.entryPrice - trade.stopLoss;
    const rewardAmount = trade.targetPrice - trade.entryPrice;
    const rrRatio = riskAmount > 0 ? (rewardAmount / riskAmount).toFixed(1) : '0';
    const multiplier = trade.entryPrice > 0 ? (trade.targetPrice / trade.entryPrice).toFixed(1) : '1';
    const maxLossPercent = trade.entryPrice > 0 ? ((trade.stopLoss / trade.entryPrice - 1) * 100).toFixed(0) : '0';
    
    // Delta display
    let deltaDisplay = 'N/A';
    if (trade.delta !== undefined) {
      const absDelta = Math.abs(trade.delta);
      const deltaLabel = absDelta < 0.20 ? 'Far OTM' : 
                         absDelta < 0.35 ? 'OTM' : 
                         absDelta < 0.55 ? 'ATM' : 'ITM';
      deltaDisplay = `${absDelta.toFixed(2)} (${deltaLabel})`;
    }
    
    // DTE display
    const dteDisplay = trade.dte !== undefined ? `${trade.dte} days` : 'N/A';
    
    // Trade type label
    const tradeTypeLabel = trade.tradeType === 'lotto' ? 'lotto play' : 
                           trade.tradeType === 'swing' ? 'swing trade' : 'day trade';
    
    // Format signals
    const signalsDisplay = trade.signals?.slice(0, 4).join(', ') || 'Technical confluence';
    
    // 🎯 DIRECTION REASONING - Why CALL vs PUT
    // This explains the directional thesis based on trade type and signals
    let directionReason = trade.directionReason || '';
    if (!directionReason) {
      const signalsList = trade.signals || [];
      const signalsLower = signalsList.map(s => s.toLowerCase()).join(' ');
      
      if (trade.tradeType === 'day') {
        // Day trade: Need clear intraday momentum reason
        if (isCall) {
          if (signalsLower.includes('breakout') || signalsLower.includes('break')) {
            directionReason = 'Intraday breakout above resistance - momentum continuation expected';
          } else if (signalsLower.includes('oversold') || signalsLower.includes('rsi')) {
            directionReason = 'Oversold bounce setup - expecting quick reversal to mean';
          } else if (signalsLower.includes('volume') || signalsLower.includes('flow')) {
            directionReason = 'Heavy call flow + volume spike - institutional buying detected';
          } else if (signalsLower.includes('vwap') || signalsLower.includes('reclaim')) {
            directionReason = 'VWAP reclaim - bulls taking control intraday';
          } else {
            directionReason = 'Bullish intraday momentum + technical alignment';
          }
        } else {
          if (signalsLower.includes('breakdown') || signalsLower.includes('break')) {
            directionReason = 'Intraday breakdown below support - selling pressure accelerating';
          } else if (signalsLower.includes('overbought') || signalsLower.includes('rsi')) {
            directionReason = 'Overbought rejection - expecting pullback to mean';
          } else if (signalsLower.includes('volume') || signalsLower.includes('flow')) {
            directionReason = 'Heavy put flow + volume spike - institutional selling detected';
          } else if (signalsLower.includes('vwap') || signalsLower.includes('reject')) {
            directionReason = 'VWAP rejection - bears defending key level';
          } else {
            directionReason = 'Bearish intraday momentum + technical breakdown';
          }
        }
      } else {
        // Swing trade: Need sustained directional thesis
        if (isCall) {
          if (signalsLower.includes('trend') || signalsLower.includes('uptrend')) {
            directionReason = 'Strong uptrend continuation - higher highs/lows pattern intact';
          } else if (signalsLower.includes('support') || signalsLower.includes('bounce')) {
            directionReason = 'Key support hold + bullish divergence - reversal setup';
          } else if (signalsLower.includes('earnings') || signalsLower.includes('catalyst')) {
            directionReason = 'Positive catalyst + sector strength - swing higher expected';
          } else if (signalsLower.includes('accumulation') || signalsLower.includes('institutional')) {
            directionReason = 'Institutional accumulation pattern - multi-day upside expected';
          } else {
            directionReason = 'Multi-day bullish setup with technical + fundamental confluence';
          }
        } else {
          if (signalsLower.includes('trend') || signalsLower.includes('downtrend')) {
            directionReason = 'Downtrend continuation - lower highs/lows pattern intact';
          } else if (signalsLower.includes('resistance') || signalsLower.includes('rejection')) {
            directionReason = 'Key resistance rejection + bearish divergence - fade setup';
          } else if (signalsLower.includes('earnings') || signalsLower.includes('catalyst')) {
            directionReason = 'Negative catalyst + sector weakness - swing lower expected';
          } else if (signalsLower.includes('distribution') || signalsLower.includes('selling')) {
            directionReason = 'Institutional distribution pattern - multi-day downside expected';
          } else {
            directionReason = 'Multi-day bearish setup with technical + fundamental confluence';
          }
        }
      }
    }
    
    // Build premium embed format with direction reasoning
    const embed: DiscordEmbed = {
      title: `${directionEmoji} ${sourceLabel} ${directionLabel} ${trade.optionType.toUpperCase()}`,
      description: `**[${trade.grade}] ${trade.confidence}% Conviction**\n\n**TRADE:** ${trade.symbol} ${trade.optionType.toUpperCase()} $${trade.strikePrice} (${tradeTypeLabel})\n\n**WHY ${trade.optionType.toUpperCase()}:** ${directionReason}`,
      color: isCall ? COLORS.LONG : COLORS.SHORT,
      fields: [
        { name: '📊 GREEKS', value: `Delta: ${deltaDisplay}\nDTE: ${dteDisplay}`, inline: true },
        { name: '📈 TECHNICALS', value: signalsDisplay, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '💰 Entry', value: `$${trade.entryPrice.toFixed(2)}`, inline: true },
        { name: '🎯 Target', value: `$${trade.targetPrice.toFixed(2)} (${multiplier}x)`, inline: true },
        { name: '🛡️ Stop', value: `$${trade.stopLoss.toFixed(2)} (${maxLossPercent}% max loss)`, inline: true },
        { name: '⚖️ R:R', value: `${rrRatio}:1`, inline: true },
        { name: '📅 Expiry', value: trade.expiryDate.split('T')[0], inline: true },
      ],
      footer: { text: `Quant Edge Labs • ${trade.grade} ${trade.confidence}% • ${tradeTypeLabel.toUpperCase()}` },
      timestamp: new Date().toISOString()
    };
    
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: `🎯 **${trade.grade} OPTIONS ALERT**: ${trade.symbol} ${trade.optionType.toUpperCase()} $${trade.strikePrice}`,
        embeds: [embed] 
      }),
    });
    
    // Mark as sent to prevent duplicate alerts (4-hour cooldown)
    markTradeIdeaSent(trade.symbol, direction, 'option', trade.optionType, trade.strikePrice);
    logger.info(`[DISCORD] Sent premium options alert: ${trade.symbol} ${trade.optionType.toUpperCase()} $${trade.strikePrice} [${trade.grade}] - ${directionReason}`);
  } catch (e) {
    logger.error(`[DISCORD] Failed to send premium options alert: ${e}`);
  }
}

// ============ INDEX 0DTE SCALP CALLOUTS ============
// Live SPX/SPY/QQQ/IWM scalp signals from the GEX index-scalp engine.
// Routes to the SPX channel. Supports a dryRun mode so callout formatting
// can be verified without posting to the live Discord.

const SCALP_SETUP_LABEL: Record<string, string> = {
  flip_bounce: 'Flip Bounce',
  wall_fade: 'Wall Fade',
  wall_break: 'Wall Break',
  power_hour: 'Power Hour',
};

export async function sendIndexScalpToDiscord(
  scalp: {
    symbol: string;
    bias: 'calls' | 'puts';
    setup: string;
    suggestedStrike: number;
    expiryDate: string;
    spotPrice: number;
    target: number;
    stop: number;
    riskRewardRatio: number;
    confidence: number;
    thesis: string;
    premiumRange: string;
    regime: string;
    isPowerHour: boolean;
  },
  options?: { dryRun?: boolean },
): Promise<{ sent: boolean; payload?: any; reason?: string }> {
  if (DISCORD_DISABLED) return { sent: false, reason: 'discord_disabled' };

  const isCall = scalp.bias === 'calls';
  const dirEmoji = isCall ? '🟢' : '🔴';
  const setupLabel = SCALP_SETUP_LABEL[scalp.setup] || scalp.setup;
  const dec = scalp.symbol === 'SPX' ? 0 : 2;
  const ph = scalp.isPowerHour ? '⚡ ' : '';

  const embed: DiscordEmbed = {
    title: `${ph}${dirEmoji} 0DTE ${scalp.symbol} ${scalp.bias.toUpperCase()} — ${setupLabel}`,
    description: `**${scalp.symbol} $${scalp.suggestedStrike} ${isCall ? 'CALL' : 'PUT'}** · ${scalp.expiryDate}\n${scalp.thesis}`,
    color: isCall ? COLORS.LONG : COLORS.SHORT,
    fields: [
      { name: '💵 Est. Premium', value: scalp.premiumRange, inline: true },
      { name: '⚖️ R:R', value: `${scalp.riskRewardRatio}:1`, inline: true },
      { name: '🎚️ Confidence', value: `${scalp.confidence}%`, inline: true },
      { name: '📍 Spot', value: `$${scalp.spotPrice.toFixed(dec)}`, inline: true },
      { name: '🎯 Target', value: `$${scalp.target.toFixed(dec)}`, inline: true },
      { name: '🛡️ Stop', value: `$${scalp.stop.toFixed(dec)}`, inline: true },
      { name: '🧭 Regime', value: scalp.regime.replace('_', ' '), inline: true },
      { name: '⏱️ Setup', value: setupLabel, inline: true },
    ],
    footer: { text: `Quant Edge Labs • Index Scalp • 0DTE${scalp.isPowerHour ? ' • POWER HOUR' : ''}` },
    timestamp: new Date().toISOString(),
  };

  const payload = {
    content: `${ph}🎯 **0DTE SCALP**: ${scalp.symbol} ${scalp.bias.toUpperCase()} $${scalp.suggestedStrike} — ${setupLabel} (${scalp.riskRewardRatio}:1)`,
    embeds: [embed],
  };

  if (options?.dryRun) {
    logger.info(`[DISCORD] (dry-run) index scalp callout: ${scalp.symbol} ${scalp.bias.toUpperCase()} $${scalp.suggestedStrike}`);
    return { sent: false, payload, reason: 'dry_run' };
  }

  const webhookUrl =
    process.env.DISCORD_WEBHOOK_SPX ||
    process.env.DISCORD_WEBHOOK_LOTTO ||
    process.env.DISCORD_WEBHOOK_OPTIONSTRADES ||
    process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn('[DISCORD] No webhook configured for index scalp callouts (set DISCORD_WEBHOOK_SPX)');
    return { sent: false, payload, reason: 'no_webhook' };
  }

  try {
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    logger.info(`[DISCORD] ✅ Sent index scalp callout: ${scalp.symbol} ${scalp.bias.toUpperCase()} $${scalp.suggestedStrike} [${setupLabel}]`);
    return { sent: true, payload };
  } catch (e) {
    logger.error(`[DISCORD] Failed to send index scalp callout: ${e}`);
    return { sent: false, payload, reason: 'post_failed' };
  }
}

// ============ WHALE FLOW ALERTS ============
// Institutional-level options flow detection ($10k+ per contract)

export async function sendWhaleFlowAlertToDiscord(whale: {
  symbol: string;
  optionType: 'call' | 'put';
  strikePrice: number;
  expiryDate: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  grade: string;
  premiumPerContract: number;
  isMegaWhale: boolean;
  direction: 'long' | 'short';
  confidenceScore: number;
}): Promise<void> {
  if (DISCORD_DISABLED) {
    logger.debug('[DISCORD] Whale flow alert skipped - Discord disabled');
    return;
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_LOTTO || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn('[DISCORD] No webhook URL for whale flow alerts');
    return;
  }

  try {
    const whaleEmoji = whale.isMegaWhale ? '🐋🐋' : '🐋';
    const whaleLabel = whale.isMegaWhale ? 'MEGA WHALE' : 'WHALE FLOW';
    const premiumFormatted = whale.premiumPerContract >= 1000
      ? `$${(whale.premiumPerContract / 1000).toFixed(1)}k`
      : `$${whale.premiumPerContract.toFixed(0)}`;

    // Calculate potential profit
    const profitPotential = ((whale.targetPrice - whale.entryPrice) / whale.entryPrice * 100).toFixed(0);
    const riskAmount = ((whale.entryPrice - whale.stopLoss) / whale.entryPrice * 100).toFixed(0);
    const rr = (parseFloat(profitPotential) / parseFloat(riskAmount)).toFixed(1);

    const embed: DiscordEmbed = {
      title: `${whaleEmoji} ${whaleLabel} DETECTED`,
      description: `**${whale.symbol} ${whale.optionType.toUpperCase()} $${whale.strikePrice}**\n\nInstitutional-level options activity detected. Premium per contract: **${premiumFormatted}**`,
      color: whale.optionType === 'call' ? COLORS.LONG : COLORS.SHORT,
      fields: [
        {
          name: '💎 Grade & Confidence',
          value: `**${whale.grade}** (${whale.confidenceScore}% confidence)`,
          inline: true
        },
        {
          name: '💰 Premium/Contract',
          value: premiumFormatted,
          inline: true
        },
        {
          name: '📅 Expiry',
          value: whale.expiryDate.split('T')[0],
          inline: true
        },
        {
          name: '🎯 Entry → Target',
          value: `$${whale.entryPrice.toFixed(2)} → $${whale.targetPrice.toFixed(2)} (+${profitPotential}%)`,
          inline: false
        },
        {
          name: '🛡️ Stop Loss',
          value: `$${whale.stopLoss.toFixed(2)} (-${riskAmount}%)`,
          inline: true
        },
        {
          name: '⚖️ Risk/Reward',
          value: `1:${rr}`,
          inline: true
        },
      ],
      footer: {
        text: `${whaleLabel} • Follow the smart money • QuantEdge Lotto Scanner`
      },
      timestamp: new Date().toISOString()
    };

    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `${whaleEmoji} **${whaleLabel}**: ${whale.symbol} ${whale.optionType.toUpperCase()} $${whale.strikePrice} - ${premiumFormatted} per contract!`,
        embeds: [embed]
      }),
    });

    logger.info(`[DISCORD] Sent whale flow alert: ${whale.symbol} ${whale.optionType.toUpperCase()} $${whale.strikePrice} - ${premiumFormatted}`);
  } catch (e) {
    logger.error(`[DISCORD] Failed to send whale flow alert: ${e}`);
  }
}

// ============ FLOW-GEX CONVERGENCE ALERTS ============
// High-conviction signals when institutional flow aligns with gamma exposure regime

const convergenceCooldown = new Map<string, number>();

export async function sendConvergenceAlertToDiscord(signal: {
  symbol: string;
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  gexBias: string;
  gexRegime: string;
  flowBias: string;
  flowCount: number;
  totalPremium: number;
  callCount: number;
  putCount: number;
  gexAnchor: number;
  gexFlipPoint: number | null;
  spotPrice: number;
  gexRating: number;
  reasoning: string;
  strategy: string;
}): Promise<void> {
  if (DISCORD_DISABLED) return;

  // Only alert HIGH conviction
  if (signal.conviction !== 'HIGH') return;

  // Rate limit: 30 min per symbol
  const lastSent = convergenceCooldown.get(signal.symbol) || 0;
  if (Date.now() - lastSent < 30 * 60 * 1000) return;

  const webhookUrl = process.env.DISCORD_WEBHOOK_OPTIONSTRADES || process.env.DISCORD_WEBHOOK_QUANTFLOOR || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const isBullish = signal.flowBias === 'BULLISH';
    const emoji = isBullish ? '🟢' : '🔴';
    const premiumStr = signal.totalPremium >= 1_000_000
      ? `$${(signal.totalPremium / 1_000_000).toFixed(1)}M`
      : `$${(signal.totalPremium / 1000).toFixed(0)}K`;

    const embed: DiscordEmbed = {
      title: `🎯 CONVERGENCE SIGNAL: ${signal.symbol}`,
      description: `**${signal.conviction} Conviction** — GEX + Flow alignment detected\n\n${signal.reasoning}`,
      color: isBullish ? COLORS.LONG : COLORS.SHORT,
      fields: [
        { name: '⚡ GEX Regime', value: `${signal.gexBias} (${signal.gexRating}/5)`, inline: true },
        { name: `${emoji} Flow Bias`, value: `${signal.flowBias} (${signal.flowCount} trades)`, inline: true },
        { name: '💰 Flow Premium', value: premiumStr, inline: true },
        { name: '🎯 Anchor', value: `$${signal.gexAnchor}`, inline: true },
        { name: '🔄 Flip Point', value: signal.gexFlipPoint ? `$${signal.gexFlipPoint}` : 'N/A', inline: true },
        { name: '💵 Spot', value: `$${signal.spotPrice.toFixed(2)}`, inline: true },
        { name: '📋 Strategy', value: signal.strategy, inline: false },
      ],
      footer: { text: 'Flow Edge • GEX Convergence • QuantEdge Labs' },
      timestamp: new Date().toISOString(),
    };

    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🎯 **CONVERGENCE**: ${signal.symbol} — ${signal.conviction} conviction | ${signal.gexBias} + ${signal.flowBias} flow | ${premiumStr} premium`,
        embeds: [embed],
      }),
    });

    convergenceCooldown.set(signal.symbol, Date.now());
    logger.info(`[DISCORD] Sent convergence alert: ${signal.symbol} ${signal.conviction} ${signal.flowBias}`);
  } catch (e) {
    logger.error(`[DISCORD] Failed to send convergence alert: ${e}`);
  }
}

// ============ DAILY PREVIEW SYSTEM ============
// Sends a single consolidated morning preview instead of individual alerts throughout the day

let dailyPreviewSent = false;
let lastPreviewDate = '';

export async function sendDailyPreview(): Promise<{ success: boolean; message: string }> {
  if (DISCORD_DISABLED) return { success: false, message: 'Discord disabled' };
  
  const webhookUrl = process.env.DISCORD_WEBHOOK_QUANTFLOOR || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return { success: false, message: 'No webhook URL configured' };
  
  try {
    // Import data sources dynamically to avoid circular deps
    const { getBullishTrends, getBreakoutStocks } = await import('./bullish-trend-scanner');
    
    const allTrends = await getBullishTrends();
    const breakouts = await getBreakoutStocks();
    
    // Get top momentum stocks (80+ score)
    const explosiveTrends = allTrends.filter(t => t.momentumScore && t.momentumScore >= 80).slice(0, 5);
    const strongTrends = allTrends.filter(t => t.momentumScore && t.momentumScore >= 65 && t.momentumScore < 80).slice(0, 5);
    
    // Format date
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      timeZone: 'America/Chicago'
    });
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      timeZone: 'America/Chicago'
    });
    
    // Build explosive movers section
    let explosiveSection = '';
    if (explosiveTrends.length > 0) {
      explosiveSection = explosiveTrends.map(t => {
        const change = t.dayChangePercent ? (t.dayChangePercent > 0 ? '+' : '') + t.dayChangePercent.toFixed(1) + '%' : 'N/A';
        const phase = t.trendPhase ? t.trendPhase.toUpperCase() : 'UNKNOWN';
        const volRatio = t.volumeRatio ? t.volumeRatio.toFixed(1) + 'x vol' : '';
        return `• **${t.symbol}** ${change} | ${phase} | Mom: ${t.momentumScore}/100 ${volRatio}`;
      }).join('\n');
    } else {
      explosiveSection = '• No explosive movers detected';
    }
    
    // Build strong momentum section
    let strongSection = '';
    if (strongTrends.length > 0) {
      strongSection = strongTrends.map(t => {
        const change = t.dayChangePercent ? (t.dayChangePercent > 0 ? '+' : '') + t.dayChangePercent.toFixed(1) + '%' : 'N/A';
        return `• **${t.symbol}** ${change} | Mom: ${t.momentumScore}/100`;
      }).join('\n');
    } else {
      strongSection = '• No strong momentum stocks';
    }
    
    // Build breakout section
    let breakoutSection = '';
    if (breakouts.length > 0) {
      breakoutSection = breakouts.slice(0, 3).map(b => {
        const change = b.dayChangePercent ? (b.dayChangePercent > 0 ? '+' : '') + b.dayChangePercent.toFixed(1) + '%' : 'N/A';
        return `• **${b.symbol}** ${change} | RSI: ${b.rsi14?.toFixed(0) || 'N/A'}`;
      }).join('\n');
    } else {
      breakoutSection = '• No active breakouts';
    }
    
    // Create the embed
    const embed: DiscordEmbed = {
      title: `📊 DAILY PREVIEW - ${dateStr}`,
      description: `**Quant Edge Labs Morning Briefing**\nGenerated at ${timeStr} CT`,
      color: 0x3b82f6, // Blue
      fields: [
        { 
          name: '🚀 EXPLOSIVE MOVERS (80+ Momentum)', 
          value: explosiveSection,
          inline: false 
        },
        { 
          name: '📈 STRONG MOMENTUM (65-79)', 
          value: strongSection,
          inline: false 
        },
        { 
          name: '💥 ACTIVE BREAKOUTS', 
          value: breakoutSection,
          inline: false 
        },
        {
          name: '📋 TODAY\'S FOCUS',
          value: `• Stocks analyzed: ${allTrends.length}\n• Active breakouts: ${breakouts.length}\n• Check dashboard for full details`,
          inline: false
        }
      ],
      footer: { text: 'Quant Edge Labs • Quality over quantity • B grade and above alerts' },
      timestamp: new Date().toISOString()
    };
    
    await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: `☀️ **GOOD MORNING!** Here's your daily market preview:`,
        embeds: [embed] 
      }),
    });
    
    // Track that we sent today's preview
    dailyPreviewSent = true;
    lastPreviewDate = now.toISOString().split('T')[0];
    
    logger.info(`[DISCORD] Sent daily preview to Quant Floor - ${explosiveTrends.length} explosive, ${strongTrends.length} strong, ${breakouts.length} breakouts`);
    
    return { 
      success: true, 
      message: `Daily preview sent: ${explosiveTrends.length} explosive movers, ${strongTrends.length} strong momentum, ${breakouts.length} breakouts` 
    };
    
  } catch (error) {
    logger.error('[DISCORD] Failed to send daily preview', { error });
    return { success: false, message: `Error: ${error}` };
  }
}

// Check if daily preview should be sent (call this from a scheduler)
export function shouldSendDailyPreview(): boolean {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  // Evaluate the send window in CT. Production runs on UTC, so raw
  // getHours()/getDay() would fire this at the wrong time (or never).
  const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const hour = ct.getHours();
  const day = ct.getDay();

  // Only on weekdays, around market open (8-9 AM CT)
  if (day === 0 || day === 6) return false;
  if (hour < 8 || hour > 9) return false;
  
  // Don't send if already sent today
  if (lastPreviewDate === today) return false;
  
  return true;
}

// Reset daily preview flag (call at midnight or when needed)
export function resetDailyPreview(): void {
  dailyPreviewSent = false;
  lastPreviewDate = '';
}

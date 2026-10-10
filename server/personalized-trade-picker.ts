/**
 * Personalized Trade Picker
 *
 * Generates daily trade picks tailored to your:
 * 1. Account size ($700)
 * 2. Risk tolerance ($30-50 max per trade)
 * 3. Trading style (pullback scalps, index plays)
 * 4. Lessons from past losses (no far OTM, cut losses at -30%)
 *
 * Based on analysis of your Webull trading history from January 2026
 */

import { logger } from './logger';
import { storage } from './storage';
import { fetchStockPrice } from './market-api';
import { validateStrike, getConfig as getPortfolioConfig } from './personal-portfolio-tracker';

// ============================================
// TYPES
// ============================================

export interface PersonalizedPick {
  id: string;
  symbol: string;
  underlying: string;

  // Trade setup
  direction: 'LONG' | 'SHORT';
  assetType: 'option' | 'stock';
  optionType?: 'call' | 'put';
  suggestedStrike?: number;
  suggestedExpiry?: string;
  daysToExpiry?: number;

  // Price levels
  currentPrice: number;
  suggestedEntry: number;
  stopLoss: number;
  target1: number;  // +30-50%
  target2: number;  // +100%

  // Sizing for your account
  maxContracts: number;
  estimatedCost: number;
  maxRisk: number;
  riskRewardRatio: number;

  // Quality
  confidence: number;
  setupType: 'pullback_scalp' | 'vwap_bounce' | 'orb_breakout' | 'momentum' | 'swing';
  thesis: string;
  signals: string[];

  // Warnings based on your history
  warnings: string[];
  alignsWithRules: boolean;

  // Timing
  timestamp: Date;
  validUntil: Date;
}

export interface DailyPicksConfig {
  accountSize: number;
  maxRiskPerTrade: number;      // Dollar amount
  maxRiskPercent: number;       // % of account
  preferredTickers: string[];   // Your most profitable tickers
  avoidTickers: string[];       // Tickers that burned you
  minDTE: number;               // Minimum days to expiry
  maxOTMPercent: number;        // Max % out of the money
  maxPicksPerDay: number;
}

// ============================================
// YOUR PERSONALIZED CONFIG (based on Webull data analysis)
// ============================================

const DEFAULT_CONFIG: DailyPicksConfig = {
  accountSize: 700,
  maxRiskPerTrade: 50,
  maxRiskPercent: 7,
  preferredTickers: [
    // Your WINNERS from January
    'SPY', 'QQQ', 'IWM',     // Index scalps - you're good at these
    'NVDA', 'AMD',           // Semi plays - consistent profits
    'ARM',                   // Your biggest winner (+$700 on ARM alone)
    'NNE',                   // Nuclear plays worked well
  ],
  avoidTickers: [
    // Your LOSERS from January - avoid until account grows
    'RKLB',    // $99 strike was way OTM, -97% loss
    'ORCL',    // Far OTM, expired worthless
    'HOOD',    // Multiple losses from holding too long
    'BIDU',    // -72% loss from bag holding
    'MSTR',    // -86% loss
    'CVNA',    // Put expired worthless
    'SMR',     // -97% loss
  ],
  minDTE: 5,                  // No more 0-2 DTE for now
  maxOTMPercent: 5,           // Stay close to ATM for small account
  maxPicksPerDay: 3,          // Max 3 picks to prevent overtrading
};

let config: DailyPicksConfig = { ...DEFAULT_CONFIG };

// ============================================
// TRADE IDEA FILTERING
// ============================================

/**
 * Filter and personalize trade ideas for your account
 */
export async function generatePersonalizedPicks(): Promise<PersonalizedPick[]> {
  logger.info('[PERSONAL-PICKS] Generating personalized trade picks...');

  // Get all trade ideas from today
  const allIdeas = await storage.getAllTradeIdeas();
  const today = new Date().toISOString().split('T')[0];

  // Pre-filter: only today's open ideas with preferred tickers first
  const todayIdeas = allIdeas.filter((idea: any) => {
    const ideaDate = new Date(idea.timestamp).toISOString().split('T')[0];
    return ideaDate === today && idea.outcomeStatus === 'open';
  });

  // Sort to prioritize preferred tickers and limit to 100 to prevent OOM
  const preferredFirst = todayIdeas.sort((a: any, b: any) => {
    const aPreferred = config.preferredTickers.includes(a.symbol) ? 1 : 0;
    const bPreferred = config.preferredTickers.includes(b.symbol) ? 1 : 0;
    return bPreferred - aPreferred;
  }).slice(0, 100); // Limit to top 100 to prevent memory issues

  logger.info(`[PERSONAL-PICKS] Evaluating ${preferredFirst.length} of ${todayIdeas.length} ideas`);

  const personalizedPicks: PersonalizedPick[] = [];

  for (const idea of preferredFirst) {
    const pick = await evaluateIdeaForYou(idea);
    if (pick && pick.alignsWithRules) {
      personalizedPicks.push(pick);
      // Early exit if we have enough picks
      if (personalizedPicks.length >= config.maxPicksPerDay * 2) break;
    }
  }

  // Sort by confidence and alignment with your style
  personalizedPicks.sort((a, b) => {
    // Prioritize your preferred tickers
    const aPreferred = config.preferredTickers.includes(a.underlying) ? 1 : 0;
    const bPreferred = config.preferredTickers.includes(b.underlying) ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;

    // Then by confidence
    return b.confidence - a.confidence;
  });

  // Limit to max picks per day
  const topPicks = personalizedPicks.slice(0, config.maxPicksPerDay);

  logger.info(`[PERSONAL-PICKS] Generated ${topPicks.length} personalized picks`);
  return topPicks;
}

/**
 * Evaluate a single trade idea against your rules
 */
async function evaluateIdeaForYou(idea: any): Promise<PersonalizedPick | null> {
  const warnings: string[] = [];
  let alignsWithRules = true;

  const underlying = idea.symbol.replace(/\d+[CP]\d+$/, '').replace(/\d{6}[CP]\d{8}/, '');

  // RULE 1: Avoid your problem tickers
  if (config.avoidTickers.includes(underlying)) {
    warnings.push(`⚠️ ${underlying} is on your avoid list - burned you in January`);
    alignsWithRules = false;
  }

  // RULE 2: Check expiry (minimum 5 DTE)
  let daysToExpiry: number | undefined;
  if (idea.expiryDate) {
    const expiry = new Date(idea.expiryDate);
    const now = new Date();
    daysToExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysToExpiry < config.minDTE) {
      warnings.push(`⚠️ Only ${daysToExpiry} DTE - you need ${config.minDTE}+ days (learned this the hard way)`);
      alignsWithRules = false;
    }
  }

  // RULE 3: Check strike distance (max 5% OTM for small account)
  const currentPrice = idea.entryPrice || await fetchStockPrice(underlying).then(p => p?.currentPrice);
  if (idea.strikePrice && currentPrice) {
    const strikeValidation = validateStrike(
      underlying,
      idea.strikePrice,
      currentPrice,
      idea.optionType || 'call',
      config.accountSize
    );

    if (!strikeValidation.isValid) {
      warnings.push(strikeValidation.warning || 'Strike too far OTM');
      if (strikeValidation.recommendation) {
        warnings.push(`💡 ${strikeValidation.recommendation}`);
      }
      alignsWithRules = false;
    }
  }

  // RULE 4: Check estimated cost vs max risk
  const estimatedPremium = idea.entryPrice || 0.50; // Default estimate
  const estimatedCost = estimatedPremium * 100; // 1 contract

  if (estimatedCost > config.maxRiskPerTrade) {
    warnings.push(`⚠️ Contract costs $${estimatedCost.toFixed(0)} - above your $${config.maxRiskPerTrade} max risk`);
    // Don't disqualify, but warn
  }

  // RULE 5: Calculate proper stop loss and targets
  const stopLoss = idea.stopLoss || (estimatedPremium * 0.70); // -30% stop
  const target1 = idea.targetPrice || (estimatedPremium * 1.50);  // +50%
  const target2 = estimatedPremium * 2.0;  // +100%

  const risk = estimatedPremium - stopLoss;
  const reward = target1 - estimatedPremium;
  const riskRewardRatio = risk > 0 ? reward / risk : 0;

  if (riskRewardRatio < 1.5) {
    warnings.push(`⚠️ R:R is only ${riskRewardRatio.toFixed(1)}:1 - aim for 2:1+`);
  }

  // RULE 6: Max contracts based on account size
  const maxContracts = Math.floor(config.maxRiskPerTrade / estimatedCost) || 1;

  // RULE 7: Determine setup type
  let setupType: PersonalizedPick['setupType'] = 'momentum';
  if (idea.dataSourceUsed?.includes('SPX_') || idea.source === 'spx_session') {
    setupType = idea.dataSourceUsed?.includes('VWAP') ? 'vwap_bounce' : 'pullback_scalp';
  } else if (idea.source === 'orb_scanner') {
    setupType = 'orb_breakout';
  }

  // Build thesis with your rules in mind
  let thesis = idea.analysis || `${underlying} ${idea.direction} setup`;
  if (config.preferredTickers.includes(underlying)) {
    thesis = `✅ ${underlying} is one of your winning tickers! ` + thesis;
  }

  // Add your personal rules reminder
  const signals = idea.qualitySignals || [];
  signals.push('📋 YOUR RULES: Stop at -30%, Take profit at +50%');
  if (maxContracts === 1) {
    signals.push('📋 1 CONTRACT ONLY for this account size');
  }

  return {
    id: `pick_${idea.id}`,
    symbol: idea.symbol,
    underlying,
    direction: idea.direction?.toUpperCase() || 'LONG',
    assetType: idea.assetType || 'option',
    optionType: idea.optionType,
    suggestedStrike: idea.strikePrice,
    suggestedExpiry: idea.expiryDate,
    daysToExpiry,
    currentPrice: currentPrice || 0,
    suggestedEntry: estimatedPremium,
    stopLoss: Math.round(stopLoss * 100) / 100,
    target1: Math.round(target1 * 100) / 100,
    target2: Math.round(target2 * 100) / 100,
    maxContracts,
    estimatedCost: Math.round(estimatedCost),
    maxRisk: Math.round(estimatedCost * 0.30), // -30% stop
    riskRewardRatio: Math.round(riskRewardRatio * 10) / 10,
    confidence: idea.confidenceScore || 50,
    setupType,
    thesis,
    signals,
    warnings,
    alignsWithRules,
    timestamp: new Date(),
    validUntil: new Date(Date.now() + 4 * 60 * 60 * 1000), // Valid for 4 hours
  };
}

// ============================================
// QUICK PICKS (Index Scalps for SPY/QQQ/IWM)
// ============================================

/**
 * Generate quick scalp opportunities on indexes
 * These are your bread & butter from January
 */
export async function generateIndexScalpPicks(): Promise<PersonalizedPick[]> {
  const picks: PersonalizedPick[] = [];
  const indexes = ['SPY', 'QQQ', 'IWM'];

  for (const symbol of indexes) {
    try {
      const priceData = await fetchStockPrice(symbol);
      if (!priceData) continue;

      // Use currentPrice from market data API
      const currentPrice = priceData.currentPrice;
      if (!currentPrice || isNaN(currentPrice)) {
        logger.warn(`[PERSONAL-PICKS] No price data for ${symbol}, skipping`);
        continue;
      }

      // ATM call - closest strike
      const atmStrike = Math.round(currentPrice);

      // Get expiry (aim for 5-7 DTE)
      const now = new Date();
      const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const expiryStr = expiry.toISOString().split('T')[0];

      // Estimate premium (rough)
      const estimatedPremium = currentPrice * 0.005; // ~0.5% of underlying
      const estimatedCost = Math.round(estimatedPremium * 100);
      const isTooExpensive = estimatedCost > config.maxRiskPerTrade;

      const pick: PersonalizedPick = {
        id: `index_${symbol}_${Date.now()}`,
        symbol: `${symbol} ATM CALL`,
        underlying: symbol,
        direction: 'LONG',
        assetType: 'option',
        optionType: 'call',
        suggestedStrike: atmStrike,
        suggestedExpiry: expiryStr,
        daysToExpiry: 7,
        currentPrice,
        suggestedEntry: Math.round(estimatedPremium * 100) / 100,
        stopLoss: Math.round(estimatedPremium * 0.70 * 100) / 100,
        target1: Math.round(estimatedPremium * 1.50 * 100) / 100,
        target2: Math.round(estimatedPremium * 2.0 * 100) / 100,
        maxContracts: 1,
        estimatedCost,
        maxRisk: Math.round(estimatedCost * 0.30),
        riskRewardRatio: 2.0,
        confidence: isTooExpensive ? 40 : 65,
        setupType: 'pullback_scalp',
        thesis: `${symbol} ATM scalp - wait for pullback to VWAP or 9 EMA. Your SPY/QQQ scalps were profitable in January.`,
        signals: [
          '📋 Wait for pullback, don\'t chase green candles',
          '📋 Stop at -30% ($' + Math.round(estimatedCost * 0.30) + ')',
          '📋 Take profit at +50%',
          '📋 1 contract max',
        ],
        warnings: isTooExpensive
          ? [`⚠️ Cost $${estimatedCost} exceeds $${config.maxRiskPerTrade} max risk - need more capital or trade 0DTE`]
          : [],
        alignsWithRules: !isTooExpensive,
        timestamp: new Date(),
        validUntil: new Date(Date.now() + 2 * 60 * 60 * 1000),
      };

      picks.push(pick);
      logger.info(`[PERSONAL-PICKS] Generated ${symbol} index pick: $${currentPrice} strike $${atmStrike} cost $${estimatedCost}`);
    } catch (error) {
      logger.error(`[PERSONAL-PICKS] Error generating ${symbol} pick:`, error);
    }
  }

  return picks;
}

// ============================================
// API
// ============================================

export function getPicksConfig(): DailyPicksConfig {
  return { ...config };
}

export function updatePicksConfig(newConfig: Partial<DailyPicksConfig>): void {
  config = { ...config, ...newConfig };
  logger.info('[PERSONAL-PICKS] Config updated');
}

export function resetToDefaults(): void {
  config = { ...DEFAULT_CONFIG };
  logger.info('[PERSONAL-PICKS] Config reset to defaults');
}

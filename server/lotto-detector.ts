// Shared Lotto Play Detection Utility
// Used by all generators (AI, Quant, Hybrid, News, Flow) to identify high-risk lotto plays

import { logger } from './logger';

// Lotto Mode thresholds - High-risk far-OTM options with 20x potential
const LOTTO_ENTRY_MIN = 0.20; // $20 minimum (options priced at $0.20+)
const LOTTO_ENTRY_MAX = 8.00; // $800 maximum (expanded for LEAPS lottos - cheap far OTM LEAPS)
const LOTTO_DELTA_MAX = 0.15; // Slightly expanded for LEAPS (delta <0.15 = still far OTM)
const LOTTO_MAX_DTE = 540; // Allow LEAPS up to 18 months out

interface LottoOption {
  lastPrice: number;           // Entry premium price
  greeks?: { delta?: number }; // Option greeks (delta for OTM detection)
  expiration: string;          // Expiry date (ISO format)
  symbol?: string;             // Option symbol (for logging)
}

/**
 * Check if an option qualifies as a Lotto Play (high-risk far-OTM with 20x potential)
 * 
 * Criteria:
 * 1. Entry price: $0.20 - $2.00 (cheap weeklies for small accounts)
 * 2. Delta: ≤0.30 (far out-of-the-money = high risk, high reward)
 * 3. DTE: 0-7 days (weekly expiration only - no monthlies)
 * 
 * @param option - Option data with lastPrice, greeks, and expiration
 * @returns true if option meets Lotto criteria, false otherwise
 */
export function isLottoCandidate(option: LottoOption): boolean {
  const entryPrice = option.lastPrice;
  const delta = option.greeks?.delta || 0;
  
  // Calculate days to expiration
  const today = new Date();
  const expiryDate = new Date(option.expiration);
  const daysToExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  // Lotto criteria validation
  const meetsLottoCriteria = (
    entryPrice >= LOTTO_ENTRY_MIN &&
    entryPrice <= LOTTO_ENTRY_MAX &&
    Math.abs(delta) <= LOTTO_DELTA_MAX &&
    daysToExpiry >= 0 &&
    daysToExpiry <= LOTTO_MAX_DTE
  );
  
  if (meetsLottoCriteria && option.symbol) {
    logger.info(`[LOTTO] ✅ DETECTED: ${option.symbol} - Entry=$${entryPrice.toFixed(2)}, Delta=${Math.abs(delta).toFixed(2)}, DTE=${daysToExpiry} days`);
  }
  
  return meetsLottoCriteria;
}

/**
 * Calculate Lotto-specific targets with DTE-aware multipliers
 * 
 * For LOTTO plays, you're always BUYING options (calls or puts).
 * - BUY CALL: You want call value to increase (when stock goes up)
 * - BUY PUT: You want put value to increase (when stock goes down)
 * 
 * Target multipliers based on DTE (Days To Expiration):
 * - 0 DTE: 3x-5x (intraday gamma play, realistic for hours left)
 * - 1-2 DTE: 5x-10x (overnight/weekend plays)
 * - 3-7 DTE: 10x-20x (full weekly lotto potential)
 * 
 * @param entryPrice - Option premium entry price
 * @param expiryDate - Optional expiry date to calculate DTE-aware targets
 * @returns Updated target price and R:R ratio for Lotto plays
 */
export function calculateLottoTargets(entryPrice: number, expiryDate?: string): {
  targetPrice: number;
  riskRewardRatio: number;
  targetMultiplier: number;
  dteCategory: '0DTE' | '1-2DTE' | '3-7DTE' | 'swing' | 'monthly' | 'quarterly' | 'leaps';
} {
  // Calculate DTE if expiry date provided
  let dte = 7; // Default to full weekly if unknown
  if (expiryDate) {
    const today = new Date();
    const expiry = new Date(expiryDate);
    dte = Math.max(0, Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
  }
  
  // DTE-aware target multipliers - realistic for time remaining
  let targetMultiplier: number;
  let dteCategory: '0DTE' | '1-2DTE' | '3-7DTE' | 'swing' | 'monthly' | 'quarterly' | 'leaps';
  
  if (dte === 0) {
    // 0DTE: Intraday gamma play - only hours left
    // Realistic 3x-5x target (average 4x)
    targetMultiplier = 4;
    dteCategory = '0DTE';
  } else if (dte <= 2) {
    // 1-2 DTE: Overnight/weekend plays
    // Medium 5x-10x target (average 7x)
    targetMultiplier = 7;
    dteCategory = '1-2DTE';
  } else if (dte <= 7) {
    // 3-7 DTE: Full weekly lotto potential
    // High 10x-20x target (average 15x)
    targetMultiplier = 15;
    dteCategory = '3-7DTE';
  } else if (dte <= 14) {
    // 8-14 DTE: Short swing trade
    // More conservative 2.5x-3x target
    targetMultiplier = 2.5;
    dteCategory = 'swing';
  } else if (dte <= 30) {
    // 15-30 DTE: Monthly swing
    // Lower target but more time - 2x
    targetMultiplier = 2;
    dteCategory = 'monthly';
  } else if (dte <= 90) {
    // 31-90 DTE: Quarterly position
    // Conservative but time allows for larger moves - 3x
    targetMultiplier = 3;
    dteCategory = 'quarterly';
  } else if (dte <= 180) {
    // 91-180 DTE: Short LEAPS
    // Cheap LEAPS lotto - time for multi-bagger - 5x
    targetMultiplier = 5;
    dteCategory = 'leaps';
  } else if (dte <= 365) {
    // 181-365 DTE: Standard LEAPS
    // Real LEAPS lotto - 10x potential on cheap far OTM
    targetMultiplier = 10;
    dteCategory = 'leaps';
  } else {
    // 366+ DTE: Long LEAPS (18+ months)
    // Max time, cheap entry, 15x-20x multi-bagger potential
    targetMultiplier = 15;
    dteCategory = 'leaps';
  }
  
  const targetPrice = entryPrice * targetMultiplier;
  
  return {
    targetPrice,
    riskRewardRatio: targetMultiplier,
    targetMultiplier,
    dteCategory
  };
}

/**
 * Get Lotto thresholds for external use (e.g., filtering, validation)
 */
export function getLottoThresholds() {
  return {
    LOTTO_ENTRY_MIN,
    LOTTO_ENTRY_MAX,
    LOTTO_DELTA_MAX,
    LOTTO_MAX_DTE
  };
}

// Flow Data Validation Module
// Validates options flow data by cross-checking against current underlying prices

import { getTradierQuote } from './tradier-api';
import { logger } from './logger';

export interface FlowValidationResult {
  isValid: boolean;
  status: 'valid' | 'stale_premium' | 'impossible_premium' | 'invalid_dte' | 'missing_quote' | 'flagged';
  reason: string;
  underlyingPrice?: number;
  intrinsicValue?: number;
  expectedMaxPremium?: number;
  adjustedConfidence?: number;
}

interface FlowData {
  symbol: string;
  optionType: 'call' | 'put';
  strike: number;
  premium: number;
  expiration: string;
  impliedVol?: number;
}

// Cache for underlying quotes (5 minute TTL)
const quoteCache = new Map<string, { price: number; timestamp: number }>();
const QUOTE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedQuote(symbol: string): Promise<number | null> {
  const now = Date.now();
  const cached = quoteCache.get(symbol);
  
  if (cached && now - cached.timestamp < QUOTE_CACHE_TTL) {
    return cached.price;
  }
  
  try {
    const quote = await getTradierQuote(symbol);
    if (quote && quote.last > 0) {
      quoteCache.set(symbol, { price: quote.last, timestamp: now });
      return quote.last;
    }
  } catch (e) {
    logger.warn(`[FLOW-VALIDATE] Failed to get quote for ${symbol}`);
  }
  
  return null;
}

function calculateDTE(expirationDate: string): number {
  const now = new Date();
  const expiry = new Date(expirationDate);
  const diffMs = expiry.getTime() - now.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function calculateIntrinsicValue(
  optionType: 'call' | 'put',
  underlyingPrice: number,
  strike: number
): number {
  if (optionType === 'call') {
    return Math.max(0, underlyingPrice - strike);
  } else {
    return Math.max(0, strike - underlyingPrice);
  }
}

function getMoneyness(
  optionType: 'call' | 'put',
  underlyingPrice: number,
  strike: number
): 'ITM' | 'ATM' | 'OTM' {
  const pctFromStrike = (underlyingPrice - strike) / underlyingPrice;
  
  if (optionType === 'call') {
    if (pctFromStrike > 0.02) return 'ITM';
    if (pctFromStrike < -0.02) return 'OTM';
    return 'ATM';
  } else {
    if (pctFromStrike < -0.02) return 'ITM';
    if (pctFromStrike > 0.02) return 'OTM';
    return 'ATM';
  }
}

export async function validateFlowData(flow: FlowData): Promise<FlowValidationResult> {
  const { symbol, optionType, strike, premium, expiration, impliedVol } = flow;
  
  // Get current underlying price
  const underlyingPrice = await getCachedQuote(symbol);
  
  if (!underlyingPrice) {
    return {
      isValid: false,
      status: 'missing_quote',
      reason: `Could not get quote for ${symbol}`
    };
  }
  
  const dte = calculateDTE(expiration);
  const intrinsic = calculateIntrinsicValue(optionType, underlyingPrice, strike);
  const moneyness = getMoneyness(optionType, underlyingPrice, strike);
  
  // Calculate expected max premium based on moneyness and DTE
  // For OTM options: mainly time value, decays with DTE
  // For ITM options: intrinsic + time value
  const iv = impliedVol || 0.3; // Default 30% if not provided
  const timeValueMultiplier = Math.sqrt(dte / 365) * iv * underlyingPrice;
  
  let expectedMaxPremium: number;
  
  if (moneyness === 'OTM') {
    // OTM: Premium is pure time value, should decay with DTE
    if (dte <= 1) {
      // 0-1 DTE OTM should be nearly worthless unless very close to strike
      const distanceFromStrike = Math.abs(underlyingPrice - strike) / underlyingPrice;
      if (distanceFromStrike > 0.05) {
        // More than 5% OTM with 0-1 DTE = should be nearly 0
        expectedMaxPremium = underlyingPrice * 0.005; // Max 0.5% of stock price
      } else {
        expectedMaxPremium = timeValueMultiplier * 0.3; // Reduced time value
      }
    } else {
      expectedMaxPremium = timeValueMultiplier;
    }
  } else if (moneyness === 'ATM') {
    // ATM: Highest time value
    expectedMaxPremium = intrinsic + timeValueMultiplier * 1.2;
  } else {
    // ITM: Intrinsic + time value
    expectedMaxPremium = intrinsic + timeValueMultiplier;
  }
  
  // Add buffer for volatility spikes (2x tolerance)
  expectedMaxPremium *= 2;
  
  // Validation checks
  
  // Check 1: Premium significantly exceeds expected max (stale or bad data)
  if (premium > expectedMaxPremium * 3) {
    const pctOver = ((premium / expectedMaxPremium) * 100 - 100).toFixed(0);
    logger.warn(`[FLOW-VALIDATE] ${symbol} ${optionType.toUpperCase()} $${strike}: Premium $${premium.toFixed(2)} exceeds expected max $${expectedMaxPremium.toFixed(2)} by ${pctOver}% (Stock: $${underlyingPrice.toFixed(2)}, DTE: ${dte})`);
    
    return {
      isValid: false,
      status: 'impossible_premium',
      reason: `Premium $${premium.toFixed(2)} is ${pctOver}% above expected max $${expectedMaxPremium.toFixed(2)} (stock @ $${underlyingPrice.toFixed(2)})`,
      underlyingPrice,
      intrinsicValue: intrinsic,
      expectedMaxPremium
    };
  }
  
  // Check 2: 0-1 DTE OTM with significant premium (likely stale)
  if (dte <= 1 && moneyness === 'OTM') {
    const distanceFromStrike = Math.abs(underlyingPrice - strike) / underlyingPrice;
    if (distanceFromStrike > 0.10 && premium > 1) {
      // More than 10% OTM with premium > $1 on 0-1 DTE = suspicious
      logger.warn(`[FLOW-VALIDATE] ${symbol} ${optionType.toUpperCase()} $${strike}: 0-1 DTE ${(distanceFromStrike * 100).toFixed(1)}% OTM with $${premium.toFixed(2)} premium (Stock: $${underlyingPrice.toFixed(2)})`);
      
      return {
        isValid: false,
        status: 'stale_premium',
        reason: `${dte} DTE, ${(distanceFromStrike * 100).toFixed(1)}% OTM with $${premium.toFixed(2)} premium is likely stale`,
        underlyingPrice,
        intrinsicValue: intrinsic,
        expectedMaxPremium
      };
    }
  }
  
  // Check 3: Premium is less than intrinsic (should not happen in live markets)
  if (moneyness === 'ITM' && premium < intrinsic * 0.8) {
    logger.warn(`[FLOW-VALIDATE] ${symbol} ${optionType.toUpperCase()} $${strike}: Premium $${premium.toFixed(2)} below intrinsic $${intrinsic.toFixed(2)}`);
    
    return {
      isValid: false,
      status: 'stale_premium',
      reason: `Premium $${premium.toFixed(2)} is below intrinsic value $${intrinsic.toFixed(2)}`,
      underlyingPrice,
      intrinsicValue: intrinsic,
      expectedMaxPremium
    };
  }
  
  // Check 4: Flag suspicious but not necessarily invalid
  if (premium > expectedMaxPremium * 1.5) {
    logger.info(`[FLOW-VALIDATE] ${symbol} ${optionType.toUpperCase()} $${strike}: Flagged - Premium $${premium.toFixed(2)} is elevated (expected max $${expectedMaxPremium.toFixed(2)})`);
    
    return {
      isValid: true, // Still valid, but flagged
      status: 'flagged',
      reason: `Premium elevated but within tolerance`,
      underlyingPrice,
      intrinsicValue: intrinsic,
      expectedMaxPremium,
      adjustedConfidence: -5 // Reduce confidence by 5 points
    };
  }
  
  // All checks passed
  return {
    isValid: true,
    status: 'valid',
    reason: 'Premium is within expected range',
    underlyingPrice,
    intrinsicValue: intrinsic,
    expectedMaxPremium
  };
}

export function clearQuoteCache(): void {
  quoteCache.clear();
}

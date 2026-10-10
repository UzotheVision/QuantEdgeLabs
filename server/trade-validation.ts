/**
 * 🛡️ CRITICAL: Pre-execution trade validation
 * Prevents logically impossible trades from entering the system
 * Based on diagnostic audit findings (2025-10-28)
 */

import { logger } from './logger';

export interface TradeValidationInput {
  symbol: string;
  assetType: 'stock' | 'option' | 'crypto';
  direction: 'long' | 'short';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  // Options-specific fields (required for option validation)
  strikePrice?: number;
  expiryDate?: string;
  optionType?: 'call' | 'put';
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  severity: 'critical' | 'high' | 'medium' | 'low' | null;
}

/**
 * Comprehensive trade validation with multiple safety layers
 */
export function validateTrade(trade: TradeValidationInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let severity: 'critical' | 'high' | 'medium' | 'low' | null = null;

  const { symbol, assetType, direction, entryPrice, targetPrice, stopLoss } = trade;

  // ===== CRITICAL VALIDATIONS =====
  
  // 1. Check for zero or negative prices
  if (entryPrice <= 0 || targetPrice <= 0 || stopLoss <= 0) {
    errors.push(`Invalid prices: entry=$${entryPrice}, target=$${targetPrice}, stop=$${stopLoss} (must be > 0)`);
    severity = 'critical';
  }

  // 2. Check for stop loss equals entry price (CRITICAL BUG from audit)
  if (stopLoss === entryPrice) {
    errors.push(`Stop loss equals entry price ($${entryPrice}). This is a fatal configuration error.`);
    severity = 'critical';
  }

  // 3. Validate price relationships based on direction
  // SPECIAL CASE: When BUYING options (both calls AND puts), we always want premium to go UP
  // - LONG + CALL = buy call, stock goes UP, premium goes UP → target > entry > stop ✓
  // - SHORT + PUT = buy put, stock goes DOWN, premium goes UP → target > entry > stop ✓
  // The only "short" validation (stop > entry > target) applies to SHORTING stock/selling options
  const isBuyingPutOption = assetType === 'option' && direction === 'short' && trade.optionType === 'put';
  
  // Use "long" price validation for buying puts (premium appreciates like a long position)
  const useLongValidation = direction === 'long' || isBuyingPutOption;
  
  if (useLongValidation) {
    // For LONG trades (or buying puts): target > entry > stop
    if (targetPrice <= entryPrice) {
      errors.push(
        `${isBuyingPutOption ? 'PUT OPTION' : 'LONG'} trade has target ($${targetPrice}) at or below entry ($${entryPrice}). ` +
        `Target must be > entry (premium appreciates). Current: target=${targetPrice}, entry=${entryPrice}`
      );
      severity = 'critical';
    }
    
    if (stopLoss >= entryPrice) {
      errors.push(
        `${isBuyingPutOption ? 'PUT OPTION' : 'LONG'} trade has stop ($${stopLoss}) at or above entry ($${entryPrice}). ` +
        `Stop must be < entry. Current: stop=${stopLoss}, entry=${entryPrice}`
      );
      severity = 'critical';
    }

    // Sanity check: target should definitely be above stop
    if (targetPrice <= stopLoss) {
      errors.push(
        `${isBuyingPutOption ? 'PUT OPTION' : 'LONG'} trade has target ($${targetPrice}) at or below stop ($${stopLoss}). ` +
        `Logical order must be: target > entry > stop`
      );
      severity = 'critical';
    }
  } else if (direction === 'short') {
    // For SHORT stock/selling options: stop > entry > target
    if (targetPrice >= entryPrice) {
      errors.push(
        `SHORT trade has target ($${targetPrice}) at or above entry ($${entryPrice}). ` +
        `For SHORT: target must be < entry. Current: target=${targetPrice}, entry=${entryPrice}`
      );
      severity = 'critical';
    }
    
    if (stopLoss <= entryPrice) {
      errors.push(
        `SHORT trade has stop ($${stopLoss}) at or below entry ($${entryPrice}). ` +
        `For SHORT: stop must be > entry. Current: stop=${stopLoss}, entry=${entryPrice}`
      );
      severity = 'critical';
    }

    // Sanity check: stop should definitely be above target
    if (stopLoss <= targetPrice) {
      errors.push(
        `SHORT trade has stop ($${stopLoss}) at or below target ($${targetPrice}). ` +
        `Logical order must be: stop > entry > target`
      );
      severity = 'critical';
    }
  }

  // 4. Check for unrealistic price movements (>50% in day trades)
  const gainPercent = Math.abs((targetPrice - entryPrice) / entryPrice) * 100;
  const lossPercent = Math.abs((stopLoss - entryPrice) / entryPrice) * 100;

  if (gainPercent > 50) {
    warnings.push(
      `Unrealistic gain target: ${gainPercent.toFixed(1)}% move expected. ` +
      `Day trades typically target <20% moves.`
    );
    if (!severity) severity = 'medium';
  }

  if (lossPercent > 10) {
    warnings.push(
      `Extremely wide stop loss: ${lossPercent.toFixed(1)}% risk. ` +
      `Stop should typically be <5% for stocks, <7% for crypto.`
    );
    if (!severity) severity = 'medium';
  }

  // 5. Calculate and validate R:R ratio
  // For buying options (calls or puts), premium appreciation means target > entry > stop
  const useLongRRCalc = direction === 'long' || isBuyingPutOption;
  
  const maxLoss = useLongRRCalc 
    ? (entryPrice - stopLoss) 
    : (stopLoss - entryPrice);
  
  const potentialGain = useLongRRCalc
    ? (targetPrice - entryPrice)
    : (entryPrice - targetPrice);

  if (maxLoss > 0) { // Avoid division by zero
    const rrRatio = potentialGain / maxLoss;
    
    if (rrRatio < 1.5) {
      warnings.push(
        `Poor risk/reward ratio: ${rrRatio.toFixed(2)}:1. ` +
        `Minimum recommended is 2:1 for day trades.`
      );
      if (!severity) severity = 'medium';
    }
  }

  // 6. Asset-specific validations
  if (assetType === 'option') {
    // Options can have either:
    // - Composite symbol: "AAPL C150 2025-11-15" (legacy format)
    // - OR separate fields: strikePrice + expiryDate + optionType (AI format)
    const hasCompositeSymbol = symbol.includes(' ') || symbol.match(/[CP]\d{8}/);
    const hasSeparateFields = 'strikePrice' in trade && 'expiryDate' in trade && 'optionType' in trade;
    
    if (!hasCompositeSymbol && !hasSeparateFields) {
      errors.push(
        `Invalid option format: "${symbol}". ` +
        `Either provide composite symbol (e.g., "AAPL C150 2025-11-15") ` +
        `or separate strikePrice/expiryDate/optionType fields`
      );
      if (!severity) severity = 'high';
    }
    
    // CRITICAL: Validate direction/optionType consistency
    // LONG direction = bullish bet = CALL option (profits when underlying goes UP)
    // SHORT direction = bearish bet = PUT option (profits when underlying goes DOWN)
    if (trade.optionType) {
      const optType = trade.optionType.toLowerCase();
      if (direction === 'long' && optType === 'put') {
        errors.push(
          `Direction/OptionType mismatch: LONG + PUT is contradictory. ` +
          `LONG means bullish (expecting price UP), but PUT profits when price goes DOWN. ` +
          `Use CALL for bullish trades, PUT for bearish trades.`
        );
        severity = 'critical';
      }
      if (direction === 'short' && optType === 'call') {
        errors.push(
          `Direction/OptionType mismatch: SHORT + CALL is contradictory. ` +
          `SHORT means bearish (expecting price DOWN), but CALL profits when price goes UP. ` +
          `Use PUT for bearish trades, CALL for bullish trades.`
        );
        severity = 'critical';
      }
    }
    
    // Smart option premium validation using available data
    // Deep ITM options CAN have high premiums (intrinsic value), so we use a heuristic:
    // If entry premium is > 10x strike, it's almost certainly stock price, not option premium
    // Even the deepest ITM options (stock at 10x strike) rarely exceed 10x premium-to-strike ratio
    if (trade.strikePrice && trade.strikePrice > 0) {
      const strike = trade.strikePrice;
      const entryRatio = entryPrice / strike;
      
      // If entry premium is > 10x strike, this is definitely stock price (e.g., META $5 strike with $645 "premium")
      if (entryRatio > 10) {
        errors.push(
          `Invalid option premium: Entry ($${entryPrice.toFixed(2)}) is ${entryRatio.toFixed(0)}x the strike price ($${strike}). ` +
          `This appears to be the stock price, not the option premium.`
        );
        if (!severity) severity = 'critical';
      }
    }
  }

  // 7. Check for penny stock risks (< $1)
  if (entryPrice < 1 && assetType === 'stock') {
    warnings.push(
      `Penny stock detected (entry=$${entryPrice}). ` +
      `High slippage and liquidity risks expected.`
    );
    if (!severity) severity = 'low';
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    severity
  };
}

/**
 * Validate and log trade with detailed error reporting
 */
export function validateAndLog(trade: TradeValidationInput, source: string): boolean {
  const result = validateTrade(trade);
  
  if (!result.isValid) {
    logger.error(`🚨 TRADE VALIDATION FAILED [${source}]`, {
      symbol: trade.symbol,
      direction: trade.direction,
      severity: result.severity,
      errors: result.errors,
      warnings: result.warnings,
      prices: {
        entry: trade.entryPrice,
        target: trade.targetPrice,
        stop: trade.stopLoss
      }
    });
    return false;
  }
  
  if (result.warnings.length > 0) {
    logger.warn(`⚠️ TRADE VALIDATION WARNINGS [${source}]`, {
      symbol: trade.symbol,
      direction: trade.direction,
      severity: result.severity,
      warnings: result.warnings
    });
  }
  
  return true;
}

/**
 * Get validation error summary for API responses
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.isValid) {
    return result.warnings.length > 0 
      ? `Trade valid with ${result.warnings.length} warning(s)`
      : 'Trade validated successfully';
  }
  
  return `${result.errors.length} validation error(s): ${result.errors.join('; ')}`;
}

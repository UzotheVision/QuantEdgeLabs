/**
 * Transaction Cost Model
 *
 * Adds realistic trading costs to trade analysis.
 * Without this, backtests overestimate returns by 20-40%.
 *
 * Cost Components:
 * 1. Commission fees (broker-dependent)
 * 2. Bid-ask spread (liquidity-dependent)
 * 3. Slippage (market impact, size-dependent)
 * 4. SEC/FINRA fees (regulatory)
 */

import { logger } from '../logger';

export interface TransactionCosts {
  commission: number;       // Broker commission per trade
  spread: number;           // Bid-ask spread cost
  slippage: number;         // Market impact/execution slippage
  regulatoryFees: number;   // SEC, FINRA fees
  totalCost: number;        // Total one-way cost
  roundTripCost: number;    // Entry + exit cost
  costAsPercent: number;    // Total cost as % of trade value
}

export interface CostParameters {
  broker: 'robinhood' | 'interactive_brokers' | 'td_ameritrade' | 'schwab' | 'fidelity' | 'tradier';
  assetClass: 'stock' | 'etf' | 'option' | 'crypto';
  tradeValue: number;       // Dollar value of trade
  avgDailyVolume?: number;  // Stock's average daily volume
  bidAskSpread?: number;    // Known bid-ask spread (if available)
  orderType: 'market' | 'limit';
  positionSizePercent?: number;  // Position as % of daily volume
}

// Broker commission structures (as of 2024)
const BROKER_COMMISSIONS = {
  robinhood: {
    stock: 0,
    etf: 0,
    option: 0,  // $0 but pays for order flow
    crypto: 0,
  },
  interactive_brokers: {
    stock: 0.005,  // $0.005/share, min $1
    etf: 0.005,
    option: 0.65,  // $0.65/contract
    crypto: 0.0018, // 0.18% of trade
  },
  td_ameritrade: {
    stock: 0,
    etf: 0,
    option: 0.65,
    crypto: 0,
  },
  schwab: {
    stock: 0,
    etf: 0,
    option: 0.65,
    crypto: 0,
  },
  fidelity: {
    stock: 0,
    etf: 0,
    option: 0.65,
    crypto: 0.01, // 1% for crypto
  },
  tradier: {
    stock: 0,
    etf: 0,
    option: 0.35,  // Competitive options pricing
    crypto: 0,
  },
};

// Average bid-ask spreads by market cap tier
const AVG_SPREADS = {
  mega_cap: 0.01,    // >$200B - AAPL, MSFT: ~1 cent
  large_cap: 0.03,   // $10-200B - ~3 cents
  mid_cap: 0.08,     // $2-10B - ~8 cents
  small_cap: 0.15,   // $300M-2B - ~15 cents
  micro_cap: 0.35,   // <$300M - ~35 cents
  penny_stock: 0.10, // As % of price for penny stocks
};

// Slippage estimates by order size relative to volume
const SLIPPAGE_FACTORS = {
  tiny: 0.0001,      // <0.1% of daily volume: 1bp slippage
  small: 0.0005,     // 0.1-0.5%: 5bp slippage
  medium: 0.001,     // 0.5-1%: 10bp slippage
  large: 0.003,      // 1-5%: 30bp slippage
  very_large: 0.01,  // >5%: 100bp slippage (significant impact)
};

// Regulatory fees (2024 rates)
const REGULATORY_FEES = {
  sec_fee: 0.0000278,   // $27.80 per $1M sold
  finra_taf: 0.000166,  // $0.000166 per share (max $8.30)
  options_occ: 0.055,   // $0.055 per contract
};

/**
 * Calculate total transaction costs for a trade
 */
export function calculateTransactionCosts(params: CostParameters): TransactionCosts {
  const {
    broker,
    assetClass,
    tradeValue,
    avgDailyVolume,
    bidAskSpread,
    orderType,
    positionSizePercent,
  } = params;

  // 1. Commission
  let commission = 0;
  const brokerRates = BROKER_COMMISSIONS[broker];

  if (assetClass === 'option') {
    // Options: per-contract fee (assume 1 contract = $100 underlying)
    const contracts = Math.ceil(tradeValue / 100);
    commission = brokerRates.option * contracts;
  } else if (assetClass === 'crypto') {
    commission = tradeValue * (brokerRates.crypto || 0);
  } else {
    // Stocks/ETFs: most brokers are commission-free
    commission = brokerRates[assetClass] || 0;
    if (broker === 'interactive_brokers') {
      // IB charges per share
      const estimatedShares = tradeValue / 100; // Assume $100 avg price
      commission = Math.max(1, estimatedShares * 0.005);
    }
  }

  // 2. Bid-ask spread
  let spread = 0;
  if (bidAskSpread !== undefined) {
    // Use provided spread
    spread = bidAskSpread / 2; // Half spread per side
  } else {
    // Estimate based on market cap (using trade value as proxy)
    if (tradeValue > 10000) {
      spread = AVG_SPREADS.large_cap;
    } else if (tradeValue > 1000) {
      spread = AVG_SPREADS.mid_cap;
    } else {
      spread = AVG_SPREADS.small_cap;
    }
  }
  const spreadCost = (spread / 100) * tradeValue; // Convert to dollars

  // 3. Slippage (market orders have higher slippage)
  let slippage = 0;
  if (orderType === 'market') {
    // Estimate slippage based on position size relative to volume
    const sizePercent = positionSizePercent || 0.1; // Default 0.1% of volume

    let slippageFactor: number;
    if (sizePercent < 0.1) slippageFactor = SLIPPAGE_FACTORS.tiny;
    else if (sizePercent < 0.5) slippageFactor = SLIPPAGE_FACTORS.small;
    else if (sizePercent < 1) slippageFactor = SLIPPAGE_FACTORS.medium;
    else if (sizePercent < 5) slippageFactor = SLIPPAGE_FACTORS.large;
    else slippageFactor = SLIPPAGE_FACTORS.very_large;

    slippage = tradeValue * slippageFactor;
  } else {
    // Limit orders have minimal slippage (but may not fill)
    slippage = tradeValue * 0.0001; // 1bp for limit orders
  }

  // 4. Regulatory fees
  let regulatoryFees = 0;
  if (assetClass === 'stock' || assetClass === 'etf') {
    // SEC fee on sales
    regulatoryFees += tradeValue * REGULATORY_FEES.sec_fee;
    // FINRA TAF (max $8.30)
    const shares = tradeValue / 100;
    regulatoryFees += Math.min(shares * REGULATORY_FEES.finra_taf, 8.30);
  } else if (assetClass === 'option') {
    const contracts = Math.ceil(tradeValue / 100);
    regulatoryFees += contracts * REGULATORY_FEES.options_occ;
  }

  // Total one-way cost
  const totalCost = commission + spreadCost + slippage + regulatoryFees;

  // Round trip (entry + exit)
  const roundTripCost = totalCost * 2;

  // Cost as percentage
  const costAsPercent = (roundTripCost / tradeValue) * 100;

  return {
    commission,
    spread: spreadCost,
    slippage,
    regulatoryFees,
    totalCost,
    roundTripCost,
    costAsPercent,
  };
}

/**
 * Adjust expected return for transaction costs
 */
export function adjustReturnForCosts(
  expectedReturn: number,  // As percentage (e.g., 5 for 5%)
  costs: TransactionCosts
): {
  grossReturn: number;
  netReturn: number;
  costDrag: number;
  isViable: boolean;
  message: string;
} {
  const grossReturn = expectedReturn;
  const costDrag = costs.costAsPercent;
  const netReturn = grossReturn - costDrag;
  const isViable = netReturn > 0.5; // Need at least 0.5% net return

  let message: string;
  if (costDrag > expectedReturn) {
    message = `Trade is NOT viable: costs (${costDrag.toFixed(2)}%) exceed expected return (${grossReturn.toFixed(2)}%)`;
  } else if (costDrag > expectedReturn * 0.5) {
    message = `Caution: costs consume ${((costDrag / grossReturn) * 100).toFixed(0)}% of expected return`;
  } else {
    message = `Trade viable: net return ${netReturn.toFixed(2)}% after ${costDrag.toFixed(2)}% costs`;
  }

  return {
    grossReturn,
    netReturn,
    costDrag,
    isViable,
    message,
  };
}

/**
 * Calculate breakeven price move needed to cover costs
 */
export function calculateBreakevenMove(
  costs: TransactionCosts,
  entryPrice: number
): {
  breakevenPercent: number;
  breakevenPrice: number;
  message: string;
} {
  const breakevenPercent = costs.costAsPercent;
  const breakevenPrice = entryPrice * (1 + breakevenPercent / 100);

  return {
    breakevenPercent,
    breakevenPrice,
    message: `Stock must move ${breakevenPercent.toFixed(2)}% (to $${breakevenPrice.toFixed(2)}) just to break even`,
  };
}

/**
 * Get cost estimate for quick reference
 */
export function getQuickCostEstimate(
  tradeValue: number,
  assetClass: 'stock' | 'option' | 'crypto' = 'stock'
): {
  estimatedCostPercent: number;
  tier: 'low' | 'medium' | 'high';
} {
  // Quick estimate based on typical retail trader costs
  let estimatedCostPercent: number;

  if (assetClass === 'stock') {
    if (tradeValue > 10000) {
      estimatedCostPercent = 0.05; // 5bp round trip for large liquid trades
    } else if (tradeValue > 1000) {
      estimatedCostPercent = 0.15; // 15bp for medium trades
    } else {
      estimatedCostPercent = 0.3; // 30bp for small trades
    }
  } else if (assetClass === 'option') {
    // Options have higher costs
    if (tradeValue > 5000) {
      estimatedCostPercent = 0.5;
    } else {
      estimatedCostPercent = 1.0; // 1% for small options trades
    }
  } else {
    // Crypto has variable costs
    estimatedCostPercent = 0.5;
  }

  const tier = estimatedCostPercent < 0.1 ? 'low' :
               estimatedCostPercent < 0.3 ? 'medium' : 'high';

  return { estimatedCostPercent, tier };
}

/**
 * Adjust confidence score based on cost viability
 */
export function adjustConfidenceForCosts(
  confidence: number,
  expectedReturn: number,
  tradeValue: number,
  assetClass: 'stock' | 'option' | 'crypto' = 'stock'
): {
  adjustedConfidence: number;
  adjustment: number;
  reason: string;
} {
  const { estimatedCostPercent } = getQuickCostEstimate(tradeValue, assetClass);
  const netReturn = expectedReturn - estimatedCostPercent;

  let adjustment = 0;
  let reason = '';

  if (netReturn <= 0) {
    adjustment = -20; // Major penalty
    reason = 'Costs exceed expected return';
  } else if (estimatedCostPercent > expectedReturn * 0.5) {
    adjustment = -10; // Moderate penalty
    reason = 'High cost relative to expected return';
  } else if (estimatedCostPercent > expectedReturn * 0.25) {
    adjustment = -5; // Small penalty
    reason = 'Costs reduce edge moderately';
  } else {
    adjustment = 0;
    reason = 'Costs are acceptable';
  }

  const adjustedConfidence = Math.max(30, Math.min(95, confidence + adjustment));

  return {
    adjustedConfidence,
    adjustment,
    reason,
  };
}

/**
 * Get cost summary for display
 */
export function getCostSummary(costs: TransactionCosts): string {
  return `
Transaction Cost Breakdown:
- Commission: $${costs.commission.toFixed(2)}
- Spread: $${costs.spread.toFixed(2)}
- Slippage: $${costs.slippage.toFixed(2)}
- Regulatory: $${costs.regulatoryFees.toFixed(2)}
- One-way total: $${costs.totalCost.toFixed(2)}
- Round-trip total: $${costs.roundTripCost.toFixed(2)} (${costs.costAsPercent.toFixed(2)}%)
  `.trim();
}

export default {
  calculateTransactionCosts,
  adjustReturnForCosts,
  calculateBreakevenMove,
  getQuickCostEstimate,
  adjustConfidenceForCosts,
  getCostSummary,
};

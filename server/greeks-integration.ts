/**
 * Greeks Integration - Add Delta, Gamma, Theta, Vega to LEAPS
 * Fetches live options data from Tradier API
 */

import { logger } from './logger';

export interface OptionsGreeks {
  symbol: string;
  strike: number;
  expiry: string;
  optionType: 'call' | 'put';
  // Greeks
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  // Pricing
  bid: number;
  ask: number;
  last: number;
  mid: number;
  // Volatility
  impliedVolatility: number;
  // Volume & OI
  volume: number;
  openInterest: number;
  // Underlying
  underlyingPrice: number;
  // Probability
  probabilityITM?: number; // Based on delta
  probabilityProfit?: number; // Calculated
}

class GreeksIntegration {
  private tradierApiKey: string;
  private useSandbox: boolean;
  private baseUrl: string;

  constructor() {
    this.tradierApiKey = process.env.TRADIER_API_KEY || '';
    this.useSandbox = process.env.TRADIER_USE_SANDBOX === 'true';
    this.baseUrl = this.useSandbox
      ? 'https://sandbox.tradier.com/v1'
      : 'https://api.tradier.com/v1';
  }

  /**
   * Fetch Greeks for a specific option contract
   */
  async fetchGreeks(
    symbol: string,
    strike: number,
    expiry: string, // Format: YYYY-MM-DD
    optionType: 'call' | 'put'
  ): Promise<OptionsGreeks | null> {
    if (!this.tradierApiKey) {
      logger.warn('[GREEKS] Tradier API key not configured');
      return null;
    }

    try {
      // First get the underlying price
      const underlyingPrice = await this.getUnderlyingPrice(symbol);
      if (!underlyingPrice) return null;

      // Get options chain for the specific expiry
      const chain = await this.getOptionsChain(symbol, expiry);
      if (!chain) return null;

      // Find the specific contract
      const contract = chain.find(
        opt =>
          opt.strike === strike &&
          opt.option_type === optionType &&
          opt.expiration_date === expiry
      );

      if (!contract) {
        logger.warn(`[GREEKS] Contract not found: ${symbol} ${optionType} ${strike} ${expiry}`);
        return null;
      }

      // Calculate probability ITM from delta
      const probabilityITM = optionType === 'call'
        ? Math.abs(contract.greeks?.delta || 0) * 100
        : (1 - Math.abs(contract.greeks?.delta || 0)) * 100;

      const greeks: OptionsGreeks = {
        symbol,
        strike,
        expiry,
        optionType,
        delta: contract.greeks?.delta || 0,
        gamma: contract.greeks?.gamma || 0,
        theta: contract.greeks?.theta || 0,
        vega: contract.greeks?.vega || 0,
        rho: contract.greeks?.rho || 0,
        bid: contract.bid || 0,
        ask: contract.ask || 0,
        last: contract.last || 0,
        mid: contract.bid && contract.ask ? (contract.bid + contract.ask) / 2 : contract.last || 0,
        impliedVolatility: contract.greeks?.mid_iv || 0,
        volume: contract.volume || 0,
        openInterest: contract.open_interest || 0,
        underlyingPrice,
        probabilityITM,
        probabilityProfit: this.calculateProbabilityProfit(
          underlyingPrice,
          strike,
          contract.mid || contract.last || 0,
          optionType
        )
      };

      logger.info(
        `[GREEKS] Fetched ${symbol} ${optionType} ${strike}: ` +
        `Delta=${greeks.delta.toFixed(3)}, IV=${(greeks.impliedVolatility * 100).toFixed(1)}%`
      );

      return greeks;
    } catch (error) {
      logger.error(`[GREEKS] Error fetching Greeks for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Batch fetch Greeks for multiple LEAPS
   */
  async batchFetchGreeks(
    leaps: Array<{
      symbol: string;
      strike: number;
      expiry: string;
      optionType: 'call' | 'put';
    }>
  ): Promise<Map<string, OptionsGreeks>> {
    const results = new Map<string, OptionsGreeks>();

    // Group by symbol to minimize API calls
    const bySymbol = new Map<string, typeof leaps>();
    for (const leap of leaps) {
      if (!bySymbol.has(leap.symbol)) {
        bySymbol.set(leap.symbol, []);
      }
      bySymbol.get(leap.symbol)!.push(leap);
    }

    // Fetch with rate limiting (5 req/sec)
    for (const [symbol, symbolLeaps] of bySymbol.entries()) {
      for (const leap of symbolLeaps) {
        const greeks = await this.fetchGreeks(
          leap.symbol,
          leap.strike,
          leap.expiry,
          leap.optionType
        );

        if (greeks) {
          const key = `${symbol}_${leap.optionType}_${leap.strike}_${leap.expiry}`;
          results.set(key, greeks);
        }

        // Rate limit: 200ms between calls = 5 req/sec
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    logger.info(`[GREEKS] Batch fetched ${results.size}/${leaps.length} contracts`);
    return results;
  }

  /**
   * Get underlying stock price
   */
  private async getUnderlyingPrice(symbol: string): Promise<number | null> {
    try {
      const response = await fetch(`${this.baseUrl}/markets/quotes?symbols=${symbol}`, {
        headers: {
          Authorization: `Bearer ${this.tradierApiKey}`,
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Tradier API error: ${response.statusText}`);
      }

      const data = await response.json();
      const quote = data.quotes?.quote;

      if (!quote) return null;

      return quote.last || quote.close || 0;
    } catch (error) {
      logger.error(`[GREEKS] Error fetching price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get options chain for specific expiry
   */
  private async getOptionsChain(
    symbol: string,
    expiry: string
  ): Promise<any[] | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/markets/options/chains?symbol=${symbol}&expiration=${expiry}&greeks=true`,
        {
          headers: {
            Authorization: `Bearer ${this.tradierApiKey}`,
            Accept: 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Tradier API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.options?.option || [];
    } catch (error) {
      logger.error(`[GREEKS] Error fetching chain for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Calculate probability of profit
   * Based on breakeven vs current price and IV
   */
  private calculateProbabilityProfit(
    underlyingPrice: number,
    strike: number,
    premium: number,
    optionType: 'call' | 'put'
  ): number {
    const breakeven = optionType === 'call'
      ? strike + premium
      : strike - premium;

    // Simple probability: distance from breakeven vs underlying price
    // More sophisticated: would use Black-Scholes and IV
    const distance = Math.abs(underlyingPrice - breakeven);
    const percentDistance = (distance / underlyingPrice) * 100;

    // Rough estimate: closer to breakeven = lower probability
    // Far OTM = lower probability
    if (optionType === 'call') {
      if (underlyingPrice > breakeven) return 70; // Already profitable
      if (percentDistance < 5) return 60;
      if (percentDistance < 10) return 45;
      if (percentDistance < 20) return 30;
      return 15;
    } else {
      if (underlyingPrice < breakeven) return 70; // Already profitable
      if (percentDistance < 5) return 60;
      if (percentDistance < 10) return 45;
      if (percentDistance < 20) return 30;
      return 15;
    }
  }

  /**
   * Interpret Greeks for user
   */
  interpretGreeks(greeks: OptionsGreeks): {
    deltaInterpretation: string;
    gammaInterpretation: string;
    thetaInterpretation: string;
    vegaInterpretation: string;
    overallRisk: 'low' | 'moderate' | 'high';
  } {
    // Delta: 0-0.3 = low, 0.3-0.7 = moderate, 0.7-1.0 = high directional exposure
    const absDelta = Math.abs(greeks.delta);
    let deltaInterpretation = '';
    if (absDelta < 0.3) {
      deltaInterpretation = `Low directional exposure (${(absDelta * 100).toFixed(0)}%). `;
      deltaInterpretation += `Option moves $${(absDelta * 100).toFixed(0)} for every $100 move in ${greeks.symbol}.`;
    } else if (absDelta < 0.7) {
      deltaInterpretation = `Moderate directional exposure (${(absDelta * 100).toFixed(0)}%). `;
      deltaInterpretation += `Acts like ${(absDelta * 100).toFixed(0)} shares of stock.`;
    } else {
      deltaInterpretation = `High directional exposure (${(absDelta * 100).toFixed(0)}%). `;
      deltaInterpretation += `Moves almost like owning the stock.`;
    }

    // Gamma: How fast delta changes
    const gammaInterpretation = greeks.gamma > 0.05
      ? `High gamma (${greeks.gamma.toFixed(3)}) - delta changes quickly with price moves`
      : `Low gamma (${greeks.gamma.toFixed(3)}) - delta stable (good for LEAPS)`;

    // Theta: Daily time decay
    const thetaPerDay = Math.abs(greeks.theta);
    const thetaInterpretation = thetaPerDay > 0.10
      ? `Losing $${(thetaPerDay * 100).toFixed(0)}/day to theta decay (high time decay)`
      : `Losing $${(thetaPerDay * 100).toFixed(0)}/day to theta decay (low - good for LEAPS)`;

    // Vega: IV sensitivity
    const vegaInterpretation = greeks.vega > 0.20
      ? `High vega (${greeks.vega.toFixed(2)}) - very sensitive to IV changes`
      : `Moderate vega (${greeks.vega.toFixed(2)}) - somewhat sensitive to IV`;

    // Overall risk
    let overallRisk: 'low' | 'moderate' | 'high' = 'moderate';
    if (thetaPerDay < 0.05 && greeks.impliedVolatility < 0.5 && absDelta > 0.5) {
      overallRisk = 'low';
    } else if (thetaPerDay > 0.15 || greeks.impliedVolatility > 0.8 || absDelta < 0.3) {
      overallRisk = 'high';
    }

    return {
      deltaInterpretation,
      gammaInterpretation,
      thetaInterpretation,
      vegaInterpretation,
      overallRisk
    };
  }
}

// Singleton instance
export const greeksIntegration = new GreeksIntegration();

// Helper functions
export async function getGreeksForLEAP(
  symbol: string,
  strike: number,
  expiry: string,
  optionType: 'call' | 'put'
): Promise<OptionsGreeks | null> {
  return greeksIntegration.fetchGreeks(symbol, strike, expiry, optionType);
}

export async function batchGetGreeks(
  leaps: Array<{
    symbol: string;
    strike: number;
    expiry: string;
    optionType: 'call' | 'put';
  }>
): Promise<Map<string, OptionsGreeks>> {
  return greeksIntegration.batchFetchGreeks(leaps);
}

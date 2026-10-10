/**
 * Correlation Position Caps Service
 * 
 * Prevents concentrated risk by limiting exposure to correlated assets.
 * Tracks sector/correlation group exposure and blocks new positions
 * that would exceed concentration limits.
 * 
 * Core Rules:
 * - Max 25% portfolio exposure to any single sector
 * - Max 3 positions in highly correlated assets (e.g., FAANG stocks)
 * - Real-time position tracking with sector classification
 */

import { logger } from "./logger";
import { storage } from "./storage";

export type CorrelationGroup = 
  | 'mega_tech'      // AAPL, MSFT, GOOGL, AMZN, META, NVDA
  | 'semiconductor'  // AMD, INTC, NVDA, AVGO, QCOM, MU
  | 'ev_clean'       // TSLA, RIVN, LCID, NIO, PLUG, FCEL
  | 'fintech'        // SQ, PYPL, COIN, SOFI, AFRM
  | 'biotech'        // MRNA, BNTX, PFE, JNJ
  | 'retail'         // AMZN, WMT, TGT, COST
  | 'energy'         // XOM, CVX, OXY, SLB
  | 'crypto'         // BTC, ETH, SOL, DOGE
  | 'meme'           // GME, AMC, BBBY, BB
  | 'index'          // SPY, QQQ, IWM, DIA
  | 'other';

export interface CorrelationConfig {
  maxPositionsPerGroup: number;
  maxPortfolioExposurePerGroup: number;
  maxSinglePositionSize: number;
}

const DEFAULT_CONFIG: CorrelationConfig = {
  maxPositionsPerGroup: 3,
  maxPortfolioExposurePerGroup: 0.25,
  maxSinglePositionSize: 0.10
};

const SYMBOL_GROUPS: Record<string, CorrelationGroup> = {
  'AAPL': 'mega_tech',
  'MSFT': 'mega_tech',
  'GOOGL': 'mega_tech',
  'GOOG': 'mega_tech',
  'AMZN': 'mega_tech',
  'META': 'mega_tech',
  'NVDA': 'mega_tech',
  'AMD': 'semiconductor',
  'INTC': 'semiconductor',
  'AVGO': 'semiconductor',
  'QCOM': 'semiconductor',
  'MU': 'semiconductor',
  'TSLA': 'ev_clean',
  'RIVN': 'ev_clean',
  'LCID': 'ev_clean',
  'NIO': 'ev_clean',
  'PLUG': 'ev_clean',
  'FCEL': 'ev_clean',
  'SQ': 'fintech',
  'PYPL': 'fintech',
  'COIN': 'fintech',
  'SOFI': 'fintech',
  'AFRM': 'fintech',
  'MRNA': 'biotech',
  'BNTX': 'biotech',
  'PFE': 'biotech',
  'JNJ': 'biotech',
  'WMT': 'retail',
  'TGT': 'retail',
  'COST': 'retail',
  'XOM': 'energy',
  'CVX': 'energy',
  'OXY': 'energy',
  'SLB': 'energy',
  'BTC': 'crypto',
  'ETH': 'crypto',
  'SOL': 'crypto',
  'DOGE': 'crypto',
  'GME': 'meme',
  'AMC': 'meme',
  'BB': 'meme',
  'SPY': 'index',
  'QQQ': 'index',
  'IWM': 'index',
  'DIA': 'index',
};

export function getCorrelationGroup(symbol: string): CorrelationGroup {
  const upperSymbol = symbol.toUpperCase();
  return SYMBOL_GROUPS[upperSymbol] || 'other';
}

export interface CorrelationCheckResult {
  allowed: boolean;
  reason: string | null;
  currentExposure: {
    group: CorrelationGroup;
    positions: number;
    dollarValue: number;
    portfolioPercent: number;
  };
  wouldBe: {
    positions: number;
    dollarValue: number;
    portfolioPercent: number;
  };
}

/**
 * Check if a proposed position would exceed correlation caps
 * 
 * @param portfolioId - Portfolio to check against
 * @param symbol - Symbol to trade
 * @param proposedPositionSize - Dollar value of the proposed position:
 *   - Options: premium × 100 × quantity (total cost)
 *   - Crypto: price × quantity (notional value)
 *   - Futures: margin required (risk capital committed)
 * @param config - Optional override config
 */
export async function checkCorrelationCaps(
  portfolioId: string,
  symbol: string,
  proposedPositionSize: number,
  config: Partial<CorrelationConfig> = {}
): Promise<CorrelationCheckResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const group = getCorrelationGroup(symbol);
  
  try {
    const portfolio = await storage.getPaperPortfolioById(portfolioId);
    if (!portfolio) {
      return {
        allowed: true,
        reason: 'Portfolio not found - allowing trade',
        currentExposure: { group, positions: 0, dollarValue: 0, portfolioPercent: 0 },
        wouldBe: { positions: 1, dollarValue: proposedPositionSize, portfolioPercent: 0 }
      };
    }
    
    const positions = await storage.getPaperPositionsByPortfolio(portfolioId);
    const openPositions = positions.filter(p => p.status === 'open');
    
    let groupPositions = 0;
    let groupDollarValue = 0;
    
    for (const pos of openPositions) {
      const posGroup = getCorrelationGroup(pos.symbol);
      if (posGroup === group) {
        groupPositions++;
        groupDollarValue += Math.abs(pos.quantity * pos.entryPrice);
      }
    }
    
    const totalValue = portfolio.totalValue || portfolio.cashBalance;
    const currentPercent = totalValue > 0 ? groupDollarValue / totalValue : 0;
    const wouldBeValue = groupDollarValue + proposedPositionSize;
    const wouldBePercent = totalValue > 0 ? wouldBeValue / totalValue : 0;
    const wouldBePositions = groupPositions + 1;
    
    let allowed = true;
    let reason: string | null = null;
    
    if (wouldBePositions > cfg.maxPositionsPerGroup) {
      allowed = false;
      reason = `Would exceed max ${cfg.maxPositionsPerGroup} positions in ${group} group (currently ${groupPositions})`;
    } else if (wouldBePercent > cfg.maxPortfolioExposurePerGroup) {
      allowed = false;
      reason = `Would exceed ${(cfg.maxPortfolioExposurePerGroup * 100).toFixed(0)}% exposure to ${group} group (would be ${(wouldBePercent * 100).toFixed(1)}%)`;
    } else if (proposedPositionSize / totalValue > cfg.maxSinglePositionSize) {
      allowed = false;
      reason = `Single position ${((proposedPositionSize / totalValue) * 100).toFixed(1)}% exceeds ${(cfg.maxSinglePositionSize * 100).toFixed(0)}% max`;
    }
    
    if (!allowed) {
      logger.warn(`[CORRELATION-CAPS] ⛔ Blocked ${symbol}: ${reason}`);
    }
    
    return {
      allowed,
      reason,
      currentExposure: {
        group,
        positions: groupPositions,
        dollarValue: groupDollarValue,
        portfolioPercent: currentPercent
      },
      wouldBe: {
        positions: wouldBePositions,
        dollarValue: wouldBeValue,
        portfolioPercent: wouldBePercent
      }
    };
    
  } catch (error: any) {
    logger.error(`[CORRELATION-CAPS] Error checking caps: ${error.message}`);
    return {
      allowed: true,
      reason: 'Error checking caps - allowing trade',
      currentExposure: { group, positions: 0, dollarValue: 0, portfolioPercent: 0 },
      wouldBe: { positions: 1, dollarValue: proposedPositionSize, portfolioPercent: 0 }
    };
  }
}

export async function getPortfolioCorrelationExposure(portfolioId: string): Promise<Record<CorrelationGroup, {
  positions: number;
  dollarValue: number;
  symbols: string[];
}>> {
  const exposure: Record<CorrelationGroup, { positions: number; dollarValue: number; symbols: string[] }> = {
    mega_tech: { positions: 0, dollarValue: 0, symbols: [] },
    semiconductor: { positions: 0, dollarValue: 0, symbols: [] },
    ev_clean: { positions: 0, dollarValue: 0, symbols: [] },
    fintech: { positions: 0, dollarValue: 0, symbols: [] },
    biotech: { positions: 0, dollarValue: 0, symbols: [] },
    retail: { positions: 0, dollarValue: 0, symbols: [] },
    energy: { positions: 0, dollarValue: 0, symbols: [] },
    crypto: { positions: 0, dollarValue: 0, symbols: [] },
    meme: { positions: 0, dollarValue: 0, symbols: [] },
    index: { positions: 0, dollarValue: 0, symbols: [] },
    other: { positions: 0, dollarValue: 0, symbols: [] }
  };
  
  try {
    const positions = await storage.getPaperPositionsByPortfolio(portfolioId);
    const openPositions = positions.filter(p => p.status === 'open');
    
    for (const pos of openPositions) {
      const group = getCorrelationGroup(pos.symbol);
      exposure[group].positions++;
      exposure[group].dollarValue += Math.abs(pos.quantity * pos.entryPrice);
      if (!exposure[group].symbols.includes(pos.symbol)) {
        exposure[group].symbols.push(pos.symbol);
      }
    }
  } catch (error: any) {
    logger.error(`[CORRELATION-CAPS] Error getting exposure: ${error.message}`);
  }
  
  return exposure;
}

export function isHighlyCorrelated(symbol1: string, symbol2: string): boolean {
  const group1 = getCorrelationGroup(symbol1);
  const group2 = getCorrelationGroup(symbol2);
  
  if (group1 === 'other' || group2 === 'other') {
    return false;
  }
  
  return group1 === group2;
}

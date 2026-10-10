/**
 * Multi-Broker Integration Service
 *
 * Supports multiple brokers for position analysis:
 * - Tradier (API)
 * - Webull (CSV import)
 * - Robinhood (CSV import)
 * - TD Ameritrade (future)
 * - Any broker (manual CSV)
 *
 * NOTE: Webull and Robinhood don't have official APIs.
 * We support CSV import from their export feature.
 */

import { logger } from './logger';
import {
  getTradierUserProfile,
  getTradierBalances,
  getTradierPositions,
  analyzePortfolioPositions,
  getBrokerStatus as getTradierStatus,
  type PositionAnalysis,
} from './tradier-api';
import { getTradierQuote, getOptionQuote, parseOptionSymbol } from './tradier-api';

// Supported brokers
export type BrokerType = 'tradier' | 'webull' | 'robinhood' | 'manual' | 'td_ameritrade' | 'schwab' | 'fidelity';

export interface BrokerConfig {
  type: BrokerType;
  name: string;
  hasApi: boolean;
  csvImport: boolean;
  instructions: string;
}

export const SUPPORTED_BROKERS: BrokerConfig[] = [
  {
    type: 'tradier',
    name: 'Tradier',
    hasApi: true,
    csvImport: false,
    instructions: 'Connect via API key from Tradier dashboard',
  },
  {
    type: 'webull',
    name: 'Webull',
    hasApi: false,
    csvImport: true,
    instructions: 'Export positions from Webull app: Menu > More > Statements & History > Export',
  },
  {
    type: 'robinhood',
    name: 'Robinhood',
    hasApi: false,
    csvImport: true,
    instructions: 'Export positions from Robinhood: Account > Statements > Download CSV',
  },
  {
    type: 'td_ameritrade',
    name: 'TD Ameritrade / Schwab',
    hasApi: false, // API deprecated after Schwab merger
    csvImport: true,
    instructions: 'Export from Schwab: Accounts > Positions > Export to CSV',
  },
  {
    type: 'fidelity',
    name: 'Fidelity',
    hasApi: false,
    csvImport: true,
    instructions: 'Export from Fidelity: Positions > Download',
  },
  {
    type: 'manual',
    name: 'Manual Entry',
    hasApi: false,
    csvImport: true,
    instructions: 'Upload CSV with columns: symbol, quantity, cost_basis',
  },
];

// Unified position interface
export interface UnifiedPosition {
  symbol: string;
  quantity: number;
  costBasis: number;
  currentPrice?: number;
  currentValue?: number;
  unrealizedPL?: number;
  unrealizedPLPercent?: number;
  broker: BrokerType;
  isOption: boolean;
  optionDetails?: {
    underlying: string;
    optionType: 'call' | 'put';
    strike: number;
    expiry: string;
    daysToExpiry: number;
  };
  dateAcquired?: string;
}

export interface UnifiedPortfolio {
  broker: BrokerType;
  brokerName: string;
  accountId?: string;
  positions: UnifiedPosition[];
  totalValue: number;
  totalCost: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  cashBalance?: number;
  buyingPower?: number;
  lastUpdated: string;
}

// In-memory storage for imported positions (per user session)
// In production, this would be stored in database with user association
const importedPositions = new Map<string, UnifiedPosition[]>();

/** Persist positions for a session (used by CSV and screenshot import paths). */
export function storeSessionPositions(sessionId: string, positions: UnifiedPosition[]): void {
  importedPositions.set(sessionId, positions);
}

/**
 * Parse Webull CSV export
 * Webull format: Symbol, Description, Quantity, Avg Cost, Market Value, etc.
 */
export function parseWebullCSV(csvContent: string): UnifiedPosition[] {
  const positions: UnifiedPosition[] = [];
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) return positions;

  // Find header line and column indices
  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(',').map(h => h.trim());

  const symbolIdx = headers.findIndex(h => h.includes('symbol') || h.includes('ticker'));
  const qtyIdx = headers.findIndex(h => h.includes('quantity') || h.includes('qty') || h.includes('shares'));
  const costIdx = headers.findIndex(h => h.includes('cost') || h.includes('avg'));
  const valueIdx = headers.findIndex(h => h.includes('value') || h.includes('market'));

  if (symbolIdx === -1 || qtyIdx === -1) {
    logger.warn('[BROKER] Webull CSV missing required columns');
    return positions;
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/["\$]/g, ''));

    if (cols.length <= symbolIdx) continue;

    const symbol = cols[symbolIdx].toUpperCase();
    const quantity = parseFloat(cols[qtyIdx]) || 0;
    const costBasis = parseFloat(cols[costIdx]) || 0;
    const currentValue = valueIdx >= 0 ? parseFloat(cols[valueIdx]) || 0 : undefined;

    if (!symbol || quantity === 0) continue;

    // Detect if option (Webull option symbols include expiry date)
    const isOption = symbol.length > 6 && /\d{6}[CP]\d/.test(symbol);
    let optionDetails: UnifiedPosition['optionDetails'];

    if (isOption) {
      const parsed = parseOptionSymbol(symbol);
      if (parsed) {
        optionDetails = {
          underlying: parsed.underlying,
          optionType: parsed.optionType,
          strike: parsed.strike,
          expiry: parsed.expiry,
          daysToExpiry: Math.ceil((new Date(parsed.expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        };
      }
    }

    positions.push({
      symbol,
      quantity,
      costBasis: costBasis * Math.abs(quantity) * (isOption ? 100 : 1),
      currentValue,
      broker: 'webull',
      isOption,
      optionDetails,
    });
  }

  logger.info(`[BROKER] Parsed ${positions.length} positions from Webull CSV`);
  return positions;
}

/**
 * Parse Robinhood CSV export
 * Robinhood format varies but typically: Instrument, Quantity, Average Cost, etc.
 */
export function parseRobinhoodCSV(csvContent: string): UnifiedPosition[] {
  const positions: UnifiedPosition[] = [];
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) return positions;

  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(',').map(h => h.trim());

  // Robinhood uses various column names
  const symbolIdx = headers.findIndex(h =>
    h.includes('symbol') || h.includes('instrument') || h.includes('ticker')
  );
  const qtyIdx = headers.findIndex(h =>
    h.includes('quantity') || h.includes('shares') || h.includes('qty')
  );
  const costIdx = headers.findIndex(h =>
    h.includes('average') || h.includes('cost') || h.includes('price')
  );

  if (symbolIdx === -1 || qtyIdx === -1) {
    logger.warn('[BROKER] Robinhood CSV missing required columns');
    return positions;
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/["\$]/g, ''));

    if (cols.length <= symbolIdx) continue;

    const symbol = cols[symbolIdx].toUpperCase();
    const quantity = parseFloat(cols[qtyIdx]) || 0;
    const avgCost = costIdx >= 0 ? parseFloat(cols[costIdx]) || 0 : 0;

    if (!symbol || quantity === 0) continue;

    // Robinhood option format is different
    const isOption = symbol.includes(' ') || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(symbol);

    positions.push({
      symbol: isOption ? symbol.split(' ')[0] : symbol,
      quantity,
      costBasis: avgCost * Math.abs(quantity) * (isOption ? 100 : 1),
      broker: 'robinhood',
      isOption,
    });
  }

  logger.info(`[BROKER] Parsed ${positions.length} positions from Robinhood CSV`);
  return positions;
}

/**
 * Parse generic/manual CSV
 * Expected format: symbol, quantity, cost_basis (or avg_cost)
 */
export function parseGenericCSV(csvContent: string): UnifiedPosition[] {
  const positions: UnifiedPosition[] = [];
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) return positions;

  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(',').map(h => h.trim());

  const symbolIdx = headers.findIndex(h => h.includes('symbol') || h.includes('ticker'));
  const qtyIdx = headers.findIndex(h => h.includes('quantity') || h.includes('qty') || h.includes('shares'));
  const costIdx = headers.findIndex(h => h.includes('cost') || h.includes('basis') || h.includes('price'));

  // Default to first 3 columns if headers not found
  const sIdx = symbolIdx >= 0 ? symbolIdx : 0;
  const qIdx = qtyIdx >= 0 ? qtyIdx : 1;
  const cIdx = costIdx >= 0 ? costIdx : 2;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/["\$]/g, ''));

    if (cols.length < 2) continue;

    const symbol = cols[sIdx]?.toUpperCase();
    const quantity = parseFloat(cols[qIdx]) || 0;
    const costBasis = cols[cIdx] ? parseFloat(cols[cIdx]) || 0 : 0;

    if (!symbol || quantity === 0) continue;

    const isOption = symbol.length > 6 && /\d{6}[CP]\d/.test(symbol);

    positions.push({
      symbol,
      quantity,
      costBasis,
      broker: 'manual',
      isOption,
    });
  }

  logger.info(`[BROKER] Parsed ${positions.length} positions from generic CSV`);
  return positions;
}

/**
 * Import positions from CSV based on broker type
 */
export function importPositionsFromCSV(
  csvContent: string,
  brokerType: BrokerType,
  sessionId: string
): { success: boolean; positions: UnifiedPosition[]; error?: string } {
  try {
    let positions: UnifiedPosition[];

    switch (brokerType) {
      case 'webull':
        positions = parseWebullCSV(csvContent);
        break;
      case 'robinhood':
        positions = parseRobinhoodCSV(csvContent);
        break;
      default:
        positions = parseGenericCSV(csvContent);
        break;
    }

    if (positions.length === 0) {
      return {
        success: false,
        positions: [],
        error: 'No valid positions found in CSV. Check format and try again.',
      };
    }

    // Store for this session
    importedPositions.set(sessionId, positions);

    return { success: true, positions };
  } catch (error) {
    logger.error('[BROKER] CSV import error:', error);
    return {
      success: false,
      positions: [],
      error: 'Failed to parse CSV file',
    };
  }
}

/**
 * Enrich positions with current market data
 */
export async function enrichPositionsWithMarketData(
  positions: UnifiedPosition[]
): Promise<UnifiedPosition[]> {
  const enriched: UnifiedPosition[] = [];

  for (const pos of positions) {
    let currentPrice = 0;

    if (pos.isOption && pos.optionDetails) {
      // Get option quote
      const optQuote = await getOptionQuote({ occSymbol: pos.symbol });
      if (optQuote) {
        currentPrice = optQuote.last || optQuote.mid;
      }
    } else {
      // Get stock quote
      const quote = await getTradierQuote(pos.symbol);
      if (quote) {
        currentPrice = quote.last;
      }
    }

    const multiplier = pos.isOption ? 100 : 1;
    const currentValue = currentPrice * pos.quantity * multiplier;
    const unrealizedPL = currentValue - pos.costBasis;
    const unrealizedPLPercent = pos.costBasis > 0 ? (unrealizedPL / pos.costBasis) * 100 : 0;

    enriched.push({
      ...pos,
      currentPrice,
      currentValue,
      unrealizedPL,
      unrealizedPLPercent,
    });
  }

  return enriched;
}

/**
 * Get unified portfolio from any broker
 */
export async function getUnifiedPortfolio(
  brokerType: BrokerType,
  accountIdOrSessionId: string,
  apiKey?: string
): Promise<UnifiedPortfolio | null> {
  const brokerConfig = SUPPORTED_BROKERS.find(b => b.type === brokerType);

  if (!brokerConfig) {
    logger.error(`[BROKER] Unknown broker type: ${brokerType}`);
    return null;
  }

  let positions: UnifiedPosition[] = [];
  let cashBalance: number | undefined;
  let buyingPower: number | undefined;

  if (brokerType === 'tradier' && brokerConfig.hasApi) {
    // Use Tradier API
    const tradierPositions = await getTradierPositions(accountIdOrSessionId, apiKey);
    const balances = await getTradierBalances(accountIdOrSessionId, apiKey);

    positions = tradierPositions.map(p => ({
      symbol: p.symbol,
      quantity: p.quantity,
      costBasis: p.costBasis,
      broker: 'tradier' as BrokerType,
      isOption: p.symbol.length > 6 && /\d{6}[CP]\d{8}$/.test(p.symbol),
      dateAcquired: p.dateAcquired,
    }));

    cashBalance = balances?.totalCash;
    buyingPower = balances?.buyingPower;
  } else {
    // Use imported positions
    positions = importedPositions.get(accountIdOrSessionId) || [];
  }

  if (positions.length === 0) {
    return null;
  }

  // Enrich with market data
  const enrichedPositions = await enrichPositionsWithMarketData(positions);

  // Calculate totals
  const totalValue = enrichedPositions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
  const totalCost = enrichedPositions.reduce((sum, p) => sum + p.costBasis, 0);
  const unrealizedPL = totalValue - totalCost;
  const unrealizedPLPercent = totalCost > 0 ? (unrealizedPL / totalCost) * 100 : 0;

  return {
    broker: brokerType,
    brokerName: brokerConfig.name,
    accountId: accountIdOrSessionId,
    positions: enrichedPositions,
    totalValue,
    totalCost,
    unrealizedPL,
    unrealizedPLPercent,
    cashBalance,
    buyingPower,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Analyze portfolio and provide insights
 */
export async function analyzeUnifiedPortfolio(portfolio: UnifiedPortfolio): Promise<{
  portfolio: UnifiedPortfolio;
  insights: {
    riskScore: number;
    topRisks: string[];
    suggestions: string[];
    optionsExpiringThisWeek: number;
    biggestWinner: { symbol: string; plPercent: number } | null;
    biggestLoser: { symbol: string; plPercent: number } | null;
  };
}> {
  const risks: string[] = [];
  const suggestions: string[] = [];
  let optionsExpiringThisWeek = 0;
  let biggestWinner: { symbol: string; plPercent: number } | null = null;
  let biggestLoser: { symbol: string; plPercent: number } | null = null;

  for (const pos of portfolio.positions) {
    const plPercent = pos.unrealizedPLPercent || 0;

    // Track biggest winner/loser
    if (!biggestWinner || plPercent > biggestWinner.plPercent) {
      biggestWinner = { symbol: pos.symbol, plPercent };
    }
    if (!biggestLoser || plPercent < biggestLoser.plPercent) {
      biggestLoser = { symbol: pos.symbol, plPercent };
    }

    // Check options expiring soon
    if (pos.isOption && pos.optionDetails) {
      const dte = pos.optionDetails.daysToExpiry;
      if (dte <= 7) {
        optionsExpiringThisWeek++;
        if (dte <= 1) {
          risks.push(`CRITICAL: ${pos.optionDetails.underlying} ${pos.optionDetails.optionType.toUpperCase()} expires TODAY/TOMORROW`);
        } else if (dte <= 3) {
          risks.push(`${pos.optionDetails.underlying} option expires in ${dte} days`);
        }
      }
    }

    // Check big losses
    if (plPercent < -30) {
      risks.push(`${pos.symbol} down ${Math.abs(plPercent).toFixed(0)}% - evaluate exit`);
    }

    // Check big winners
    if (plPercent > 50) {
      suggestions.push(`Consider taking profits on ${pos.symbol} (+${plPercent.toFixed(0)}%)`);
    }
  }

  // Portfolio-level insights
  const optionsCount = portfolio.positions.filter(p => p.isOption).length;
  const stocksCount = portfolio.positions.length - optionsCount;

  if (optionsCount > stocksCount * 2) {
    suggestions.push('Portfolio is options-heavy - consider adding stock positions for stability');
  }

  if (portfolio.unrealizedPLPercent < -20) {
    risks.push(`Portfolio overall down ${Math.abs(portfolio.unrealizedPLPercent).toFixed(1)}%`);
  }

  // Calculate risk score
  const criticalCount = risks.filter(r => r.includes('CRITICAL')).length;
  const riskScore = Math.min(100, criticalCount * 30 + risks.length * 10 + (optionsExpiringThisWeek * 5));

  return {
    portfolio,
    insights: {
      riskScore,
      topRisks: risks.slice(0, 5),
      suggestions: suggestions.slice(0, 5),
      optionsExpiringThisWeek,
      biggestWinner: biggestWinner?.plPercent !== 0 ? biggestWinner : null,
      biggestLoser: biggestLoser?.plPercent !== 0 ? biggestLoser : null,
    },
  };
}

/**
 * Get broker connection status
 */
export async function getBrokerConnectionStatus(
  brokerType: BrokerType,
  accountIdOrApiKey?: string
): Promise<{
  connected: boolean;
  broker: BrokerType;
  brokerName: string;
  hasApi: boolean;
  positionCount?: number;
  lastUpdated?: string;
}> {
  const brokerConfig = SUPPORTED_BROKERS.find(b => b.type === brokerType);

  if (!brokerConfig) {
    return {
      connected: false,
      broker: brokerType,
      brokerName: 'Unknown',
      hasApi: false,
    };
  }

  if (brokerType === 'tradier' && brokerConfig.hasApi && accountIdOrApiKey) {
    const status = await getTradierStatus(accountIdOrApiKey);
    return {
      connected: status?.connected || false,
      broker: brokerType,
      brokerName: brokerConfig.name,
      hasApi: true,
      positionCount: status?.positionCount,
    };
  }

  // For CSV-based brokers, check if we have imported positions
  const sessionPositions = importedPositions.get(accountIdOrApiKey || '');
  return {
    connected: (sessionPositions?.length || 0) > 0,
    broker: brokerType,
    brokerName: brokerConfig.name,
    hasApi: false,
    positionCount: sessionPositions?.length,
    lastUpdated: sessionPositions?.length ? new Date().toISOString() : undefined,
  };
}

/**
 * Clear imported positions for a session
 */
export function clearImportedPositions(sessionId: string): void {
  importedPositions.delete(sessionId);
  logger.info(`[BROKER] Cleared imported positions for session ${sessionId}`);
}

/**
 * Get sample CSV template for manual import
 */
export function getCSVTemplate(): string {
  return `symbol,quantity,cost_basis
AAPL,100,17500.00
TSLA,50,12500.00
NVDA250117C00150000,10,3500.00`;
}

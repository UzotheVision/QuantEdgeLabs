/**
 * Alpaca Trading Integration
 *
 * Connects to Alpaca API for paper/live trading
 * Executes trades based on Trade Desk signals
 */

import { logger } from './logger';

// Alpaca API Configuration - use getters to read env at runtime (after dotenv loads)
function getAlpacaApiKey(): string {
  return process.env.ALPACA_API_KEY || '';
}

function getAlpacaSecretKey(): string {
  return process.env.ALPACA_SECRET_KEY || '';
}

function isPaperMode(): boolean {
  return process.env.ALPACA_PAPER !== 'false';
}

const ALPACA_URLS = {
  paperBaseUrl: 'https://paper-api.alpaca.markets',
  liveBaseUrl: 'https://api.alpaca.markets',
  dataBaseUrl: 'https://data.alpaca.markets',
};

// Types
export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  transfers_blocked: boolean;
  account_blocked: boolean;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  daytrading_buying_power: string;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  qty: string;
  filled_qty: string;
  type: string;
  side: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  filled_avg_price: string | null;
  status: string;
  extended_hours: boolean;
  legs: any[] | null;
}

export interface TradeRequest {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
  extended_hours?: boolean;
  client_order_id?: string;
  // For options
  option_symbol?: string;
}

// API Helper
async function alpacaRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH' = 'GET',
  body?: any
): Promise<T | null> {
  const baseUrl = isPaperMode()
    ? ALPACA_URLS.paperBaseUrl
    : ALPACA_URLS.liveBaseUrl;

  const url = `${baseUrl}${endpoint}`;
  const apiKey = getAlpacaApiKey();
  const secretKey = getAlpacaSecretKey();

  if (!apiKey || !secretKey) {
    logger.error('[ALPACA] API keys not configured');
    return null;
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`[ALPACA] API error: ${response.status} - ${error}`);
      return null;
    }

    return await response.json() as T;
  } catch (error) {
    logger.error('[ALPACA] Request failed:', error);
    return null;
  }
}

// ============================================
// ACCOUNT & POSITIONS
// ============================================

export async function getAccount(): Promise<AlpacaAccount | null> {
  return alpacaRequest<AlpacaAccount>('/v2/account');
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  const positions = await alpacaRequest<AlpacaPosition[]>('/v2/positions');
  return positions || [];
}

export async function getPosition(symbol: string): Promise<AlpacaPosition | null> {
  return alpacaRequest<AlpacaPosition>(`/v2/positions/${symbol}`);
}

export async function closePosition(symbol: string): Promise<AlpacaOrder | null> {
  return alpacaRequest<AlpacaOrder>(`/v2/positions/${symbol}`, 'DELETE');
}

export async function closeAllPositions(): Promise<AlpacaOrder[]> {
  const result = await alpacaRequest<AlpacaOrder[]>('/v2/positions', 'DELETE');
  return result || [];
}

// ============================================
// ORDERS
// ============================================

export async function submitOrder(request: TradeRequest): Promise<AlpacaOrder | null> {
  const orderPayload = {
    symbol: request.symbol,
    qty: request.qty.toString(),
    side: request.side,
    type: request.type,
    time_in_force: request.time_in_force,
    limit_price: request.limit_price?.toString(),
    stop_price: request.stop_price?.toString(),
    extended_hours: request.extended_hours,
    client_order_id: request.client_order_id,
  };

  logger.info(`[ALPACA] Submitting order: ${request.side} ${request.qty} ${request.symbol} @ ${request.type}`);

  const order = await alpacaRequest<AlpacaOrder>('/v2/orders', 'POST', orderPayload);

  if (order) {
    logger.info(`[ALPACA] Order submitted: ${order.id} - ${order.status}`);
  }

  return order;
}

export async function getOrders(status: 'open' | 'closed' | 'all' = 'open'): Promise<AlpacaOrder[]> {
  const orders = await alpacaRequest<AlpacaOrder[]>(`/v2/orders?status=${status}`);
  return orders || [];
}

export async function getOrder(orderId: string): Promise<AlpacaOrder | null> {
  return alpacaRequest<AlpacaOrder>(`/v2/orders/${orderId}`);
}

export async function cancelOrder(orderId: string): Promise<boolean> {
  const result = await alpacaRequest<any>(`/v2/orders/${orderId}`, 'DELETE');
  return result !== null;
}

export async function cancelAllOrders(): Promise<boolean> {
  const result = await alpacaRequest<any>('/v2/orders', 'DELETE');
  return result !== null;
}

// ============================================
// BRACKET ORDERS (Entry + Stop Loss + Take Profit)
// ============================================

export interface BracketOrderRequest {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  entryType: 'market' | 'limit';
  entryPrice?: number;
  stopLoss: number;
  takeProfit: number;
  timeInForce?: 'day' | 'gtc';
}

export async function submitBracketOrder(request: BracketOrderRequest): Promise<AlpacaOrder | null> {
  const orderPayload = {
    symbol: request.symbol,
    qty: request.qty.toString(),
    side: request.side,
    type: request.entryType,
    time_in_force: request.timeInForce || 'day',
    limit_price: request.entryPrice?.toString(),
    order_class: 'bracket',
    take_profit: {
      limit_price: request.takeProfit.toString(),
    },
    stop_loss: {
      stop_price: request.stopLoss.toString(),
    },
  };

  logger.info(`[ALPACA] Submitting bracket order: ${request.side} ${request.qty} ${request.symbol}`);
  logger.info(`[ALPACA]   Entry: ${request.entryType} @ ${request.entryPrice || 'market'}`);
  logger.info(`[ALPACA]   Stop: ${request.stopLoss} | Target: ${request.takeProfit}`);

  const order = await alpacaRequest<AlpacaOrder>('/v2/orders', 'POST', orderPayload);

  if (order) {
    logger.info(`[ALPACA] Bracket order submitted: ${order.id}`);
  }

  return order;
}

// ============================================
// MARKET DATA
// ============================================

export async function getLatestQuote(symbol: string): Promise<{ ask: number; bid: number; last: number } | null> {
  try {
    const response = await fetch(`${ALPACA_URLS.dataBaseUrl}/v2/stocks/${symbol}/quotes/latest`, {
      headers: {
        'APCA-API-KEY-ID': getAlpacaApiKey(),
        'APCA-API-SECRET-KEY': getAlpacaSecretKey(),
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      ask: data.quote?.ap || 0,
      bid: data.quote?.bp || 0,
      last: (data.quote?.ap + data.quote?.bp) / 2 || 0,
    };
  } catch (error) {
    logger.error(`[ALPACA] Quote error for ${symbol}:`, error);
    return null;
  }
}

// ============================================
// TRADING STATUS
// ============================================

export async function isMarketOpen(): Promise<boolean> {
  try {
    const response = await fetch(`${ALPACA_URLS.paperBaseUrl}/v2/clock`, {
      headers: {
        'APCA-API-KEY-ID': getAlpacaApiKey(),
        'APCA-API-SECRET-KEY': getAlpacaSecretKey(),
      },
    });

    if (!response.ok) return false;

    const data = await response.json();
    return data.is_open === true;
  } catch (error) {
    return false;
  }
}

export async function getTradingStatus(): Promise<{
  isOpen: boolean;
  nextOpen: string;
  nextClose: string;
} | null> {
  try {
    const response = await fetch(`${ALPACA_URLS.paperBaseUrl}/v2/clock`, {
      headers: {
        'APCA-API-KEY-ID': getAlpacaApiKey(),
        'APCA-API-SECRET-KEY': getAlpacaSecretKey(),
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      isOpen: data.is_open,
      nextOpen: data.next_open,
      nextClose: data.next_close,
    };
  } catch (error) {
    return null;
  }
}

// ============================================
// INITIALIZATION
// ============================================

export function isAlpacaConfigured(): boolean {
  const apiKey = getAlpacaApiKey();
  const secretKey = getAlpacaSecretKey();
  return !!(apiKey && secretKey);
}

export async function initializeAlpaca(): Promise<boolean> {
  if (!isAlpacaConfigured()) {
    logger.warn('[ALPACA] API keys not configured');
    logger.warn(`[ALPACA] ALPACA_API_KEY: ${getAlpacaApiKey() ? 'set' : 'NOT SET'}`);
    logger.warn(`[ALPACA] ALPACA_SECRET_KEY: ${getAlpacaSecretKey() ? 'set' : 'NOT SET'}`);
    return false;
  }

  const account = await getAccount();
  if (!account) {
    logger.error('[ALPACA] Failed to connect to Alpaca');
    return false;
  }

  logger.info(`[ALPACA] ✅ Connected to Alpaca ${isPaperMode() ? '(PAPER)' : '(LIVE)'}`);
  logger.info(`[ALPACA]    Account: ${account.account_number}`);
  logger.info(`[ALPACA]    Buying Power: $${parseFloat(account.buying_power).toFixed(2)}`);
  logger.info(`[ALPACA]    Portfolio Value: $${parseFloat(account.portfolio_value).toFixed(2)}`);

  return true;
}

// Export config for other modules
export function getAlpacaConfig() {
  return {
    isPaper: isPaperMode(),
    isConfigured: isAlpacaConfigured(),
  };
}

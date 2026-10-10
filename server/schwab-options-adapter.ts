/**
 * Schwab Developer API — Options Adapter
 * ========================================
 * FREE REAL-TIME options chains for anyone with a Schwab brokerage account.
 *
 * Setup:
 *   1. Sign up at https://developer.schwab.com
 *   2. Create an app, enable Market Data Production API
 *   3. Set callback URL to http://localhost (for dev) or your domain
 *   4. Run OAuth2 auth code flow ONCE to get refresh_token
 *   5. Store these env vars:
 *        SCHWAB_APP_KEY=your_app_key
 *        SCHWAB_APP_SECRET=your_app_secret
 *        SCHWAB_REFRESH_TOKEN=the_refresh_token_from_step_4
 *
 * The adapter auto-refreshes access tokens (30 min expiry).
 * Refresh tokens last 7 days — re-auth manually after that.
 *
 * Returns data in TradierOption-compatible shape so existing code works unchanged.
 */

import { logger } from './logger';

// ─── Config ─────────────────────────────────────────────────

const SCHWAB_API_BASE = 'https://api.schwabapi.com';
const SCHWAB_MARKET_DATA = `${SCHWAB_API_BASE}/marketdata/v1`;
const SCHWAB_AUTH = `${SCHWAB_API_BASE}/v1/oauth/token`;

// ─── Token Cache ────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

export function isSchwabConfigured(): boolean {
  return !!(
    process.env.SCHWAB_APP_KEY &&
    process.env.SCHWAB_APP_SECRET &&
    process.env.SCHWAB_REFRESH_TOKEN
  );
}

async function getAccessToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const appKey = process.env.SCHWAB_APP_KEY;
  const appSecret = process.env.SCHWAB_APP_SECRET;
  const refreshToken = process.env.SCHWAB_REFRESH_TOKEN;

  if (!appKey || !appSecret || !refreshToken) {
    return null;
  }

  try {
    const basicAuth = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const response = await fetch(SCHWAB_AUTH, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`[SCHWAB] Token refresh failed: ${response.status} ${errText}`);
      return null;
    }

    const data = await response.json();
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 1800) * 1000,
    };
    logger.info(`[SCHWAB] Token refreshed, expires in ${data.expires_in}s`);
    return tokenCache.accessToken;
  } catch (e: any) {
    logger.error(`[SCHWAB] Token refresh error: ${e.message}`);
    return null;
  }
}

// ─── Types ──────────────────────────────────────────────────

interface SchwabOption {
  putCall: 'CALL' | 'PUT';
  symbol: string;
  description: string;
  bid: number;
  ask: number;
  last: number;
  mark: number;
  bidSize: number;
  askSize: number;
  lastSize: number;
  highPrice: number;
  lowPrice: number;
  openPrice: number;
  closePrice: number;
  totalVolume: number;
  tradeTimeInLong: number;
  quoteTimeInLong: number;
  netChange: number;
  volatility: number;     // IV in percent (e.g. 25.0)
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  openInterest: number;
  timeValue: number;
  theoreticalOptionValue: number;
  theoreticalVolatility: number;
  strikePrice: number;
  expirationDate: string;
  daysToExpiration: number;
  expirationType: string;
  lastTradingDay: number;
  multiplier: number;
  inTheMoney: boolean;
}

interface TradierCompatOption {
  symbol: string;
  description: string;
  exch: string;
  type: string;
  last: number;
  change: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bid: number;
  ask: number;
  underlying: string;
  strike: number;
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
    phi: number;
    bid_iv: number;
    mid_iv: number;
    ask_iv: number;
    smv_vol: number;
    updated_at: string;
  };
  change_percentage: number;
  average_volume: number;
  last_volume: number;
  trade_date: number;
  prevclose: number;
  week_52_high: number;
  week_52_low: number;
  bidsize: number;
  bidexch: string;
  bid_date: number;
  asksize: number;
  askexch: string;
  ask_date: number;
  open_interest: number;
  contract_size: number;
  expiration_date: string;
  expiration_type: string;
  option_type: string;
  root_symbol: string;
}

// ─── Quote API ──────────────────────────────────────────────

export async function getSchwabQuote(symbol: string): Promise<{ last: number; bid: number; ask: number; prevClose: number } | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const response = await fetch(`${SCHWAB_MARKET_DATA}/quotes?symbols=${encodeURIComponent(symbol)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });

    if (!response.ok) {
      logger.warn(`[SCHWAB] Quote ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();
    const q = data[symbol]?.quote || data[symbol];
    if (!q) return null;

    return {
      last: q.lastPrice || q.mark || 0,
      bid: q.bidPrice || 0,
      ask: q.askPrice || 0,
      prevClose: q.closePrice || 0,
    };
  } catch (e: any) {
    logger.error(`[SCHWAB] Quote error for ${symbol}: ${e.message}`);
    return null;
  }
}

// ─── Options Chain ──────────────────────────────────────────

export async function getSchwabOptionsChain(
  symbol: string,
  expiration?: string,
): Promise<TradierCompatOption[]> {
  const token = await getAccessToken();
  if (!token) return [];

  try {
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      contractType: 'ALL',
      includeUnderlyingQuote: 'true',
      strategy: 'SINGLE',
    });

    // If expiration given, filter to that date range (inclusive)
    if (expiration) {
      params.set('fromDate', expiration);
      params.set('toDate', expiration);
    }

    const response = await fetch(`${SCHWAB_MARKET_DATA}/chains?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });

    if (!response.ok) {
      logger.warn(`[SCHWAB] Chain ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    if (data.status === 'FAILED') {
      logger.warn(`[SCHWAB] Chain failed for ${symbol}: ${data.errorMsg || 'unknown'}`);
      return [];
    }

    const results: TradierCompatOption[] = [];
    const spotPrice = data.underlyingPrice || data.underlying?.last || 0;

    // Walk callExpDateMap and putExpDateMap
    const processMap = (map: any, type: 'call' | 'put') => {
      for (const expKey of Object.keys(map || {})) {
        // expKey format: "2026-04-17:7" (date : DTE)
        const expDate = expKey.split(':')[0];
        const strikes = map[expKey];
        for (const strikeKey of Object.keys(strikes)) {
          const contracts: SchwabOption[] = strikes[strikeKey];
          for (const c of contracts) {
            results.push(schwabToTradier(c, type, symbol, expDate));
          }
        }
      }
    };

    processMap(data.callExpDateMap, 'call');
    processMap(data.putExpDateMap, 'put');

    const withOI = results.filter(r => r.open_interest > 0).length;
    logger.info(`[SCHWAB] ${symbol}: ${results.length} options (${withOI} w/OI), spot=$${spotPrice.toFixed(2)}`);
    return results;
  } catch (e: any) {
    logger.error(`[SCHWAB] Chain error for ${symbol}: ${e.message}`);
    return [];
  }
}

// ─── Expirations ────────────────────────────────────────────

export async function getSchwabExpirations(symbol: string): Promise<string[]> {
  const token = await getAccessToken();
  if (!token) return [];

  try {
    const response = await fetch(
      `${SCHWAB_MARKET_DATA}/expirationchain?symbol=${encodeURIComponent(symbol)}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } },
    );

    if (!response.ok) {
      logger.warn(`[SCHWAB] Expirations ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const list: Array<{ expirationDate: string }> = data.expirationList || [];
    return list.map((e) => e.expirationDate).filter(Boolean);
  } catch (e: any) {
    logger.error(`[SCHWAB] Expirations error for ${symbol}: ${e.message}`);
    return [];
  }
}

// ─── Conversion ─────────────────────────────────────────────

function schwabToTradier(
  c: SchwabOption,
  type: 'call' | 'put',
  underlying: string,
  expDateStr: string,
): TradierCompatOption {
  // Schwab IV comes in percent (e.g. 25.0 = 25%), normalize to decimal
  const iv = (c.volatility || 0) / 100;
  return {
    symbol: c.symbol,
    description: c.description,
    exch: 'SCHWAB',
    type,
    last: c.last || c.mark || 0,
    change: c.netChange || 0,
    volume: c.totalVolume || 0,
    open: c.openPrice || 0,
    high: c.highPrice || 0,
    low: c.lowPrice || 0,
    close: c.closePrice || 0,
    bid: c.bid || 0,
    ask: c.ask || 0,
    underlying,
    strike: c.strikePrice,
    greeks: {
      delta: c.delta || 0,
      gamma: c.gamma || 0,
      theta: c.theta || 0,
      vega: c.vega || 0,
      rho: c.rho || 0,
      phi: 0,
      bid_iv: iv,
      mid_iv: iv,
      ask_iv: iv,
      smv_vol: iv,
      updated_at: new Date(c.quoteTimeInLong || Date.now()).toISOString(),
    },
    change_percentage: 0,
    average_volume: c.totalVolume || 0,
    last_volume: c.lastSize || 0,
    trade_date: c.tradeTimeInLong || Date.now(),
    prevclose: c.closePrice || 0,
    week_52_high: 0,
    week_52_low: 0,
    bidsize: c.bidSize || 0,
    bidexch: '',
    bid_date: c.quoteTimeInLong || Date.now(),
    asksize: c.askSize || 0,
    askexch: '',
    ask_date: c.quoteTimeInLong || Date.now(),
    open_interest: c.openInterest || 0,
    contract_size: c.multiplier || 100,
    expiration_date: expDateStr,
    expiration_type: c.expirationType || 'standard',
    option_type: type,
    root_symbol: underlying,
  };
}

// ─── Init log ───────────────────────────────────────────────

if (isSchwabConfigured()) {
  logger.info('[SCHWAB] Real-time options adapter loaded (configured)');
} else {
  logger.info('[SCHWAB] Adapter loaded (NOT configured — set SCHWAB_APP_KEY/SECRET/REFRESH_TOKEN to enable)');
}

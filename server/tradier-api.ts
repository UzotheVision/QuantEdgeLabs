// Tradier API integration for real-time market data and options chains
// Replaces rate-limited Alpha Vantage with unlimited Tradier access

import { logger } from './logger';
import { logAPIError, logAPISuccess } from './monitoring-service';

interface TradierQuote {
  symbol: string;
  description: string;
  exch: string;
  type: string;
  last: number;
  change: number;
  change_percentage: number;
  volume: number;
  average_volume: number;
  last_volume: number;
  trade_date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  prevclose: number;
  week_52_high: number;
  week_52_low: number;
  bid: number;
  bidsize: number;
  bidexch: string;
  bid_date: number;
  ask: number;
  asksize: number;
  askexch: string;
  ask_date: number;
  root_symbols?: string;
}

interface TradierHistoricalDay {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradierOption {
  symbol: string;
  description: string;
  exch: string;
  type: string; // "call" | "put"
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

const TRADIER_API_BASE = 'https://api.tradier.com/v1';
const TRADIER_SANDBOX_BASE = 'https://sandbox.tradier.com/v1';

// Detect if using sandbox (paper trading) based on API key format
function isSandboxKey(apiKey: string): boolean {
  // Sandbox keys typically start with specific prefixes or can be detected
  // For now, we'll check environment variable or key format
  return process.env.TRADIER_USE_SANDBOX === 'true';
}

function getBaseUrl(apiKey: string): string {
  return isSandboxKey(apiKey) ? TRADIER_SANDBOX_BASE : TRADIER_API_BASE;
}

/**
 * THE base URL for every Tradier call in the codebase.
 *
 * `TRADIER_USE_SANDBOX` was honoured by four files and ignored by eight, which
 * hardcoded `https://api.tradier.com/v1` — including gamma-exposure.ts, the path
 * the whole GEX layer depends on. So flipping to sandbox did not actually move
 * the calls that matter: they kept hitting production and kept 401-ing on a
 * token that has not been approved for market data.
 *
 * A sandbox token is a real fallback, not a toy. Quotes are delayed, but option
 * CHAIN structure — strikes, expiries, open interest, greeks — is what GEX needs,
 * and OI only updates once a day anyway. Delayed chains beat no chains.
 *
 * Exported so nothing has to hardcode a host again.
 */
export function tradierBase(): string {
  return process.env.TRADIER_USE_SANDBOX === 'true' ? TRADIER_SANDBOX_BASE : TRADIER_API_BASE;
}

// ─── Circuit breaker ─────────────────────────────────────────────────
// When Tradier auth fails (401) or service is down, repeatedly hammering it
// floods logs and burns CPU. This breaker trips after 3 consecutive auth
// failures and stays tripped for 60s, after which it half-opens for one retry.
//
// Caller behavior is unchanged — the breaker just short-circuits to null
// without making the network call (or logging the same error).

let _breakerOpenedAt = 0;
let _breakerFailures = 0;
let _disabledForBoot = false;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
let _lastBreakerLogAt = 0;

function isBreakerOpen(): boolean {
  if (_disabledForBoot) return true;
  if (_breakerOpenedAt === 0) return false;
  if (Date.now() - _breakerOpenedAt < BREAKER_COOLDOWN_MS) return true;
  // Cooldown elapsed → half-open: allow one trial request
  _breakerOpenedAt = 0;
  _breakerFailures = 0;
  return false;
}

function recordBreakerFailure(reason: string): void {
  _breakerFailures++;
  if (_breakerFailures >= BREAKER_THRESHOLD && _breakerOpenedAt === 0) {
    _breakerOpenedAt = Date.now();
    // Log once per cooldown window to avoid spam
    const now = Date.now();
    if (now - _lastBreakerLogAt > BREAKER_COOLDOWN_MS) {
      _lastBreakerLogAt = now;
      logger.warn(
        `[TRADIER] Circuit breaker OPENED after ${_breakerFailures} failures (${reason}). Skipping calls for ${BREAKER_COOLDOWN_MS / 1000}s. Falling back to CBOE/Yahoo.`,
      );
    }
  }
}

function recordBreakerSuccess(): void {
  if (_breakerFailures > 0 || _breakerOpenedAt > 0) {
    logger.info('[TRADIER] Circuit breaker CLOSED — Tradier responding again');
  }
  _breakerFailures = 0;
  _breakerOpenedAt = 0;
}

// The breaker tracks the health of the PLATFORM market-data key. A caller that
// supplies its own token — a user's connected brokerage account — must never be
// short-circuited (or counted against the breaker) because our key is dead.
function skipTradier(apiKey?: string): boolean {
  return !apiKey && isBreakerOpen();
}

function noteTradierFailure(apiKey: string | undefined, reason: string): void {
  if (!apiKey) recordBreakerFailure(reason);
}

export function getTradierBreakerState(): { open: boolean; failures: number; cooldownRemainingMs: number } {
  return {
    open: isBreakerOpen(),
    failures: _breakerFailures,
    cooldownRemainingMs:
      _breakerOpenedAt === 0 ? 0 : Math.max(0, BREAKER_COOLDOWN_MS - (Date.now() - _breakerOpenedAt)),
  };
}

// Get real-time quote for a stock symbol
export async function getTradierQuote(symbol: string, apiKey?: string): Promise<TradierQuote | null> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key) {
    logger.error('Tradier API key not found');
    logAPIError('Tradier', '/markets/quotes', new Error('API key not configured'));
    return null;
  }

  // Circuit breaker short-circuit — when Tradier auth is dead, skip the call
  if (isBreakerOpen()) return null;

  const startTime = Date.now();
  try {
    const baseUrl = getBaseUrl(key);
    const response = await fetch(`${baseUrl}/markets/quotes?symbols=${symbol}`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // Log only the first 3 401s, then breaker silences the spam
      if (_breakerFailures < BREAKER_THRESHOLD) {
        logger.error(`Tradier quote error for ${symbol}: ${response.status} ${response.statusText}`);
        logAPIError('Tradier', '/markets/quotes', new Error(`HTTP ${response.status}: ${response.statusText}`));
      }
      recordBreakerFailure(`HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    // Tradier sometimes returns HTTP 200 with a {fault:...} body on bad auth
    if (data?.fault) {
      if (_breakerFailures < BREAKER_THRESHOLD) {
        logger.error(`Tradier fault for ${symbol}: ${data.fault.faultstring ?? 'unknown'}`);
      }
      recordBreakerFailure(`fault: ${data.fault.faultstring ?? 'unknown'}`);
      return null;
    }
    const quote = data.quotes?.quote;

    if (!quote || quote.type === 'index') {
      return null;
    }

    recordBreakerSuccess();
    logAPISuccess('Tradier', '/markets/quotes', Date.now() - startTime);
    return quote;
  } catch (error) {
    if (_breakerFailures < BREAKER_THRESHOLD) {
      logger.error(`Tradier quote fetch error for ${symbol}:`, error);
      logAPIError('Tradier', '/markets/quotes', error);
    }
    recordBreakerFailure((error as Error).message ?? 'network');
    return null;
  }
}

/**
 * Build OCC option symbol from components
 * Format: SYMBOL + YYMMDD + C/P + 8-digit strike (strike * 1000, zero-padded)
 * Example: AAPL240119C00175000 = AAPL Jan 19 2024 Call $175
 */
export function buildOptionSymbol(
  underlying: string,
  expiryDate: string,  // YYYY-MM-DD format
  optionType: 'call' | 'put',
  strike: number
): string {
  // Parse date
  const [year, month, day] = expiryDate.split('-');
  const yy = year.slice(-2);
  const mm = month.padStart(2, '0');
  const dd = day.padStart(2, '0');
  
  // Option type
  const typeChar = optionType === 'call' ? 'C' : 'P';
  
  // Strike price: multiply by 1000 and pad to 8 digits
  const strikeInt = Math.round(strike * 1000);
  const strikePadded = strikeInt.toString().padStart(8, '0');
  
  return `${underlying.toUpperCase()}${yy}${mm}${dd}${typeChar}${strikePadded}`;
}

/**
 * Fetch current option quote (premium/price) from Tradier
 * Can accept either OCC symbol or individual components
 */
export interface OptionMark {
  last: number;
  bid: number;
  ask: number;
  mid: number;
  /** Which venue actually answered. Never inferred — always the real one. */
  source: 'tradier' | 'cboe';
  /** True when the mark is the ~15-min delayed CBOE chain. */
  delayed: boolean;
}

export async function getOptionQuote(
  params: {
    occSymbol?: string;
    underlying?: string;
    expiryDate?: string;
    optionType?: 'call' | 'put';
    strike?: number;
  },
  apiKey?: string
): Promise<{ last: number; bid: number; ask: number; mid: number } | null> {
  const m = await resolveOptionMark(params, apiKey);
  if (!m) return null;
  const { source, delayed, ...quote } = m;
  return quote;
}

/**
 * The universal option mark. Resolves Tradier first, CBOE delayed chain second,
 * and reports which one answered so callers can label a delayed price instead of
 * implying it's live. Returns null only when NEITHER venue has a price — never a
 * stock price, and never a zero-row masquerading as a $0.00 contract.
 */
export async function getOptionMark(params: {
  occSymbol?: string;
  underlying?: string;
  expiryDate?: string;
  optionType?: 'call' | 'put';
  strike?: number;
}): Promise<OptionMark | null> {
  return resolveOptionMark(params);
}

async function resolveOptionMark(
  params: {
    occSymbol?: string;
    underlying?: string;
    expiryDate?: string;
    optionType?: 'call' | 'put';
    strike?: number;
  },
  apiKey?: string
): Promise<OptionMark | null> {
  const key = apiKey || process.env.TRADIER_API_KEY;

  // Build OCC symbol if not provided
  let optionSymbol = params.occSymbol;
  if (!optionSymbol && params.underlying && params.expiryDate && params.optionType && params.strike) {
    optionSymbol = buildOptionSymbol(params.underlying, params.expiryDate, params.optionType, params.strike);
  }

  if (!optionSymbol) {
    logger.error('Option quote requires either occSymbol or all components (underlying, expiryDate, optionType, strike)');
    return null;
  }

  // A missing/unfunded Tradier key used to return null here, and every one of the
  // ~13 call sites treated null as "hold the last price" — which is why paper
  // positions, the bot, and the realtime pricing service all froze at their entry
  // premium and reported a permanent +0.0%. Tradier is now the PREFERRED source,
  // not the only one: if it can't answer, fall through to the CBOE delayed chain.
  if (!key) {
    return cboeOptionQuote(optionSymbol, params);
  }

  // Breaker open → the round-trip is already known to fail. Go straight to CBOE.
  if (skipTradier(apiKey)) {
    return cboeOptionQuote(optionSymbol, params);
  }

  try {
    const baseUrl = getBaseUrl(key);
    const response = await fetch(`${baseUrl}/markets/quotes?symbols=${optionSymbol}`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // 401 = unfunded/expired key, 4xx/5xx = outage. Either way Tradier can't price
      // this contract right now, and a stale mark is worse than a delayed one.
      noteTradierFailure(apiKey, `HTTP ${response.status}`);
      return cboeOptionQuote(optionSymbol, params);
    }

    const data = await response.json();
    const quote = data.quotes?.quote;

    if (!quote) {
      return cboeOptionQuote(optionSymbol, params);
    }

    const last = quote.last || 0;
    const bid = quote.bid || 0;
    const ask = quote.ask || 0;
    const mid = (bid + ask) / 2;

    // A quote that came back all zeros is not a price — it's an empty row for a
    // contract Tradier doesn't cover. Treat it as a miss rather than marking the
    // position to $0.00 and booking a fabricated -100%.
    if (mid <= 0 && last <= 0) {
      return cboeOptionQuote(optionSymbol, params);
    }

    return { last, bid, ask, mid, source: 'tradier', delayed: false };
  } catch (error) {
    return cboeOptionQuote(optionSymbol, params);
  }
}

/**
 * Delayed-chain fallback. CBOE publishes the full chain with no auth, so it works
 * on an unfunded account — the trade-off is a ~15-minute delay, which is correct
 * for marking paper positions and research, and NOT good enough for a live fill.
 * Callers that need real-time execution prices must check `source`/`delayed` on
 * getOptionMark() rather than using this transparently.
 */
async function cboeOptionQuote(
  occSymbol: string,
  params: { underlying?: string; expiryDate?: string; optionType?: 'call' | 'put'; strike?: number },
): Promise<OptionMark | null> {
  try {
    // Prefer the caller's decomposed fields; fall back to parsing the OCC symbol.
    let underlying = params.underlying;
    let expiry = params.expiryDate;
    let optionType = params.optionType;
    let strike = params.strike;

    if (!underlying || !expiry || !optionType || !strike) {
      const parsed = parseOptionSymbol(occSymbol);
      if (!parsed) return null;
      underlying = underlying || parsed.underlying;
      expiry = expiry || parsed.expiry;
      optionType = optionType || parsed.optionType;
      strike = strike || parsed.strike;
    }

    // Use the canonical full-chain parser shared with the contract detail
    // panel. The older fallback parser trims the chain for GEX analytics and
    // historically substituted a nearby strike when a far-OTM held contract
    // was outside that window. Position valuation must resolve one exact OCC
    // contract or return no mark.
    const { fetchCboeChain } = await import('./contract-analyzer/cboe-chain');
    const chain = await fetchCboeChain(underlying);
    const wantExpiry = String(expiry).slice(0, 10);
    const row = chain?.rawChain.find((o) =>
      o.option_type === optionType &&
      Math.abs(Number(o.strike) - Number(strike)) < 0.01 &&
      String(o.expiration_date).slice(0, 10) === wantExpiry
    );
    if (!row) return null;
    const bid = Number(row.bid) || 0;
    const ask = Number(row.ask) || 0;
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : ask || bid;
    if (!(mid > 0)) return null;

    return { last: mid, bid, ask, mid, source: 'cboe', delayed: true };
  } catch {
    return null;
  }
}



// Get historical price data
export async function getTradierHistory(
  symbol: string, 
  days: number = 60, 
  apiKey?: string
): Promise<number[]> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key) {
    logger.error('Tradier API key not found');
    return [];
  }

  if (skipTradier(apiKey)) return [];

  try {
    const baseUrl = getBaseUrl(key);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const start = startDate.toISOString().split('T')[0];
    const end = endDate.toISOString().split('T')[0];

    const response = await fetch(
      `${baseUrl}/markets/history?symbol=${symbol}&interval=daily&start=${start}&end=${end}`,
      {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      logger.error(`Tradier history error for ${symbol}: ${response.status}`);
      noteTradierFailure(apiKey, `HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    const history: TradierHistoricalDay[] = data.history?.day || [];
    
    if (history.length === 0) {
      return [];
    }

    // Return closing prices in chronological order
    return history.map(day => day.close);
  } catch (error) {
    logger.error(`Tradier history fetch error for ${symbol}:`, error);
    return [];
  }
}

// Yahoo Finance fallback for OHLC data
async function fetchYahooHistoryOHLC(
  symbol: string,
  days: number = 20
): Promise<{ opens: number[]; highs: number[]; lows: number[]; closes: number[]; dates: string[] } | null> {
  try {
    const endDate = Math.floor(Date.now() / 1000);
    const startDate = endDate - (days * 24 * 60 * 60);
    
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${startDate}&period2=${endDate}`
    );

    if (!response.ok) {
      logger.warn(`Yahoo Finance OHLC error for ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      logger.warn(`No Yahoo Finance OHLC data for ${symbol}`);
      return null;
    }

    const quote = result.indicators.quote[0];
    const timestamps = result.timestamp;
    
    // Filter out null values and build arrays
    const opens: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    const closes: number[] = [];
    const dates: string[] = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] != null && quote.high[i] != null && quote.low[i] != null && quote.close[i] != null) {
        opens.push(quote.open[i]);
        highs.push(quote.high[i]);
        lows.push(quote.low[i]);
        closes.push(quote.close[i]);
        dates.push(new Date(timestamps[i] * 1000).toISOString().split('T')[0]);
      }
    }
    
    logger.info(`[YAHOO-FALLBACK] Fetched ${closes.length} OHLC bars for ${symbol}`);
    return { opens, highs, lows, closes, dates };
  } catch (error) {
    logger.error(`Yahoo Finance OHLC fetch error for ${symbol}:`, error);
    return null;
  }
}

// Get historical OHLC data for ATR calculation and chart analysis
// Falls back to Yahoo Finance when Tradier is unavailable
export async function getTradierHistoryOHLC(
  symbol: string,
  days: number = 20,
  apiKey?: string
): Promise<{ opens: number[]; highs: number[]; lows: number[]; closes: number[]; dates: string[] } | null> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  
  // Try Tradier first if key available — unless the breaker already knows it is down,
  // in which case Yahoo is the answer and the round-trip is pure latency.
  if (key && !skipTradier(apiKey)) {
    try {
      const baseUrl = getBaseUrl(key);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const start = startDate.toISOString().split('T')[0];
      const end = endDate.toISOString().split('T')[0];

      const response = await fetch(
        `${baseUrl}/markets/history?symbol=${symbol}&interval=daily&start=${start}&end=${end}`,
        {
          headers: {
            'Authorization': `Bearer ${key}`,
            'Accept': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        const history: TradierHistoricalDay[] = data.history?.day || [];
        
        if (history.length > 0) {
          // Return OHLC arrays in chronological order
          return {
            opens: history.map(day => day.open),
            highs: history.map(day => day.high),
            lows: history.map(day => day.low),
            closes: history.map(day => day.close),
            dates: history.map(day => day.date)
          };
        }
      } else {
        logger.warn(`Tradier OHLC history error for ${symbol}: ${response.status}, trying Yahoo Finance`);
        noteTradierFailure(apiKey, `HTTP ${response.status}`);
      }
    } catch (error) {
      logger.warn(`Tradier OHLC fetch error for ${symbol}, trying Yahoo Finance:`, error);
    }
  }
  
  // Fallback to Yahoo Finance (unlimited, always available)
  return await fetchYahooHistoryOHLC(symbol, days);
}

// Get options chain for a symbol
export async function getTradierOptionsChain(
  symbol: string,
  expiration?: string,
  apiKey?: string
): Promise<TradierOption[]> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key) {
    logger.error('Tradier API key not found');
    return [];
  }

  // Every scanner calls this per symbol. Without the breaker check a rejected token
  // produced hundreds of identical 401s a minute for the whole life of the process.
  if (skipTradier(apiKey)) return [];

  try {
    const baseUrl = getBaseUrl(key);

    // If no expiration provided, get the nearest expiration
    let targetExpiration = expiration;
    if (!targetExpiration) {
      const expResponse = await fetch(`${baseUrl}/markets/options/expirations?symbol=${symbol}`, {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json'
        }
      });

      if (expResponse.ok) {
        const expData = await expResponse.json();
        const expirations = expData.expirations?.date || [];
        if (expirations.length > 0) {
          targetExpiration = expirations[0]; // First expiration (nearest)
        }
      } else {
        noteTradierFailure(apiKey, `HTTP ${expResponse.status}`);
      }
    }

    if (!targetExpiration) {
      logger.error(`No expiration found for ${symbol}`);
      return [];
    }

    const response = await fetch(
      `${baseUrl}/markets/options/chains?symbol=${symbol}&expiration=${targetExpiration}&greeks=true`,
      {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      logger.error(`Tradier options chain error for ${symbol}: ${response.status}`);
      noteTradierFailure(apiKey, `HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    const options: TradierOption[] = data.options?.option || [];
    
    return options;
  } catch (error) {
    logger.error(`Tradier options chain fetch error for ${symbol}:`, error);
    return [];
  }
}

// Get the raw list of available option expiration dates (YYYY-MM-DD), nearest first.
// Additive helper used by the option-selection engine to pick exact DTE windows.
export async function getTradierOptionExpirations(symbol: string, apiKey?: string): Promise<string[]> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key) {
    logger.error('Tradier API key not found');
    return [];
  }
  if (skipTradier(apiKey)) return [];

  try {
    const baseUrl = getBaseUrl(key);
    const resp = await fetch(`${baseUrl}/markets/options/expirations?symbol=${symbol}`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });
    if (!resp.ok) {
      logger.error(`Tradier expirations error for ${symbol}: ${resp.status}`);
      noteTradierFailure(apiKey, `HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return data.expirations?.date || [];
  } catch (error) {
    logger.error(`Tradier expirations fetch error for ${symbol}:`, error);
    return [];
  }
}

// Get options across multiple expiration buckets (weeklies, monthlies, quarterlies, LEAPS)
export async function getTradierOptionsChainsByDTE(
  symbol: string,
  apiKey?: string
): Promise<TradierOption[]> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key) {
    logger.error('Tradier API key not found');
    return [];
  }

  if (skipTradier(apiKey)) return [];

  try {
    const baseUrl = getBaseUrl(key);

    // 1. Get all available expirations
    const expResponse = await fetch(`${baseUrl}/markets/options/expirations?symbol=${symbol}`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!expResponse.ok) {
      logger.error(`Tradier expirations error for ${symbol}: ${expResponse.status}`);
      noteTradierFailure(apiKey, `HTTP ${expResponse.status}`);
      return [];
    }

    const expData = await expResponse.json();
    const allExpirations: string[] = expData.expirations?.date || [];
    
    if (allExpirations.length === 0) {
      logger.info(`No expirations found for ${symbol}`);
      return [];
    }

    // 2. Bucket expirations by DTE ranges
    const now = new Date();
    const buckets = {
      frontWeek: { min: 0, max: 7, expirations: [] as string[] },    // 0-7 days (includes today/tomorrow, critical for lotto plays)
      weekly: { min: 7, max: 14, expirations: [] as string[] },      // 7-14 days
      monthly: { min: 30, max: 60, expirations: [] as string[] },    // 30-60 days
      quarterly: { min: 90, max: 270, expirations: [] as string[] }, // 90-270 days (3-9 months)
      leaps: { min: 270, max: 540, expirations: [] as string[] },    // 270-540 days (9-18 months)
    };

    for (const expDate of allExpirations) {
      const daysToExp = Math.ceil((new Date(expDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysToExp >= buckets.frontWeek.min && daysToExp <= buckets.frontWeek.max) {
        buckets.frontWeek.expirations.push(expDate);
      } else if (daysToExp >= buckets.weekly.min && daysToExp <= buckets.weekly.max) {
        buckets.weekly.expirations.push(expDate);
      } else if (daysToExp >= buckets.monthly.min && daysToExp <= buckets.monthly.max) {
        buckets.monthly.expirations.push(expDate);
      } else if (daysToExp >= buckets.quarterly.min && daysToExp <= buckets.quarterly.max) {
        buckets.quarterly.expirations.push(expDate);
      } else if (daysToExp >= buckets.leaps.min && daysToExp <= buckets.leaps.max) {
        buckets.leaps.expirations.push(expDate);
      }
    }

    // 3. Select one representative expiration per bucket (nearest in each range)
    // CRITICAL: Always include nearest expiration (for lotto/flow scanners) + longer-dated options
    const selectedExpirations: string[] = [];
    
    // Always add nearest expiration first (safety measure for 0DTE/1DTE plays)
    if (allExpirations.length > 0) {
      selectedExpirations.push(allExpirations[0]);
    }
    
    // Add one per bucket (skip frontWeek since nearest is already added)
    if (buckets.weekly.expirations.length > 0 && !selectedExpirations.includes(buckets.weekly.expirations[0])) {
      selectedExpirations.push(buckets.weekly.expirations[0]);
    }
    if (buckets.monthly.expirations.length > 0) selectedExpirations.push(buckets.monthly.expirations[0]);
    if (buckets.quarterly.expirations.length > 0) selectedExpirations.push(buckets.quarterly.expirations[0]);
    if (buckets.leaps.expirations.length > 0) selectedExpirations.push(buckets.leaps.expirations[0]);

    logger.info(`📅 [OPTIONS] ${symbol}: Found expirations across ${selectedExpirations.length} buckets - ${selectedExpirations.join(', ')}`);

    // 4. Fetch options for each selected expiration (parallelized with rate limiting)
    const optionsPromises = selectedExpirations.map(async (exp, index) => {
      // Basic rate limiting: stagger requests by 100ms each
      await new Promise(resolve => setTimeout(resolve, index * 100));
      return getTradierOptionsChain(symbol, exp, apiKey);
    });

    const optionsArrays = await Promise.all(optionsPromises);
    const allOptions = optionsArrays.flat();

    logger.info(`📅 [OPTIONS] ${symbol}: Retrieved ${allOptions.length} total option contracts across ${selectedExpirations.length} expiration dates`);
    
    return allOptions;
  } catch (error) {
    logger.error(`Tradier multi-expiration fetch error for ${symbol}:`, error);
    return [];
  }
}

// Get market status
export async function getTradierMarketStatus(apiKey?: string): Promise<{
  state: 'premarket' | 'open' | 'postmarket' | 'closed';
  description: string;
  timestamp: string;
} | null> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key) {
    logger.error('Tradier API key not found');
    return null;
  }

  if (skipTradier(apiKey)) return null;

  try {
    const baseUrl = getBaseUrl(key);
    const response = await fetch(`${baseUrl}/markets/clock`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      logger.error(`Tradier market clock error: ${response.status}`);
      noteTradierFailure(apiKey, `HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const clock = data.clock;
    
    return {
      state: clock.state,
      description: clock.description,
      timestamp: clock.timestamp
    };
  } catch (error) {
    logger.error('Tradier market clock fetch error:', error);
    return null;
  }
}

// Find optimal option strike based on current price and direction
/**
 * Free fallback strike picker off the CBOE delayed chain — used when Tradier is
 * unavailable (no key / 401 / empty). Returns the SAME shape as findOptimalStrike,
 * crucially including a real `lastPrice` (mid premium) so callers that gate on
 * `optimalStrike.lastPrice` still produce priced option ideas. Picks the nearest
 * future expiry, then the ~0.35-delta strike (or slightly-OTM by moneyness when
 * greeks are missing). Returns null if CBOE has nothing usable — never fabricates.
 */
async function cboeFallbackStrike(
  symbol: string,
  currentPrice: number,
  direction: 'long' | 'short',
): Promise<{ strike: number; optionType: 'call' | 'put'; delta?: number; lastPrice?: number } | null> {
  try {
    const { fetchCboeChain } = await import('./contract-analyzer/cboe-chain');
    const chain = await fetchCboeChain(symbol);
    if (!chain || chain.rawChain.length === 0) return null;

    const optionType: 'call' | 'put' = direction === 'long' ? 'call' : 'put';
    const typed = chain.rawChain.filter((o) => o.option_type === optionType);
    if (typed.length === 0) return null;

    // Pick a swing-horizon expiry (>= 5 DTE) so the strike ladder is full and
    // deltas are sane — the very-front 0-1 DTE weeklies have sparse ladders that
    // wreck the 0.35-delta match. Fall back to the nearest future expiry, then
    // the latest listed, so we always return something usable.
    const dte = (e: string) => Math.round((new Date(`${e}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
    const expiries = Array.from(new Set(typed.map((o) => o.expiration_date))).sort();
    const expiry =
      expiries.find((e) => dte(e) >= 5) ??
      expiries.find((e) => dte(e) >= 0) ??
      expiries[expiries.length - 1];
    const frontMonth = typed.filter((o) => o.expiration_date === expiry);
    if (frontMonth.length === 0) return null;

    const hasGreeks = frontMonth.some((o) => Math.abs(o.greeks?.delta ?? 0) > 0.0001);
    let best;
    if (hasGreeks) {
      const targetDelta = direction === 'long' ? 0.35 : -0.35;
      best = frontMonth.reduce((b, o) =>
        Math.abs((o.greeks?.delta ?? 0) - targetDelta) < Math.abs((b.greeks?.delta ?? 0) - targetDelta) ? o : b,
      );
    } else {
      // No greeks — pick slightly-OTM by moneyness.
      const targetStrike = direction === 'long' ? currentPrice * 1.02 : currentPrice * 0.98;
      best = frontMonth.reduce((b, o) =>
        Math.abs(o.strike - targetStrike) < Math.abs(b.strike - targetStrike) ? o : b,
      );
    }

    const mid = (Number(best.bid ?? 0) + Number(best.ask ?? 0)) / 2;
    return {
      strike: best.strike,
      optionType,
      delta: best.greeks?.delta || undefined,
      lastPrice: mid > 0 ? Math.round(mid * 100) / 100 : undefined,
    };
  } catch (e) {
    logger.warn(`⚠️  CBOE fallback strike failed for ${symbol}: ${(e as Error).message}`);
    return null;
  }
}

export async function findOptimalStrike(
  symbol: string,
  currentPrice: number,
  direction: 'long' | 'short',
  apiKey?: string
): Promise<{ strike: number; optionType: 'call' | 'put'; delta?: number; lastPrice?: number } | null> {
  const options = await getTradierOptionsChain(symbol, undefined, apiKey);

  if (options.length === 0) {
    // Tradier unavailable (no key / 401 / empty) → fall back to the FREE CBOE
    // chain so option ideas still get a real strike + premium (~0.35 delta).
    const cboe = await cboeFallbackStrike(symbol, currentPrice, direction);
    if (cboe) {
      logger.info(`📈 [FALLBACK] ${symbol}: Tradier chain empty — used CBOE strike $${cboe.strike}${cboe.lastPrice ? ` @ $${cboe.lastPrice}` : ''}`);
      return cboe;
    }

    // Last resort: naive slightly-OTM strike with no premium (unpriced).
    const strike = direction === 'long'
      ? Number((currentPrice * 1.02).toFixed(2))
      : Number((currentPrice * 0.98).toFixed(2));

    return {
      strike,
      optionType: direction === 'long' ? 'call' : 'put',
      delta: undefined,
      lastPrice: undefined
    };
  }

  // Filter options by type based on direction
  const optionType: 'call' | 'put' = direction === 'long' ? 'call' : 'put';
  const filteredOptions = options.filter(opt => opt.option_type === optionType);

  if (filteredOptions.length === 0) {
    return null;
  }

  // Find option closest to desired delta (0.30-0.40 for slightly OTM)
  const targetDelta = direction === 'long' ? 0.35 : -0.35;
  
  let bestOption = filteredOptions[0];
  let bestDeltaDiff = Math.abs((bestOption.greeks?.delta || 0) - targetDelta);

  for (const option of filteredOptions) {
    const delta = option.greeks?.delta || 0;
    const deltaDiff = Math.abs(delta - targetDelta);
    
    if (deltaDiff < bestDeltaDiff) {
      bestOption = option;
      bestDeltaDiff = deltaDiff;
    }
  }

  return {
    strike: bestOption.strike,
    optionType: bestOption.option_type as 'call' | 'put',
    delta: bestOption.greeks?.delta,
    lastPrice: bestOption.last || bestOption.bid || bestOption.ask
  };
}

// Validate Tradier API key on startup
export async function validateTradierAPI(): Promise<boolean> {
  const key = process.env.TRADIER_API_KEY;
  if (!key) {
    _disabledForBoot = true;
    logger.warn('⚠️  Tradier API key not configured');
    logger.warn('   → Options trading DISABLED until valid key is provided');
    logger.warn('   → Only stock shares and crypto will be generated');
    logAPIError('Tradier', 'validate', new Error('API key not configured'));
    return false;
  }

  const startTime = Date.now();
  try {
    // Test with a simple quote request
    const baseUrl = getBaseUrl(key);
    const response = await fetch(`${baseUrl}/markets/quotes?symbols=AAPL`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      // Authentication failures do not heal during a process lifetime. Permanently
      // short-circuit this boot instead of allowing hundreds of concurrent scanners
      // to retry the same rejected token every circuit-breaker cooldown.
      if (response.status === 401 || response.status === 403) _disabledForBoot = true;
      logger.error(`❌ Tradier API validation failed: ${response.status} ${response.statusText}`);
      logger.error('   → Options trading DISABLED - invalid or expired API key');
      logger.error('   → Get a valid key at: https://tradier.com/individuals/api-access');
      logAPIError('Tradier', 'validate', new Error(`HTTP ${response.status}: ${response.statusText} - Invalid or expired API key`));
      return false;
    }

    logger.info('✅ Tradier API connected successfully');
    _disabledForBoot = false;
    logger.info('   → Options trading available with real-time data');
    logAPISuccess('Tradier', 'validate', Date.now() - startTime);
    return true;
  } catch (error) {
    logger.error('❌ Tradier API connection error:', error);
    logger.error('   → Options trading DISABLED');
    logAPIError('Tradier', 'validate', error);
    return false;
  }
}

interface TradierLookupResult {
  symbol: string;
  exchange: string;
  type: string;
  description: string;
}

export async function searchSymbolLookup(query: string, apiKey?: string): Promise<TradierLookupResult[]> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key || query.length < 1) {
    return [];
  }

  if (skipTradier(apiKey)) return [];

  const startTime = Date.now();
  try {
    const baseUrl = getBaseUrl(key);
    const response = await fetch(`${baseUrl}/markets/lookup?q=${encodeURIComponent(query)}`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      logger.warn(`Tradier lookup error for "${query}": ${response.status}`);
      noteTradierFailure(apiKey, `HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    const securities = data.securities?.security;

    if (!securities) {
      return [];
    }

    const results = Array.isArray(securities) ? securities : [securities];

    logAPISuccess('Tradier', '/markets/lookup', Date.now() - startTime);

    return results
      .filter((s: any) => s.type === 'stock' || s.type === 'etf')
      .slice(0, 10)
      .map((s: any) => ({
        symbol: s.symbol,
        exchange: s.exchange,
        type: s.type,
        description: s.description
      }));
  } catch (error) {
    logger.error('Tradier lookup error:', error);
    return [];
  }
}

// ============================================
// BROKER ACCOUNT & PORTFOLIO INTEGRATION
// Real positions and balances from Tradier brokerage
// ============================================

export interface TradierAccountInfo {
  accountNumber: string;
  type: 'cash' | 'margin' | 'ira' | 'roth_ira' | 'rollover_ira' | 'traditional_ira';
  classification: 'individual' | 'joint' | 'trust' | 'corporate';
  dayTrader: boolean;
  status: 'active' | 'inactive' | 'restricted';
}

export interface TradierPosition {
  symbol: string;
  quantity: number;
  costBasis: number;
  dateAcquired?: string;
  id?: number;
}

export interface TradierBalance {
  accountNumber: string;
  accountType: string;
  totalCash: number;
  totalEquity: number;
  marketValue: number;
  openPL: number;
  closePL: number;
  buyingPower: number;
  pendingCash: number;
  unclearedFunds: number;
}

export interface PositionAnalysis {
  symbol: string;
  quantity: number;
  costBasis: number;
  currentPrice: number;
  currentValue: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  dayChange: number;
  dayChangePercent: number;
  isOption: boolean;
  optionDetails?: {
    underlying: string;
    optionType: 'call' | 'put';
    strike: number;
    expiry: string;
    daysToExpiry: number;
  };
  // Analysis signals
  signals: {
    trend: 'bullish' | 'bearish' | 'neutral';
    momentum: 'strong' | 'weak' | 'neutral';
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    suggestion: string;
  };
}

// Get user profile and accounts
export async function getTradierUserProfile(apiKey?: string): Promise<{ userId: string; accounts: TradierAccountInfo[] } | null> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key) {
    logger.error('Tradier API key not found');
    return null;
  }

  try {
    const baseUrl = getBaseUrl(key);
    const response = await fetch(`${baseUrl}/user/profile`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      logger.error(`Tradier profile error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const profile = data.profile;

    if (!profile) {
      return null;
    }

    const accounts = profile.account || [];
    const accountList = Array.isArray(accounts) ? accounts : [accounts];

    return {
      userId: profile.id,
      accounts: accountList.map((acc: any) => ({
        accountNumber: acc.account_number,
        type: acc.type,
        classification: acc.classification,
        dayTrader: acc.day_trader === true,
        status: acc.status
      }))
    };
  } catch (error) {
    logger.error('Tradier profile fetch error:', error);
    return null;
  }
}

// Get account balances
export async function getTradierBalances(accountId: string, apiKey?: string): Promise<TradierBalance | null> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key) {
    logger.error('Tradier API key not found');
    return null;
  }

  try {
    const baseUrl = getBaseUrl(key);
    const response = await fetch(`${baseUrl}/accounts/${accountId}/balances`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      logger.error(`Tradier balances error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    const balances = data.balances;

    if (!balances) {
      return null;
    }

    // Handle both cash and margin accounts
    const cash = balances.cash || balances.margin || {};

    return {
      accountNumber: accountId,
      accountType: balances.account_type || 'cash',
      totalCash: cash.cash_available || 0,
      totalEquity: balances.total_equity || 0,
      marketValue: balances.market_value || 0,
      openPL: balances.open_pl || 0,
      closePL: balances.close_pl || 0,
      buyingPower: cash.buying_power || balances.buying_power || 0,
      pendingCash: cash.pending_cash || 0,
      unclearedFunds: cash.uncleared_funds || 0
    };
  } catch (error) {
    logger.error('Tradier balances fetch error:', error);
    return null;
  }
}

// Get account positions
export async function getTradierPositions(accountId: string, apiKey?: string): Promise<TradierPosition[]> {
  const key = apiKey || process.env.TRADIER_API_KEY;
  if (!key) {
    logger.error('Tradier API key not found');
    return [];
  }

  try {
    const baseUrl = getBaseUrl(key);
    const response = await fetch(`${baseUrl}/accounts/${accountId}/positions`, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      logger.error(`Tradier positions error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    const positions = data.positions?.position;

    if (!positions) {
      return [];
    }

    const positionList = Array.isArray(positions) ? positions : [positions];

    return positionList.map((pos: any) => ({
      symbol: pos.symbol,
      quantity: pos.quantity,
      costBasis: pos.cost_basis,
      dateAcquired: pos.date_acquired,
      id: pos.id
    }));
  } catch (error) {
    logger.error('Tradier positions fetch error:', error);
    return [];
  }
}

// Parse OCC option symbol to components
export function parseOptionSymbol(occSymbol: string): { underlying: string; expiry: string; optionType: 'call' | 'put'; strike: number } | null {
  // OCC format: SYMBOL + YYMMDD + C/P + 8-digit strike
  // Example: AAPL240119C00175000
  const match = occSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);

  if (!match) {
    return null;
  }

  const [, underlying, dateStr, typeChar, strikeStr] = match;

  // Parse date (YYMMDD)
  const year = 2000 + parseInt(dateStr.slice(0, 2), 10);
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);
  const expiry = `${year}-${month}-${day}`;

  // Parse strike (8 digits, divided by 1000)
  const strike = parseInt(strikeStr, 10) / 1000;

  return {
    underlying,
    expiry,
    optionType: typeChar === 'C' ? 'call' : 'put',
    strike
  };
}

// Analyze positions with current market data
export async function analyzePortfolioPositions(accountId: string, apiKey?: string): Promise<{
  positions: PositionAnalysis[];
  summary: {
    totalValue: number;
    totalCost: number;
    totalUnrealizedPL: number;
    totalUnrealizedPLPercent: number;
    optionsCount: number;
    stocksCount: number;
    riskScore: number;
    topRisks: string[];
    suggestions: string[];
  };
}> {
  const positions = await getTradierPositions(accountId, apiKey);

  if (positions.length === 0) {
    return {
      positions: [],
      summary: {
        totalValue: 0,
        totalCost: 0,
        totalUnrealizedPL: 0,
        totalUnrealizedPLPercent: 0,
        optionsCount: 0,
        stocksCount: 0,
        riskScore: 0,
        topRisks: [],
        suggestions: ['No positions found - portfolio is empty']
      }
    };
  }

  const analyzedPositions: PositionAnalysis[] = [];
  let totalValue = 0;
  let totalCost = 0;
  let optionsCount = 0;
  let stocksCount = 0;
  const risks: string[] = [];
  const suggestions: string[] = [];

  for (const pos of positions) {
    const isOption = pos.symbol.length > 6 && /\d{6}[CP]\d{8}$/.test(pos.symbol);

    let currentPrice = 0;
    let dayChange = 0;
    let dayChangePercent = 0;
    let optionDetails: PositionAnalysis['optionDetails'] | undefined;

    if (isOption) {
      optionsCount++;
      const parsed = parseOptionSymbol(pos.symbol);

      if (parsed) {
        optionDetails = {
          underlying: parsed.underlying,
          optionType: parsed.optionType,
          strike: parsed.strike,
          expiry: parsed.expiry,
          daysToExpiry: Math.ceil((new Date(parsed.expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        };

        // Get option quote
        const optQuote = await getOptionQuote({ occSymbol: pos.symbol }, apiKey);
        if (optQuote) {
          currentPrice = optQuote.last || optQuote.mid;
        }

        // Risk check: Expiring soon
        if (optionDetails.daysToExpiry <= 1) {
          risks.push(`${parsed.underlying} option expires TODAY/TOMORROW`);
        } else if (optionDetails.daysToExpiry <= 3) {
          risks.push(`${parsed.underlying} option expires in ${optionDetails.daysToExpiry} days`);
        }
      }
    } else {
      stocksCount++;
      const quote = await getTradierQuote(pos.symbol, apiKey);
      if (quote) {
        currentPrice = quote.last;
        dayChange = quote.change;
        dayChangePercent = quote.change_percentage;
      }
    }

    const currentValue = currentPrice * pos.quantity * (isOption ? 100 : 1);
    const unrealizedPL = currentValue - pos.costBasis;
    const unrealizedPLPercent = pos.costBasis > 0 ? (unrealizedPL / pos.costBasis) * 100 : 0;

    totalValue += currentValue;
    totalCost += pos.costBasis;

    // Determine signals
    let trend: PositionAnalysis['signals']['trend'] = 'neutral';
    let momentum: PositionAnalysis['signals']['momentum'] = 'neutral';
    let riskLevel: PositionAnalysis['signals']['riskLevel'] = 'medium';
    let suggestion = 'Hold position';

    if (unrealizedPLPercent > 50) {
      trend = 'bullish';
      momentum = 'strong';
      suggestion = 'Consider taking partial profits';
    } else if (unrealizedPLPercent > 20) {
      trend = 'bullish';
      momentum = 'weak';
      suggestion = 'Trailing stop recommended';
    } else if (unrealizedPLPercent < -30) {
      trend = 'bearish';
      momentum = 'strong';
      riskLevel = 'high';
      suggestion = 'Evaluate exit - significant loss';
    } else if (unrealizedPLPercent < -15) {
      trend = 'bearish';
      momentum = 'weak';
      riskLevel = 'medium';
      suggestion = 'Review thesis - moderate loss';
    }

    // Options-specific risk
    if (isOption && optionDetails) {
      if (optionDetails.daysToExpiry <= 1) {
        riskLevel = 'critical';
        suggestion = 'EXIT TODAY - expires imminently';
        risks.push(`CRITICAL: ${optionDetails.underlying} option expires very soon`);
      } else if (optionDetails.daysToExpiry <= 3 && unrealizedPLPercent < 0) {
        riskLevel = 'high';
        suggestion = 'Close position - theta decay accelerating';
      }
    }

    analyzedPositions.push({
      symbol: pos.symbol,
      quantity: pos.quantity,
      costBasis: pos.costBasis,
      currentPrice,
      currentValue,
      unrealizedPL,
      unrealizedPLPercent,
      dayChange,
      dayChangePercent,
      isOption,
      optionDetails,
      signals: {
        trend,
        momentum,
        riskLevel,
        suggestion
      }
    });
  }

  // Calculate overall risk score (0-100)
  const criticalCount = analyzedPositions.filter(p => p.signals.riskLevel === 'critical').length;
  const highCount = analyzedPositions.filter(p => p.signals.riskLevel === 'high').length;
  const riskScore = Math.min(100, criticalCount * 40 + highCount * 20 + (optionsCount / positions.length) * 20);

  // Portfolio-level suggestions
  if (optionsCount > stocksCount * 2) {
    suggestions.push('Portfolio is options-heavy - consider balancing with stocks');
  }
  if (criticalCount > 0) {
    suggestions.push(`${criticalCount} position(s) need immediate attention`);
  }
  if (totalCost > 0 && (totalValue - totalCost) / totalCost < -0.2) {
    suggestions.push('Portfolio down >20% - review all positions');
  }

  const totalUnrealizedPL = totalValue - totalCost;
  const totalUnrealizedPLPercent = totalCost > 0 ? (totalUnrealizedPL / totalCost) * 100 : 0;

  return {
    positions: analyzedPositions,
    summary: {
      totalValue,
      totalCost,
      totalUnrealizedPL,
      totalUnrealizedPLPercent,
      optionsCount,
      stocksCount,
      riskScore,
      topRisks: risks.slice(0, 5),
      suggestions
    }
  };
}

// Get linked broker status
export async function getBrokerStatus(apiKey?: string): Promise<{
  connected: boolean;
  accounts: number;
  primaryAccount?: string;
  totalEquity?: number;
  positionCount?: number;
} | null> {
  const profile = await getTradierUserProfile(apiKey);

  if (!profile || profile.accounts.length === 0) {
    return {
      connected: false,
      accounts: 0
    };
  }

  const primaryAccount = profile.accounts.find(a => a.status === 'active');
  if (!primaryAccount) {
    return {
      connected: true,
      accounts: profile.accounts.length
    };
  }

  const balances = await getTradierBalances(primaryAccount.accountNumber, apiKey);
  const positions = await getTradierPositions(primaryAccount.accountNumber, apiKey);

  return {
    connected: true,
    accounts: profile.accounts.length,
    primaryAccount: primaryAccount.accountNumber,
    totalEquity: balances?.totalEquity,
    positionCount: positions.length
  };
}

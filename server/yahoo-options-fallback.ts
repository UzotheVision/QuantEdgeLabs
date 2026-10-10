/**
 * Yahoo Finance Options Chain Fallback
 * ======================================
 * When Tradier API is down (401/missing key), fetch options chain from Yahoo Finance.
 * Returns data in TradierOption-compatible format so GEX/VEX calculators work unchanged.
 *
 * Yahoo Finance provides: strike, OI, volume, IV, and we compute approximate greeks
 * using Black-Scholes. Not as precise as Tradier's greeks but enough for GEX/VEX levels.
 */

import { logger } from './logger';
import { getYahooFinance, safeQuote } from './yahoo-finance-service';

// ─── Types (matches TradierOption shape) ─────────────────────

interface YahooOptionContract {
  strike: number;
  lastPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  expiration: Date;
  contractSymbol: string;
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

// ─── Black-Scholes Greeks (approximate) ──────────────────────

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function computeGreeks(
  spot: number,
  strike: number,
  tte: number,        // time to expiry in years
  iv: number,         // implied volatility (decimal, e.g. 0.25)
  isCall: boolean,
  riskFreeRate: number = 0.045,
): { delta: number; gamma: number; theta: number; vega: number; vanna: number } {
  if (tte <= 0 || iv <= 0 || spot <= 0 || strike <= 0) {
    return { delta: isCall ? (spot > strike ? 1 : 0) : (spot < strike ? -1 : 0), gamma: 0, theta: 0, vega: 0, vanna: 0 };
  }

  const sqrtT = Math.sqrt(tte);
  const d1 = (Math.log(spot / strike) + (riskFreeRate + 0.5 * iv * iv) * tte) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;

  const nd1 = normalPDF(d1);

  const delta = isCall ? normalCDF(d1) : normalCDF(d1) - 1;
  const gamma = nd1 / (spot * iv * sqrtT);
  const vega = spot * nd1 * sqrtT / 100; // per 1% IV move
  const theta = (-(spot * nd1 * iv) / (2 * sqrtT) - riskFreeRate * strike * Math.exp(-riskFreeRate * tte) * (isCall ? normalCDF(d2) : -normalCDF(-d2))) / 365;

  // Vanna = d(delta)/d(vol) = -d2 * nd1 / iv ... but simplified
  const vanna = -(d2 / iv) * nd1;

  return { delta, gamma, theta, vega, vanna };
}

// ─── Yahoo Options Chain Fetcher ─────────────────────────────

export async function getYahooOptionsChain(
  symbol: string,
  expiration?: string,
): Promise<TradierCompatOption[]> {
  try {
    const yf = await getYahooFinance();

    // Get spot price — prefer chart candle (most accurate) over quote (can be stale)
    const { getBestPrice, getChartLastPrice } = await import('./yahoo-finance-service');
    const [quote, chartPrice] = await Promise.all([
      safeQuote(symbol),
      getChartLastPrice(symbol),
    ]);
    const quotePrice = getBestPrice(quote);
    // Chart candle is ground truth; quote's regularMarketPrice can lag by hours
    const spotPrice = chartPrice > 0 ? chartPrice : quotePrice;
    if (spotPrice <= 0) {
      logger.warn(`[YAHOO-OPT] No spot price for ${symbol}`);
      return [];
    }

    // Fetch options — yahoo-finance2 v3 uses options() method
    let optionsData: any;
    try {
      // yahoo-finance2 expects date as epoch seconds (number) matching midnight UTC exactly
      const dateParam = expiration
        ? { date: Math.floor(new Date(expiration + 'T00:00:00Z').getTime() / 1000) }
        : undefined;
      optionsData = await yf.options(symbol, dateParam);
    } catch (e: any) {
      // Fallback: try quoteSummary with defaultKeyStatistics to at least get some data
      logger.warn(`[YAHOO-OPT] options() failed for ${symbol}: ${e.message}, trying alternative...`);
      // Try raw fetch as fallback
      optionsData = await fetchYahooOptionsRaw(symbol, expiration);
    }

    if (!optionsData) {
      logger.warn(`[YAHOO-OPT] No options data for ${symbol}`);
      return [];
    }

    const expirationDates: number[] = optionsData.expirationDates || [];
    const calls: YahooOptionContract[] = optionsData.options?.[0]?.calls || optionsData.calls || [];
    const puts: YahooOptionContract[] = optionsData.options?.[0]?.puts || optionsData.puts || [];

    // Get the actual expiration date string
    // yahoo-finance2 v3 returns Date objects for expirationDates, not epoch numbers
    let expDateStr = expiration || '';
    if (!expDateStr && expirationDates.length > 0) {
      const raw: any = expirationDates[0];
      const d = raw instanceof Date ? raw : new Date(typeof raw === 'number' ? raw * 1000 : raw);
      if (!isNaN(d.getTime())) expDateStr = d.toISOString().split('T')[0];
    }
    // Also check if the option's own expiration_date is a Date object
    const optExp = optionsData.options?.[0]?.expirationDate;
    if (optExp && !expDateStr) {
      const d = optExp instanceof Date ? optExp : new Date(optExp);
      if (!isNaN(d.getTime())) expDateStr = d.toISOString().split('T')[0];
    }

    // Calculate time to expiry
    const expDate = expDateStr ? new Date(expDateStr + 'T16:00:00') : new Date(Date.now() + 7 * 86400000);
    const tte = Math.max(0.001, (expDate.getTime() - Date.now()) / (365.25 * 86400000));

    const results: TradierCompatOption[] = [];

    // Filter to strikes within ~15% of spot for relevance
    const lowerBound = spotPrice * 0.85;
    const upperBound = spotPrice * 1.15;

    // Process calls
    for (const c of calls) {
      const strike = c.strike;
      if (strike < lowerBound || strike > upperBound) continue;
      const iv = c.impliedVolatility || 0.25;
      const oi = c.openInterest || 0;
      if (oi === 0 && (c.volume || 0) === 0) continue; // Skip empty strikes

      const greeks = computeGreeks(spotPrice, strike, tte, iv, true);

      results.push(buildCompatOption(symbol, c, greeks, iv, 'call', expDateStr, spotPrice));
    }

    // Process puts
    for (const p of puts) {
      const strike = p.strike;
      if (strike < lowerBound || strike > upperBound) continue;
      const iv = p.impliedVolatility || 0.25;
      const oi = p.openInterest || 0;
      if (oi === 0 && (p.volume || 0) === 0) continue;

      const greeks = computeGreeks(spotPrice, strike, tte, iv, false);

      results.push(buildCompatOption(symbol, p, greeks, iv, 'put', expDateStr, spotPrice));
    }

    const withOI = results.filter(r => r.open_interest > 0).length;
    const sample = results.slice(0, 3).map(r => `$${r.strike}(OI:${r.open_interest},g:${r.greeks?.gamma?.toFixed(4)})`).join(', ');
    logger.info(`[YAHOO-OPT] ${symbol}: ${results.length} options (${calls.length}c/${puts.length}p), spot=$${spotPrice.toFixed(2)}, ${withOI} w/OI, sample: ${sample}`);
    return results;
  } catch (error: any) {
    logger.error(`[YAHOO-OPT] Error fetching options for ${symbol}:`, error.message);
    return [];
  }
}

/**
 * Engine-oriented chain fetch: returns spot + a wide RawChainOption-compatible
 * chain across the given expiries with computed greeks. Unlike getYahooOptionsChain
 * (tuned for GEX/VEX ±15% around spot), this keeps a WIDE strike band so the
 * option-selection-engine can find deep-ITM LEAP strikes (0.70–0.80 delta sit
 * well below spot). Used as the engine's fallback when CBOE is rate-limited.
 */
export async function getYahooEngineChain(
  symbol: string,
  expiries: string[],
  strikeBandPct = 0.45,
): Promise<{ spot: number; chain: TradierCompatOption[] }> {
  const { getBestPrice, getChartLastPrice } = await import('./yahoo-finance-service');
  const [quote, chartPrice] = await Promise.all([safeQuote(symbol), getChartLastPrice(symbol)]);
  const spot = chartPrice > 0 ? chartPrice : getBestPrice(quote);
  if (!(spot > 0)) return { spot: 0, chain: [] };

  const lower = spot * (1 - strikeBandPct);
  const upper = spot * (1 + strikeBandPct);
  const chain: TradierCompatOption[] = [];

  for (let i = 0; i < expiries.length; i++) {
    const exp = expiries[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 120)); // stagger
    try {
      const data = await fetchYahooOptionsRaw(symbol, exp);
      if (!data) continue;
      const calls: YahooOptionContract[] = data.options?.[0]?.calls || data.calls || [];
      const puts: YahooOptionContract[] = data.options?.[0]?.puts || data.puts || [];
      const expDate = new Date(exp + 'T16:00:00');
      const tte = Math.max(0.001, (expDate.getTime() - Date.now()) / (365.25 * 86400000));
      for (const c of calls) {
        if (c.strike < lower || c.strike > upper) continue;
        const iv = c.impliedVolatility || 0.3;
        const g = computeGreeks(spot, c.strike, tte, iv, true);
        chain.push(buildCompatOption(symbol, c, g, iv, 'call', exp, spot));
      }
      for (const p of puts) {
        if (p.strike < lower || p.strike > upper) continue;
        const iv = p.impliedVolatility || 0.3;
        const g = computeGreeks(spot, p.strike, tte, iv, false);
        chain.push(buildCompatOption(symbol, p, g, iv, 'put', exp, spot));
      }
    } catch (e: any) {
      logger.warn(`[YAHOO-OPT] engine chain ${symbol} ${exp} failed: ${e.message}`);
    }
  }
  return { spot, chain };
}

// Get all available expiration dates
export async function getYahooExpirations(symbol: string): Promise<string[]> {
  try {
    const yf = await getYahooFinance();
    const optionsData = await yf.options(symbol);
    const rawDates: any[] = optionsData?.expirationDates || [];
    return rawDates.map((d: any) => {
      // yahoo-finance2 v3 returns Date objects, not epoch numbers
      if (d instanceof Date) return d.toISOString().split('T')[0];
      if (typeof d === 'number') return new Date(d * 1000).toISOString().split('T')[0];
      return String(d).split('T')[0];
    });
  } catch {
    // Fallback via raw API
    try {
      const data = await fetchYahooOptionsRaw(symbol);
      const timestamps: number[] = data?.expirationDates || [];
      return timestamps.map((ts: number) => new Date(ts * 1000).toISOString().split('T')[0]);
    } catch {
      return [];
    }
  }
}

// ─── Raw Yahoo Finance API fallback (crumb-authenticated) ───

let _crumb: string | null = null;
let _cookie: string | null = null;
let _crumbFetchedAt = 0;
const CRUMB_TTL = 30 * 60_000; // 30 min

async function fetchYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  // Return cached if fresh
  if (_crumb && _cookie && Date.now() - _crumbFetchedAt < CRUMB_TTL) {
    return { crumb: _crumb, cookie: _cookie };
  }
  try {
    // Step 1: Get session cookie from consent page
    const initRes = await fetch('https://fc.yahoo.com', {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    const setCookies = initRes.headers.getSetCookie?.() || [];
    const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');

    // Step 2: Fetch crumb using session cookie
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': cookieStr,
      },
    });
    if (!crumbRes.ok) {
      logger.warn(`[YAHOO-OPT] Crumb fetch failed: ${crumbRes.status}`);
      return null;
    }
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes('<') || crumb.length > 50) {
      logger.warn(`[YAHOO-OPT] Invalid crumb response`);
      return null;
    }

    _crumb = crumb;
    _cookie = cookieStr;
    _crumbFetchedAt = Date.now();
    logger.info(`[YAHOO-OPT] Crumb acquired successfully`);
    return { crumb, cookie: cookieStr };
  } catch (e: any) {
    logger.warn(`[YAHOO-OPT] Crumb acquisition error: ${e.message}`);
    return null;
  }
}

async function fetchYahooOptionsRaw(symbol: string, expiration?: string): Promise<any> {
  // Try crumb-authenticated v7 first
  const auth = await fetchYahooCrumb();
  if (auth) {
    try {
      let url = `https://query2.finance.yahoo.com/v7/finance/options/${symbol}?crumb=${encodeURIComponent(auth.crumb)}`;
      if (expiration) {
        const epochSeconds = Math.floor(new Date(expiration + 'T16:00:00').getTime() / 1000);
        url += `&date=${epochSeconds}`;
      }

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Cookie': auth.cookie,
        },
      });

      if (res.ok) {
        const data = await res.json();
        const result = data?.optionChain?.result?.[0];
        if (result) {
          logger.info(`[YAHOO-OPT] Crumb-auth raw fetch OK for ${symbol}`);
          return {
            expirationDates: result.expirationDates || [],
            calls: result.options?.[0]?.calls || [],
            puts: result.options?.[0]?.puts || [],
            options: result.options,
          };
        }
      } else {
        logger.warn(`[YAHOO-OPT] Crumb-auth API ${res.status} for ${symbol}`);
        // Invalidate crumb on 401 so next call re-fetches
        if (res.status === 401 || res.status === 403) {
          _crumb = null;
          _cookie = null;
        }
      }
    } catch (e: any) {
      logger.warn(`[YAHOO-OPT] Crumb-auth error for ${symbol}: ${e.message}`);
    }
  }

  // Fallback: try unauthenticated v7 (may still work in some regions)
  try {
    let url = `https://query1.finance.yahoo.com/v7/finance/options/${symbol}`;
    if (expiration) {
      const epochSeconds = Math.floor(new Date(expiration + 'T16:00:00').getTime() / 1000);
      url += `?date=${epochSeconds}`;
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!res.ok) {
      logger.warn(`[YAHOO-OPT] Raw API ${res.status} for ${symbol}`);
      return null;
    }

    const data = await res.json();
    const result = data?.optionChain?.result?.[0];
    if (!result) return null;

    return {
      expirationDates: result.expirationDates || [],
      calls: result.options?.[0]?.calls || [],
      puts: result.options?.[0]?.puts || [],
      options: result.options,
    };
  } catch (e: any) {
    logger.error(`[YAHOO-OPT] Raw API error for ${symbol}:`, e.message);
    return null;
  }
}

// ─── Helper ──────────────────────────────────────────────────

function buildCompatOption(
  underlying: string,
  raw: YahooOptionContract,
  greeks: ReturnType<typeof computeGreeks>,
  iv: number,
  optionType: 'call' | 'put',
  expDateStr: string,
  spotPrice: number,
): TradierCompatOption {
  return {
    symbol: raw.contractSymbol || `${underlying}_${raw.strike}_${optionType}`,
    description: `${underlying} ${expDateStr} ${raw.strike} ${optionType}`,
    exch: 'YAHOO',
    type: optionType,
    last: raw.lastPrice || 0,
    change: 0,
    volume: raw.volume || 0,
    open: raw.lastPrice || 0,
    high: raw.lastPrice || 0,
    low: raw.lastPrice || 0,
    close: raw.lastPrice || 0,
    bid: raw.bid || 0,
    ask: raw.ask || 0,
    underlying,
    strike: raw.strike,
    greeks: {
      delta: greeks.delta,
      gamma: greeks.gamma,
      theta: greeks.theta,
      vega: greeks.vega,
      rho: 0,
      phi: 0,
      bid_iv: iv,
      mid_iv: iv,
      ask_iv: iv,
      smv_vol: iv,
      updated_at: new Date().toISOString(),
      vanna: greeks.vanna, // Computed from Black-Scholes
    } as any,
    change_percentage: 0,
    average_volume: raw.volume || 0,
    last_volume: raw.volume || 0,
    trade_date: Date.now(),
    prevclose: raw.lastPrice || 0,
    week_52_high: 0,
    week_52_low: 0,
    bidsize: 0,
    bidexch: '',
    bid_date: Date.now(),
    asksize: 0,
    askexch: '',
    ask_date: Date.now(),
    // Use OI if available; fall back to volume as proxy when OI is 0
    // (Yahoo often returns 0 OI after hours before EOD settlement)
    open_interest: raw.openInterest || raw.volume || 0,
    contract_size: 100,
    expiration_date: expDateStr,
    expiration_type: 'standard',
    option_type: optionType,
    root_symbol: underlying,
  };
}

logger.info('[YAHOO-OPT] Yahoo Finance options fallback loaded');

/**
 * CBOE Delayed Options Fallback
 * ==============================
 * Free delayed options chain data from CBOE's public API.
 * No API key required. Data is 15-min delayed during market hours.
 *
 * Used as a last-resort fallback when both Tradier and Yahoo fail.
 * Returns TradierOption-compatible format so GEX/VEX calculators work unchanged.
 */

import { logger } from './logger';

interface CBOEOption {
  option: string;         // OCC symbol
  bid: number;
  ask: number;
  last_sale_price: number;
  volume: number;
  open_interest: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  strike: number;
  expiration_date: string; // "2026-04-18"
  option_type: string;     // "Call" | "Put"
}

interface CBOEQuote {
  current_price: number;
  prev_day_close: number;
  change: number;
  change_percent: number;
}

// ─── CBOE Delayed API ────────────────────────────────────────

/**
 * CBOE ships contract details ONLY inside the OCC symbol — there are no strike /
 * expiration_date / option_type fields on the option objects. Parse them out.
 *   NVDA260819C00110000 -> { root: NVDA, expiration: 2026-08-19, type: call, strike: 110 }
 */
export function parseOccSymbol(occ: string): { root: string; expirationDate: string; optionType: 'call' | 'put'; strike: number } | null {
  const m = /^([A-Z0-9.]+?)(\d{6})([CP])(\d{8})$/.exec((occ || '').trim().toUpperCase());
  if (!m) return null;
  const [, root, yymmdd, cp, strike8] = m;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const year = 2000 + yy;
  const month = Number(mm), day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    root,
    expirationDate: `${year}-${mm}-${dd}`,
    optionType: cp === 'C' ? 'call' : 'put',
    strike: Number(strike8) / 1000,
  };
}

/**
 * In-flight coalescing + a short TTL cache.
 *
 * The boot scanners were requesting the SAME symbol from several call sites at once —
 * the logs showed PLTR fetched four times and 429'd three times inside one second. CBOE
 * then rate-limited us, every retry queued, and unrelated endpoints (convictions) stalled
 * behind the storm. Concurrent callers for a symbol now share ONE request, and repeat
 * calls inside the TTL are served from memory. Chains are delayed data; a short cache
 * costs nothing in accuracy.
 */
const _cboeInflight = new Map<string, Promise<any>>();
const _cboeCache = new Map<string, { data: any; expiresAt: number }>();
const CBOE_TTL_MS = 60_000;

export async function getCBOEOptionsChain(symbol: string): Promise<{
  options: any[];
  /** Full decoded chain. Exact-position pricing must use this, never a nearby strike. */
  allOptions: any[];
  spotPrice: number;
  expirations: string[];
  source: 'cboe';
} | null> {
  const key = symbol.toUpperCase();
  const now = Date.now();

  const cached = _cboeCache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  const inflight = _cboeInflight.get(key);
  if (inflight) return inflight;

  const p = _fetchCBOEOptionsChain(symbol)
    .then((data) => {
      _cboeCache.set(key, { data, expiresAt: Date.now() + CBOE_TTL_MS });
      if (_cboeCache.size > 300) {
        const oldest = Array.from(_cboeCache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
        if (oldest) _cboeCache.delete(oldest[0]);
      }
      return data;
    })
    .finally(() => { _cboeInflight.delete(key); });

  _cboeInflight.set(key, p);
  return p;
}

async function _fetchCBOEOptionsChain(symbol: string): Promise<{
  options: any[];
  allOptions: any[];
  spotPrice: number;
  expirations: string[];
  source: 'cboe';
} | null> {
  try {
    // CBOE serves delayed quotes via their market data API
    const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${symbol.toUpperCase()}.json`;

    // Serialised behind a global limiter: the scanners request ~160 distinct symbols in
    // bursts, and CBOE answers that with a blanket 429 that kills options pricing entirely.
    const { rateLimited } = await import('./provider-cache');
    const res = await rateLimited('cboe', 350, () => fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    }));

    if (!res.ok) {
      logger.warn(`[CBOE-OPT] API ${res.status} for ${symbol}`);
      return null;
    }

    const data = await res.json();
    // CBOE moved the underlying quote fields up one level: they used to live on
    // data.quote, and now sit directly on data. Accept BOTH shapes — reading only the
    // old path silently returned null here, which killed every Tradier fallback that
    // depends on this (options-flow ingestion and GEX included).
    const payload = data?.data ?? {};
    const quote: Partial<CBOEQuote> = payload.quote ?? payload;
    const rawOptions: CBOEOption[] = payload.options || [];

    if (rawOptions.length === 0) {
      logger.warn(`[CBOE-OPT] No options returned for ${symbol}`);
      return null;
    }

    const spotPrice = Number(quote?.current_price ?? quote?.prev_day_close ?? 0);
    if (!spotPrice || spotPrice <= 0) {
      logger.warn(`[CBOE-OPT] No usable spot price for ${symbol}`);
      return null;
    }

    // Decode each contract from its OCC symbol (CBOE sends no strike/expiry/type fields)
    const decoded = rawOptions
      .map((opt: any) => ({ opt, occ: parseOccSymbol(opt.option) }))
      .filter((d): d is { opt: any; occ: NonNullable<ReturnType<typeof parseOccSymbol>> } => d.occ !== null);

    if (decoded.length === 0) {
      logger.warn(`[CBOE-OPT] Could not decode any OCC symbols for ${symbol}`);
      return null;
    }

    // Collect unique expirations
    const expirationSet = new Set<string>();
    for (const d of decoded) expirationSet.add(d.occ.expirationDate);
    const expirations = Array.from(expirationSet).sort();

    // Convert to Tradier-compatible format
    // Filter to strikes within ~15% of spot
    const lowerBound = spotPrice * 0.85;
    const upperBound = spotPrice * 1.15;

    const toCompatible = ({ opt, occ }: (typeof decoded)[number]) => ({
        symbol: opt.option,
        description: `${symbol} ${occ.expirationDate} ${occ.strike} ${occ.optionType}`,
        exch: 'CBOE',
        type: occ.optionType,
        last: opt.last_trade_price || opt.theo || 0,
        change: opt.change || 0,
        volume: opt.volume || 0,
        open: opt.open || 0,
        high: opt.high || 0,
        low: opt.low || 0,
        close: opt.last_trade_price || 0,
        bid: opt.bid || 0,
        ask: opt.ask || 0,
        underlying: symbol,
        strike: occ.strike,
        greeks: {
          delta: opt.delta || 0,
          gamma: opt.gamma || 0,
          theta: opt.theta || 0,
          vega: opt.vega || 0,
          rho: opt.rho || 0,
          phi: 0,
          bid_iv: opt.iv || 0,
          mid_iv: opt.iv || 0,
          ask_iv: opt.iv || 0,
          smv_vol: opt.iv || 0,
          updated_at: new Date().toISOString(),
        },
        change_percentage: opt.percent_change || 0,
        average_volume: opt.volume || 0,
        last_volume: opt.volume || 0,
        trade_date: Date.now(),
        prevclose: opt.prev_day_close || 0,
        week_52_high: 0,
        week_52_low: 0,
        bidsize: opt.bid_size || 0,
        bidexch: 'CBOE',
        bid_date: Date.now(),
        asksize: opt.ask_size || 0,
        askexch: 'CBOE',
        ask_date: Date.now(),
        open_interest: opt.open_interest || 0,
        contract_size: 100,
        expiration_date: occ.expirationDate,
        expiration_type: 'standard',
        option_type: occ.optionType,
        root_symbol: symbol,
      });

    // Analytics callers only need the liquid near-money slice. Position
    // marking is different: it must be able to find the exact far-OTM contract
    // the ledger owns. Keep both views from the same downloaded chain.
    const allOptions = decoded.map(toCompatible);
    const options = decoded
      .filter(({ occ }) => occ.strike >= lowerBound && occ.strike <= upperBound)
      .filter(({ opt }) => (opt.open_interest || 0) > 0 || (opt.volume || 0) > 0)
      .map(toCompatible);

    logger.info(`[CBOE-OPT] ${symbol}: ${options.length} options across ${expirations.length} expirations, spot=$${spotPrice.toFixed(2)}`);

    return { options, allOptions, spotPrice, expirations, source: 'cboe' };
  } catch (e: any) {
    logger.warn(`[CBOE-OPT] Error for ${symbol}: ${e.message}`);
    return null;
  }
}

/**
 * Get expirations from CBOE delayed data
 */
export async function getCBOEExpirations(symbol: string): Promise<string[]> {
  try {
    const result = await getCBOEOptionsChain(symbol);
    return result?.expirations || [];
  } catch {
    return [];
  }
}

logger.info('[CBOE-OPT] CBOE delayed options fallback loaded');

/**
 * Price ONE specific contract from the delayed CBOE chain.
 *
 * The paper bot needs a real premium to fill an options trade. Tradier (the usual source)
 * returns 401 on an unfunded account, so CBOE's free delayed feed is what we have. It is
 * delayed and it is a quote rather than a print — both stated on the result so nothing
 * downstream can mistake it for a live fill.
 */
export interface ContractQuote {
  symbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expirationDate: string;
  bid: number;
  ask: number;
  last: number;
  /** what we'd realistically pay: mid, falling back to last */
  mid: number;
  openInterest: number;
  volume: number;
  iv: number;
  delta: number;
  spotPrice: number;
  source: 'cboe_delayed';
}

export async function getContractQuote(
  symbol: string,
  optionType: 'call' | 'put',
  strike: number,
  expirationDate: string,
): Promise<ContractQuote | null> {
  const chain = await getCBOEOptionsChain(symbol);
  if (!chain) return null;

  const want = String(expirationDate).slice(0, 10);
  // A held position is one exact OCC contract. Substituting a nearby strike
  // corrupts premium P&L while still printing the held strike's label (SNOW
  // $420C was marked with a $390C quote). If the exact contract is absent,
  // return no mark and preserve the last known value with a stale label.
  const sameExpiry = chain.allOptions.filter(
    (o: any) => o.option_type === optionType && String(o.expiration_date).slice(0, 10) === want,
  );
  if (sameExpiry.length === 0) return null;

  const exact = sameExpiry.find((o: any) => Math.abs(o.strike - strike) < 0.01);
  if (!exact) return null;
  const pick = exact;

  const bid = Number(pick.bid) || 0;
  const ask = Number(pick.ask) || 0;
  const last = Number(pick.last) || 0;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (last || ask || bid);
  if (!mid || mid <= 0) return null;

  return {
    symbol,
    optionType,
    strike: pick.strike,
    expirationDate: pick.expiration_date,
    bid, ask, last,
    mid: Number(mid.toFixed(2)),
    openInterest: Number(pick.open_interest) || 0,
    volume: Number(pick.volume) || 0,
    iv: Number(pick.greeks?.mid_iv) || 0,
    delta: Number(pick.greeks?.delta) || 0,
    spotPrice: chain.spotPrice,
    source: 'cboe_delayed',
  };
}

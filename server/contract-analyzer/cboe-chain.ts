/**
 * CBOE delayed-quotes chain fetcher — single source of truth.
 *
 * One place fetches https://cdn.cboe.com/api/global/delayed_quotes/options/{SYM}.json,
 * derives the underlying spot, and maps every contract into the option-selection
 * engine's RawChainOption shape (greeks + IV included). Both the Contract Analyzer
 * and the Trade Desk idea pipeline consume this, so there is exactly one fetch/parse
 * implementation to reason about.
 *
 * SPOT: CBOE exposes `current_price` (live/delayed intraday) AND `close`
 * (prior-session settlement). `close` is stale and was the cause of the MU
 * "$971 vs ~$120" bug — it returned the prior settlement, not the live print.
 * We prefer current_price, then bid, then close as last resort.
 */
import type { RawChainOption } from '../option-selection-engine';

export interface CboeChain {
  /** Epoch ms the chain was actually fetched — never "now" for a cached copy. */
  fetchedAt?: number;
  spot: number;
  rawChain: RawChainOption[];
  totalChainOI: number;
  topStrikeOI: number;
}

/** Parse an OCC symbol like "MU260529C00415000" → { exp, type, strike }. */
export function parseOcc(occ: string): { exp: string; type: 'call' | 'put'; strike: number } | null {
  const m = occ.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  return {
    exp: `20${m[2]}-${m[3]}-${m[4]}`,
    type: m[5] === 'C' ? 'call' : 'put',
    strike: parseInt(m[6], 10) / 1000,
  };
}

/**
 * Locate one contract's mid premium in a fetched chain by type/strike/expiry.
 * Returns null if the exact contract isn't listed (callers must not fabricate).
 * Shared by idea-creation (capture entry premium) and the performance validator
 * (capture exit premium) so there's one place that maps a contract → premium.
 */
export function findContractMid(
  chain: CboeChain,
  optionType: 'call' | 'put',
  strike: number,
  expiry: string,
): number | null {
  const row = chain.rawChain.find(
    (o) =>
      o.option_type === optionType &&
      Math.abs(o.strike - strike) < 0.01 &&
      o.expiration_date === expiry,
  );
  if (!row) return null;
  const mid = (Number(row.bid ?? 0) + Number(row.ask ?? 0)) / 2;
  return mid > 0 ? mid : null;
}

/**
 * Locate one contract's liquidity (open interest + day volume) in a fetched
 * chain by type/strike/expiry. Returns null if the exact contract isn't listed.
 * Used to backfill OI/volume onto ideas that were created before those columns
 * were captured at selection time.
 */
export function findContractLiquidity(
  chain: CboeChain,
  optionType: 'call' | 'put',
  strike: number,
  expiry: string,
): { openInterest: number; volume: number } | null {
  const row = chain.rawChain.find(
    (o) =>
      o.option_type === optionType &&
      Math.abs(o.strike - strike) < 0.01 &&
      o.expiration_date === expiry,
  );
  if (!row) return null;
  return {
    openInterest: Math.round(Number(row.open_interest ?? 0)),
    volume: Math.round(Number(row.volume ?? 0)),
  };
}

// ─── TTL cache ─────────────────────────────────────────────────
// CBOE's CDN rate-limits (HTTP 429) under bursty access — and the idea
// pipeline + performance validator both hammer the same symbols on a tight
// loop. A short in-memory TTL cache collapses those duplicate fetches into one
// network call, which is the single biggest lever against 429s (and the root
// cause of the blank "Thesis / Option" column when attachment kept failing).
// Quotes are delayed anyway, so a ~60s TTL costs us nothing in freshness.
const CHAIN_TTL_MS = 60_000;
const chainCache = new Map<string, { at: number; chain: CboeChain }>();

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/** Single network attempt — returns the parsed chain, or throws/returns null. */
async function fetchCboeChainOnce(symbol: string, timeoutMs: number): Promise<{ chain: CboeChain | null; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(
      `https://cdn.cboe.com/api/global/delayed_quotes/options/${symbol.toUpperCase()}.json`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: controller.signal },
    );
    if (!r.ok) return { chain: null, status: r.status };
    const data = (await r.json()) as {
      data?: { current_price?: number; bid?: number; close?: number; last?: number; options?: any[] };
    };
    const d = data.data;
    if (!d) return { chain: null, status: r.status };

    // Prefer the live intraday price; `close` is prior-session settlement.
    const spot = (d.current_price ?? d.bid ?? d.close ?? d.last) || 0;
    if (!spot) return { chain: null, status: r.status };

    let totalChainOI = 0;
    let topStrikeOI = 0;
    let minStrike = Infinity;
    let maxStrike = -Infinity;
    const rawChain: RawChainOption[] = [];
    for (const o of d.options ?? []) {
      const parsed = parseOcc(o.option);
      if (!parsed) continue;
      const oi = Number(o.open_interest ?? 0);
      totalChainOI += oi;
      if (oi > topStrikeOI) topStrikeOI = oi;
      if (parsed.strike < minStrike) minStrike = parsed.strike;
      if (parsed.strike > maxStrike) maxStrike = parsed.strike;
      rawChain.push({
        symbol: o.option,
        option_type: parsed.type,
        strike: parsed.strike,
        expiration_date: parsed.exp,
        bid: Number(o.bid ?? 0),
        ask: Number(o.ask ?? 0),
        volume: Number(o.volume ?? 0),
        open_interest: oi,
        greeks: {
          delta: Number(o.delta ?? 0),
          gamma: Number(o.gamma ?? 0),
          theta: Number(o.theta ?? 0),
          vega: Number(o.vega ?? 0),
          mid_iv: Number(o.iv ?? 0),
        },
      });
    }
    if (rawChain.length === 0) return { chain: null, status: r.status };

    // Spot-sanity cross-check: the derived underlying must sit within the listed
    // strike ladder. CBOE occasionally serves an internally-consistent but
    // implausible quote (e.g. MU returning ~$1057 vs a real ~$120), which would
    // poison every downstream Black-Scholes fair value and strike pick. Wide,
    // conservative bounds so this only fires on clearly-broken data — normal
    // chains list strikes well inside [spot*0.5, spot*1.5]. There's no second
    // price source, so reject the chain rather than fabricate a "corrected" spot.
    if (minStrike <= maxStrike && (spot < minStrike * 0.5 || spot > maxStrike * 1.5)) {
      console.warn(
        `[cboe-chain] ${symbol.toUpperCase()}: derived spot ${spot} is outside listed strike range [${minStrike}, ${maxStrike}] — rejecting chain as unreliable.`,
      );
      return { chain: null, status: r.status };
    }

    return { chain: { spot, rawChain, totalChainOI, topStrikeOI }, status: r.status };
  } catch {
    return { chain: null, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch + normalize a symbol's option chain from CBOE.
 * Returns null on any network/parse failure or empty chain (callers fall back
 * to their non-option behavior — never fabricate a contract).
 *
 * Resilience: serves a fresh (<60s) cached chain when available, and retries
 * with exponential backoff on HTTP 429 so transient rate-limits don't silently
 * collapse option ideas into bare-stock theses.
 */
const CHAIN_STALE_MAX_MS = 5 * 60_000;

export async function fetchCboeChain(symbol: string, timeoutMs = 6000): Promise<CboeChain | null> {
  const key = symbol.toUpperCase();

  const cached = chainCache.get(key);
  if (cached && Date.now() - cached.at < CHAIN_TTL_MS) return cached.chain;

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { chain, status } = await fetchCboeChainOnce(key, timeoutMs);
    if (chain) {
      chain.fetchedAt = Date.now();
      chainCache.set(key, { at: chain.fetchedAt, chain });
      return chain;
    }
    // Only backoff-retry on rate-limit; other failures (404, parse) won't fix themselves.
    if (status !== 429 || attempt === maxAttempts - 1) break;
    await sleep(500 * 2 ** attempt); // 500ms, 1000ms
  }

  // Last resort: a stale cached chain, but only while it is still usable.
  // Unbounded stale-serve let hour-old premiums grade outcomes and render as
  // live (audit 2026-09-24). Beyond the cap, no chain beats a wrong chain.
  if (cached && Date.now() - cached.at <= CHAIN_STALE_MAX_MS) return cached.chain;
  return null;
}

/**
 * MASSIVE OPTIONS — the chain-snapshot leg that ends the provider juggling.
 *
 * One call to /v3/snapshot/options/{underlying} returns the ENTIRE chain with
 * greeks, IV, open interest, and day volume — everything computeExposures
 * needs, from OPRA-consolidated data, without the 30-expiry × 6-chunk fetch
 * storm that CBOE 429s us for.
 *
 * ENTITLEMENT-AWARE: the operator's options plan is Basic (free) as of
 * 2026-08-26 — snapshots return NOT_AUTHORIZED until the Options Starter
 * ($29/mo, separate from the stocks plan) activates. This module probes once,
 * remembers the answer for six hours, and stays out of the way while locked;
 * the moment the subscription lands, the platform upgrades itself with no
 * code change. Nothing is fabricated in the meantime — a locked or failed
 * snapshot returns null and callers fall through to the existing cascade.
 */
import { logger } from './logger';
import type { OptionInput } from './options-exposures';

const BASE = 'https://api.polygon.io';
const ENTITLEMENT_RECHECK_MS = 6 * 60 * 60 * 1000;
let lockedUntil = 0;

function key(): string | null {
  return process.env.POLYGON_API_KEY?.trim() || null;
}

export function massiveOptionsLocked(): boolean {
  return Date.now() < lockedUntil;
}

/**
 * Full chain snapshot as OptionInput[] ready for computeExposures.
 * Returns null when unentitled, unconfigured, or on any fetch failure.
 */
export async function getMassiveChainInputs(underlying: string): Promise<OptionInput[] | null> {
  const apiKey = key();
  if (!apiKey || massiveOptionsLocked()) return null;

  const inputs: OptionInput[] = [];
  const today = Date.now();
  let url: string | null =
    `${BASE}/v3/snapshot/options/${encodeURIComponent(underlying.toUpperCase())}?limit=250&apiKey=${apiKey}`;
  let pages = 0;

  try {
    while (url && pages < 12) { // 12 × 250 = 3000 contracts — beyond any single chain we chart
      const res: any = await fetch(url).then((r) => r.json()).catch(() => null);
      if (!res) return inputs.length ? inputs : null;
      if (res.status === 'NOT_AUTHORIZED' || /not entitled/i.test(res.error ?? '')) {
        lockedUntil = Date.now() + ENTITLEMENT_RECHECK_MS;
        logger.info('[MASSIVE-OPT] snapshot not entitled on this plan — rechecking in 6h (Options Starter unlocks it)');
        return null;
      }
      const rows: any[] = res.results ?? [];
      for (const r of rows) {
        const det = r.details ?? {};
        const strike = Number(det.strike_price);
        const type = det.contract_type === 'call' ? 'call' : det.contract_type === 'put' ? 'put' : null;
        const expMs = Date.parse(det.expiration_date ?? '');
        if (!Number.isFinite(strike) || !type || !Number.isFinite(expMs)) continue;
        const g = r.greeks ?? {};
        inputs.push({
          strike,
          optionType: type,
          openInterest: Number(r.open_interest) || 0,
          volume: Number(r.day?.volume) || 0,
          impliedVolatility: Number(r.implied_volatility) || 0,
          daysToExpiry: Math.max(0, (expMs - today) / 86_400_000),
          greeks: {
            delta: Number.isFinite(g.delta) ? g.delta : undefined,
            gamma: Number.isFinite(g.gamma) ? g.gamma : undefined,
            vega: Number.isFinite(g.vega) ? g.vega : undefined,
            theta: Number.isFinite(g.theta) ? g.theta : undefined,
          },
        });
      }
      pages++;
      url = res.next_url ? `${res.next_url}&apiKey=${apiKey}` : null;
    }
  } catch (err: any) {
    logger.warn(`[MASSIVE-OPT] ${underlying} chain snapshot failed: ${err?.message}`);
    return inputs.length ? inputs : null;
  }
  return inputs.length ? inputs : null;
}

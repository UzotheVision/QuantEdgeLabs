/**
 * SEC CIK RESOLVER — stop hand-maintaining a list of 28 companies.
 *
 * Catalyst coverage was a hardcoded map of 28 mega-caps: AAPL, MSFT, JPM, V,
 * JNJ, PG, XOM and similar. Not one name from the 175-symbol universe this
 * platform actually scans. So when AAOI announced a $600M at-the-market equity
 * offering and fell 13% after hours, nothing knew — not because SEC data is hard
 * to reach, but because AAOI was not on a list somebody typed out by hand.
 *
 * The filing pipeline itself was never broken. It ran that same day and captured
 * 8-Ks for BA and NOC. It was pointed at the wrong 28 companies.
 *
 * SEC publishes the complete ticker-to-CIK mapping as a single JSON file, free,
 * no key, 10,403 companies — every name in this universe included. Resolving
 * against it turns catalyst coverage from a maintenance chore into a property of
 * the universe: add a ticker anywhere and its filings become reachable, with no
 * second list to remember.
 *
 * SEC asks for a descriptive User-Agent and rate-limits at 10 requests/second.
 * The map is fetched once and cached for a day — it changes when companies list
 * or delist, which is not an intraday concern.
 */
import { logger } from './logger';

const SEC_TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers.json';
/**
 * SEC's fair-access policy asks that this identify the requester, and it is
 * enforced more literally than the wording suggests: SEC returned 403 for a
 * User-Agent whose contact domain was users.noreply.github.com, while the same
 * request with an ordinary contact domain returned 200. A 403 here reads like a
 * permissions problem and is really a rejected UA string, which cost an hour of
 * looking in the wrong place. Keep this in SEC's documented
 * "Company Name contact@domain" shape and do not point it at a noreply host.
 *
 * Deliberately not the operator's personal address — this is an outbound header
 * to a third party, and a role address is the right thing to put in it.
 */
const UA = 'QuantEdge Research admin@quantedge.research';
const MAP_TTL_MS = 24 * 60 * 60_000;

let _map: Map<string, string> | null = null;
let _fetchedAt = 0;
let _inflight: Promise<Map<string, string>> | null = null;

async function loadMap(): Promise<Map<string, string>> {
  if (_map && Date.now() - _fetchedAt < MAP_TTL_MS) return _map;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      // SEC enforces fair access at ~10 requests/second and answers a burst with
      // a 403 rather than a 429, which reads like a permissions problem and is
      // not one. Retry with backoff before concluding anything is wrong.
      let body: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch(SEC_TICKER_MAP_URL, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        if (r.ok) { body = await r.json(); break; }
        if (r.status !== 403 && r.status !== 429) throw new Error(`SEC ticker map ${r.status}`);
        if (attempt === 2) throw new Error(`SEC ticker map ${r.status} after 3 attempts`);
        await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
      }

      const m = new Map<string, string>();
      for (const row of Object.values(body ?? {}) as any[]) {
        const t = String(row?.ticker ?? '').toUpperCase();
        const cik = row?.cik_str;
        if (t && cik != null) m.set(t, String(cik).padStart(10, '0'));
      }
      if (m.size < 1000) throw new Error(`SEC ticker map looks truncated (${m.size} rows)`);

      _map = m;
      _fetchedAt = Date.now();
      logger.info(`[SEC-CIK] resolved map loaded: ${m.size} companies`);
      return m;
    } catch (err: any) {
      logger.warn(`[SEC-CIK] map fetch failed: ${err?.message ?? err}`);
      // Serve a stale map rather than losing catalyst coverage entirely.
      if (_map) return _map;
      return new Map<string, string>();
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

/** Zero-padded CIK for a ticker, or null when SEC does not list it. */
export async function resolveCik(ticker: string): Promise<string | null> {
  const m = await loadMap();
  return m.get(ticker.toUpperCase()) ?? null;
}

/** Resolve many at once. Unlisted tickers are simply absent from the result. */
export async function resolveCiks(tickers: string[]): Promise<Map<string, string>> {
  const m = await loadMap();
  const out = new Map<string, string>();
  for (const t of tickers) {
    const cik = m.get(t.toUpperCase());
    if (cik) out.set(t.toUpperCase(), cik);
  }
  return out;
}

/** How much of a given list SEC can actually be asked about. */
export async function cikCoverage(tickers: string[]): Promise<{ resolved: number; total: number; missing: string[] }> {
  const m = await resolveCiks(tickers);
  const missing = tickers.filter((t) => !m.has(t.toUpperCase()));
  return { resolved: m.size, total: tickers.length, missing };
}

/**
 * SECTOR LEADERSHIP — which groups are leading, and the names carrying them.
 *
 * Sector rotation tells you money is moving into biotech. It does NOT tell you WHICH
 * biotech name to look at — and that's the step that actually finds a trade. The desk
 * workflow is: see the leading group, then scan the names inside it for the best chart.
 * This computes both halves in one pass.
 *
 * Strength is deliberately not just "average change":
 *   • avgChange  — how much the group moved
 *   • breadth    — what share of its names are up (a group carried by one name is fragile)
 *   • leaderGap  — how far the best name is ahead of the group (dispersion / a standout)
 * A group that is up on broad participation ranks above one up on a single spike.
 */
import { logger } from './logger';
import { getAllApprovedSymbols, getSector, SECTOR_LABELS, MEGA_CAP_TIER } from '../shared/approved-tickers';

export interface LeaderName {
  symbol: string;
  price: number;
  changePct: number;
  isMega: boolean;
}

export interface SectorStrength {
  key: string;
  label: string;
  /** typical move — MEDIAN, so one +177% name can't speak for the group */
  medianChangePct: number;
  avgChangePct: number;
  /** true when the mean is far from the median: the group is carried by an outlier */
  isSkewed: boolean;
  breadthPct: number;      // % of names green
  strength: number;        // 0–100 composite
  count: number;
  leaders: LeaderName[];   // strongest names in the group
  laggards: LeaderName[];  // weakest names in the group
  stance: 'leading' | 'improving' | 'weakening' | 'lagging';
}

export interface SectorLeadershipResult {
  generatedAt: string;
  /** which session the prices came from — pre / regular / post / closed */
  session: string;
  universeSize: number;
  quoted: number;
  benchmarkChangePct: number | null;
  sectors: SectorStrength[];
  megaCaps: LeaderName[];
  topLeaders: LeaderName[];   // strongest names market-wide
  topLaggards: LeaderName[];
  interpretation: string;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Pull quotes in chunks so one big request can't blow up the provider. */
async function quoteAll(symbols: string[], fetchQuotes: (batch: string[]) => Promise<Record<string, any>>) {
  const out: Record<string, any> = {};
  const SIZE = 40;
  for (let i = 0; i < symbols.length; i += SIZE) {
    const batch = symbols.slice(i, i + SIZE);
    try {
      Object.assign(out, await fetchQuotes(batch));
    } catch (e: any) {
      logger.warn(`[SECTOR-LEAD] quote batch failed: ${e?.message}`);
    }
  }
  return out;
}

export async function computeSectorLeadership(
  fetchQuotes: (symbols: string[]) => Promise<Record<string, any>>,
  opts: { session?: string } = {},
): Promise<SectorLeadershipResult> {
  const universe = getAllApprovedSymbols();
  const quotes = await quoteAll([...universe, 'SPY'], fetchQuotes);
  const session = opts.session ?? 'regular';

  const spy = quotes['SPY'];
  const benchmarkChangePct = typeof spy?.changePercent === 'number' ? spy.changePercent : null;
  const mega = new Set<string>(MEGA_CAP_TIER as readonly string[]);

  // bucket the tape by sector
  const buckets = new Map<string, LeaderName[]>();
  let quoted = 0;
  for (const sym of universe) {
    const q = quotes[sym];
    const chg = typeof q?.changePercent === 'number' ? q.changePercent : null;
    const price = typeof q?.price === 'number' ? q.price : null;
    if (chg == null || price == null) continue;
    quoted++;
    const key = getSector(sym) || 'other';
    const entry: LeaderName = { symbol: sym, price, changePct: chg, isMega: mega.has(sym) };
    const arr = buckets.get(key);
    if (arr) arr.push(entry); else buckets.set(key, [entry]);
  }

  const sectors: SectorStrength[] = [];
  for (const [key, names] of buckets) {
    if (names.length === 0) continue;
    const sorted = [...names].sort((a, b) => b.changePct - a.changePct);
    const avgChangePct = names.reduce((s, n) => s + n.changePct, 0) / names.length;

    // The group's TYPICAL move is the median, not the mean. One name up 177% would drag
    // a mean to +49% and make a quiet sector look like a stampede — the opposite of what
    // a leadership read is for. The mean is kept only to detect that skew.
    const byChange = [...names].map((n) => n.changePct).sort((a, b) => a - b);
    const mid = Math.floor(byChange.length / 2);
    const medianChangePct = byChange.length % 2 ? byChange[mid] : (byChange[mid - 1] + byChange[mid]) / 2;
    const isSkewed = Math.abs(avgChangePct - medianChangePct) > Math.max(1.5, Math.abs(medianChangePct));

    const breadthPct = (names.filter((n) => n.changePct > 0).length / names.length) * 100;
    const leaderGap = sorted[0].changePct - medianChangePct;

    // composite: typical move (±5% saturates) + participation + a nod to a clear standout
    const moveScore = clamp(50 + medianChangePct * 10);
    const strength = Math.round(clamp(moveScore * 0.55 + breadthPct * 0.35 + clamp(leaderGap * 5) * 0.10));

    const rel = benchmarkChangePct == null ? medianChangePct : medianChangePct - benchmarkChangePct;
    const stance: SectorStrength['stance'] =
      rel >= 0 && breadthPct >= 50 ? 'leading'
      : rel >= 0 ? 'improving'
      : breadthPct >= 50 ? 'weakening'
      : 'lagging';

    sectors.push({
      key,
      label: (SECTOR_LABELS as Record<string, string>)[key] ?? key,
      medianChangePct, avgChangePct, isSkewed, breadthPct, strength, count: names.length,
      leaders: sorted.slice(0, 4),
      laggards: sorted.slice(-3).reverse(),
      stance,
    });
  }
  sectors.sort((a, b) => b.strength - a.strength);

  const all = [...buckets.values()].flat();
  const ranked = [...all].sort((a, b) => b.changePct - a.changePct);
  const megaCaps = all.filter((n) => n.isMega).sort((a, b) => b.changePct - a.changePct);

  const top = sectors[0], bottom = sectors[sectors.length - 1];
  const sessionWord =
    session === 'pre' ? 'Pre-market' : session === 'post' ? 'After-hours'
    : session === 'closed' ? 'Last cash close' : 'Today';
  const interpretation = top && bottom
    ? `${sessionWord}: ${top.label} leads (typical name ${top.medianChangePct >= 0 ? '+' : ''}${top.medianChangePct.toFixed(2)}%, ${top.breadthPct.toFixed(0)}% green)` +
      `${top.leaders[0] ? `, led by ${top.leaders[0].symbol} ${top.leaders[0].changePct >= 0 ? '+' : ''}${top.leaders[0].changePct.toFixed(1)}%` : ''}` +
      `${top.isSkewed ? ' — but the move is concentrated in one name, so the group is thinner than it looks' : ''}. ` +
      `${bottom.label} is weakest (${bottom.medianChangePct >= 0 ? '+' : ''}${bottom.medianChangePct.toFixed(2)}%). ` +
      `Trade continuation in the leaders, or look for reversals in the laggards.`
    : 'Not enough of the tape returned to rank sectors.';

  return {
    generatedAt: new Date().toISOString(),
    session,
    universeSize: universe.length,
    quoted,
    benchmarkChangePct,
    sectors,
    megaCaps,
    topLeaders: ranked.slice(0, 8),
    topLaggards: ranked.slice(-8).reverse(),
    interpretation,
  };
}

/**
 * READ-THROUGH CATALYSTS — events on OTHER tickers that move this one.
 *
 * A per-company calendar answers "what is happening to META". The more useful
 * question is "what is happening that MOVES META", and the answer routinely sits
 * on someone else's ticker: NVDA's print is a read-through on Meta's AI compute
 * story, and Oracle's capex guide is a read-through on the same demand curve.
 *
 * That is the difference between a calendar and a catalyst map, and it is
 * computable from data already here — the earnings calendar plus the sector
 * groupings the discovery universe already encodes. Two kinds of link:
 *
 *   PEER      — same sector group. A peer's print sets the tone for the group and
 *               frequently moves it more than the company's own news that week.
 *   BELLWETHER— a name whose result is read as a verdict on a whole theme. NVDA
 *               for AI compute, TSM for semis, JPM for banks. Asymmetric on
 *               purpose: NVDA moves ANET, ANET does not move NVDA.
 *
 * What this does NOT cover, and no amount of price data will: legal calendars,
 * regulatory deadlines, product launches. Those need curation or a news pipeline,
 * and pretending otherwise would be the wrong kind of confident.
 */
import { logger } from './logger';
import { DISCOVERY_UNIVERSE } from './multi-signal-discovery';

/**
 * Names whose results are read as a verdict on a theme, and the tickers that get
 * re-rated when they report. Asymmetric by design — the bellwether moves the
 * followers, not the reverse.
 */
const BELLWETHERS: { ticker: string; theme: string; movesArgs: string[] }[] = [
  { ticker: 'NVDA', theme: 'AI compute demand',
    movesArgs: ['AMD','AVGO','MRVL','ANET','SMCI','VRT','MU','TSM','ASML','ALAB','CRDO','DELL','HPE','MSFT','META','GOOGL','AMZN','ORCL','CRWV','NBIS'] },
  { ticker: 'TSM', theme: 'semiconductor cycle',
    movesArgs: ['NVDA','AMD','AVGO','QCOM','MU','ASML','KLAC','LRCX','AMAT','INTC','GFS','ARM'] },
  { ticker: 'ASML', theme: 'semi cap-equipment cycle',
    movesArgs: ['KLAC','LRCX','AMAT','ONTO','NVMI','ACLS','TER','ENTG'] },
  { ticker: 'MSFT', theme: 'enterprise AI spend',
    movesArgs: ['NVDA','ORCL','CRM','NOW','SNOW','DDOG','MDB','NET','PLTR'] },
  { ticker: 'ORCL', theme: 'AI capex and cloud backlog',
    movesArgs: ['NVDA','MSFT','AMZN','GOOGL','CRWV','NBIS','VRT','ANET'] },
  { ticker: 'JPM', theme: 'credit and bank earnings season',
    movesArgs: ['V','MA','SOFI','HOOD','COIN','ALLY','UPST','XYZ','PYPL'] },
  { ticker: 'LLY', theme: 'obesity and pharma demand',
    movesArgs: ['MRK','PFE','ABBV','AMGN','VKTX','ZTS','BMY','REGN'] },
  { ticker: 'COIN', theme: 'crypto risk appetite',
    movesArgs: ['MARA','RIOT','HUT','CLSK','MSTR','HOOD','CRCL','GLXY','IREN','WULF','BTDR'] },
];

export interface ReadThrough {
  /** The ticker whose event this is. */
  sourceSymbol: string;
  /** Why it matters to the ticker being viewed. */
  linkType: 'peer' | 'bellwether';
  theme: string | null;
  eventType: string;
  date: string;
  daysAway: number;
  session: 'pre' | 'post' | null;
  why: string;
}

/** Sector groups from the discovery universe, as symbol → group name. */
function buildGroupIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [group, syms] of Object.entries(DISCOVERY_UNIVERSE as Record<string, readonly string[]>)) {
    for (const s of syms) {
      const list = index.get(s) ?? [];
      list.push(group);
      index.set(s, list);
    }
  }
  return index;
}

let _groupIndex: Map<string, string[]> | null = null;
function groupsFor(symbol: string): string[] {
  if (!_groupIndex) _groupIndex = buildGroupIndex();
  return _groupIndex.get(symbol.toUpperCase()) ?? [];
}

function peersOf(symbol: string): Set<string> {
  const sym = symbol.toUpperCase();
  const peers = new Set<string>();
  const groups = groupsFor(sym);
  for (const [group, syms] of Object.entries(DISCOVERY_UNIVERSE as Record<string, readonly string[]>)) {
    if (!groups.includes(group)) continue;
    for (const s of syms) if (s !== sym) peers.add(s);
  }
  return peers;
}

/**
 * Events on other tickers that are read-throughs for `symbol`, soonest first.
 * `earnings` is the map from getEarningsBySymbol.
 */
export function findReadThroughs(
  symbol: string,
  earnings: Map<string, { date: string; daysAway: number; session: 'pre' | 'post' | null; companyName: string }>,
  limit = 8,
): ReadThrough[] {
  const sym = symbol.toUpperCase();
  const out: ReadThrough[] = [];

  // Bellwethers first — a theme verdict outranks a peer print.
  for (const b of BELLWETHERS) {
    if (b.ticker === sym) continue;
    if (!b.movesArgs.includes(sym)) continue;
    const e = earnings.get(b.ticker);
    if (!e) continue;
    out.push({
      sourceSymbol: b.ticker,
      linkType: 'bellwether',
      theme: b.theme,
      eventType: 'earnings',
      date: e.date,
      daysAway: e.daysAway,
      session: e.session,
      why: `${b.ticker} reports in ${e.daysAway}d and is read as the verdict on ${b.theme}. ${sym} tends to re-rate on it regardless of its own news.`,
    });
  }

  // Then peers in the same group.
  const peers = peersOf(sym);
  for (const p of peers) {
    if (out.some((r) => r.sourceSymbol === p)) continue;
    const e = earnings.get(p);
    if (!e || e.daysAway > 21) continue;
    out.push({
      sourceSymbol: p,
      linkType: 'peer',
      theme: null,
      eventType: 'earnings',
      date: e.date,
      daysAway: e.daysAway,
      session: e.session,
      why: `${p} reports in ${e.daysAway}d — a peer print that sets the tone for the group.`,
    });
  }

  out.sort((a, b) => {
    if (a.linkType !== b.linkType) return a.linkType === 'bellwether' ? -1 : 1;
    return a.daysAway - b.daysAway;
  });

  logger.debug(`[READ-THROUGH] ${sym}: ${out.length} linked events`);
  return out.slice(0, limit);
}

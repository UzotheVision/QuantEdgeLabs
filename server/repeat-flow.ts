/**
 * REPEAT-BUYER TRACKER — the same contract getting bought again, day after day.
 *
 * From the MomoEdge walkthrough, on Oracle:
 *   "Oracle had the same flow as yesterday, the 147 July 31st. So it looks like
 *    this whale keeps buying it."
 *
 * That's the highest-quality read available from flow, and it's qualitatively
 * different from a single large print. One big order is ambiguous — it can be a
 * hedge, a roll, a spread leg, or a closing trade. The SAME strike and expiry
 * being accumulated across consecutive sessions is much harder to explain away:
 * somebody is adding to a position they already have, with a thesis that has
 * survived at least one more day of price action.
 *
 * WHAT WE CAN AND CANNOT SEE
 * Our flow rows are end-of-day chain aggregates, not time-and-sales. So a row's
 * `totalPremium` is everything that traded at that strike that day — not one
 * order. Premium therefore CANNOT distinguish accumulation from churn: heavy
 * two-way trading produces a huge number while net positioning is unchanged.
 *
 * Open interest can. OI is the count of contracts actually still open at the end
 * of the day, so RISING OI across sessions means positions were opened and held,
 * not opened and closed. That is the honest accumulation signal, and it is what
 * this ranks on. Premium is reported for context only, never scored.
 */
import { db } from './db';
import { sql } from 'drizzle-orm';

export interface RepeatDay {
  date: string;
  volume: number;
  openInterest: number;
  totalPremium: number;
}

export interface RepeatContract {
  symbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  /** Distinct sessions this contract showed up in the flow scan. */
  daysSeen: number;
  /** True when those sessions are back-to-back trading days. */
  consecutive: boolean;
  firstSeen: string;
  lastSeen: string;
  days: RepeatDay[];
  /** OI on the last day minus OI on the first — the accumulation proof. */
  oiChange: number;
  oiChangePct: number | null;
  /** Aggregate strike premium across those days. CONTEXT ONLY — not a print. */
  totalPremium: number;
  /** 'accumulating' | 'churning' | 'unwinding' — from OI, not premium. */
  read: 'accumulating' | 'churning' | 'unwinding';
  why: string;
}

export interface RepeatReport {
  contracts: RepeatContract[];
  coverage: {
    /** Distinct days of flow we actually captured. */
    daysCaptured: number;
    dates: string[];
    /** Any adjacent pair exists anywhere in the captured history. */
    sufficient: boolean;
    /** The newest session has a day next to it — i.e. repeats are CURRENT. */
    current: boolean;
    /** Newest captured session. */
    latest: string | null;
    note: string;
  };
}

/** Calendar days between two YYYY-MM-DD strings. */
function dayGap(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}

/** Back-to-back allowing for weekends (Fri→Mon is 3 calendar days). */
function isConsecutive(dates: string[]): boolean {
  for (let i = 1; i < dates.length; i++) {
    if (dayGap(dates[i - 1], dates[i]) > 3) return false;
  }
  return true;
}

export async function getRepeatFlow(minDays = 2, limit = 40): Promise<RepeatReport> {
  const datesRes: any = await db.execute(
    sql`select distinct detected_date::text d from options_flow_history order by d desc limit 30`,
  );
  const dates: string[] = (datesRes.rows ?? datesRes).map((r: any) => r.d);

  // Two captured days weeks apart cannot show anyone "buying it again" — they show
  // two unrelated snapshots. And what matters for TODAY's board is specifically
  // whether the MOST RECENT session has a predecessor next to it: an adjacent pair
  // sitting six months back means the tracker demonstrably works but is describing
  // stale positioning, which is a different claim entirely.
  const hasAdjacentPair = dates.some((d, i) => i > 0 && dayGap(d, dates[i - 1]) <= 3);
  const latestHasPredecessor = dates.length > 1 && dayGap(dates[1], dates[0]) <= 3;

  const rowsRes: any = await db.execute(sql`
    select symbol, option_type, strike_price, expiration_date::text exp, detected_date::text d,
           max(volume) volume, max(open_interest) oi, sum(total_premium) prem
    from options_flow_history
    group by 1,2,3,4,5
  `);
  const rows = (rowsRes.rows ?? rowsRes) as any[];

  const byContract = new Map<string, { meta: any; days: Map<string, RepeatDay> }>();
  for (const r of rows) {
    const key = `${r.symbol}|${r.option_type}|${r.strike_price}|${r.exp}`;
    if (!byContract.has(key)) {
      byContract.set(key, {
        meta: { symbol: r.symbol, optionType: r.option_type, strike: Number(r.strike_price), expiry: r.exp },
        days: new Map(),
      });
    }
    byContract.get(key)!.days.set(r.d, {
      date: r.d,
      volume: Number(r.volume ?? 0),
      openInterest: Number(r.oi ?? 0),
      totalPremium: Number(r.prem ?? 0),
    });
  }

  const out: RepeatContract[] = [];
  for (const { meta, days } of byContract.values()) {
    if (days.size < minDays) continue;
    const list = Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));
    const first = list[0];
    const last = list[list.length - 1];

    const oiChange = last.openInterest - first.openInterest;
    const oiChangePct = first.openInterest > 0 ? (oiChange / first.openInterest) * 100 : null;

    // Thresholds are on OI because that's the only field that reflects NET
    // positioning. A 5% band absorbs ordinary settlement noise.
    let read: RepeatContract['read'];
    let why: string;
    if (oiChangePct != null && oiChangePct > 5) {
      read = 'accumulating';
      why = `Open interest grew ${oiChangePct.toFixed(0)}% (${first.openInterest.toLocaleString()} → ${last.openInterest.toLocaleString()}) — positions opened and held`;
    } else if (oiChangePct != null && oiChangePct < -5) {
      read = 'unwinding';
      why = `Open interest fell ${Math.abs(oiChangePct).toFixed(0)}% — the position is being closed, not built`;
    } else {
      read = 'churning';
      why = 'Heavy trading but open interest flat — opened and closed the same day, not accumulation';
    }

    out.push({
      ...meta,
      daysSeen: list.length,
      consecutive: isConsecutive(list.map((d) => d.date)),
      firstSeen: first.date,
      lastSeen: last.date,
      days: list,
      oiChange,
      oiChangePct,
      totalPremium: list.reduce((s, d) => s + d.totalPremium, 0),
      read,
      why,
    });
  }

  // Accumulation first, then by how much OI was actually added. Deliberately NOT
  // by premium — that would just re-rank by which strike is busiest.
  const order = { accumulating: 0, churning: 1, unwinding: 2 } as const;
  out.sort((a, b) => order[a.read] - order[b.read] || b.oiChange - a.oiChange);

  return {
    contracts: out.slice(0, limit),
    coverage: {
      daysCaptured: dates.length,
      dates,
      sufficient: hasAdjacentPair,
      current: latestHasPredecessor,
      latest: dates[0] ?? null,
      note: !hasAdjacentPair
        ? `Only ${dates.length} sessions of flow captured, none adjacent. A repeat buyer is only visible across consecutive days, so this stays empty until flow ingestion runs daily.`
        : latestHasPredecessor
          ? `${dates.length} sessions captured; the latest (${dates[0]}) has a prior session to compare against.`
          : `${dates.length} sessions captured, but the latest (${dates[0]}) has no adjacent prior session — every repeat below is from an older pair and describes PAST positioning, not today's. Daily ingestion is what makes this live.`,
    },
  };
}

/**
 * WHALE EXITS — positions being CLOSED, not opened.
 *
 * From the walkthrough: "I have to have a[n] unusual basically showcasing if a
 * whale exited… I want to add a tracker that shows when whales sell."
 *
 * The same open-interest logic that proves accumulation proves the opposite when
 * it runs backwards. Heavy volume with FALLING open interest means contracts were
 * traded and then closed out — the position is being taken off, not put on. That
 * matters because a big print on a contract someone is exiting reads as fresh
 * conviction on a tape that only shows premium, and it is the reverse.
 *
 * Size gate is on the OI actually given up, not premium: a 200-contract unwind on
 * a 10,000-lot position is noise, and premium cannot tell you which is which.
 */
export interface WhaleExit extends RepeatContract {
  /** Contracts closed between the first and last session seen. */
  contractsClosed: number;
}

export async function getWhaleExits(minDays = 2, limit = 30): Promise<{
  exits: WhaleExit[];
  coverage: RepeatReport['coverage'];
}> {
  const { contracts, coverage } = await getRepeatFlow(minDays, 500);

  const exits = contracts
    .filter((c) => c.read === 'unwinding')
    // EXPIRY IS NOT AN EXIT. Open interest collapses to nothing as a contract
    // expires no matter what anyone decides — MSFT $480P last seen on its own
    // expiration date showed a 97% "unwind" that was simply the contract dying.
    // Anything inside three sessions of expiry is excluded: the OI change there
    // carries no information about conviction.
    .filter((c) => {
      const exp = new Date(`${c.expiry}T12:00:00Z`).getTime();
      const seen = new Date(`${c.lastSeen}T12:00:00Z`).getTime();
      return (exp - seen) / 86_400_000 > 3;
    })
    // Require a materially sized position AND a meaningful share of it gone, so a
    // small drift on a huge open interest doesn't register as somebody leaving.
    .filter((c) => c.days[0].openInterest >= 500 && (c.oiChangePct ?? 0) <= -15)
    .map((c) => ({ ...c, contractsClosed: Math.abs(c.oiChange) }))
    .sort((a, b) => b.contractsClosed - a.contractsClosed)
    .slice(0, limit);

  return { exits, coverage };
}

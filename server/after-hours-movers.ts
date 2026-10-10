/**
 * AFTER-HOURS MOVERS — the session where tomorrow's gap is decided.
 *
 * AAOI fell 13% in a post session while the board still carried it as a LONG at
 * conviction 11, and nothing anywhere said a word. Every piece needed to catch
 * that already existed: extended-hours quotes were being fetched for sector
 * leadership, the board knew it held the name, and the gap engine knows what an
 * overnight move does to the next open. None of them were connected.
 *
 * This connects them, and it is the same point as watching gaps. A gap is not an
 * event that happens at 09:30 — it is the PRICED-IN result of a move that already
 * happened while the regular session was shut. By the time it shows up as a gap
 * on a daily chart it is several hours old and fully reflected in the premium of
 * anything you were holding.
 *
 * Three things worth saying out loud, and only the third needs any cleverness:
 *
 *   MOVE      Something moved hard while the tape was closed. That is news, and
 *             for a name we hold or rank it is news about a position.
 *   CONFLICT  We are LONG a name that just fell, or SHORT one that just ran. The
 *             most valuable row here, because it is the one where the board is
 *             now saying the opposite of what the tape just said.
 *   EXPOSURE  An open option position on a name that moved. Overnight moves are
 *             where long premium is decided, and the position cannot be managed
 *             until the open regardless.
 *
 * Deliberately does NOT try to explain WHY a name moved. The earnings calendar
 * covers 14% of the universe, so an explanation would be a guess most of the
 * time, and a confident wrong reason is worse than an honest "this moved, go
 * look". It reports the move and leaves the cause to the human.
 */
import { logger } from './logger';

export type MoverKind = 'conflict' | 'exposure' | 'move';

export interface AfterHoursMover {
  symbol: string;
  lastPrice: number;
  changePct: number;
  session: string;
  kind: MoverKind;
  /** Board direction, when the name is ranked. */
  boardDirection?: 'long' | 'short';
  boardConviction?: number;
  /** True when an open position exists on this name. */
  held: boolean;
  /** What this implies for the next open, in plain terms. */
  read: string;
}

/** Below this an extended move is noise, not news. */
export const MATERIAL_MOVE_PCT = 4;

export interface AfterHoursScan {
  session: string;
  scanned: number;
  movers: AfterHoursMover[];
  /**
   * False when the board cache was cold, which means CONFLICT could not be
   * detected and every row degraded to a plain move. Reported rather than left
   * silent: a scan that quietly loses its most valuable classification looks
   * identical to one where nothing conflicted.
   */
  boardAvailable: boolean;
  asOf: string;
}

export async function scanAfterHoursMovers(
  opts: { threshold?: number; limit?: number } = {},
): Promise<AfterHoursScan> {
  const threshold = opts.threshold ?? MATERIAL_MOVE_PCT;
  const limit = opts.limit ?? 25;

  const { currentSession, fetchExtendedQuote } = await import('./extended-hours');
  const session = await currentSession();

  if (session === 'regular') {
    return { session, scanned: 0, movers: [], boardAvailable: true, asOf: new Date().toISOString() };
  }

  // What we actually care about, in priority order: names we hold, names the
  // board ranks, then the rest of the universe. A move in something we own is
  // worth a request; a move in something we have never looked at is worth less.
  const held = new Map<string, boolean>();
  try {
    const { getBotPortfolio } = await import('./quant-bot');
    const { getOpenPositions } = await import('./paper-trading-service');
    const p = await getBotPortfolio();
    for (const pos of await getOpenPositions(p.id)) held.set(pos.symbol.toUpperCase(), true);
  } catch { /* the scan is still useful without position context */ }

  const board = new Map<string, { direction: 'long' | 'short'; conviction: number }>();
  let boardAvailable = false;
  try {
    const { peekConvictions } = await import('./convictions-engine');
    const peek = peekConvictions();
    boardAvailable = !!peek?.data?.picks?.length;
    for (const p of (peek?.data?.picks ?? []) as any[]) {
      board.set(String(p.symbol).toUpperCase(), {
        direction: p.direction, conviction: p.convictionScore ?? 0,
      });
    }
  } catch { /* optional */ }

  if (!boardAvailable) {
    logger.warn(
      '[AFTER-HOURS] board cache is cold — CONFLICT detection unavailable this scan, '
      + 'every mover will read as a plain move even if it contradicts a live pick',
    );
  }

  const { getAllApprovedSymbols } = await import('@shared/approved-tickers');
  const symbols = Array.from(new Set<string>([
    ...held.keys(), ...board.keys(), ...getAllApprovedSymbols(),
  ]));

  const movers: AfterHoursMover[] = [];
  const CONC = 8;
  for (let i = 0; i < symbols.length; i += CONC) {
    const slice = symbols.slice(i, i + CONC);
    const rows = await Promise.all(slice.map((s) => fetchExtendedQuote(s).catch(() => null)));
    for (const q of rows) {
      if (!q || !Number.isFinite(q.changePct)) continue;
      const pct = Number(q.changePct);
      if (Math.abs(pct) < threshold) continue;

      const sym = String(q.symbol).toUpperCase();
      const b = board.get(sym);
      const isHeld = held.has(sym);

      // A board direction that disagrees with the move is the row worth reading.
      const conflicts = b
        ? (b.direction === 'long' && pct <= -threshold) || (b.direction === 'short' && pct >= threshold)
        : false;

      const kind: MoverKind = conflicts ? 'conflict' : isHeld ? 'exposure' : 'move';

      const read = conflicts
        ? `Board is ${b!.direction.toUpperCase()} at conviction ${b!.conviction}, and it just moved `
          + `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% the other way while the tape was shut. `
          + `That gap is already priced; the board has not seen it.`
        : isHeld
          ? `Open position, ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% after hours. Nothing can be done `
            + `about it until the open, which is exactly why it matters now rather than then.`
          : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% with the tape shut. Whatever caused it will be a `
            + `gap at the next open.`;

      movers.push({
        symbol: sym, lastPrice: Number(q.lastPrice), changePct: pct,
        session: String(q.session ?? session), kind,
        boardDirection: b?.direction, boardConviction: b?.conviction,
        held: isHeld, read,
      });
    }
  }

  // Conflicts first, then exposure, then size of move.
  const rank: Record<MoverKind, number> = { conflict: 0, exposure: 1, move: 2 };
  movers.sort((a, b) =>
    (rank[a.kind] - rank[b.kind]) || (Math.abs(b.changePct) - Math.abs(a.changePct)),
  );

  logger.info(
    `[AFTER-HOURS] ${session}: ${movers.length} movers over ${threshold}% `
    + `(${movers.filter((m) => m.kind === 'conflict').length} conflict with the board)`,
  );

  return {
    session, scanned: symbols.length,
    movers: movers.slice(0, limit),
    boardAvailable,
    asOf: new Date().toISOString(),
  };
}

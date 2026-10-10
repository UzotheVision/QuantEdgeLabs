/**
 * WEEKLY WATCHLIST SEEDER
 * =======================
 * Auto-populates a per-user weekly focus list every Monday morning by
 * pulling the top conviction picks from the past 7 days. The user can
 * still edit/add/remove items manually all week — the seeder is
 * idempotent per (userId, symbol, weekStartDate).
 *
 * This is the "Weekly Watchlist" entry point referenced in the
 * convictions priority gate and the Live Tracker.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { watchlist, type InsertWatchlist } from "@shared/schema";
import { logger } from "./logger";

/**
 * Compute the ISO date (YYYY-MM-DD) of the Monday for the week containing
 * a given date. Used as the grouping key for weekly watchlist items.
 */
export function mondayOfWeek(d: Date = new Date()): string {
  const date = new Date(d);
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

export interface SeedResult {
  weekStartDate: string;
  inserted: number;
  skipped: number;
  symbols: string[];
}

/**
 * Seed the weekly watchlist for a user with the top conviction picks of
 * the past 7 days. Idempotent — re-running the same Monday is a no-op.
 */
export async function seedWeeklyWatchlist(
  userId: string,
  weekStartDate: string = mondayOfWeek(),
  opts: { limit?: number; minScore?: number } = {},
): Promise<SeedResult> {
  const limit = opts.limit ?? 15;
  const minScore = opts.minScore ?? 18;

  logger.info(
    `[WEEKLY-SEED] starting for user=${userId} week=${weekStartDate} limit=${limit}`,
  );

  // Pull a wide window so we get a real weekly leaderboard, not just
  // today's picks. Skip live revalidation — we want a snapshot of where
  // the engine ranked these names *for the week*, not a moment-in-time
  // chase filter.
  const { buildConvictions } = await import("./convictions-engine");
  const conv = await buildConvictions({
    lookbackHours: 168, // 7 days
    limit: limit * 2, // grab some buffer for dedup
    minScore,
    watchlistOnly: true,
    skipLiveRevalidation: true,
  });

  // Dedupe by symbol — keep highest score per ticker
  const bySymbol = new Map<string, (typeof conv.picks)[number]>();
  for (const pick of conv.picks) {
    const existing = bySymbol.get(pick.symbol);
    if (!existing || pick.convictionScore > existing.convictionScore) {
      bySymbol.set(pick.symbol, pick);
    }
  }
  const top = Array.from(bySymbol.values())
    .sort((a, b) => b.convictionScore - a.convictionScore)
    .slice(0, limit);

  let inserted = 0;
  let skipped = 0;
  const symbols: string[] = [];

  for (const pick of top) {
    // Idempotency check: skip if a row already exists for this user/symbol/week
    const existing = await db
      .select({ id: watchlist.id })
      .from(watchlist)
      .where(
        and(
          eq(watchlist.userId, userId),
          eq(watchlist.symbol, pick.symbol),
          eq(watchlist.category, "weekly" as any),
          eq(watchlist.weekStartDate, weekStartDate),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    const insert: InsertWatchlist = {
      userId,
      symbol: pick.symbol,
      assetType: (pick.assetType as any) || "stock",
      category: "weekly" as any,
      addedAt: new Date().toISOString(),
      thesis: pick.thesis || pick.catalyst || "",
      sector: pick.sector || null,
      conviction: pick.convictionBand === "S" || pick.convictionBand === "A" ? "high" : "medium",
      // Weekly-specific snapshot fields
      weekStartDate,
      autoSeeded: true,
      weeklyConvictionScore: pick.convictionScore,
      weeklyConvictionBand: pick.convictionBand,
      weeklyThesis: pick.thesis || pick.catalyst || "",
    } as InsertWatchlist;

    try {
      await db.insert(watchlist).values(insert as any);
      inserted++;
      symbols.push(pick.symbol);
    } catch (err) {
      logger.warn(`[WEEKLY-SEED] insert failed for ${pick.symbol}:`, err);
    }
  }

  logger.info(
    `[WEEKLY-SEED] done user=${userId} week=${weekStartDate} inserted=${inserted} skipped=${skipped}`,
  );

  return { weekStartDate, inserted, skipped, symbols };
}

/**
 * Get the current weekly watchlist for a user (defaults to current Monday).
 */
export async function getWeeklyWatchlist(
  userId: string,
  weekStartDate: string = mondayOfWeek(),
) {
  return await db
    .select()
    .from(watchlist)
    .where(
      and(
        eq(watchlist.userId, userId),
        eq(watchlist.category, "weekly" as any),
        eq(watchlist.weekStartDate, weekStartDate),
      ),
    )
    .orderBy(sql`${watchlist.weeklyConvictionScore} DESC NULLS LAST`);
}

/**
 * List the distinct week-start dates a user has weekly watchlists for.
 * Used by the UI for the historical week selector.
 */
export async function listWeeklyWeeks(userId: string, limit = 12): Promise<string[]> {
  const rows = await db
    .selectDistinct({ wk: watchlist.weekStartDate })
    .from(watchlist)
    .where(
      and(
        eq(watchlist.userId, userId),
        eq(watchlist.category, "weekly" as any),
      ),
    )
    .limit(limit);
  return rows
    .map((r) => r.wk)
    .filter((x): x is string => !!x)
    .sort()
    .reverse();
}

/**
 * Symbol list helper used by the live tracker — returns just the unique
 * symbols across all users for the current week. (Multi-user aware in
 * case multiple sessions track the same week.)
 */
export async function getCurrentWeekSymbols(): Promise<string[]> {
  const week = mondayOfWeek();
  const rows = await db
    .selectDistinct({ symbol: watchlist.symbol })
    .from(watchlist)
    .where(
      and(
        eq(watchlist.category, "weekly" as any),
        eq(watchlist.weekStartDate, week),
      ),
    );
  return rows.map((r) => r.symbol).filter((x): x is string => !!x);
}

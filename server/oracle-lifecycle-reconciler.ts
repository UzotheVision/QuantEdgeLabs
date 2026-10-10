import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { paperPositions, tradeIdeas, tradePriceSnapshots } from "@shared/schema";
import {
  readOracleExecutionAudit,
  recordPaperExecution,
  withOracleExecutionAudit,
} from "@shared/oracle-lifecycle";
import { logger } from "./logger";

/**
 * TRIGGER OBSERVER
 *
 * The UI refuses to call a setup triggered on price alone — it waits for
 * `executionAudit.state === "triggered"`, on the principle that a plan is not an
 * entry. That principle is right, but NOTHING in the codebase ever wrote that
 * state: the only writer was recordPaperExecution(), which jumps straight to
 * "executed" and only fires on a paper fill. So every published idea sat at
 * "pending trigger" forever while price ran clean through the entry — LLY
 * showing "waiting" with the trigger 1.6% BELOW spot.
 *
 * This closes the gap: it observes the trigger and records when and at what
 * price it was observed. It never invents a fill — "triggered" means the level
 * traded, not that a position exists.
 */
export async function observeTriggeredIdeas(hoursBack = 96): Promise<number> {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const rows = await db
    .select()
    .from(tradeIdeas)
    .where(and(
      gte(tradeIdeas.timestamp, cutoff),
      eq(tradeIdeas.outcomeStatus, "open"),
      eq(tradeIdeas.archived, false),
    ))
    .orderBy(desc(tradeIdeas.timestamp))
    .limit(1000);

  // Only rows still waiting. An executed or closed idea is further along the
  // lifecycle and must never be walked backwards.
  const pending = rows.filter((idea) => {
    const state = readOracleExecutionAudit(idea.convergenceSignalsJson)?.state;
    return state == null || state === "coverage" || state === "thesis" || state === "pending_trigger";
  });
  if (pending.length === 0) return 0;

  // Scanner checkpoints are already our durable path evidence. A live poll can
  // miss a quick touch that reverses before the next two-minute observation;
  // taking the recorded max/min makes trigger detection monotonic and auditable.
  const extremaRows = await db
    .select({
      tradeIdeaId: tradePriceSnapshots.tradeIdeaId,
      high: sql<number>`max(${tradePriceSnapshots.currentPrice})`,
      low: sql<number>`min(${tradePriceSnapshots.currentPrice})`,
    })
    .from(tradePriceSnapshots)
    .where(inArray(tradePriceSnapshots.tradeIdeaId, pending.map((idea) => idea.id)))
    .groupBy(tradePriceSnapshots.tradeIdeaId);
  const checkpointExtrema = new Map(extremaRows.map((row) => [row.tradeIdeaId, row]));

  /**
   * Ask for each row under ITS OWN asset class.
   *
   * This used to hardcode `assetType: "stock"` for every pending row. That is
   * right for option rows — entry/stop/target are underlying levels, so an
   * option is priced off its equity, never an OCC symbol — but it was applied
   * to crypto too, and the pricing service has a separate crypto path. Asking
   * for JUP and TRUMP as stocks returned no quote, every time, so those rows
   * could never be observed as triggered and sat at PENDING TRIGGER
   * indefinitely — reading as "never entered" no matter what the coin did.
   *
   * Options and futures still resolve to the underlying equity symbol; only
   * crypto changes behaviour.
   */
  const assetOf = (t: string | null | undefined): "stock" | "crypto" =>
    String(t ?? "").toLowerCase() === "crypto" ? "crypto" : "stock";

  const byName = new Map<string, "stock" | "crypto">();
  for (const i of pending) {
    if (!i.symbol) continue;
    // A symbol seen as crypto anywhere is priced as crypto.
    const a = assetOf((i as any).assetType);
    if (a === "crypto" || !byName.has(i.symbol)) byName.set(i.symbol, a);
  }

  const symbols = Array.from(byName.keys());
  const { getRealtimeBatchQuotes } = await import("./realtime-pricing-service");
  const quotes = await getRealtimeBatchQuotes(
    symbols.map((symbol) => ({ symbol, assetType: byName.get(symbol)! })),
  );

  const nowIso = new Date().toISOString();
  let observed = 0;

  for (const idea of pending) {
    const entry = idea.entryPrice;
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;

    const quote = quotes.get(idea.symbol);
    const live = quote && Number.isFinite(quote.price) ? quote.price : null;

    // Persisted extrema beat a spot check: a trigger that traded between two
    // polls is still a trigger, and sampling live price alone would miss it.
    const isLong = idea.direction !== "short";
    const persistedExtreme = isLong ? idea.highestPriceReached : idea.lowestPriceReached;
    const checkpoint = checkpointExtrema.get(idea.id);
    const checkpointExtreme = isLong ? checkpoint?.high : checkpoint?.low;
    const best = [
      live,
      typeof persistedExtreme === "number" ? persistedExtreme : null,
      typeof checkpointExtreme === "number" ? checkpointExtreme : null,
    ].filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v),
    );
    if (best.length === 0) continue;

    const reached = isLong ? Math.max(...best) : Math.min(...best);
    const triggered = isLong ? reached >= entry : reached <= entry;
    if (!triggered) continue;

    const audit = withOracleExecutionAudit(idea.convergenceSignalsJson, {
      version: 1,
      state: "triggered",
      triggerType: isLong ? "breakout" : "breakdown",
      triggerPrice: entry,
      triggerObservedAt: nowIso,
      triggerObservedPrice: reached,
    });

    await db.update(tradeIdeas)
      .set({ convergenceSignalsJson: audit as any })
      .where(eq(tradeIdeas.id, idea.id));
    observed++;
  }

  if (observed) {
    const { invalidateConvictionsCache } = await import("./convictions-engine");
    invalidateConvictionsCache();
    logger.info(`[ORACLE LIFECYCLE] Observed ${observed} trigger${observed === 1 ? "" : "s"} (pending → triggered)`);
  }
  return observed;
}

/**
 * Paper positions are the execution source of truth. Older versions could
 * close the linked research row while the paper position was still open,
 * because publishing an idea was treated as entering it. Repair only this
 * unambiguous mismatch; it is safe and idempotent on every boot.
 */
export async function reconcileOpenPaperExecutions(): Promise<number> {
  const rows = await db
    .select({ position: paperPositions, idea: tradeIdeas })
    .from(paperPositions)
    .innerJoin(tradeIdeas, eq(paperPositions.tradeIdeaId, tradeIdeas.id))
    .where(and(eq(paperPositions.status, "open"), eq(tradeIdeas.archived, false)));

  let reconciled = 0;
  for (const { position, idea } of rows) {
    const audit = recordPaperExecution(idea.convergenceSignalsJson, {
      price: position.entryPrice,
      at: position.entryTime,
      paperPositionId: position.id,
    });

    const needsRepair = idea.outcomeStatus !== "open" || JSON.stringify(idea.convergenceSignalsJson) !== JSON.stringify(audit);
    if (!needsRepair) continue;

    await db.update(tradeIdeas)
      .set({
        outcomeStatus: "open",
        exitPrice: null,
        exitDate: null,
        exitPremium: null,
        realizedPnL: null,
        percentGain: null,
        optionPercentGain: null,
        outcomeNotes: null,
        resolutionReason: null,
        actualHoldingTimeMinutes: null,
        convergenceSignalsJson: audit as any,
      })
      .where(eq(tradeIdeas.id, idea.id));
    reconciled++;
  }

  if (reconciled) {
    logger.info(`[ORACLE LIFECYCLE] Reconciled ${reconciled} live paper execution${reconciled === 1 ? "" : "s"}`);
  }
  return reconciled;
}

/**
 * Repair the exact historical signature produced by the old option-direction
 * inversion. A short idea cannot have hit its stop when its recorded high stayed
 * below that stop (with symmetric rules for the other direction/barrier).
 *
 * This is deliberately narrow: recent automatic outcomes, no linked execution,
 * and persisted extrema that prove the outcome impossible. No row is deleted.
 */
export async function repairImpossibleRecentOutcomes(hoursBack = 72): Promise<number> {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const [rows, linked] = await Promise.all([
    db.select().from(tradeIdeas)
      .where(and(
        gte(tradeIdeas.timestamp, cutoff),
        inArray(tradeIdeas.outcomeStatus, ["hit_target", "hit_stop"]),
        inArray(tradeIdeas.resolutionReason, ["auto_target_hit", "auto_stop_hit"]),
      ))
      .orderBy(desc(tradeIdeas.timestamp)),
    db.select({ tradeIdeaId: paperPositions.tradeIdeaId })
      .from(paperPositions)
      .where(isNotNull(paperPositions.tradeIdeaId)),
  ]);

  const executedIds = new Set(linked.map((row) => row.tradeIdeaId).filter(Boolean));
  let repaired = 0;
  for (const idea of rows) {
    if (executedIds.has(idea.id)) continue;
    const high = idea.highestPriceReached;
    const low = idea.lowestPriceReached;
    const impossible = idea.direction === "short"
      ? idea.outcomeStatus === "hit_stop"
        ? typeof high === "number" && high < idea.stopLoss
        : typeof low === "number" && low > idea.targetPrice
      : idea.outcomeStatus === "hit_stop"
        ? typeof low === "number" && low > idea.stopLoss
        : typeof high === "number" && high < idea.targetPrice;

    if (!impossible) continue;
    await db.update(tradeIdeas).set({
      outcomeStatus: "open",
      exitPrice: null,
      exitDate: null,
      exitPremium: null,
      realizedPnL: null,
      percentGain: null,
      optionPercentGain: null,
      outcomeNotes: null,
      resolutionReason: null,
      actualHoldingTimeMinutes: null,
      predictionAccurate: null,
      predictionAccuracyPercent: null,
      predictionValidatedAt: null,
      validatedAt: null,
    }).where(eq(tradeIdeas.id, idea.id));
    repaired++;
  }

  if (repaired) {
    logger.warn(`[ORACLE LIFECYCLE] Reopened ${repaired} mathematically impossible automatic outcome${repaired === 1 ? "" : "s"}`);
  }
  return repaired;
}

/**
 * HORIZON EXPIRY
 *
 * An idea has a stated horizon and the platform already computes it — the
 * cockpit renders "37% of 5d used" on every card. Nothing ever enforced it.
 *
 * Measured on the live book, 2026-08-27:
 *   122 open ideas
 *     13 carried entry_valid_until — and ALL 13 had already passed, still open
 *    109 carried no expiry at all
 *     16 were holding_period='day' with an average age of 22 HOURS
 *     19 of 40 distinct symbols had been open longer than 24h, oldest 46h
 *
 * That is why the same names cycle: the scanners keep re-finding setups that
 * were valid two days ago, and nothing retires the originals. The duplicate
 * gate stops the re-publishing; this retires what is already stale.
 *
 * Horizons mirror lib/oracle/signal-geometry.ts → horizonDaysFor, so a card
 * showing "100% of 5d used" and this pass agree by construction rather than by
 * coincidence.
 *
 * Deliberately NON-DESTRUCTIVE: rows are marked expired, never deleted. An
 * expired idea is still a record of what was published and is still needed to
 * score the book honestly — 156 rows already carry that status.
 *
 * Only untriggered/open ideas expire. An idea that has TRIGGERED is a live
 * position in the user's mind; retiring it out from under them because a clock
 * ran out would be worse than leaving it stale.
 */
const HORIZON_DAYS: Record<string, number> = {
  day: 1,
  swing: 5,
  'week-ending': 5,
  position: 30,
};
const DEFAULT_HORIZON_DAYS = 10;

/**
 * Calendar days to allow for N sessions — weekends are not trading time.
 *
 * No blanket +1 buffer: a first pass added one and gave a DAY trade three
 * calendar days, so the 16 day-ideas sitting at an average age of 22 hours all
 * survived. The buffer only makes sense for multi-session horizons, where a
 * weekend can legitimately fall inside the window.
 */
function sessionsToCalendarDays(sessions: number): number {
  if (sessions <= 1) return 1;
  return Math.ceil(sessions * 1.45);
}

/**
 * A DAY idea is scoped to ONE SESSION, so elapsed hours are the wrong test —
 * one published at 14:00 is dead at that day's close, 22 hours later but well
 * short of any 24h threshold. The honest question is whether its session has
 * ended, which is a DATE comparison.
 */
function dayIdeaSessionEnded(publishedMs: number, nowMs: number): boolean {
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return d(publishedMs) !== d(nowMs);
}

export async function expireStaleIdeas(): Promise<number> {
  const rows = await db
    .select()
    .from(tradeIdeas)
    .where(and(
      eq(tradeIdeas.outcomeStatus, "open"),
      eq(tradeIdeas.archived, false),
    ))
    .limit(2000);

  let expired = 0;
  const now = Date.now();

  for (const idea of rows as any[]) {
    const started = Date.parse(idea.timestamp);
    if (!Number.isFinite(started)) continue;

    // Never retire something the user is treating as live.
    const state = readOracleExecutionAudit(idea.convergenceSignalsJson)?.state;
    if (state === "executed") continue;

    const hp = String(idea.holdingPeriod ?? "").toLowerCase();
    const sessions = HORIZON_DAYS[hp] ?? DEFAULT_HORIZON_DAYS;
    const ageDays = (now - started) / 86_400_000;

    const stale = hp === "day"
      ? dayIdeaSessionEnded(started, now)
      : ageDays > sessionsToCalendarDays(sessions);
    if (!stale) continue;

    await db.update(tradeIdeas)
      .set({
        // outcome_status is the lifecycle field — `status` only accepts
        // draft/published/archived, and every "open" query in the codebase
        // keys off outcome_status, so this alone retires the row.
        outcomeStatus: "expired",
        // Say WHY, so a later audit can tell a horizon expiry from a stop-out.
        analysis: `${idea.analysis ?? ""}\n\n[HORIZON EXPIRY] ${hp || "unspecified"} idea published ` +
          `${ageDays.toFixed(1)}d ago, past its ${sessions}-session horizon. Never resolved to target or stop.`,
      })
      .where(eq(tradeIdeas.id, idea.id));
    expired++;
  }

  if (expired > 0) {
    logger.info(`[ORACLE LIFECYCLE] ⏳ Expired ${expired} ideas past their stated horizon`);
  }
  return expired;
}

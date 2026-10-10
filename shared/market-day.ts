/**
 * The current MARKET date (US/Eastern), as YYYY-MM-DD.
 *
 * `new Date().toISOString().split('T')[0]` returns the UTC date, which is a
 * different day from the market's for a four-to-five hour window every evening.
 * At 22:23 ET on Aug 20 the UTC date is already Aug 21, so code that stamped or
 * filtered market-dated rows with it was reading and writing the wrong session:
 * the flow→GEX convergence engine queried `detectedDate >= '2026-08-21'` against
 * rows stamped '2026-08-20' and silently found nothing, every night after 8pm ET.
 *
 * Anything keyed to a TRADING day — flow captures, daily dedupe keys, "today's"
 * signals — must use this. Genuine wall-clock timestamps should stay UTC.
 */
const ET = 'America/New_York';

export function marketDateET(d: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape these columns store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** The market date N calendar days back — for "last 7 sessions" style windows. */
export function marketDateDaysAgo(days: number, from: Date = new Date()): string {
  return marketDateET(new Date(from.getTime() - days * 86_400_000));
}

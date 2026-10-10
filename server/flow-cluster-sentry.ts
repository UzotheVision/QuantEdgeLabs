/**
 * FLOW CLUSTER SENTRY — the mouth the flow layer never had.
 *
 * The META miss, root-caused: $20M clustered into one name's next-day strikes
 * and the platform knew (board rows existed by 1:46 PM) but had no way to SAY
 * it — the board is pull-only, the pulse narrates scans not findings, and no
 * flow finding had a push channel. The operator learned about their own data
 * from a rival's Discord bot at 3:15.
 *
 * Every sweep (5 min, cash hours) this aggregates the day's prints per
 * single-name symbol. A cluster — >=$5M total premium across >=3 prints —
 * fires ONCE per tier per day to the System Pulse and Discord, carrying the
 * one line no chain snapshot can produce: the Bullflow aggressor lean. A
 * bearish lean is delivered as a READ even when the discipline gate blocks
 * the trade — the gate governs positions, not information.
 */
import { logger } from './logger';

// Index/leveraged tape — hedging churn, never a "cluster finding".
const INDEX_TAPE = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'SPX', 'XSP', 'NDX', 'VIX', 'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UVXY', 'SMH', 'SOXX', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLC', 'XLB', 'XLRE', 'IGV', 'XBI', 'GLD', 'SLV', 'USO', 'TLT', 'HYG', 'EEM', 'FXI', 'EWZ', 'GDX', 'GDXU', 'ARKK', 'KRE', 'SPXL', 'SPXS', 'UPRO', 'TSLL', 'TSLG', 'TSLR', 'NVDL', 'SMCX', 'PLTU', 'MSTU', 'MSTX', 'BITX']);

const TIERS = [5e6, 20e6, 50e6];          // alert once per tier per symbol per day
const MIN_PRINTS = 3;

let alerted = new Map<string, number>();  // symbol → highest tier index fired
let alertedDay = '';

async function discordFlow(content: string): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_OPTIONSTRADES || process.env.DISCORD_WEBHOOK_QUANTFLOOR;
  if (!url) return;
  try {
    const { postDiscordWebhook } = await import('./discord-service');
    await postDiscordWebhook(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    logger.warn('[FLOW-SENTRY] discord relay failed (pulse still recorded):', err);
  }
}

export async function runFlowClusterSweep(): Promise<number> {
  const { marketDateET } = await import('@shared/market-day');
  const today = marketDateET();
  if (alertedDay !== today) { alerted = new Map(); alertedDay = today; }

  const { getTodayFlows } = await import('./options-flow-scanner');
  const agg = new Map<string, { call: number; put: number; prints: number }>();
  for (const f of getTodayFlows()) {
    const sym = f.symbol.toUpperCase();
    if (INDEX_TAPE.has(sym)) continue;
    const a = agg.get(sym) ?? { call: 0, put: 0, prints: 0 };
    const dollars = f.premium * 100;  // store units → real dollars
    if (f.optionType === 'call') a.call += dollars; else a.put += dollars;
    a.prints++;
    agg.set(sym, a);
  }

  let fired = 0;
  for (const [sym, a] of agg) {
    const total = a.call + a.put;
    if (a.prints < MIN_PRINTS) continue;
    let tier = -1;
    for (let t = TIERS.length - 1; t >= 0; t--) { if (total >= TIERS[t]) { tier = t; break; } }
    if (tier < 0 || (alerted.get(sym) ?? -1) >= tier) continue;
    alerted.set(sym, tier);
    fired++;

    // The aggressor lean — the line the META miss was missing. Cached 3 min
    // in the service; a cold read is skipped, never invented.
    let leanLine = 'aggressor lean: not measured';
    let bearishRead = false;
    try {
      const { bullflowEnabled, getNetPremiumToday } = await import('./bullflow-service');
      if (bullflowEnabled()) {
        const read = await getNetPremiumToday(sym);
        if (read) {
          const f2 = (n: number) => `${n < 0 ? '−' : '+'}$${(Math.abs(n) / 1e6).toFixed(1)}M`;
          leanLine = `aggressor lean: ${read.lean.toUpperCase()} (calls net ${f2(read.callsNetPremium)}, puts net ${f2(read.putsNetPremium)})`;
          bearishRead = read.lean === 'short';
        }
      }
    } catch { /* lean unavailable — the cluster still reports */ }

    const skew = a.put > 0 ? (a.call / a.put) : Infinity;
    const skewStr = skew === Infinity ? 'all calls' : skew >= 1 ? `${skew.toFixed(1)}:1 calls` : `${(1 / skew).toFixed(1)}:1 puts`;
    const msg = `FLOW CLUSTER: ${sym} — $${(total / 1e6).toFixed(1)}M across ${a.prints} prints (${skewStr}) · ${leanLine}`;

    try {
      const { pulse } = await import('./system-pulse');
      pulse('flow', msg);
    } catch { /* decoration */ }

    // Bearish reads are delivered as READS even where the gate blocks the
    // trade — information is not a position.
    const gateNote = bearishRead ? '\n> read, not a signal — the discipline gate still requires an event catalyst for any short' : '';
    await discordFlow(`🐋 **${msg}**${gateNote}`);
    logger.info(`[FLOW-SENTRY] ${msg}`);
  }
  return fired;
}

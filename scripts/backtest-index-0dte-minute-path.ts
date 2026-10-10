/**
 * Ten-session index 0DTE mark-path replay.
 *
 * Joins the platform's selected Bullflow alerts to reported one-minute option
 * trade bars. Entry is the next minute's first reported trade, never the alert
 * minute itself. Stops and targets are evaluated in timestamp order; when both
 * occur in the same OHLC minute, the stop wins (conservative ordering).
 *
 * This is a MARK replay, not an executable-fill backtest. Historical NBBO and
 * broker fills are required before these results can be called realized P&L.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getHistoricalOptionMinutes, normalizeYahooOptionSymbol } from '../server/option-minute-history';

type SourceAlert = {
  date: string;
  symbol: string;
  direction: 'bullish' | 'bearish';
  timestamp: number;
  estTimestamp: string;
  alertName: string;
};

type ReplayRow = SourceAlert & {
  entryAt?: string;
  entryMark?: number;
  quantity?: number;
  debitDollars?: number;
  stopMark?: number;
  targetMark?: number;
  exitAt?: string;
  exitMark?: number;
  outcome: 'target' | 'stop' | 'eod' | 'unresolved';
  returnPct?: number;
  pnlDollars?: number;
  mfePct?: number;
  maePct?: number;
  minutesHeld?: number;
  policyOutcomes?: Record<string, {
    outcome: 'target' | 'stop' | 'eod';
    exitAt: string;
    exitMark: number;
    returnPct: number;
    pnlDollars: number;
    minutesHeld: number;
  }>;
  error?: string;
};

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const inputFile = path.resolve(args.input ?? path.join(process.cwd(), 'research', 'results', 'bullflow-index-0dte-2026-03-01-2026-09-24.json'));
const outputFile = path.resolve(args.output ?? path.join(process.cwd(), 'research', 'results', 'index-0dte-minute-path-last-10-sessions.json'));
const START_DATE = args.from ?? '2026-09-14';
const END_DATE = args.to ?? '2026-09-25';
const INCLUDE_CLOSING_DRIVE = args.includeClosingDrive == null ? !args.input : args.includeClosingDrive === 'true';
const STOP_PCT = 50;
const TARGET_PCT = 100;
const MAX_DEBIT_DOLLARS = 200;
const MAX_CONTRACTS = 5;
const PROFIT_POLICIES = [10, 15, 25, 50, 100] as const;

function round2(n: number) { return Number(n.toFixed(2)); }

function replayProfitPolicy(
  path: Array<{ timestamp: string; open: number; high: number; low: number; close: number }>,
  entryAt: string,
  entryMark: number,
  quantity: number,
  targetPct: number,
) {
  const stopMark = entryMark * (1 - STOP_PCT / 100);
  const targetMark = entryMark * (1 + targetPct / 100);
  let outcome: 'target' | 'stop' | 'eod' = 'eod';
  let exit = path.at(-1)!;
  let exitMark = exit.close;
  for (const bar of path) {
    // Reported OHLC cannot order two touches inside one minute. Preserve the
    // conservative stop-first rule for every policy so smaller targets do not
    // receive a hidden hindsight advantage.
    if (bar.low <= stopMark) { outcome = 'stop'; exit = bar; exitMark = stopMark; break; }
    if (bar.high >= targetMark) { outcome = 'target'; exit = bar; exitMark = targetMark; break; }
  }
  return {
    outcome,
    exitAt: exit.timestamp,
    exitMark: round2(exitMark),
    returnPct: round2((exitMark / entryMark - 1) * 100),
    pnlDollars: round2((exitMark - entryMark) * 100 * quantity),
    minutesHeld: Math.max(0, Math.round((Date.parse(exit.timestamp) - Date.parse(entryAt)) / 60_000)),
  };
}

async function replayAlert(alert: SourceAlert): Promise<ReplayRow> {
  const series = await getHistoricalOptionMinutes(normalizeYahooOptionSymbol(alert.symbol), alert.date);
  if (!series?.bars.length) return { ...alert, outcome: 'unresolved', error: 'no minute option trades' };
  const reportedTrades = series.bars.filter((bar) => bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0);
  if (!reportedTrades.length) return { ...alert, outcome: 'unresolved', error: 'no positive minute option trades' };

  // The alert can arrive partway through a minute. Enter no earlier than the
  // next complete minute, using its first reported trade as a transparent mark.
  // Always move to the following minute. `ceil()` reused the alert minute
  // whenever the alert timestamp landed exactly on :00, quietly granting the
  // replay access to a bar whose high/low had not happened yet.
  const earliestEntryMs = (Math.floor((alert.timestamp * 1000) / 60_000) + 1) * 60_000;
  const entry = reportedTrades.find((bar) => Date.parse(bar.timestamp) >= earliestEntryMs);
  if (!entry || entry.open <= 0) return { ...alert, outcome: 'unresolved', error: 'no post-alert entry mark' };

  const entryMark = entry.open;
  const quantity = Math.min(MAX_CONTRACTS, Math.floor(MAX_DEBIT_DOLLARS / (entryMark * 100)));
  if (quantity < 1) return {
    ...alert, outcome: 'unresolved', entryAt: entry.timestamp, entryMark: round2(entryMark),
    error: `entry debit $${round2(entryMark * 100)} exceeds $${MAX_DEBIT_DOLLARS} cap`,
  };

  const stopMark = entryMark * (1 - STOP_PCT / 100);
  const targetMark = entryMark * (1 + TARGET_PCT / 100);
  const path = reportedTrades.filter((bar) => Date.parse(bar.timestamp) >= Date.parse(entry.timestamp));
  let outcome: ReplayRow['outcome'] = 'eod';
  let exit = path.at(-1)!;
  let exitMark = exit.close;
  let pathHigh = entryMark;
  let pathLow = entryMark;

  for (const bar of path) {
    pathHigh = Math.max(pathHigh, bar.high);
    pathLow = Math.min(pathLow, bar.low);
    // OHLC cannot reveal intraminute ordering. Charge the stop first whenever
    // both thresholds occur in the same minute instead of granting a free win.
    if (bar.low <= stopMark) {
      outcome = 'stop'; exit = bar; exitMark = stopMark; break;
    }
    if (bar.high >= targetMark) {
      outcome = 'target'; exit = bar; exitMark = targetMark; break;
    }
  }

  const returnPct = (exitMark / entryMark - 1) * 100;
  const policyOutcomes = Object.fromEntries(PROFIT_POLICIES.map((targetPct) => [
    `target${targetPct}`,
    replayProfitPolicy(path, entry.timestamp, entryMark, quantity, targetPct),
  ]));
  return {
    ...alert,
    symbol: normalizeYahooOptionSymbol(alert.symbol),
    entryAt: entry.timestamp,
    entryMark: round2(entryMark),
    quantity,
    debitDollars: round2(entryMark * 100 * quantity),
    stopMark: round2(stopMark),
    targetMark: round2(targetMark),
    exitAt: exit.timestamp,
    exitMark: round2(exitMark),
    outcome,
    returnPct: round2(returnPct),
    pnlDollars: round2((exitMark - entryMark) * 100 * quantity),
    mfePct: round2((pathHigh / entryMark - 1) * 100),
    maePct: round2((pathLow / entryMark - 1) * 100),
    minutesHeld: Math.max(0, Math.round((Date.parse(exit.timestamp) - Date.parse(entry.timestamp)) / 60_000)),
    policyOutcomes,
  };
}

function summarizePolicies(rows: ReplayRow[]) {
  return Object.fromEntries(PROFIT_POLICIES.map((targetPct) => {
    const key = `target${targetPct}`;
    const outcomes = rows.flatMap((row) => row.policyOutcomes?.[key] ? [row.policyOutcomes[key]] : []);
    const pnl = outcomes.map((row) => row.pnlDollars);
    const grossWins = pnl.filter((x) => x > 0).reduce((a, b) => a + b, 0);
    const grossLosses = Math.abs(pnl.filter((x) => x < 0).reduce((a, b) => a + b, 0));
    return [key, {
      targetPct,
      sample: outcomes.length,
      targetHits: outcomes.filter((row) => row.outcome === 'target').length,
      stops: outcomes.filter((row) => row.outcome === 'stop').length,
      eodExits: outcomes.filter((row) => row.outcome === 'eod').length,
      targetHitRatePct: outcomes.length ? round2(outcomes.filter((row) => row.outcome === 'target').length / outcomes.length * 100) : 0,
      profitableRatePct: outcomes.length ? round2(pnl.filter((x) => x > 0).length / outcomes.length * 100) : 0,
      netMarkedPnlDollars: round2(pnl.reduce((a, b) => a + b, 0)),
      averageReturnPct: outcomes.length ? round2(outcomes.reduce((sum, row) => sum + row.returnPct, 0) / outcomes.length) : 0,
      profitFactor: grossLosses > 0 ? round2(grossWins / grossLosses) : null,
    }];
  }));
}

function summarize(rows: ReplayRow[]) {
  const resolved = rows.filter((row) => row.outcome !== 'unresolved');
  const wins = resolved.filter((row) => row.outcome === 'target');
  const stops = resolved.filter((row) => row.outcome === 'stop');
  const eod = resolved.filter((row) => row.outcome === 'eod');
  const pnl = resolved.map((row) => row.pnlDollars ?? 0);
  const grossWins = pnl.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(pnl.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  const sessionsWithPath = new Set(resolved.map((row) => row.date)).size;
  const noPathData = rows.filter((row) => row.error === 'no minute option trades').length;
  const budgetRejected = rows.filter((row) => row.error?.includes('exceeds')).length;
  const coveragePct = rows.length ? round2(resolved.length / rows.length * 100) : 0;
  return {
    alerts: rows.length,
    resolved: resolved.length,
    coveragePct,
    sessionsWithPath,
    noPathData,
    budgetRejected,
    trust: coveragePct >= 80 && resolved.length >= 30 ? 'research_sample' : 'insufficient_coverage',
    targetHits: wins.length,
    stops: stops.length,
    eodExits: eod.length,
    targetHitRatePct: resolved.length ? round2(wins.length / resolved.length * 100) : 0,
    profitableRatePct: resolved.length ? round2(pnl.filter((x) => x > 0).length / resolved.length * 100) : 0,
    netMarkedPnlDollars: round2(pnl.reduce((a, b) => a + b, 0)),
    averageReturnPct: resolved.length ? round2(resolved.reduce((a, b) => a + (b.returnPct ?? 0), 0) / resolved.length) : 0,
    medianReturnPct: resolved.length
      ? [...resolved].map((x) => x.returnPct ?? 0).sort((a, b) => a - b)[Math.floor(resolved.length / 2)]
      : null,
    profitFactor: grossLosses > 0 ? round2(grossWins / grossLosses) : null,
  };
}

async function main() {
  const historical = JSON.parse(await readFile(inputFile, 'utf8'));
  const alerts: SourceAlert[] = historical.rows
    .filter((row: any) => row.date >= START_DATE && row.date <= END_DATE)
    .map((row: any) => ({
      date: row.date,
      symbol: row.symbol,
      direction: row.direction,
      timestamp: row.timestamp,
      estTimestamp: row.estTimestamp,
      alertName: row.alertName,
    }));

  // The tenth session: the TradingView-confirmed SPX closing-drive call. Use
  // the cheaper account-fit expression discussed in the audit, not hindsight's
  // intraminute high. Entry remains the next minute's first reported trade.
  if (INCLUDE_CLOSING_DRIVE && START_DATE <= '2026-09-25' && END_DATE >= '2026-09-25') {
    alerts.push({
      date: '2026-09-25',
      symbol: 'SPXW260925C07745000',
      direction: 'bullish',
      timestamp: Date.parse('2026-09-25T19:37:00.000Z') / 1000,
      estTimestamp: '2026-09-25 15:37:00 ET',
      alertName: 'QuantEdge TradingView SPX Closing Drive Bullish',
    });
  }

  const rows: ReplayRow[] = [];
  for (const [index, alert] of alerts.entries()) {
    rows.push(await replayAlert(alert));
    console.log(`[minute-path] ${index + 1}/${alerts.length} ${alert.date} ${alert.symbol}`);
  }
  const report = {
    model: 'QuantEdge index 0DTE ordered minute-mark replay',
    classification: 'reported-trade mark replay — not executable NBBO or broker-fill P&L',
    period: { from: START_DATE, to: END_DATE, tradingSessions: new Set(alerts.map((row) => row.date)).size },
    policy: {
      entry: 'next minute first reported option trade after alert',
      stop: `-${STOP_PCT}% premium`,
      target: `+${TARGET_PCT}% premium`,
      collision: 'stop first when stop and target occur within the same OHLC minute',
      close: 'last regular-session reported trade',
      maxDebitDollars: MAX_DEBIT_DOLLARS,
      maxContracts: MAX_CONTRACTS,
    },
    limitation: 'Reported option trades are marks, not NBBO. Results exclude spread, commissions, queue position and broker latency; trust only actual imported fills as realized P&L.',
    summary: summarize(rows),
    policyMatrix: summarizePolicies(rows),
    rows,
  };
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outputFile, summary: report.summary }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });

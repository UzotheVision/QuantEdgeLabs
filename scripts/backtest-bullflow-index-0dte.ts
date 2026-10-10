/**
 * Bullflow index-0DTE opportunity replay.
 *
 * This is intentionally NOT labelled a P&L backtest. Bullflow replay gives the
 * alert-time trade and peakReturn gives the best later print, but neither gives
 * the full bid/ask path needed to know whether a stop happened before a target.
 * The output therefore reports opportunity-capture rates only. A true execution
 * backtest must join historical option NBBO/quotes and apply next-quote fills.
 *
 * Run:
 *   node --env-file=.env node_modules/.bin/tsx scripts/backtest-bullflow-index-0dte.ts \
 *     --from=2026-03-01 --to=2026-09-24 --concurrency=3
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type ReplayAlert = {
  id: string;
  date: string;
  symbol: string;
  alertName: string;
  direction: 'bullish' | 'bearish';
  premium: number;
  entry: number;
  timestamp: number;
  estTimestamp: string;
};

type ScoredAlert = ReplayAlert & { peakPrice: number | null; peakPct: number | null; error?: string };

const API = 'https://api.bullflow.io';
const apiKey = process.env.BULLFLOW_API_KEY?.trim();
if (!apiKey) throw new Error('BULLFLOW_API_KEY is required');

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const from = args.from ?? '2026-03-01';
const to = args.to ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const concurrency = Math.max(1, Math.min(4, Number(args.concurrency ?? 2)));
const maxPerDay = Math.max(1, Math.min(6, Number(args.maxPerDay ?? 2)));
const outDir = path.join(process.cwd(), 'research', 'results');
const cacheFile = path.join(outDir, 'bullflow-index-0dte-peak-cache.json');
const outputFile = path.join(outDir, `bullflow-index-0dte-${from}-${to}.json`);

function datesBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${a}T12:00:00Z`); d <= new Date(`${b}T12:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    const day = d.getUTCDay();
    if (day >= 1 && day <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function occExpiry(occ: string): string | null {
  const m = /^O:[A-Z.]+(\d{6})[CP]\d{8}$/.exec(occ);
  return m ? `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}` : null;
}

function regularMinutes(est: string): number | null {
  const m = /(\d{2}):(\d{2}):\d{2}\s+EST$/.exec(est);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

async function replayOnce(date: string): Promise<ReplayAlert[]> {
  const url = new URL(`${API}/v1/streaming/backtesting`);
  url.searchParams.set('key', apiKey!);
  url.searchParams.set('date', date);
  url.searchParams.set('speed', '10000');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
    if (!response.ok || !response.body) throw new Error(`replay HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const alerts: ReplayAlert[] = [];
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data: ')) continue;
        let message: any;
        try { message = JSON.parse(line.slice(6)); } catch { continue; }
        if (message.event === 'error') throw new Error(message.message ?? 'replay error');
        if (message.event === 'complete') return alerts;
        if (message.event !== 'alert' || message.data?.alertType !== 'custom') continue;
        const name = String(message.data.alertName ?? '');
        const direction = name.endsWith('Bullish') ? 'bullish' : name.endsWith('Bearish') ? 'bearish' : null;
        if (!direction) continue;
        const symbol = String(message.data.symbol ?? '');
        if (!/^O:(SPY|QQQ|IWM)/.test(symbol) || occExpiry(symbol) !== date) continue;
        // This study models LONG premium only. Bullflow can classify a put sale
        // as bullish (correctly), but peakReturn measures the put price rising,
        // which is the opposite P&L of that sale. Direction and option type must
        // therefore align: bullish calls, bearish puts. Credit spreads belong in
        // a separate NBBO-path study.
        const isCall = /C\d{8}$/.test(symbol);
        if ((direction === 'bullish' && !isCall) || (direction === 'bearish' && isCall)) continue;
        const minutes = regularMinutes(String(message.data.estTimestamp ?? ''));
        // Avoid opening auction noise and late-day gamma singularity. Both may
        // be studied separately, but neither belongs in the base policy.
        if (minutes == null || minutes < 9 * 60 + 45 || minutes > 14 * 60 + 30) continue;
        const entry = Number(message.data.tradePrice);
        if (!(entry >= 0.25 && entry <= 3.00)) continue; // $25-$300 debit/account fit
        alerts.push({
          id: String(message.id), date, symbol, alertName: name, direction,
          premium: Number(message.data.alertPremium) || 0,
          entry, timestamp: Number(message.data.timestamp),
          estTimestamp: String(message.data.estTimestamp ?? ''),
        });
      }
    }
    return alerts;
  } finally {
    clearTimeout(timer);
  }
}

async function replay(date: string): Promise<ReplayAlert[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await replayOnce(date);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

function chooseDaily(alerts: ReplayAlert[]): ReplayAlert[] {
  const sorted = [...alerts].sort((a, b) => a.timestamp - b.timestamp || b.premium - a.premium);
  const chosen: ReplayAlert[] = [];
  const lastByDirection = new Map<string, number>();
  for (const alert of sorted) {
    const last = lastByDirection.get(alert.direction) ?? 0;
    if (alert.timestamp - last < 30 * 60) continue;
    chosen.push(alert);
    lastByDirection.set(alert.direction, alert.timestamp);
    if (chosen.length >= maxPerDay) break;
  }
  return chosen;
}

async function peak(alert: ReplayAlert): Promise<{ peakPrice: number; peakPct: number }> {
  const url = new URL(`${API}/v1/data/peakReturn`);
  url.searchParams.set('key', apiKey!);
  url.searchParams.set('sym', alert.symbol);
  url.searchParams.set('old_price', String(alert.entry));
  url.searchParams.set('trade_timestamp', String(Math.floor(alert.timestamp)));
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`peak HTTP ${response.status}`);
  const data: any = await response.json();
  const peakPrice = Number(data.peakPriceSinceTimestamp);
  const peakPct = Number(data.peakPercentReturnSinceTimestamp);
  if (!Number.isFinite(peakPrice) || !Number.isFinite(peakPct)) throw new Error('invalid peak payload');
  return { peakPrice, peakPct };
}

function summarize(rows: ScoredAlert[]) {
  const valid = rows.filter((r) => r.peakPct != null) as Array<ScoredAlert & { peakPct: number }>;
  const hit = (threshold: number) => valid.length ? valid.filter((r) => r.peakPct >= threshold).length / valid.length : 0;
  const values = valid.map((r) => r.peakPct).sort((a, b) => a - b);
  return {
    attempted: rows.length,
    observations: valid.length,
    unresolved: rows.length - valid.length,
    coveragePct: rows.length ? (valid.length / rows.length) * 100 : 0,
    hit25Pct: hit(25), hit50Pct: hit(50), hit100Pct: hit(100), hit200Pct: hit(200),
    medianPeakPct: values.length ? values[Math.floor(values.length / 2)] : null,
    meanPeakPct: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  let cache: Record<string, { peakPrice: number; peakPct: number }> = {};
  try { cache = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* first run */ }
  const dates = datesBetween(from, to);
  const selected: ReplayAlert[] = [];
  const replayFailures: Array<{ date: string; error: string }> = [];
  let cursor = 0;
  async function replayWorker() {
    while (cursor < dates.length) {
      const date = dates[cursor++];
      try {
        const rows = chooseDaily(await replay(date));
        selected.push(...rows);
        console.log(`[replay] ${date}: ${rows.length} selected`);
      } catch (error: any) {
        const message = error?.message ?? String(error);
        replayFailures.push({ date, error: message });
        console.warn(`[replay] ${date}: ${message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => replayWorker()));
  selected.sort((a, b) => a.timestamp - b.timestamp);

  const scored: ScoredAlert[] = [];
  for (const [index, alert] of selected.entries()) {
    const key = `${alert.symbol}|${alert.timestamp}|${alert.entry}`;
    try {
      const cached = cache[key];
      const result = cached ?? await peak(alert);
      cache[key] = result;
      scored.push({ ...alert, ...result });
      if (!cached) await new Promise((resolve) => setTimeout(resolve, 1100));
    } catch (error: any) {
      scored.push({ ...alert, peakPrice: null, peakPct: null, error: error?.message ?? String(error) });
    }
    if ((index + 1) % 20 === 0 || index + 1 === selected.length) {
      console.log(`[peak] ${index + 1}/${selected.length} scored`);
    }
  }
  await writeFile(cacheFile, JSON.stringify(cache, null, 2));

  const n = scored.length;
  const trainEnd = Math.floor(n * 0.6);
  const validationEnd = Math.floor(n * 0.8);
  const report = {
    model: 'Bullflow index 0DTE alert opportunity replay',
    classification: 'opportunity study — not executable P&L',
    period: {
      from, to, weekdaysRequested: dates.length,
      replayDaysCompleted: dates.length - replayFailures.length,
      replayDaysFailed: replayFailures.length,
    },
    policy: {
      universe: ['SPY', 'QQQ', 'IWM'], direction: 'provider-classified bullish/bearish custom alerts',
      dte: 0, premiumMin: 100000, sigScoreMin: 0.65, entryWindowET: '09:45-14:30',
      contractDebit: '$25-$300', maxSignalsPerDay: maxPerDay, cooldownMinutesByDirection: 30,
    },
    limitation: 'peakReturn is best later trade, not a fillable exit; no bid/ask path, stop ordering, slippage, commissions, or settlement. Do not call hit rates win rates.',
    replayFailures,
    splits: {
      train: summarize(scored.slice(0, trainEnd)),
      validation: summarize(scored.slice(trainEnd, validationEnd)),
      test: summarize(scored.slice(validationEnd)),
      all: summarize(scored),
    },
    rows: scored,
  };
  await writeFile(outputFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outputFile, ...report.splits }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });

/**
 * Audit published SPX/SPY/QQQ/IWM 0DTE ideas against the selected contract's
 * ordered one-minute reported-trade path.
 *
 * Default: read-only JSON report.
 * --apply: repair only rows whose exact contract and first post-alert mark are
 * available. This is mark-path validation, never a claim of broker execution.
 */
import 'dotenv/config';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../server/db';
import { getHistoricalOptionMinutes } from '../server/option-minute-history';
import { tradeIdeas } from '../shared/schema';

const DATE = process.argv.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) ?? '2026-09-25';
const APPLY = process.argv.includes('--apply');
const TARGET_RETURN_PCT = 100;

function occSymbol(symbol: string, expiry: string, optionType: string, strike: number) {
  const root = symbol.toUpperCase() === 'SPX' ? 'SPXW' : symbol.toUpperCase();
  const date = expiry.replaceAll('-', '').slice(2);
  const side = optionType.toLowerCase() === 'put' ? 'P' : 'C';
  const strikeCode = String(Math.round(strike * 1_000)).padStart(8, '0');
  return `${root}${date}${side}${strikeCode}`;
}

function nextMinute(iso: string) {
  return new Date((Math.floor(Date.parse(iso) / 60_000) + 1) * 60_000).toISOString();
}

function round2(value: number) { return Number(value.toFixed(2)); }

async function main() {
  const rows = await db.select().from(tradeIdeas).where(and(
    inArray(tradeIdeas.symbol, ['SPX', 'SPY', 'QQQ', 'IWM']),
    gte(tradeIdeas.timestamp, `${DATE}T00:00:00.000Z`),
    lte(tradeIdeas.timestamp, `${DATE}T23:59:59.999Z`),
    eq(tradeIdeas.assetType, 'option'),
  ));

  const report: any[] = [];
  for (const idea of rows) {
    if (!idea.optionType || idea.strikePrice == null || !idea.expiryDate) continue;
    const expiry = String(idea.expiryDate).slice(0, 10);
    if (expiry !== DATE) continue;
    const occ = occSymbol(idea.symbol, expiry, idea.optionType, Number(idea.strikePrice));
    const series = await getHistoricalOptionMinutes(occ, DATE);
    const earliest = nextMinute(String(idea.timestamp));
    const path = (series?.bars ?? []).filter((bar) =>
      Date.parse(bar.timestamp) >= Date.parse(earliest) && bar.open > 0 && bar.high > 0 && bar.close > 0,
    );
    if (!path.length) {
      report.push({ id: idea.id, symbol: idea.symbol, occ, verdict: 'unresolved', reason: 'no positive post-alert option trades' });
      continue;
    }

    const entry = path[0];
    const entryMark = entry.open;
    const targetMark = entryMark * (1 + TARGET_RETURN_PCT / 100);
    const hit = path.find((bar) => bar.high >= targetMark);
    const peak = path.reduce((best, bar) => bar.high > best.high ? bar : best, path[0]);
    const last = path.at(-1)!;
    const mfePct = (peak.high / entryMark - 1) * 100;
    const closePct = (last.close / entryMark - 1) * 100;
    const verdict = hit ? 'contract_target_hit' : mfePct >= 10 ? 'bankable_mfe_then_expired' : 'expired_loss';
    const audit = {
      id: idea.id,
      symbol: idea.symbol,
      occ,
      alertAt: idea.timestamp,
      entryAt: entry.timestamp,
      entryMark: round2(entryMark),
      targetMark: round2(targetMark),
      targetAt: hit?.timestamp ?? null,
      peakMark: round2(peak.high),
      peakAt: peak.timestamp,
      mfePct: round2(mfePct),
      lastPositiveMark: round2(last.close),
      closePct: round2(closePct),
      previousOutcome: idea.outcomeStatus,
      verdict,
      basis: series?.priceBasis,
    };
    report.push(audit);

    // Do not overwrite a row that already carries a more specific audited
    // replay (for example SPX's completed signal-bar $2.00 → underlying-T1
    // $7.20 record). This repair targets unresolved/legacy rows only.
    const alreadyAudited = idea.dataSourceUsed === 'yahoo-opr-trades' && idea.outcomeStatus !== 'open';
    (audit as any).applyEligible = !alreadyAudited;
    if (APPLY && !alreadyAudited) {
      const exitPremium = hit ? targetMark : last.close;
      const optionPercentGain = hit ? TARGET_RETURN_PCT : closePct;
      await db.update(tradeIdeas).set({
        entryPremium: round2(entryMark),
        exitPremium: round2(exitPremium),
        optionPercentGain: round2(optionPercentGain),
        percentGain: round2(optionPercentGain),
        outcomeStatus: hit ? 'hit_target' : 'expired',
        exitDate: hit?.timestamp ?? last.timestamp,
        resolutionReason: hit ? 'option_target_hit' : 'contract_expired',
        validatedAt: hit?.timestamp ?? last.timestamp,
        predictionAccurate: Boolean(hit),
        predictionValidatedAt: hit?.timestamp ?? last.timestamp,
        outcomeNotes: `Contract-path audit ${occ}: first post-alert reported trade $${entryMark.toFixed(2)}; peak $${peak.high.toFixed(2)} (${mfePct >= 0 ? '+' : ''}${mfePct.toFixed(1)}%); ${hit ? `+${TARGET_RETURN_PCT}% premium target crossed at ${hit.timestamp}` : `last positive reported trade $${last.close.toFixed(2)} (${closePct.toFixed(1)}%)`}. Yahoo OPR trade bars are marks, not guaranteed NBBO fills.`,
        dataSourceUsed: 'yahoo-opr-trades',
      } as any).where(eq(tradeIdeas.id, idea.id));
    }
  }

  const summary = {
    date: DATE,
    mode: APPLY ? 'applied' : 'read_only',
    rows: report.length,
    contractTargetHits: report.filter((row) => row.verdict === 'contract_target_hit').length,
    bankableMfeThenExpired: report.filter((row) => row.verdict === 'bankable_mfe_then_expired').length,
    expiredLosses: report.filter((row) => row.verdict === 'expired_loss').length,
    unresolved: report.filter((row) => row.verdict === 'unresolved').length,
    definition: `contract target = first positive post-alert trade +${TARGET_RETURN_PCT}%; positive OHLC only; reported trades, not executable NBBO`,
  };
  console.log(JSON.stringify({ summary, report }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

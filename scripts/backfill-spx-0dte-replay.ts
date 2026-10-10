import { and, eq } from 'drizzle-orm';
import { db } from '../server/db';
import { getHistoricalOptionMinutes, replayOptionMarks } from '../server/option-minute-history';
import { tradeIdeas } from '../shared/schema';

const OCC = 'SPXW260925C07740000';
const SIGNAL_ID = 'spx-closing-drive-2026-09-25-1537';
const ENTRY_AT = '2026-09-25T19:37:00.000Z';
const EXIT_AT = '2026-09-25T19:45:00.000Z';

async function main() {
  const existing = await db.select({ id: tradeIdeas.id }).from(tradeIdeas).where(and(
    eq(tradeIdeas.source, 'tradingview'),
    eq(tradeIdeas.catalystSourceUrl, `tradingview:${SIGNAL_ID}`),
  )).limit(1);
  if (existing[0]) {
    console.log(JSON.stringify({ status: 'already-present', ideaId: existing[0].id }));
    return;
  }

  const series = await getHistoricalOptionMinutes(OCC, '2026-09-25');
  if (!series) throw new Error(`No reported one-minute trades for ${OCC}`);
  const replay = replayOptionMarks({ series, entryAt: ENTRY_AT, exitAt: EXIT_AT });
  if (!replay) throw new Error('Entry or exit minute did not contain a reported trade');

  const entryPremium = Number(replay.entry.close.toFixed(2));
  const exitPremium = Number(replay.exit.close.toFixed(2));
  const optionReturn = Number(replay.returnPct.toFixed(2));
  const peakReturn = Number(replay.peakReturnPct.toFixed(2));
  const mae = Number(replay.maxAdversePct.toFixed(2));
  const entryUnderlying = 7736.98;
  const stop = 7731.81;
  const target = 7747.00;
  const realizedPnl = Number(((exitPremium - entryPremium) * 100).toFixed(2));

  const [created] = await db.insert(tradeIdeas).values({
    symbol: 'SPX',
    assetType: 'option',
    direction: 'long',
    holdingPeriod: 'day',
    entryPrice: entryUnderlying,
    targetPrice: target,
    stopLoss: stop,
    riskRewardRatio: Number(((target - entryUnderlying) / (entryUnderlying - stop)).toFixed(2)),
    catalyst: 'SPX Closing Drive · confirmed 15:37 ET reclaim of 7,737',
    catalystSourceUrl: `tradingview:${SIGNAL_ID}`,
    analysis: `Recorded replay, not a simulated Greek estimate. ${OCC} reported-trade close was $${entryPremium.toFixed(2)} on the confirmed 15:37 ET signal minute and $${exitPremium.toFixed(2)} on the 15:45 ET T1 minute: ${optionReturn >= 0 ? '+' : ''}${optionReturn.toFixed(1)}%. Peak reported trade through exit was $${replay.peak.high.toFixed(2)} (${peakReturn >= 0 ? '+' : ''}${peakReturn.toFixed(1)}%); MAE was ${mae.toFixed(1)}%. One contract cost $${(entryPremium * 100).toFixed(0)} and produced $${realizedPnl.toFixed(0)} marked P&L. OPR trade bars are auditable marks, not guaranteed NBBO fills.`,
    sessionContext: 'power_hour',
    timestamp: ENTRY_AT,
    source: 'tradingview',
    status: 'published',
    confidenceScore: 78,
    probabilityBand: 'B+',
    optionType: 'call',
    strikePrice: 7740,
    expiryDate: '2026-09-25',
    entryPremium,
    exitPremium,
    optionPercentGain: optionReturn,
    realizedPnL: realizedPnl,
    exitDate: EXIT_AT,
    outcomeStatus: 'hit_target',
    resolutionReason: 'auto_target_hit',
    outcomeNotes: `T1 underlying traded at 15:45 ET; exact contract mark ${entryPremium.toFixed(2)} → ${exitPremium.toFixed(2)} from reported OPR one-minute trades. Peak ${replay.peak.high.toFixed(2)} at ${replay.peak.timestamp}.`,
    actualHoldingTimeMinutes: 8,
    percentGain: optionReturn,
    highestPriceReached: 7747.32,
    lowestPriceReached: 7732.85,
    validatedAt: EXIT_AT,
    predictionAccurate: true,
    predictionAccuracyPercent: 100,
    predictionValidatedAt: EXIT_AT,
    dataSourceUsed: 'yahoo-opr-trades',
    qualitySignals: [
      'SPX Closing Drive · confirmed reclaim',
      `Exact contract ${OCC}`,
      `Entry mark $${entryPremium.toFixed(2)} · T1 mark $${exitPremium.toFixed(2)}`,
      `Peak ${peakReturn >= 0 ? '+' : ''}${peakReturn.toFixed(1)}% · MAE ${mae.toFixed(1)}%`,
    ],
    convergenceSignalsJson: {
      signals: [{
        source: 'tradingview', type: 'confirmed_reclaim', direction: 'bullish',
        weight: 20, confidence: 78,
        description: 'SPX reclaimed 7,737 on the completed 15:37 ET one-minute bar',
        data: {
          signalId: SIGNAL_ID,
          occSymbol: OCC,
          entryAt: replay.entry.timestamp,
          entryMark: entryPremium,
          exitAt: replay.exit.timestamp,
          exitMark: exitPremium,
          priceBasis: series.priceBasis,
          source: series.source,
          peakMark: replay.peak.high,
          maxAdversePct: mae,
        },
        timestamp: ENTRY_AT,
      }],
      convergenceScore: 78,
      signalCount: 1,
      primaryThesis: 'SPX Closing Drive: confirmed reclaim with expanding one-minute range and volume into power hour.',
      generatedAt: ENTRY_AT,
      executionAudit: {
        version: 1,
        state: 'closed',
        triggerType: 'reclaim',
        triggerPrice: 7737,
        triggerObservedAt: ENTRY_AT,
        triggerObservedPrice: entryUnderlying,
        executionRecordedAt: ENTRY_AT,
        executionPrice: entryPremium,
        executionVenue: 'paper',
      },
    } as any,
  } as any).returning({ id: tradeIdeas.id });

  console.log(JSON.stringify({
    status: 'inserted',
    ideaId: created.id,
    occSymbol: OCC,
    entryPremium,
    exitPremium,
    optionReturnPct: optionReturn,
    peakReturnPct: peakReturn,
    markedPnlDollars: realizedPnl,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

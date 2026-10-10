/**
 * Test harness for the index scalp engine — proves the GEX setups generate
 * BOTH calls and puts for SPX/SPY/QQQ/IWM across every setup type, without
 * needing a live market. Feeds synthetic GEX snapshots representing each
 * regime/scenario into the (now-exported) builder functions.
 *
 * Run: npx tsx scripts/test-index-scalps.ts
 */
import {
  buildFlipBounce,
  buildWallFade,
  buildWallBreak,
  buildTrendContinuation,
  buildPowerHourPlay,
  type IndexScalpIdea,
} from '../server/index-scalp-engine';
import type { GexSnapshot } from '../server/gex-snapshot-service';

function snap(p: Partial<GexSnapshot> & { symbol: string; spot: number }): GexSnapshot {
  return {
    flipPoint: null,
    callWall: null,
    putWall: null,
    flipDistancePct: null,
    regime: null,
    vexRegime: null,
    netGexSign: 'neutral',
    fetchedAt: new Date().toISOString(),
    ...p,
  } as GexSnapshot;
}

const REGULAR = { isMarketOpen: true, isPowerHour: false, isLastHour: false, minutesToClose: 180, sessionLabel: 'midday' };
const POWER = { isMarketOpen: true, isPowerHour: true, isLastHour: true, minutesToClose: 45, sessionLabel: 'power_hour' };

interface Case {
  name: string;
  build: (s: GexSnapshot, sess: any) => IndexScalpIdea | null;
  snap: GexSnapshot;
  session: any;
  expectBias: 'calls' | 'puts';
}

const cases: Case[] = [
  {
    name: 'SPY neg-gamma break below put wall → SPX PUTS',
    build: buildWallBreak,
    snap: snap({ symbol: 'SPY', spot: 735, putWall: 736, callWall: 745, flipPoint: 740, regime: 'negative_gamma' }),
    session: REGULAR,
    expectBias: 'puts',
  },
  {
    name: 'QQQ neg-gamma break above call wall → CALLS',
    build: buildWallBreak,
    snap: snap({ symbol: 'QQQ', spot: 500.5, callWall: 500, putWall: 490, flipPoint: 495, regime: 'negative_gamma' }),
    session: REGULAR,
    expectBias: 'calls',
  },
  {
    name: 'IWM neg-gamma extended below put wall → PUTS (trend continuation)',
    build: buildTrendContinuation,
    snap: snap({ symbol: 'IWM', spot: 220, putWall: 224, callWall: 230, flipPoint: 226, regime: 'negative_gamma' }),
    session: REGULAR,
    expectBias: 'puts',
  },
  {
    name: 'SPY pos-gamma pinned at call wall → SPX PUTS (fade)',
    build: buildWallFade,
    snap: snap({ symbol: 'SPY', spot: 744, callWall: 745, putWall: 735, flipPoint: 738, regime: 'positive_gamma' }),
    session: REGULAR,
    expectBias: 'puts',
  },
  {
    name: 'QQQ pos-gamma pinned at put wall → CALLS (fade)',
    build: buildWallFade,
    snap: snap({ symbol: 'QQQ', spot: 491, putWall: 490, callWall: 500, flipPoint: 495, regime: 'positive_gamma' }),
    session: REGULAR,
    expectBias: 'calls',
  },
  {
    name: 'SPY neg-gamma at flip, above → SPX CALLS (flip bounce)',
    build: buildFlipBounce,
    snap: snap({ symbol: 'SPY', spot: 741, flipPoint: 740, callWall: 745, putWall: 735, regime: 'negative_gamma' }),
    session: REGULAR,
    expectBias: 'calls',
  },
  {
    name: 'SPY power hour neg-gamma below flip → SPX PUTS',
    build: buildPowerHourPlay,
    snap: snap({ symbol: 'SPY', spot: 735, flipPoint: 740, callWall: 745, putWall: 730, regime: 'negative_gamma' }),
    session: POWER,
    expectBias: 'puts',
  },
];

let pass = 0;
let fail = 0;
let calls = 0;
let puts = 0;
const symbolsSeen = new Set<string>();

console.log('\n=== INDEX SCALP ENGINE TEST ===\n');
for (const c of cases) {
  const idea = c.build(c.snap, c.session);
  if (!idea) {
    console.log(`❌ ${c.name}\n   → produced NO idea (expected ${c.expectBias})`);
    fail++;
    continue;
  }
  const ok = idea.bias === c.expectBias;
  if (ok) pass++; else fail++;
  if (idea.bias === 'calls') calls++; else puts++;
  symbolsSeen.add(idea.symbol);

  const tgtDir = idea.bias === 'puts' ? idea.target < idea.spotPrice : idea.target > idea.spotPrice;
  const stopDir = idea.bias === 'puts' ? idea.stop > idea.spotPrice : idea.stop < idea.spotPrice;
  const sane = tgtDir && stopDir && idea.riskRewardRatio >= 1.3;

  console.log(`${ok && sane ? '✅' : '⚠️ '} ${c.name}`);
  console.log(`   → ${idea.symbol} ${idea.bias.toUpperCase()} $${idea.suggestedStrike} ${idea.expiryDate} | ${idea.setup} | spot ${idea.spotPrice.toFixed(2)} → tgt ${idea.target.toFixed(2)} / stop ${idea.stop.toFixed(2)} | ${idea.riskRewardRatio}R | conf ${idea.confidence} | ${idea.premiumRange}`);
  if (!tgtDir) console.log(`   🐞 TARGET WRONG SIDE for ${idea.bias}`);
  if (!stopDir) console.log(`   🐞 STOP WRONG SIDE for ${idea.bias}`);
}

console.log('\n=== SUMMARY ===');
console.log(`Cases: ${cases.length} | pass ${pass} | fail ${fail}`);
console.log(`Calls generated: ${calls} | Puts generated: ${puts}`);
console.log(`Symbols covered: ${Array.from(symbolsSeen).sort().join(', ')}`);
const bothBiases = calls > 0 && puts > 0;
const allSymbols = ['SPX', 'QQQ', 'IWM'].every(s => symbolsSeen.has(s));
console.log(`\nBoth calls AND puts: ${bothBiases ? '✅ YES' : '❌ NO'}`);
console.log(`SPX + QQQ + IWM all covered: ${allSymbols ? '✅ YES' : '❌ NO'}`);
console.log(fail === 0 && bothBiases && allSymbols ? '\n🎯 ALL CHECKS PASSED\n' : '\n❌ SOME CHECKS FAILED\n');
process.exit(fail === 0 && bothBiases && allSymbols ? 0 : 1);

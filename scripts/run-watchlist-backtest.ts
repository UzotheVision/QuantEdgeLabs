/**
 * One-shot 25-ticker watchlist backtest runner
 * ============================================
 * Runs the OlAlgo Monte Carlo backtest across all 4 capital tiers
 * against the user's full 25-ticker watchlist. Used to validate the
 * 17-mega-cap option backfill.
 *
 * Run with: node --env-file=.env node_modules/.bin/tsx scripts/run-watchlist-backtest.ts
 */

import { runChallengeMC, DEFAULT_SWING_CONFIG } from "../server/olalgo-backtest";

const WATCHLIST = [
  "AAOI", "MU", "AVGO", "TSEM", "OKLO", "NFLX", "KLAC", "LRCX", "NBIS",
  "LITE", "LUNR", "EWY", "SOXX", "CRWV", "CRCL", "MRVL", "ARM", "TSLA",
  "AMD", "APP", "ORCL", "SMH", "WDC", "SNDK", "FSLY",
];

const TIERS = [
  { name: "$300 CASH",     startingCapital: 300,  accountType: "cash"   as const, marginMultiple: 1, skimPct: 0.75 },
  { name: "$500 CASH",     startingCapital: 500,  accountType: "cash"   as const, marginMultiple: 1, skimPct: 0.75 },
  { name: "$1K MARGIN 2x", startingCapital: 1000, accountType: "margin" as const, marginMultiple: 2, skimPct: 0.80 },
  { name: "$2K MARGIN 4x", startingCapital: 2000, accountType: "margin" as const, marginMultiple: 4, skimPct: 0.85 },
];

const RUNS = 30;
const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function main() {
  console.log(`\n[watchlist-backtest] ${WATCHLIST.length} tickers, ${RUNS} MC runs per tier, mixed mode, 90d pool\n`);

  console.log("Tier             | Bust% | Median Total | Vault    | BP       | Mean     | Max      | HitTgt% | Skims | PoolSize");
  console.log("-----------------+-------+--------------+----------+----------+----------+----------+---------+-------+---------");

  for (const tier of TIERS) {
    const t0 = Date.now();
    const config = {
      ...DEFAULT_SWING_CONFIG,
      mode: "mixed" as const,
      pool: "last_90d" as const,
      // any_approved opens the watchlist scope to SECONDARY tickers
      // (CRWV, MRVL, APP, ORCL, SNDK, FSLY, EWY, SOXX). Without this
      // the s_and_a default filters them out before alphaTickers can
      // even apply.
      watchlist: "any_approved" as const,
      startingCapital: tier.startingCapital,
      targetCapital: tier.startingCapital * 10,
      stretchTarget: tier.startingCapital * 100,
      bustThreshold: tier.startingCapital * 0.2,
      accountType: tier.accountType,
      marginMultiple: tier.marginMultiple,
      skimTriggerMult: 1.5,
      skimPct: tier.skimPct,
      alphaTickers: WATCHLIST,
    };

    try {
      const r = await runChallengeMC(config as any, RUNS);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `${tier.name.padEnd(16)} | ` +
        `${(r.bustedPct * 100).toFixed(0).padStart(4)}% | ` +
        `${fmt(r.totalRealizedP50).padStart(12)} | ` +
        `${fmt(r.vaultBalanceP50).padStart(8)} | ` +
        `${fmt(r.endingEquityP50).padStart(8)} | ` +
        `${fmt(r.totalRealizedMean).padStart(8)} | ` +
        `${fmt(r.totalRealizedMax).padStart(8)} | ` +
        `${(r.hitTargetPct * 100).toFixed(0).padStart(6)}% | ` +
        `${String(r.medianSkimEvents).padStart(5)} | ` +
        `${String(r.poolSize).padStart(8)}` +
        `   (${elapsed}s)`
      );
    } catch (err: any) {
      console.error(`${tier.name}: FAILED — ${err?.message || err}`);
    }
  }

  console.log("");
  process.exit(0);
}

main().catch((err) => {
  console.error("[watchlist-backtest] FATAL:", err);
  process.exit(1);
});

/**
 * One-shot backfill script
 * ========================
 * Run with: tsx scripts/backfill-options.ts
 *
 * Generates synthetic 90-day option trade ideas for the 17 mega-cap
 * tickers in the user's watchlist that had ZERO option ideas in the
 * historical pool. Required to make the OlAlgo backtest dashboard
 * trade the user's full 25-ticker watchlist.
 */

import { backfillOptionIdeas } from "../server/option-backfill";

// Mega-cap watchlist (original 17 — covers $1K/$2K margin tiers)
const MEGA_CAP_TICKERS = [
  "AAOI", "AVGO", "TSEM", "NFLX", "NBIS", "LITE", "EWY", "SOXX",
  "CRWV", "CRCL", "MRVL", "TSLA", "APP", "ORCL", "SMH", "SNDK", "FSLY",
];

// SMALL ACCOUNT TIER — cheap, high-vol, catalyst-driven names where
// $0.10-$1.50 weekly premiums fit a $300-$1K account.
const SMALL_ACCOUNT_TICKERS = [
  // AI / quantum
  "SOUN", "IONQ", "RGTI", "BBAI", "QBTS",
  // Crypto miners
  "RIOT", "WULF", "BTBT", "IREN",
  // EV / mobility / nuclear
  "NIO", "RIVN", "LCID", "JOBY", "ACHR", "SMR", "NNE",
  // Fintech / consumer
  "HOOD", "OPEN",
  // Meme / catalyst
  "BB", "GME",
  // Already-cheap names that need MORE backfill (already in pool but
  // we re-run to extend their coverage)
  "CLSK", "RKLB", "ASTS", "MARA", "SOFI", "AFRM", "HIMS",
];

// CLI flag: --small-account → backfill small-account tier instead of mega-caps
const SMALL_FLAG = process.argv.includes("--small-account");
const TICKERS = SMALL_FLAG ? SMALL_ACCOUNT_TICKERS : MEGA_CAP_TICKERS;
const TIER_LABEL = SMALL_FLAG ? "SMALL_ACCOUNT" : "MEGA_CAP";

async function main() {
  console.log(`[backfill-options] Starting ${TIER_LABEL} backfill for ${TICKERS.length} tickers (90d)`);
  const t0 = Date.now();
  const results = await backfillOptionIdeas(TICKERS, 90);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n[backfill-options] Done in ${elapsed}s\n`);
  console.log("Symbol  | Ideas  W   L   E   WR%   Note");
  console.log("--------+------------------------------");
  let totalInserted = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalExpired = 0;
  for (const r of results) {
    const note = r.error ? `❌ ${r.error}` : "";
    console.log(
      `${r.symbol.padEnd(7)} | ` +
      `${String(r.inserted).padStart(5)} ` +
      `${String(r.wins).padStart(3)} ` +
      `${String(r.losses).padStart(3)} ` +
      `${String(r.expired).padStart(3)} ` +
      `${r.winRate.toFixed(1).padStart(5)}  ${note}`
    );
    totalInserted += r.inserted;
    totalWins += r.wins;
    totalLosses += r.losses;
    totalExpired += r.expired;
  }
  const totalResolved = totalWins + totalLosses + totalExpired;
  const overallWR = totalResolved > 0 ? (totalWins / totalResolved) * 100 : 0;
  console.log("--------+------------------------------");
  console.log(
    `TOTAL   | ${String(totalInserted).padStart(5)} ` +
    `${String(totalWins).padStart(3)} ` +
    `${String(totalLosses).padStart(3)} ` +
    `${String(totalExpired).padStart(3)} ` +
    `${overallWR.toFixed(1).padStart(5)}`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill-options] FATAL:", err);
  process.exit(1);
});

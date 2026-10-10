/**
 * OlAlgoMax — what would fire on the next entry day?
 * ====================================================
 * Runs the OlAlgoMax entry signal against the user's 25-ticker watchlist
 * using the most recent OHLC bar. Prints qualifying entries with strike,
 * premium, sizing, and the trim/stop ladder so the user can see exactly
 * what the bot would buy on Monday.
 *
 * Run with:
 *   PATH="/opt/homebrew/bin:$PATH" node --env-file=.env \
 *     node_modules/.bin/tsx scripts/olalgo-max-picks-today.ts
 */

import { scanCurrentSignals } from "../server/olalgo-max";

const WATCHLIST = [
  "AAOI", "MU", "AVGO", "TSEM", "OKLO", "NFLX", "KLAC", "LRCX", "NBIS",
  "LITE", "LUNR", "EWY", "SOXX", "CRWV", "CRCL", "MRVL", "ARM", "TSLA",
  "AMD", "APP", "ORCL", "SMH", "WDC", "SNDK", "FSLY",
];

const TIERS = [5000, 25000];
const PCT_PER_NAME = 0.07;
const MAX_CONCURRENT = 10;
const MAX_PER_SECTOR = 2;

const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const pad = (s: string | number, w: number) => String(s).padStart(w);

async function runTier(capital: number) {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  $${capital.toLocaleString()} ACCOUNT · 7%/name · max 10 concurrent · 2 per sector`);
  console.log(`══════════════════════════════════════════════`);

  const picks = await scanCurrentSignals(
    WATCHLIST,
    capital,
    PCT_PER_NAME,
    MAX_CONCURRENT,
    MAX_PER_SECTOR,
  );

  if (picks.length === 0) {
    console.log("No tickers passed the entry filter + affordability.\n");
    return;
  }

  const asOf = picks[0].asOfDate;
  console.log(`\nAs of bar: ${asOf}\n`);
  console.log(
    `${pad("SYMBOL", 7)} | ${pad("SECTOR", 14)} | ${pad("PRICE", 9)} | ${pad("RSI", 5)} | ${pad("STRIKE", 9)} | ${pad("PREM", 8)} | ${pad("CT", 3)} | ${pad("COST", 9)} | ${pad("%EQ", 5)} | ${pad("TRIM1", 8)} | ${pad("TRIM2", 8)} | ${pad("STOP", 8)}`,
  );
  console.log("-".repeat(130));

  let totalCost = 0;
  for (const p of picks) {
    totalCost += p.totalCost;
    console.log(
      `${pad(p.symbol, 7)} | ${pad(p.sector, 14)} | ${pad(fmt(p.stockPrice), 9)} | ${pad(p.rsi14.toFixed(1), 5)} | ${pad(fmt(p.strike), 9)} | ${pad(fmt(p.entryPremium), 8)} | ${pad(p.contracts, 3)} | ${pad(fmt(p.totalCost), 9)} | ${pad((p.pctOfEquity * 100).toFixed(1) + "%", 5)} | ${pad(fmt(p.trim1Price), 8)} | ${pad(fmt(p.trim2Price), 8)} | ${pad(fmt(p.hardStopPrice), 8)}`,
    );
  }

  console.log("-".repeat(130));
  console.log(
    `Total: ${picks.length} entries · ${fmt(totalCost)} deployed · ${((totalCost / capital) * 100).toFixed(1)}% of equity · cash left ${fmt(capital - totalCost)}\n`,
  );
}

async function main() {
  console.log(`\n[olalgo-max picks] Scanning ${WATCHLIST.length} tickers across ${TIERS.length} capital tiers...`);
  for (const tier of TIERS) {
    await runTier(tier);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[olalgo-max picks] FATAL:", err);
  process.exit(1);
});

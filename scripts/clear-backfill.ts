/**
 * Delete prior synthetic backfill rows so we can re-run with new params.
 * Targets only rows tagged dataSourceUsed='backfill_synthetic' so live
 * ideas are never touched.
 */

import { db } from "../server/db";
import { tradeIdeas } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const deleted = await db
    .delete(tradeIdeas)
    .where(eq(tradeIdeas.dataSourceUsed, "backfill_synthetic"))
    .returning({ id: tradeIdeas.id });
  console.log(`[clear-backfill] Deleted ${deleted.length} synthetic backfill rows`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[clear-backfill] FATAL:", err);
  process.exit(1);
});

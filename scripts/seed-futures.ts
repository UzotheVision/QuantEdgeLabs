import { db } from "../server/db";
import { futuresContracts, type InsertFuturesContract } from "@shared/schema";
import { eq } from "drizzle-orm";

const nqContracts: InsertFuturesContract[] = [
  {
    rootSymbol: "NQ",
    contractCode: "NQH25",
    exchange: "CME",
    expirationDate: "2025-03-21",
    multiplier: 20,
    tickSize: 0.25,
    tickValue: 5,
    initialMargin: 17600,
    maintenanceMargin: 16000,
    isFrontMonth: true,
    rollDate: "2025-03-14",
    description: "E-mini Nasdaq-100 Futures March 2025"
  },
  {
    rootSymbol: "NQ",
    contractCode: "NQM25",
    exchange: "CME",
    expirationDate: "2025-06-20",
    multiplier: 20,
    tickSize: 0.25,
    tickValue: 5,
    initialMargin: 17600,
    maintenanceMargin: 16000,
    isFrontMonth: false,
    rollDate: "2025-06-13",
    description: "E-mini Nasdaq-100 Futures June 2025"
  },
  {
    rootSymbol: "NQ",
    contractCode: "NQU25",
    exchange: "CME",
    expirationDate: "2025-09-19",
    multiplier: 20,
    tickSize: 0.25,
    tickValue: 5,
    initialMargin: 17600,
    maintenanceMargin: 16000,
    isFrontMonth: false,
    rollDate: "2025-09-12",
    description: "E-mini Nasdaq-100 Futures September 2025"
  },
  {
    rootSymbol: "NQ",
    contractCode: "NQZ25",
    exchange: "CME",
    expirationDate: "2025-12-19",
    multiplier: 20,
    tickSize: 0.25,
    tickValue: 5,
    initialMargin: 17600,
    maintenanceMargin: 16000,
    isFrontMonth: false,
    rollDate: "2025-12-12",
    description: "E-mini Nasdaq-100 Futures December 2025"
  }
];

const gcContracts: InsertFuturesContract[] = [
  {
    rootSymbol: "GC",
    contractCode: "GCJ25",
    exchange: "COMEX",
    expirationDate: "2025-04-29",
    multiplier: 100,
    tickSize: 0.10,
    tickValue: 10,
    initialMargin: 11000,
    maintenanceMargin: 10000,
    isFrontMonth: true,
    rollDate: "2025-04-22",
    description: "Gold Futures April 2025"
  },
  {
    rootSymbol: "GC",
    contractCode: "GCM25",
    exchange: "COMEX",
    expirationDate: "2025-06-26",
    multiplier: 100,
    tickSize: 0.10,
    tickValue: 10,
    initialMargin: 11000,
    maintenanceMargin: 10000,
    isFrontMonth: false,
    rollDate: "2025-06-19",
    description: "Gold Futures June 2025"
  },
  {
    rootSymbol: "GC",
    contractCode: "GCQ25",
    exchange: "COMEX",
    expirationDate: "2025-08-27",
    multiplier: 100,
    tickSize: 0.10,
    tickValue: 10,
    initialMargin: 11000,
    maintenanceMargin: 10000,
    isFrontMonth: false,
    rollDate: "2025-08-20",
    description: "Gold Futures August 2025"
  },
  {
    rootSymbol: "GC",
    contractCode: "GCV25",
    exchange: "COMEX",
    expirationDate: "2025-10-29",
    multiplier: 100,
    tickSize: 0.10,
    tickValue: 10,
    initialMargin: 11000,
    maintenanceMargin: 10000,
    isFrontMonth: false,
    rollDate: "2025-10-22",
    description: "Gold Futures October 2025"
  },
  {
    rootSymbol: "GC",
    contractCode: "GCZ25",
    exchange: "COMEX",
    expirationDate: "2025-12-29",
    multiplier: 100,
    tickSize: 0.10,
    tickValue: 10,
    initialMargin: 11000,
    maintenanceMargin: 10000,
    isFrontMonth: false,
    rollDate: "2025-12-22",
    description: "Gold Futures December 2025"
  }
];

async function seedFuturesContracts() {
  console.log("🚀 Seeding futures contracts...");

  try {
    for (const contract of [...nqContracts, ...gcContracts]) {
      const existing = await db
        .select()
        .from(futuresContracts)
        .where(eq(futuresContracts.contractCode, contract.contractCode))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(futuresContracts).values(contract);
        console.log(`✅ Inserted ${contract.contractCode} - ${contract.description}`);
      } else {
        console.log(`⏭️  Skipped ${contract.contractCode} (already exists)`);
      }
    }

    console.log("✨ Futures contracts seeding complete!");
  } catch (error) {
    console.error("❌ Error seeding futures contracts:", error);
    throw error;
  } finally {
    await db.$client.end();
  }
}

seedFuturesContracts();

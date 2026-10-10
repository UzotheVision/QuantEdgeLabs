/**
 * Migration: Add convergence_signals_json column to trade_ideas table
 * This stores the deep analysis breakdown for Trade Desk display
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = neon(databaseUrl);
  const db = drizzle(client);

  console.log('Adding convergence_signals_json column to trade_ideas table...');

  try {
    // Add the new JSONB column for deep analysis
    await db.execute(sql`
      ALTER TABLE trade_ideas
      ADD COLUMN IF NOT EXISTS convergence_signals_json JSONB
    `);

    console.log('Successfully added convergence_signals_json column!');
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      console.log('Column already exists, skipping...');
    } else {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  }

  process.exit(0);
}

migrate();

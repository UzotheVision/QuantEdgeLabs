/**
 * Migration script to add credits-related columns to users table
 * Run with: npx tsx scripts/add-credits-columns.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL not set. Please check your .env file.');
  process.exit(1);
}

const neonClient = neon(databaseUrl);
const db = drizzle(neonClient);

async function addCreditsColumns() {
  console.log('Adding credits columns to users table...');
  console.log('Database URL:', databaseUrl?.substring(0, 30) + '...');

  try {
    // Add credits column
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 10
    `);
    console.log('✅ Added credits column');

    // Add last_credit_refresh column
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_credit_refresh TIMESTAMP
    `);
    console.log('✅ Added last_credit_refresh column');

    // Add login_streak column
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak INTEGER NOT NULL DEFAULT 0
    `);
    console.log('✅ Added login_streak column');

    // Add last_login_date column
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_date TEXT
    `);
    console.log('✅ Added last_login_date column');

    // Add referral_code column (without UNIQUE first to avoid errors)
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(255)
    `);
    console.log('✅ Added referral_code column');

    // Add referred_by column
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by VARCHAR(255)
    `);
    console.log('✅ Added referred_by column');

    // Add total_credits_earned column
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS total_credits_earned INTEGER DEFAULT 0
    `);
    console.log('✅ Added total_credits_earned column');

    console.log('\n🎉 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

addCreditsColumns();

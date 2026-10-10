/**
 * Startup Environment Check
 * 
 * This runs at server startup to verify all required environment variables are set.
 * If something is missing, it shows a clear error message.
 */

import { logger } from './logger';

interface EnvCheck {
  name: string;
  required: boolean;
  category: string;
}

const ENV_CHECKS: EnvCheck[] = [
  // Critical - app will crash without these
  { name: 'DATABASE_URL', required: true, category: 'DATABASE' },
  { name: 'SESSION_SECRET', required: true, category: 'AUTH' },
  
  // Market data - needed for stock analysis
  { name: 'TRADIER_API_KEY', required: false, category: 'MARKET DATA' },
  { name: 'ALPHA_VANTAGE_API_KEY', required: false, category: 'MARKET DATA' },
  
  // AI Providers - at least one needed for AI features
  { name: 'ANTHROPIC_API_KEY', required: false, category: 'AI' },
  { name: 'OPENAI_API_KEY', required: false, category: 'AI' },
  { name: 'GEMINI_API_KEY', required: false, category: 'AI' },
  { name: 'GROQ_API_KEY', required: false, category: 'AI' },
  { name: 'MISTRAL_API_KEY', required: false, category: 'AI' },
  { name: 'GROK_API_KEY', required: false, category: 'AI' },
];

export function checkEnvironment(): { ok: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];
  const available: string[] = [];
  
  console.log('\n========================================');
  console.log('   QUANT EDGE LABS - ENVIRONMENT CHECK');
  console.log('========================================\n');
  
  for (const check of ENV_CHECKS) {
    const value = process.env[check.name];
    const exists = !!value && value.length > 0;
    
    if (check.required && !exists) {
      missing.push(check.name);
      console.log(`   [${check.category}] ${check.name} - MISSING (REQUIRED)`);
    } else if (!exists) {
      warnings.push(check.name);
      console.log(`   [${check.category}] ${check.name} - not set (optional)`);
    } else {
      available.push(check.name);
      const maskedValue = value.substring(0, 4) + '...' + value.substring(value.length - 4);
      console.log(`   [${check.category}] ${check.name} - ${maskedValue}`);
    }
  }
  
  console.log('\n----------------------------------------');
  console.log(`   Available: ${available.length}/${ENV_CHECKS.length}`);
  
  if (missing.length > 0) {
    console.log(`   MISSING REQUIRED: ${missing.join(', ')}`);
    console.log('\n   Your app will NOT work correctly without these!');
    console.log('   Copy values from Replit Secrets to your .env file.');
  }
  
  // Check AI availability
  const aiKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'GROK_API_KEY'];
  const hasAnyAI = aiKeys.some(key => process.env[key]);
  
  if (!hasAnyAI) {
    console.log('\n   WARNING: No AI providers configured!');
    console.log('   AI analysis features will not work.');
  }
  
  // Check market data
  const hasMarketData = !!process.env.TRADIER_API_KEY;
  if (!hasMarketData) {
    console.log('\n   WARNING: TRADIER_API_KEY not set!');
    console.log('   Real-time stock quotes will fail.');
  }
  
  console.log('========================================\n');
  
  return {
    ok: missing.length === 0,
    missing,
    warnings
  };
}

export function runStartupCheck(): void {
  const result = checkEnvironment();
  
  if (!result.ok) {
    logger.error(`[STARTUP] Missing required environment variables: ${result.missing.join(', ')}`);
    console.error('\n   To fix this:');
    console.error('   1. Create a .env file in the project root');
    console.error('   2. Copy values from Replit Secrets');
    console.error('   3. See .env.example for the full list\n');
  }
}

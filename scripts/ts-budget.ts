#!/usr/bin/env tsx
/**
 * TS Error Budget Gate
 *
 *   npm run ts:budget              ← check (CI uses this)
 *   npm run ts:budget -- --update  ← rebaseline after fixing errors
 *   npm run ts:budget -- --diff    ← show per-file breakdown
 *
 * Policy:
 *   Errors may NEVER increase. Each PR must hold or reduce the count.
 *   Adding new TS errors is a CI failure.
 *
 * The baseline lives in `.ts-error-budget.json` at repo root.
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

interface Budget {
  baseline: number;
  asOf: string;
  policy: string;
  note?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUDGET_FILE = resolve(ROOT, '.ts-error-budget.json');

function readBudget(): Budget {
  return JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
}

function writeBudget(b: Budget) {
  writeFileSync(BUDGET_FILE, JSON.stringify(b, null, 2) + '\n');
}

function runTsc(): string {
  try {
    execSync('npx tsc --noEmit -p tsconfig.json', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return ''; // 0 errors
  } catch (e: any) {
    // tsc exits non-zero when errors exist; the output is in stdout
    return (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
  }
}

function parseErrors(output: string): { count: number; byFile: Map<string, number> } {
  const byFile = new Map<string, number>();
  let count = 0;
  const lines = output.split('\n');
  for (const line of lines) {
    // Match: path/to/file.ts(123,45): error TS2345: ...
    const m = line.match(/^(.+?)\(\d+,\d+\):\s+error\s+TS\d+/);
    if (m) {
      count++;
      const file = m[1].trim();
      byFile.set(file, (byFile.get(file) || 0) + 1);
    }
  }
  return { count, byFile };
}

// ─── main ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isUpdate = args.includes('--update');
const showDiff = args.includes('--diff');

const budget = readBudget();
console.log(`📊 TS Error Budget — baseline: ${budget.baseline} (set ${budget.asOf})`);
console.log('   Running tsc…');

const output = runTsc();
const { count, byFile } = parseErrors(output);

console.log(`   Current errors: ${count}\n`);

if (showDiff || isUpdate) {
  const top = Array.from(byFile.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('Top 20 files by error count:');
  for (const [file, n] of top) {
    console.log(`   ${String(n).padStart(4)}  ${file}`);
  }
  console.log();
}

if (isUpdate) {
  if (count > budget.baseline) {
    console.error(`❌ Cannot --update: count (${count}) > baseline (${budget.baseline}). Fix errors before raising baseline.`);
    process.exit(1);
  }
  const newBudget: Budget = {
    ...budget,
    baseline: count,
    asOf: new Date().toISOString().slice(0, 10),
    note: `Rebaselined from ${budget.baseline} → ${count} (${budget.baseline - count} errors fixed).`,
  };
  writeBudget(newBudget);
  console.log(`✅ Baseline lowered: ${budget.baseline} → ${count} (-${budget.baseline - count})`);
  process.exit(0);
}

// CI gate — fail if errors increased
if (count > budget.baseline) {
  console.error(`❌ TS error count INCREASED: ${count} > baseline ${budget.baseline} (+${count - budget.baseline})`);
  console.error(`   Fix the new errors OR justify in PR description.`);
  console.error(`   Run \`npm run ts:budget -- --diff\` to see which files added errors.`);
  process.exit(1);
}

if (count < budget.baseline) {
  console.log(`🎉 Errors DECREASED: ${count} < baseline ${budget.baseline} (-${budget.baseline - count})`);
  console.log(`   Run \`npm run ts:budget -- --update\` to lock in the new lower baseline.`);
  process.exit(0);
}

console.log(`✅ Errors unchanged at baseline (${count}). PR may proceed.`);
process.exit(0);

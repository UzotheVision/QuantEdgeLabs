/**
 * GEX/VEX Narrative Service
 * ==========================
 * Generates concise, trader-grade natural-language commentary for GEX/VEX
 * snapshots using the free/cheap LLM cascade (Groq first → Gemini → Mistral).
 *
 * Use Cases:
 *   - Per-ticker terminal "regime insight" card
 *   - Scanner "why this ranks high" tooltip
 *   - Morning market-regime summary
 *
 * Performance:
 *   - Groq Llama-3.3-70B returns in ~400ms on this payload
 *   - Caches per-snapshot hash for 10 minutes to avoid duplicate calls
 */

import { logger } from './logger';
import { generateAI } from './multi-llm-service';
import type { GEXSnapshot, ConfluenceRow } from '../shared/gex-types';

// ─── Cache ──────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000;
const narrativeCache = new Map<string, { narrative: string; expiresAt: number }>();

function cacheKey(snap: GEXSnapshot): string {
  // Bucket at 1% price precision + regime to avoid redundant calls
  const bucket = Math.round(snap.spotPrice * 100) / 100;
  return `${snap.symbol}:${snap.regime}:${bucket}:${Math.round(snap.totalGEX * 10)}:${Math.round(snap.totalVEX * 10)}`;
}

// ─── Narrative Prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior derivatives strategist at a top prop trading firm.
Your job is to translate raw gamma exposure (GEX) and vanna exposure (VEX) data into
concise, actionable commentary for traders. Be direct. No hype. No disclaimers. No emojis.

RULES:
- 2-3 sentences max.
- Lead with the regime (e.g. "Dealers are long gamma...").
- Name the key level with its implication (pin, breakout magnet, support).
- If VEX is aligned with GEX → mention vol tailwind.
- If VEX diverges from GEX → flag regime transition risk.
- Use terms like "pin," "flip," "hedge flow," "vol crush."
- Never recommend specific trades. Just describe what dealer flow implies.`;

function buildUserPrompt(snap: GEXSnapshot): string {
  const gexDir = snap.totalGEX > 0 ? 'long' : 'short';
  const vexDir = snap.totalVEX > 0 ? 'tailwind' : 'headwind';
  const aligned = Math.sign(snap.totalGEX) === Math.sign(snap.totalVEX);

  return `Generate a terse regime insight for ${snap.symbol}:

- Spot: $${snap.spotPrice.toFixed(2)}
- Total GEX: ${snap.totalGEX.toFixed(2)}B (dealers ${gexDir} gamma)
- Total VEX: ${snap.totalVEX.toFixed(1)}M (vol ${vexDir})
- Regime: ${snap.regime}
- Put/Call GEX ratio: ${snap.putCallRatio.toFixed(2)}
- Gamma flip: ${snap.gammaFlipPrice ? '$' + snap.gammaFlipPrice : 'none'}
- Call wall: ${snap.callWall ? '$' + snap.callWall : 'none'}
- Put wall: ${snap.putWall ? '$' + snap.putWall : 'none'}
- Max gamma strike: $${snap.maxGammaStrike}
- Zero-gamma projection: ${snap.zeroGammaProjection ? '$' + snap.zeroGammaProjection : 'none'}
- GEX/VEX alignment: ${aligned ? 'aligned' : 'divergent'}

Write 2-3 sentences.`;
}

// ─── Main API ──────────────────────────────────────────────

export async function generateGEXNarrative(snap: GEXSnapshot): Promise<string> {
  const key = cacheKey(snap);
  const cached = narrativeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.narrative;
  }

  try {
    const narrative = await generateAI(buildUserPrompt(snap), {
      system: SYSTEM_PROMPT,
      mode: 'fallback',
      strategy: 'cheap', // Groq first
    });

    const clean = narrative.trim().replace(/^["']|["']$/g, '');
    narrativeCache.set(key, { narrative: clean, expiresAt: Date.now() + CACHE_TTL_MS });
    return clean;
  } catch (e: any) {
    logger.warn(`[GEX-NARRATIVE] AI failed for ${snap.symbol}: ${e.message}. Using rule-based fallback.`);
    return fallbackNarrative(snap);
  }
}

// ─── Rule-Based Fallback (no LLM needed) ──────────────────

export function fallbackNarrative(snap: GEXSnapshot): string {
  const parts: string[] = [];

  // Regime line
  switch (snap.regime) {
    case 'positive_gamma':
      parts.push(
        `Dealers are long gamma (+${snap.totalGEX.toFixed(2)}B). Expect vol suppression and mean reversion to ${snap.maxGammaStrike ? '$' + snap.maxGammaStrike : 'the max-gamma strike'}.`,
      );
      break;
    case 'negative_gamma':
      parts.push(
        `Dealers are short gamma (${snap.totalGEX.toFixed(2)}B). Moves will extend — break plays favored toward ${snap.callWall ? '$' + snap.callWall + ' (call wall)' : snap.putWall ? '$' + snap.putWall + ' (put wall)' : 'the nearest wall'}.`,
      );
      break;
    case 'transitioning':
      parts.push(
        `Gamma regime is flipping around ${snap.gammaFlipPrice ? '$' + snap.gammaFlipPrice : 'the flip point'}. Expect expansion of range.`,
      );
      break;
    default:
      parts.push(
        `Balanced gamma (${snap.totalGEX.toFixed(2)}B). Wait for walls to establish before positioning.`,
      );
  }

  // VEX line if meaningful
  if (Math.abs(snap.totalVEX) > 150) {
    const sameSign = Math.sign(snap.totalGEX) === Math.sign(snap.totalVEX);
    if (sameSign) {
      parts.push(
        `Vanna is ${snap.totalVEX > 0 ? 'tailwind' : 'headwind'} ($${(snap.totalVEX / 1000).toFixed(1)}B) — aligned with gamma, reinforcing the move.`,
      );
    } else {
      parts.push(
        `Vanna ($${(snap.totalVEX / 1000).toFixed(1)}B) diverges from gamma — regime shift risk elevated.`,
      );
    }
  }

  return parts.join(' ');
}

// ─── Scanner Row Narrative (shorter) ──────────────────────

export async function generateConfluenceNarrative(row: ConfluenceRow): Promise<string> {
  const prompt = `One-line thesis for ${row.symbol} (score ${row.score}/100):

- Bias: ${row.bias}
- Tier: ${row.tier || 'untiered'}
- Gamma flip: ${row.gammaFlip ? '$' + row.gammaFlip : 'none'}
- Call wall: ${row.callWall ? '$' + row.callWall : 'none'}  |  Put wall: ${row.putWall ? '$' + row.putWall : 'none'}
- Target: ${row.target ? '$' + row.target : '—'}  |  Stop: ${row.stop ? '$' + row.stop : '—'}
- R:R: ${row.riskReward?.toFixed(1) || '—'}

Write ONE sentence (max 20 words) describing why this setup ranks high.`;

  try {
    const text = await generateAI(prompt, {
      system: 'You are a prop trader. Be terse. No disclaimers.',
      strategy: 'cheap',
    });
    return text.trim().replace(/^["']|["']$/g, '');
  } catch {
    return `${row.symbol} ${row.bias} @ $${row.spotPrice.toFixed(2)} — ${row.scoreTier} confluence, R:R ${row.riskReward?.toFixed(1) || '—'}`;
  }
}

// ─── Batch Narratives ─────────────────────────────────────

export async function generateBatchNarratives(snaps: GEXSnapshot[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  // Limit concurrency to 3 to respect free-tier rate limits
  const BATCH = 3;
  for (let i = 0; i < snaps.length; i += BATCH) {
    const batch = snaps.slice(i, i + BATCH);
    const narratives = await Promise.all(batch.map((s) => generateGEXNarrative(s)));
    batch.forEach((s, idx) => result.set(s.symbol, narratives[idx]));
  }
  return result;
}

logger.info('[GEX-NARRATIVE] Narrative service loaded (Groq-first, fallback to rule-based)');

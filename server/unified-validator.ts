/**
 * Unified Validator
 * =================
 * Single validation gate that ALL trade ideas pass through before
 * reaching the Trade Desk. Each source gets appropriate strictness.
 *
 * TV signals: NEVER blocked, only scored (CONFIRMED/CAUTION)
 * AI/Quant/Flow: Can be blocked if market context is wrong
 * All sources: Get sector, volume, VIX, time-of-day checks
 *
 * This replaces the scattered confidence logic across 11 engines
 * with one consistent system.
 */

import { logger } from './logger';
import { getTradierQuote } from './tradier-api';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ValidationInput {
  symbol: string;
  direction: 'long' | 'short';
  source: string; // 'ai' | 'quant' | 'flow' | 'lotto' | 'tradingview' | etc.
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  assetType: string;
  confidence: number; // raw confidence from the source engine
  signalCount?: number;
}

export interface ValidationResult {
  approved: boolean;
  finalConfidence: number;
  grade: string;
  verdict: 'CONFIRMED' | 'NEUTRAL' | 'CAUTION' | 'BLOCKED';
  checks: ValidationCheck[];
  reasoning: string;
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  score: number; // -15 to +15
  detail: string;
}

// Skip list — these tickers lose money on the strategy
const SKIP_TICKERS = new Set([
  'AI', 'GLBE', 'TOST', 'CYBR', 'MNDY', 'GRAB', 'SE',
]);

// Sector ETF mapping
const SECTOR_MAP: Record<string, string> = {
  AAOI: 'SMH', KLAC: 'SMH', LRCX: 'SMH', MU: 'SMH', AMD: 'SMH', SMTC: 'SMH',
  TSEM: 'SMH', AEHR: 'SMH', OLED: 'SMH', RMBS: 'SMH', MKSI: 'SMH', ARM: 'SMH',
  CRCL: 'SMH', WDC: 'SMH', AVGO: 'SMH', ONTO: 'SMH', ENTG: 'SMH', COHU: 'SMH',
  ACLS: 'SMH', AMBA: 'SMH', DELL: 'SMH', ALGM: 'SMH', COHR: 'SMH',
  INTA: 'XLK', DDOG: 'XLK', SNOW: 'XLK', NET: 'XLK', PATH: 'XLK',
  MDB: 'XLK', ESTC: 'XLK', FRSH: 'XLK', ASAN: 'XLK', DUOL: 'XLK',
  BILL: 'XLF', AFRM: 'XLF', SOFI: 'XLF', COIN: 'XLF', UPST: 'XLF',
  LUNR: 'XLI', OKLO: 'XLE', HIMS: 'XLV', LLY: 'XLV',
  TSLA: 'XLY', NFLX: 'XLC', SHOP: 'XLY', DKNG: 'XLY',
  MARA: 'SMH', MSTR: 'SMH',
  LITE: 'SMH', FN: 'SMH', CIEN: 'SMH', AXTI: 'SMH', // Optics/photonics
};

// ═══════════════════════════════════════════════════════════════
// MAIN VALIDATOR
// ═══════════════════════════════════════════════════════════════

export async function validateIdea(input: ValidationInput): Promise<ValidationResult> {
  const { symbol, direction, source, entryPrice, targetPrice, stopLoss, confidence } = input;
  const checks: ValidationCheck[] = [];
  let totalScore = 0;
  const isTV = source === 'tradingview';
  const isManual = source === 'manual';

  // ── CHECK 1: Skip list ──────────────────────────────────────
  if (SKIP_TICKERS.has(symbol.toUpperCase())) {
    return {
      approved: false,
      finalConfidence: 0,
      grade: 'F',
      verdict: 'BLOCKED',
      checks: [{ name: 'Skip List', passed: false, score: -100, detail: `${symbol} is on skip list (proven money loser)` }],
      reasoning: `BLOCKED: ${symbol} is on the skip list — loses money on backtested strategy`,
    };
  }

  // ── CHECK 2: R:R Quality ────────────────────────────────────
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(targetPrice - entryPrice);
  const rr = risk > 0 ? reward / risk : 0;

  if (rr >= 2.5) {
    checks.push({ name: 'R:R Ratio', passed: true, score: 15, detail: `${rr.toFixed(1)}:1 — excellent` });
  } else if (rr >= 1.5) {
    checks.push({ name: 'R:R Ratio', passed: true, score: 8, detail: `${rr.toFixed(1)}:1 — good` });
  } else if (rr >= 1.0) {
    checks.push({ name: 'R:R Ratio', passed: true, score: 0, detail: `${rr.toFixed(1)}:1 — acceptable` });
  } else {
    checks.push({ name: 'R:R Ratio', passed: false, score: -10, detail: `${rr.toFixed(1)}:1 — poor risk/reward` });
  }

  // ── CHECK 3: Sector ETF alignment ──────────────────────────
  try {
    const sectorETF = SECTOR_MAP[symbol.toUpperCase()] || 'SPY';
    const sectorQuote = await getTradierQuote(sectorETF).catch(() => null);

    if (sectorQuote?.change_percentage !== undefined) {
      const sectorPct = sectorQuote.change_percentage;
      const aligned = (direction === 'long' && sectorPct > 0) || (direction === 'short' && sectorPct < 0);

      if (aligned && Math.abs(sectorPct) > 1) {
        checks.push({ name: 'Sector', passed: true, score: 15, detail: `${sectorETF} ${sectorPct > 0 ? '+' : ''}${sectorPct.toFixed(1)}% — strongly aligned` });
      } else if (aligned) {
        checks.push({ name: 'Sector', passed: true, score: 8, detail: `${sectorETF} ${sectorPct > 0 ? '+' : ''}${sectorPct.toFixed(1)}% — aligned` });
      } else if (Math.abs(sectorPct) > 2) {
        checks.push({ name: 'Sector', passed: false, score: -12, detail: `${sectorETF} ${sectorPct > 0 ? '+' : ''}${sectorPct.toFixed(1)}% — opposing (strong)` });
      } else {
        checks.push({ name: 'Sector', passed: false, score: -5, detail: `${sectorETF} ${sectorPct > 0 ? '+' : ''}${sectorPct.toFixed(1)}% — slightly opposing` });
      }
    }
  } catch {}

  // ── CHECK 4: Volume ─────────────────────────────────────────
  try {
    const quote = await getTradierQuote(symbol).catch(() => null);
    if (quote?.volume && quote?.average_volume && quote.average_volume > 0) {
      const volRatio = quote.volume / quote.average_volume;

      if (volRatio >= 2.0) {
        checks.push({ name: 'Volume', passed: true, score: 15, detail: `${volRatio.toFixed(1)}x avg — institutional` });
      } else if (volRatio >= 1.5) {
        checks.push({ name: 'Volume', passed: true, score: 8, detail: `${volRatio.toFixed(1)}x avg — above average` });
      } else if (volRatio >= 1.0) {
        checks.push({ name: 'Volume', passed: true, score: 0, detail: `${volRatio.toFixed(1)}x avg — normal` });
      } else {
        checks.push({ name: 'Volume', passed: false, score: -8, detail: `${volRatio.toFixed(1)}x avg — low volume` });
      }
    }
  } catch {}

  // ── CHECK 5: VIX range ──────────────────────────────────────
  try {
    const vixQuote = await getTradierQuote('VIX').catch(() => null);
    if (vixQuote?.last) {
      const vix = vixQuote.last;
      if (vix > 38) {
        checks.push({ name: 'VIX', passed: false, score: -15, detail: `VIX ${vix.toFixed(1)} — too high, spreads wide` });
      } else if (vix < 13) {
        checks.push({ name: 'VIX', passed: false, score: -10, detail: `VIX ${vix.toFixed(1)} — too low, nothing moves` });
      } else if (vix >= 25) {
        checks.push({ name: 'VIX', passed: true, score: 0, detail: `VIX ${vix.toFixed(1)} — elevated, size down` });
      } else {
        checks.push({ name: 'VIX', passed: true, score: 5, detail: `VIX ${vix.toFixed(1)} — normal range` });
      }
    }
  } catch {}

  // ── CHECK 6: Time of day ────────────────────────────────────
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = et.getHours();
  const minute = et.getMinutes();
  const timeMinutes = hour * 60 + minute;
  const day = et.getDay();

  if (day === 0 || day === 6) {
    checks.push({ name: 'Time', passed: true, score: 0, detail: 'Weekend — for next session' });
  } else if (timeMinutes >= 600 && timeMinutes <= 690) { // 10:00-11:30 AM
    checks.push({ name: 'Time', passed: true, score: 10, detail: 'Prime window (10:00-11:30 AM)' });
  } else if (timeMinutes >= 570 && timeMinutes <= 600) { // 9:30-10:00 AM
    checks.push({ name: 'Time', passed: true, score: 3, detail: 'Opening range forming (wait for 10AM)' });
  } else if (timeMinutes >= 810 && timeMinutes <= 900) { // 1:30-3:00 PM
    checks.push({ name: 'Time', passed: true, score: 5, detail: 'Afternoon session' });
  } else if (timeMinutes >= 900 && timeMinutes <= 960) { // 3:00-4:00 PM
    checks.push({ name: 'Time', passed: true, score: -3, detail: 'Power hour — theta risk on 0DTE' });
  } else if (timeMinutes < 570 || timeMinutes > 960) {
    checks.push({ name: 'Time', passed: true, score: 0, detail: 'Pre/post market' });
  }

  // ── CHECK 7: Previous day setup ─────────────────────────────
  try {
    const quote = await getTradierQuote(symbol).catch(() => null);
    if (quote?.change_percentage !== undefined) {
      const prevPct = quote.change_percentage;
      if (direction === 'long' && prevPct < -3) {
        checks.push({ name: 'Setup', passed: true, score: 12, detail: `Reversal after ${prevPct.toFixed(1)}% red — highest WR setup` });
      } else if (direction === 'short' && prevPct > 3) {
        checks.push({ name: 'Setup', passed: true, score: 10, detail: `Breakdown after +${prevPct.toFixed(1)}% extended` });
      } else if (direction === 'long' && prevPct < -1.5) {
        checks.push({ name: 'Setup', passed: true, score: 5, detail: `Bounce after ${prevPct.toFixed(1)}% pullback` });
      }
    }
  } catch {}

  // ── CHECK 8: Fundamental catalysts ───────────────────────────
  try {
    const { calculateCatalystScore } = await import('./catalyst-intelligence-service');
    const catalystData = await calculateCatalystScore(symbol);

    if (catalystData.catalystCount > 0) {
      const catScore = catalystData.score;
      if (catScore > 0 && direction === 'long') {
        checks.push({ name: 'Catalyst', passed: true, score: Math.min(12, catScore), detail: `${catalystData.catalystCount} bullish catalysts — ${catalystData.summary}` });
      } else if (catScore < 0 && direction === 'short') {
        checks.push({ name: 'Catalyst', passed: true, score: Math.min(12, Math.abs(catScore)), detail: `${catalystData.catalystCount} bearish catalysts — ${catalystData.summary}` });
      } else if (catScore > 0 && direction === 'short') {
        checks.push({ name: 'Catalyst', passed: false, score: -8, detail: `Bullish catalysts detected but shorting — ${catalystData.summary}` });
      } else if (catScore < 0 && direction === 'long') {
        checks.push({ name: 'Catalyst', passed: false, score: -8, detail: `Bearish catalysts detected but going long — ${catalystData.summary}` });
      }
    }
  } catch {}

  // ── CHECK 9: Earnings proximity ─────────────────────────────
  try {
    const { shouldBlockSymbol } = await import('./earnings-service');
    const earningsBlocked = await shouldBlockSymbol(symbol, false);
    if (earningsBlocked) {
      if (isTV) {
        // TV signals: warn but don't block
        checks.push({ name: 'Earnings', passed: false, score: -5, detail: 'Earnings within 2 days — IV crush risk' });
      } else {
        // AI/other: strong penalty
        checks.push({ name: 'Earnings', passed: false, score: -12, detail: 'Earnings within 2 days — high risk of gap' });
      }
    }
  } catch {}

  // ── CHECK 10: Whale flow alignment ──────────────────────────
  try {
    const { getSymbolDirectionality } = await import('./whale-flow-service');
    const flowDir = await getSymbolDirectionality(symbol);
    if (flowDir && flowDir.whaleCount >= 3) {
      const flowAligned = (direction === 'long' && flowDir.netDirection === 'BULLISH') ||
                         (direction === 'short' && flowDir.netDirection === 'BEARISH');
      if (flowAligned && flowDir.directionStrength > 40) {
        checks.push({ name: 'Whale Flow', passed: true, score: 12, detail: `${flowDir.netDirection} flow (${flowDir.whaleCount} whales, ${flowDir.directionStrength}% strength)` });
      } else if (flowAligned) {
        checks.push({ name: 'Whale Flow', passed: true, score: 5, detail: `${flowDir.netDirection} flow (${flowDir.whaleCount} whales)` });
      } else if (flowDir.directionStrength > 40) {
        checks.push({ name: 'Whale Flow', passed: false, score: -8, detail: `${flowDir.netDirection} flow OPPOSING trade (${flowDir.directionStrength}% strength)` });
      }
    }
  } catch {}

  // ── CALCULATE FINAL SCORE ───────────────────────────────────
  totalScore = checks.reduce((sum, c) => sum + c.score, 0);

  // Base score from source engine
  let baseScore = confidence;

  // Apply validation adjustments
  const adjustedScore = Math.max(10, Math.min(98, baseScore + totalScore * 0.5));

  // ── DETERMINE VERDICT ───────────────────────────────────────
  const passedCount = checks.filter(c => c.passed).length;
  const failedCount = checks.filter(c => !c.passed).length;
  const hasBlocker = checks.some(c => c.score <= -12);

  let verdict: ValidationResult['verdict'];
  let approved: boolean;

  if (isTV || isManual) {
    // TV and manual signals: NEVER block, only score
    approved = true;
    if (totalScore >= 15) verdict = 'CONFIRMED';
    else if (totalScore >= 0) verdict = 'NEUTRAL';
    else verdict = 'CAUTION';
  } else {
    // AI/Quant/Flow: Can be blocked
    if (hasBlocker && totalScore < -10) {
      approved = false;
      verdict = 'BLOCKED';
    } else if (totalScore >= 10) {
      approved = true;
      verdict = 'CONFIRMED';
    } else if (totalScore >= -5) {
      approved = true;
      verdict = 'NEUTRAL';
    } else {
      approved = false;
      verdict = 'CAUTION';
    }
  }

  // Grade from adjusted score
  const grade = adjustedScore >= 90 ? 'A+' : adjustedScore >= 85 ? 'A' : adjustedScore >= 80 ? 'A-' :
    adjustedScore >= 75 ? 'B+' : adjustedScore >= 70 ? 'B' : adjustedScore >= 60 ? 'B-' :
    adjustedScore >= 50 ? 'C+' : adjustedScore >= 40 ? 'C' : 'D';

  const reasoning = checks.map(c => `${c.passed ? '✅' : '⚠️'} ${c.name}: ${c.detail}`).join(' | ');

  logger.info(`[VALIDATOR] ${symbol} ${direction} (${source}): ${verdict} score=${adjustedScore.toFixed(0)} grade=${grade} | ${reasoning}`);

  return {
    approved,
    finalConfidence: Math.round(adjustedScore),
    grade,
    verdict,
    checks,
    reasoning,
  };
}

logger.info('[VALIDATOR] Unified Validator initialized');

/**
 * ENTRY TIMING VALIDATOR - Prevents Chasing & Bull Traps
 * Only enters BEFORE the move, not AFTER
 */

import { logger } from './logger';

interface EntryTimingCheck {
  allowed: boolean;
  reason: string;
  score: number;
}

/**
 * Check if we're chasing a move that already happened
 */
export function validateNotChasing(
  ticker: string,
  changePercent: number,
  type: 'call' | 'put'
): { pass: boolean; reason: string } {
  // Don't chase calls on stocks already up >3%
  if (type === 'call' && changePercent > 3) {
    return {
      pass: false,
      reason: `Stock already up ${changePercent.toFixed(1)}% - would be buying the top`
    };
  }

  // Don't chase puts on stocks already down >3%
  if (type === 'put' && changePercent < -3) {
    return {
      pass: false,
      reason: `Stock already down ${Math.abs(changePercent).toFixed(1)}% - would be selling the bottom`
    };
  }

  return { pass: true, reason: 'Not chasing' };
}

/**
 * Check if signals are predictive (before move) vs reactive (after move)
 */
export function validatePredictiveSignals(
  signals: string[]
): { pass: boolean; reason: string } {
  const predictive = [
    'consolidation',
    'triangle',
    'accumulation',
    'smart_money',
    'dark_pool',
    'insider',
    'pre_breakout'
  ];

  const reactive = [
    'unusual_call_flow',
    'unusual_put_flow',
    'momentum_surge',
    'breakout_confirmed',
    'volume_spike'
  ];

  const hasPredictive = signals.some(s =>
    predictive.some(p => s.toLowerCase().includes(p))
  );

  const onlyReactive = signals.every(s =>
    reactive.some(r => s.toLowerCase().includes(r))
  );

  if (onlyReactive && !hasPredictive) {
    return {
      pass: false,
      reason: 'Only reactive signals - likely too late (unusual flow = already moved)'
    };
  }

  return { pass: true, reason: hasPredictive ? 'Has predictive signals' : 'Mixed signals' };
}

/**
 * Master validation - returns score 0-100
 */
export function validateEntryTiming(
  ticker: string,
  type: 'call' | 'put',
  changePercent: number,
  signals: string[],
  premium: number
): EntryTimingCheck {
  let score = 100;
  const reasons: string[] = [];

  // Check 1: Not chasing (CRITICAL - 50 points)
  const chasingCheck = validateNotChasing(ticker, changePercent, type);
  if (!chasingCheck.pass) {
    score -= 50;
    reasons.push(chasingCheck.reason);
  }

  // Check 2: Predictive signals (30 points)
  const signalCheck = validatePredictiveSignals(signals);
  if (!signalCheck.pass) {
    score -= 30;
    reasons.push(signalCheck.reason);
  }

  // Check 3: Premium not too expensive (20 points)
  if (premium > 1.50) {
    score -= 20;
    reasons.push(`Premium $${premium} too high - likely inflated IV`);
  }

  const allowed = score >= 60; // Need 60/100 to enter

  if (!allowed) {
    logger.warn(`[ENTRY-TIMING] ❌ ${ticker} REJECTED - Score: ${score}/100`);
    logger.warn(`[ENTRY-TIMING]    Reasons: ${reasons.join(' | ')}`);
  } else {
    logger.info(`[ENTRY-TIMING] ✅ ${ticker} APPROVED - Score: ${score}/100 - Good entry timing`);
  }

  return {
    allowed,
    reason: reasons.join('; ') || 'Good timing',
    score
  };
}

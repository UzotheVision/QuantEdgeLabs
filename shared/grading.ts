/**
 * UNIFIED GRADING CONTRACT v4.0
 * 
 * Single source of truth for all grading across the platform.
 * 
 * IMPORTANT: The platform uses CONFIDENCE-BASED grading as the canonical system.
 * - `probabilityBand` is assigned at trade creation using confidenceScore
 * - Signal count is SUPPLEMENTARY information, NOT the grade
 * - All UI should display the stored `probabilityBand`, not recalculate
 * 
 * GRADING SCALE (Trade-Conviction — the platform standard):
 * Calibrated for trade-setup scores, NOT academic tests. A setup scoring 80
 * is a STRONG setup (B+), not a "barely passing" one. This is the same scale
 * the active modules already use (thesis-radar, contract-analyzer, intraday,
 * btc-beta) — now centralized here as the single source of truth.
 * - A+ = 95%+   (Exceptional)
 * - A  = 90-94% (Excellent)
 * - A- = 85-89% (Very strong)
 * - B+ = 80-84% (Strong)
 * - B  = 75-79% (Good)
 * - B- = 70-74% (Above average — lowest "tradeable")
 * - C+ = 65-69% (Average+)
 * - C  = 60-64% (Average)
 * - C- = 55-59% (Passing)
 * - D+ = 50-54% (Below average)
 * - D  = 45-49% (Poor)
 * - D- = 40-44% (Minimal)
 * - F  = <40%   (Failing)
 */

export type GradeLetter = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F';

export interface GradeInfo {
  grade: GradeLetter;
  description: string;
  tier: 'elite' | 'strong' | 'average' | 'weak' | 'failing';
  minScore: number;
  maxScore: number;
}

/**
 * Grade thresholds - single source of truth
 */
export const GRADE_THRESHOLDS: { min: number; grade: GradeLetter; description: string; tier: GradeInfo['tier'] }[] = [
  { min: 95, grade: 'A+', description: 'Exceptional', tier: 'elite' },
  { min: 90, grade: 'A', description: 'Excellent', tier: 'elite' },
  { min: 85, grade: 'A-', description: 'Very strong', tier: 'strong' },
  { min: 80, grade: 'B+', description: 'Strong', tier: 'strong' },
  { min: 75, grade: 'B', description: 'Good', tier: 'strong' },
  { min: 70, grade: 'B-', description: 'Above average', tier: 'average' },
  { min: 65, grade: 'C+', description: 'Average+', tier: 'average' },
  { min: 60, grade: 'C', description: 'Average', tier: 'average' },
  { min: 55, grade: 'C-', description: 'Passing', tier: 'average' },
  { min: 50, grade: 'D+', description: 'Below average', tier: 'weak' },
  { min: 45, grade: 'D', description: 'Poor', tier: 'weak' },
  { min: 40, grade: 'D-', description: 'Minimal', tier: 'weak' },
  { min: 0, grade: 'F', description: 'Failing', tier: 'failing' },
];

/**
 * Convert a score (0-100) to a grade
 * This is the CANONICAL grading function for the entire platform
 */
export function scoreToGrade(score: number): GradeInfo {
  // NaN protection: if score is NaN or undefined, return F grade
  if (score === null || score === undefined || isNaN(score)) {
    return {
      grade: 'F',
      description: 'Invalid score',
      tier: 'failing',
      minScore: 0,
      maxScore: 59,
    };
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  
  for (let i = 0; i < GRADE_THRESHOLDS.length; i++) {
    const threshold = GRADE_THRESHOLDS[i];
    if (clampedScore >= threshold.min) {
      const maxScore = i === 0 ? 100 : GRADE_THRESHOLDS[i - 1].min - 1;
      return {
        grade: threshold.grade,
        description: threshold.description,
        tier: threshold.tier,
        minScore: threshold.min,
        maxScore,
      };
    }
  }
  
  // Fallback (should never reach)
  return {
    grade: 'F',
    description: 'Failing',
    tier: 'failing',
    minScore: 0,
    maxScore: 59,
  };
}

/**
 * Get just the letter grade from a score
 */
export function getLetterGrade(score: number): GradeLetter {
  return scoreToGrade(score).grade;
}

/**
 * Check if a grade is considered "tradeable" (B- or better)
 */
export function isTradeableGrade(grade: GradeLetter): boolean {
  return ['A+', 'A', 'A-', 'B+', 'B', 'B-'].includes(grade);
}

/**
 * Check if a grade is elite tier (A range)
 */
export function isEliteGrade(grade: GradeLetter): boolean {
  return ['A+', 'A'].includes(grade);
}

/**
 * Get grade styling for UI components
 */
export function getGradeStyle(grade: GradeLetter | string | null | undefined): {
  bgClass: string;
  textClass: string;
  borderClass: string;
} {
  const g = (grade || 'F').toUpperCase();
  
  if (g === 'A+') {
    return {
      bgClass: 'bg-emerald-500/20',
      textClass: 'text-emerald-400',
      borderClass: 'border-emerald-500/40',
    };
  }
  if (g === 'A' || g === 'A-') {
    return {
      bgClass: 'bg-green-500/20',
      textClass: 'text-green-400',
      borderClass: 'border-green-500/40',
    };
  }
  if (g === 'B+' || g === 'B' || g === 'B-') {
    return {
      bgClass: 'bg-blue-500/20',
      textClass: 'text-blue-400',
      borderClass: 'border-blue-500/40',
    };
  }
  if (g === 'C+' || g === 'C' || g === 'C-') {
    return {
      bgClass: 'bg-amber-500/20',
      textClass: 'text-amber-400',
      borderClass: 'border-amber-500/40',
    };
  }
  
  // D and F grades
  return {
    bgClass: 'bg-red-500/20',
    textClass: 'text-red-400',
    borderClass: 'border-red-500/40',
  };
}

/**
 * SIGNAL QUALITY (Supplementary Information)
 * 
 * Signal count provides ADDITIONAL context but is NOT the grade.
 * Use this for UI tooltips and secondary indicators.
 */
export interface SignalQuality {
  count: number;
  label: string;
  description: string;
}

export function getSignalQuality(signalCount: number): SignalQuality {
  if (signalCount >= 5) {
    return { count: signalCount, label: 'Exceptional', description: 'All indicators aligned' };
  }
  if (signalCount >= 4) {
    return { count: signalCount, label: 'Strong', description: 'Most indicators aligned' };
  }
  if (signalCount >= 3) {
    return { count: signalCount, label: 'Good', description: 'Multiple indicators aligned' };
  }
  if (signalCount >= 2) {
    return { count: signalCount, label: 'Average', description: 'Some indicators aligned' };
  }
  return { count: signalCount, label: 'Weak', description: 'Few indicators aligned' };
}

/**
 * Combine confidence score + signal count into a final grade
 * 
 * This is for systems that want to consider BOTH factors:
 * - Base: confidence score (70% weight)
 * - Bonus: signal quality (30% weight as bonus adjustment)
 * 
 * Signal bonus:
 * - 5 signals: +5 points
 * - 4 signals: +3 points
 * - 3 signals: +1 point
 * - 2 signals: 0 points
 * - 0-1 signals: -3 points
 */
export function getCombinedGrade(confidenceScore: number, signalCount: number): GradeInfo {
  let bonus = 0;
  if (signalCount >= 5) bonus = 5;
  else if (signalCount >= 4) bonus = 3;
  else if (signalCount >= 3) bonus = 1;
  else if (signalCount <= 1) bonus = -3;
  
  const adjustedScore = Math.max(0, Math.min(100, confidenceScore + bonus));
  return scoreToGrade(adjustedScore);
}

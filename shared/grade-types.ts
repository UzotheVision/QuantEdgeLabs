/**
 * Grading System Types
 *
 * Types for the QuantEdge stock grading system
 */

export type GradeLetter = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface GradeConfig {
  S: { min: 90; max: 100; label: 'Exceptional'; color: 'purple' };
  A: { min: 80; max: 89; label: 'Excellent'; color: 'green' };
  B: { min: 70; max: 79; label: 'Good'; color: 'blue' };
  C: { min: 60; max: 69; label: 'Fair'; color: 'yellow' };
  D: { min: 50; max: 59; label: 'Poor'; color: 'orange' };
  F: { min: 0; max: 49; label: 'Failing'; color: 'red' };
}

export interface GradeWeights {
  technical: number; // Default: 0.40
  fundamental: number; // Default: 0.35
  sentiment: number; // Default: 0.15
  ai: number; // Default: 0.10
}

export const DEFAULT_GRADE_WEIGHTS: GradeWeights = {
  technical: 0.40,
  fundamental: 0.35,
  sentiment: 0.15,
  ai: 0.10,
};

export const FUNDAMENTAL_CATEGORY_WEIGHTS = {
  'Financial Health': 0.35,
  'Valuation': 0.25,
  'Growth': 0.20,
  'Dividend': 0.10,
  'Quality': 0.10,
};

export function scoreToGrade(score: number): GradeLetter {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export function gradeToColor(grade: GradeLetter): string {
  const colorMap: Record<GradeLetter, string> = {
    S: 'text-purple-500',
    A: 'text-green-500',
    B: 'text-blue-500',
    C: 'text-yellow-500',
    D: 'text-orange-500',
    F: 'text-red-500',
  };
  return colorMap[grade];
}

export function gradeToBackgroundColor(grade: GradeLetter): string {
  const bgMap: Record<GradeLetter, string> = {
    S: 'bg-purple-500/10',
    A: 'bg-green-500/10',
    B: 'bg-blue-500/10',
    C: 'bg-yellow-500/10',
    D: 'bg-orange-500/10',
    F: 'bg-red-500/10',
  };
  return bgMap[grade];
}

export function gradeLabel(grade: GradeLetter): string {
  const labelMap: Record<GradeLetter, string> = {
    S: 'Exceptional',
    A: 'Excellent',
    B: 'Good',
    C: 'Fair',
    D: 'Poor',
    F: 'Failing',
  };
  return labelMap[grade];
}

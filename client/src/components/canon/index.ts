/**
 * CANON — one component per concept.
 *
 * Phase 1 of the UI unification. Before this, freshness rendered three ways,
 * scores five, level names differed per surface, and zero/missing/not-measurable
 * were indistinguishable in places.
 *
 * These promote the best existing implementation rather than inventing new ones:
 * freshness is CacheFreshnessIndicator's logic on design tokens, level naming is
 * gex-level-badge's ROLE_LABELS, score wraps conviction-display's resolution, and
 * value/model-note generalise the honesty pattern Flow already ships.
 */
export { CanonValue, CanonCoverage, valueStateOf, type ValueState } from './value';
export { CanonFreshness } from './freshness';
export { CanonScore, CanonGrade, CanonRate, scoreBand, gradeColor, bandColor, tierColor, tierBadgeStyle, type ScoreBand } from './score';
export { CanonLevelBadge, LEVEL_LABELS, levelColor, type LevelRole } from './level';
export { CanonModelNote } from './model-note';
export { feedTimestamp, lacksTimestamp } from './use-feed-freshness';

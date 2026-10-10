/**
 * Presentation scale for a raw confluence score.
 *
 * The engine scores independent evidence in raw points (S >= 25, A >= 19,
 * B >= 13). Product surfaces use a 0–100 confidence index so a score of 27
 * is not incorrectly presented as "27%". Keep this transform here: alerts,
 * the terminal and any future API consumer must show the same scale.
 */
export function convictionDisplayPercent(score: number): number {
  const s = Math.max(0, score);
  let pct: number;

  if (s >= 25) pct = 86 + ((s - 25) / 10) * 13;
  else if (s >= 19) pct = 72 + ((s - 19) / 6) * 14;
  else if (s >= 13) pct = 58 + ((s - 13) / 6) * 14;
  else pct = (s / 13) * 58;

  return Math.round(Math.max(0, Math.min(99, pct)));
}

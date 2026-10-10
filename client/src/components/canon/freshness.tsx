/**
 * CANON · FRESHNESS
 *
 * This file previously contained a second freshness component. That was a
 * mistake and it is worth recording why, because it is the exact failure the
 * canonicalisation was supposed to prevent.
 *
 * `Heartbeat` in components/viz already owned this concept. It is documented in
 * viz/MOTION.md as the Tier 1 primitive for "proof the screen is still
 * connected", and it is better than what replaced it: it re-renders every second
 * so the age genuinely counts up, where a static component shows an age frozen
 * at last paint — which on a stalling feed is the one moment the number matters.
 *
 * MOTION.md also records that Heartbeat had ZERO files using it. So the problem
 * was never that the right component did not exist. It existed, was documented,
 * and was never wired in. Writing a sixth one would have made that worse.
 *
 * Canon re-exports it rather than wrapping it, so there is no second name for
 * one thing. The only change made to Heartbeat itself was moving its hardcoded
 * emerald/amber/rose onto --trade-bullish / --brand-gold / --trade-bearish.
 */
export { Heartbeat as CanonFreshness } from '@/components/viz';

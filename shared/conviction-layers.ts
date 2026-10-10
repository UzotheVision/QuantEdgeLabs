/**
 * The conviction layers, as one canonical list.
 *
 * The layer count was previously typed by hand in three places on the landing
 * page and disagreed with itself: the section heading claimed 14, the hero
 * claimed 15, and the chips below the heading showed 6 from an older taxonomy.
 * The engine's own type union listed 15 while emitting 16 — `macro` was being
 * assigned to layers without ever being declared.
 *
 * A number that is asserted in prose drifts the moment the engine changes. This
 * is the single source: the engine's union is built from it, and the marketing
 * copy counts it, so the two cannot disagree again.
 */

export const CONVICTION_LAYERS = [
  { kind: 'technical',    label: 'Technical',      short: 'TCH', blurb: 'Price action, RSI, volume against its own average' },
  { kind: 'ta',           label: 'Signals',        short: 'SIG', blurb: 'Named setups the scanner recognises' },
  { kind: 'compression',  label: 'Compression',    short: 'CMP', blurb: 'Darvas box and TTM squeeze — range tightening against its own volatility' },
  { kind: 'gex',          label: 'Gamma',          short: 'GEX', blurb: 'Dealer positioning: flip point, call wall, put wall' },
  { kind: 'convergence',  label: 'Convergence',    short: 'CNV', blurb: 'Independent methods agreeing on the same direction' },
  { kind: 'sector',       label: 'Sector',         short: 'SEC', blurb: 'Is the group being bought, with breadth behind it' },
  { kind: 'regime',       label: 'Regime',         short: 'RGM', blurb: 'Whether the market favours this side today' },
  { kind: 'breadth',      label: 'Breadth',        short: 'BRD', blurb: 'How much of the market is participating' },
  { kind: 'macro',        label: 'Macro',          short: 'MAC', blurb: 'Rates, dollar and cross-asset backdrop' },
  { kind: 'catalyst',     label: 'Catalyst',       short: 'CAT', blurb: 'Tracked events, and whether they argue with the call' },
  { kind: 'analyst',      label: 'Analyst',        short: 'ANL', blurb: 'Estimate revisions and coverage shifts' },
  { kind: 'fundamental',  label: 'Fundamental',    short: 'FND', blurb: 'Quality tier of the underlying business' },
  { kind: 'geopolitical', label: 'Geopolitical',   short: 'GEO', blurb: 'Policy and conflict exposure for the sector' },
  { kind: 'premarket',    label: 'Pre-market',     short: 'PRE', blurb: 'Whether the overnight tape confirms or fights the setup' },
  { kind: 'freshness',    label: 'Freshness',      short: 'FRS', blurb: 'How much of the move has already happened' },
  { kind: 'weekly',       label: 'Weekly',         short: 'WKY', blurb: 'Position within the weekly watchlist thesis' },
  { kind: 'structure',    label: 'Structure',      short: 'STR', blurb: 'What the publishing detector measured: a dated bottom with a printed invalidation, or aggressor dollars at the ask' },
] as const;

/**
 * The four families the 16 layers fall into.
 *
 * Sixteen chips in a grid is not a design, it is a dump — every item the same
 * size, so nothing has a shape and the reader gives up. The layers were always
 * answering four different questions; this says so.
 *
 * `kinds` is the canonical membership. It lives here rather than in the view so
 * the grouping cannot drift from the list it groups, which is the same mistake
 * that produced a heading claiming 14, a hero claiming 15 and chips showing 6.
 * A layer added above and not placed in a family will fail the assertion below.
 */
export const CONVICTION_FAMILIES = [
  {
    id: 'chart',
    label: 'The chart',
    tag: 'PRICE',
    question: 'What is price doing on its own terms?',
    blurb:
      'The setup as it appears without any outside context — structure, the named pattern, how tightly the range has wound, and how much of the move has already happened.',
    kinds: ['technical', 'ta', 'compression', 'freshness', 'structure'],
  },
  {
    id: 'positioning',
    label: 'Positioning',
    tag: 'FLOW',
    question: 'Where does other money already sit?',
    blurb:
      'Dealer hedging levels, whether independent methods land on the same direction, and what the overnight tape did to the setup before the open.',
    kinds: ['gex', 'convergence', 'premarket'],
  },
  {
    id: 'tape',
    label: 'The tape',
    tag: 'CONTEXT',
    question: 'Is the market helping or fighting this?',
    blurb:
      'The same setup is worth different money depending on the day around it — the sector bid, the regime, how many names are participating, and the cross-asset backdrop.',
    kinds: ['sector', 'regime', 'breadth', 'macro'],
  },
  {
    id: 'calendar',
    label: 'Company & calendar',
    tag: 'EVENT',
    question: 'What could move it that is not price?',
    blurb:
      'Tracked events, revisions, the quality of the business underneath, and policy exposure. This family is where a setup gets argued against most often.',
    kinds: ['catalyst', 'analyst', 'fundamental', 'geopolitical', 'weekly'],
  },
] as const;

/** Every layer belongs to exactly one family — checked, not assumed. */
const _FAMILY_KINDS = CONVICTION_FAMILIES.flatMap((f) => f.kinds as readonly string[]);
if (_FAMILY_KINDS.length !== CONVICTION_LAYERS.length) {
  throw new Error(
    `conviction-layers: ${CONVICTION_LAYERS.length} layers but ${_FAMILY_KINDS.length} placed in families — add the new layer to a family.`,
  );
}

/** The layer objects for one family, in declaration order. */
export function layersInFamily(familyId: string) {
  const fam = CONVICTION_FAMILIES.find((f) => f.id === familyId);
  if (!fam) return [];
  return CONVICTION_LAYERS.filter((l) => (fam.kinds as readonly string[]).includes(l.kind));
}

export type ConvictionLayerKind = (typeof CONVICTION_LAYERS)[number]['kind'];

/** How many layers the engine can score. Count it, never type it. */
export const CONVICTION_LAYER_COUNT = CONVICTION_LAYERS.length;

/**
 * Not every layer fires on every signal — several are conditional (weekly only
 * applies to watchlist names, pre-market only outside regular hours). Copy should
 * say a setup is scored ACROSS these, not that all of them always contribute.
 */
export const CONVICTION_LAYER_NOTE =
  'Not every layer fires on every signal; several are conditional. A signal shows which ones did.';

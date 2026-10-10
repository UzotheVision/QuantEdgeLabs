/**
 * THESIS RADAR — Pattern Library
 * ================================
 * The 5 starter pattern signatures that catch repeating high-asymmetry setups.
 *
 * Each pattern is a chain of filters that — when they ALL match — fingerprint
 * a setup that historically preceded outsized moves. The subset engine compiles
 * these into actual queries; the conviction agent grades the matches.
 *
 * To add a pattern:
 *   1. Append a PatternSpec to PATTERN_LIBRARY below
 *   2. Make sure each filter.predicate has a handler in subset-engine.ts
 *   3. Add a brief in this header comment so future readers know the thesis
 *
 * The 5 starter patterns:
 *
 *   1. DGXX setup — the small-cap-hyperscaler-validated pattern
 *      (DGXX +29% on Cerebras $1.1B deal, POET +76% in 3 days, etc.)
 *
 *   2. Aschenbrenner 2nd derivative — when first-order ran but 2nd hasn't
 *      (NVDA running → memory/cooling/photonics still cheap)
 *
 *   3. Bottleneck whisper — earnings transcripts mention "constrained"
 *      Cross-references with sub-$5B suppliers named in 2+ hyperscaler calls
 *
 *   4. Institutional accumulation — Vanguard/insiders quietly load
 *      (AUR 17.8M shares purchase by Vanguard the day before earnings)
 *
 *   5. Catalyst whisper — unusual OI + scheduled catalyst in 30 days
 *      (DGXX 2,212 OI on $7C Jan'27 BEFORE most retail noticed)
 */

import type { PatternSpec } from '@shared/thesis-radar-types';

// ─── Pattern 1: DGXX Setup ──────────────────────────────────────────

const DGXX_SETUP: PatternSpec = {
  id: 'dgxx_setup',
  name: 'DGXX Setup — Small-cap Hyperscaler Validation',
  thesis:
    'Sub-$1B-cap AI/data-center adjacent ticker prints unusual call volume on the same day a hyperscaler announces capacity. Catches the 5-10x runners 24-72 hours BEFORE consensus.',
  horizon: 'weeks',
  targetHitRate: 0.45, // 45% hit T1 historically
  alertTTLHours: 72,
  output: 'forming',
  filters: [
    {
      domain: 'cap',
      predicate: 'lt',
      params: { value: 1_000_000_000 },
      explain: 'Market cap under $1B — true small/micro cap zone where 5-10x is mathematically possible',
    },
    {
      domain: 'sector',
      predicate: 'in_layers',
      params: { layers: 'ai_data_center,photonics,power_ic,cooling,quantum,advanced_packaging' },
      explain: 'Operates in an AI buildout layer (data center, photonics, power, cooling, quantum, packaging)',
    },
    {
      domain: 'options_flow',
      predicate: 'call_volume_spike',
      params: { multiplier: 3.0, lookback_days: 30 },
      explain: 'Today\'s call volume ≥ 3x the 30-day average — institutions or whales just loaded',
    },
    {
      domain: 'options_flow',
      predicate: 'oi_concentration',
      params: { strike_offset_pct: 30, min_oi: 1000 },
      explain: 'Significant OI clustered on a single OTM strike (~30% above spot) — directional positioning, not hedging',
    },
    {
      domain: 'news',
      predicate: 'hyperscaler_mention_recent',
      params: { lookback_days: 7, hyperscalers: 'NVDA,MSFT,AMZN,GOOGL,META,ORCL,Cerebras,CoreWeave' },
      explain: 'A named hyperscaler mentioned the company OR adjacent capacity in the last 7 days',
    },
  ],
  gradedSignals: [
    'options_flow',
    'news_nlp',
    'price_action',
    'volume_profile',
    'unusual_activity',
    'sector_rotation',
  ],
};

// ─── Pattern 2: Aschenbrenner Second Derivative ─────────────────────

const ASCHENBRENNER_2ND_DERIVATIVE: PatternSpec = {
  id: 'aschenbrenner_2nd_derivative',
  name: 'Aschenbrenner 2nd Derivative — Layer Below Just Hasn\'t Run Yet',
  thesis:
    'First-order AI layer (NVDA, AMD) up >30% in 90 days while a derivative-order layer (memory, cooling, photonics, packaging) is flat or down. The derivative layer historically catches up within 2 quarters with cheap optionality.',
  horizon: 'months',
  targetHitRate: 0.55,
  alertTTLHours: 168, // 7 days
  output: 'preview',
  filters: [
    {
      domain: 'sector',
      predicate: 'first_order_layer_up',
      params: { layer: 'ai_compute', min_pct: 30, lookback_days: 90 },
      explain: 'First-order layer (AI compute / GPU) up >30% in 90 days — capital is flowing INTO the theme',
    },
    {
      domain: 'sector',
      predicate: 'derivative_layer_flat',
      params: { layer_min_derivative_order: 2, max_pct: 5, lookback_days: 90 },
      explain: 'Target ticker sits in a 2nd+ derivative layer that\'s lagged (<5% in 90 days)',
    },
    {
      domain: 'iv',
      predicate: 'iv_percentile_low',
      params: { max_percentile: 30 },
      explain: 'IV percentile <30 — long-vol setup is structurally cheap',
    },
    {
      domain: 'analysts',
      predicate: 'coverage_increasing',
      params: { min_new_initiations_90d: 2 },
      explain: 'Sell-side coverage growing (≥2 new initiations in 90 days) — institutions starting to discover',
    },
    {
      domain: 'cap',
      predicate: 'between',
      params: { min: 500_000_000, max: 10_000_000_000 },
      explain: 'Cap $500M-$10B — past the micro-cap risk zone, before mega-cap drag kicks in',
    },
  ],
  gradedSignals: [
    'sector_rotation',
    'iv_skew',
    'analyst_ratings',
    'price_action',
    'options_flow',
  ],
};

// ─── Pattern 3: Bottleneck Whisper ──────────────────────────────────

const BOTTLENECK_WHISPER: PatternSpec = {
  id: 'bottleneck_whisper',
  name: 'Bottleneck Whisper — The Supplier Nobody Knows Is Constrained',
  thesis:
    'When 3+ companies mention "constrained," "lead times," "shortage," or name the same obscure supplier in earnings calls within 60 days, that supplier is structurally short of capacity. Investable BEFORE the analyst notes follow.',
  horizon: 'quarters',
  targetHitRate: 0.60,
  alertTTLHours: 720, // 30 days
  output: 'preview',
  filters: [
    {
      domain: 'news',
      predicate: 'transcript_keyword_cluster',
      params: {
        keywords: 'constrained,lead times,shortage,sold out,tight supply,limited availability',
        min_company_mentions: 3,
        lookback_days: 60,
      },
      explain: 'Same constraint language appears in 3+ unrelated earnings calls within 60 days',
    },
    {
      domain: 'news',
      predicate: 'transcript_supplier_named',
      params: { min_hyperscaler_mentions: 2, lookback_days: 60 },
      explain: 'Target ticker is named as a supplier by ≥2 hyperscalers/customers in same window',
    },
    {
      domain: 'cap',
      predicate: 'lt',
      params: { value: 5_000_000_000 },
      explain: 'Supplier cap <$5B — re-rate potential is real (vs already-priced-in mega caps)',
    },
    {
      domain: 'options_flow',
      predicate: 'has_leaps',
      params: { min_dte: 200 },
      explain: 'Has tradeable LEAPS (≥200 DTE) — long thesis is investable, not just a swing',
    },
  ],
  gradedSignals: [
    'news_nlp',
    'earnings_history',
    'analyst_ratings',
    'sector_rotation',
    'price_action',
  ],
};

// ─── Pattern 4: Institutional Accumulation ──────────────────────────

const INSTITUTIONAL_ACCUMULATION: PatternSpec = {
  id: 'institutional_accumulation',
  name: 'Institutional Accumulation — Whales Load Before the Move',
  thesis:
    'Form 4 insider buys + 13F-disclosed whale (Vanguard, Blackrock, Sylebra, Coatue) accumulation on a sub-$5B-cap stock with low IV percentile. Pattern preceded AUR (+57% YTD) and others — institutions are early, not late.',
  horizon: 'weeks',
  targetHitRate: 0.50,
  alertTTLHours: 168,
  output: 'forming',
  filters: [
    {
      domain: 'fundamentals',
      predicate: 'recent_13f_buy',
      params: { min_share_count: 1_000_000, lookback_days: 30 },
      explain: '13F filing in last 30 days shows ≥1M share addition by a tracked whale',
    },
    {
      domain: 'fundamentals',
      predicate: 'recent_form4_buy',
      params: { min_dollar_value: 100_000, lookback_days: 60 },
      explain: 'Recent Form 4 insider purchase (≥$100k) — alignment between management and the trade',
    },
    {
      domain: 'cap',
      predicate: 'lt',
      params: { value: 5_000_000_000 },
      explain: 'Cap <$5B — whale position is meaningful relative to float, not just index rebalance',
    },
    {
      domain: 'iv',
      predicate: 'iv_percentile_low',
      params: { max_percentile: 40 },
      explain: 'IV <40 percentile — optionality is cheap on the way in',
    },
    {
      domain: 'price',
      predicate: 'not_extended',
      params: { max_pct_above_50d_ma: 15 },
      explain: 'Stock not extended (<15% above 50-day) — entry isn\'t chasing',
    },
  ],
  gradedSignals: [
    'institutional_flow',
    'insider_filings',
    'iv_skew',
    'price_action',
    'analyst_ratings',
  ],
};

// ─── Pattern 5: Catalyst Whisper ────────────────────────────────────

const CATALYST_WHISPER: PatternSpec = {
  id: 'catalyst_whisper',
  name: 'Catalyst Whisper — Unusual OI Before a Scheduled Event',
  thesis:
    'Unusual call OI clustering on a strike just OUT-of-the-money, with a scheduled catalyst (earnings, FDA, product launch, contract decision) within 30 days. The smart money positions before the event; we ride the same setup.',
  horizon: 'days',
  targetHitRate: 0.40,
  alertTTLHours: 48,
  output: 'confirmed',
  filters: [
    {
      domain: 'options_flow',
      predicate: 'oi_concentration',
      params: { strike_offset_pct: 20, min_oi_pct_of_total: 0.15 },
      explain: 'Single strike holds ≥15% of total chain OI — directional bet, not hedge',
    },
    {
      domain: 'options_flow',
      predicate: 'recent_sweep',
      params: { lookback_days: 5, min_premium: 100_000 },
      explain: 'Sweep order ≥$100k premium in last 5 trading days',
    },
    {
      domain: 'news',
      predicate: 'scheduled_catalyst_within',
      params: { catalyst_types: 'earnings,fda,product_launch,contract_award,investor_day', max_days: 30 },
      explain: 'Known catalyst (earnings, FDA, product, contract, investor day) within 30 days',
    },
    {
      domain: 'iv',
      predicate: 'iv_term_structure_steep',
      params: { min_front_back_ratio: 1.3 },
      explain: 'Front-month IV ≥1.3x back-month — market expects volatility but hasn\'t fully priced direction',
    },
  ],
  gradedSignals: [
    'options_flow',
    'unusual_activity',
    'iv_skew',
    'news_nlp',
    'gex_positioning',
  ],
};

// ─── Pattern 6: Gamma Squeeze Detector (UNH-style premium juice) ────

const GAMMA_SQUEEZE_DETECTOR: PatternSpec = {
  id: 'gamma_squeeze' as any,
  name: 'Gamma Squeeze — Dealer Short-Gamma Trap',
  thesis:
    'Single OTM strike accumulating ≥15% of total chain OI while spot trades within 25% below the strike → dealers are short gamma. Any positive catalyst forces reflexive hedging → cheap penny calls JUICE 50-100x even without strike being hit. Mirror of the UNH 18-pack premium-juice strategy.',
  horizon: 'days',
  targetHitRate: 0.35,
  alertTTLHours: 96,
  output: 'forming',
  filters: [
    {
      domain: 'options_flow',
      predicate: 'oi_concentration',
      params: { strike_offset_pct: 25, min_oi_pct_of_total: 0.15 },
      explain: 'Single strike holds ≥15% of total chain OI within 25% above spot — dealer short-gamma trap',
    },
    {
      domain: 'options_flow',
      predicate: 'oi_concentration',
      params: { min_oi: 5000 },
      explain: 'Top strike OI ≥5,000 contracts — institutional positioning, not retail noise',
    },
    {
      domain: 'iv',
      predicate: 'iv_percentile_low',
      params: { max_percentile: 50 },
      explain: 'IV percentile ≤50 — call premium is structurally cheap, room for expansion on catalyst',
    },
    {
      domain: 'price',
      predicate: 'not_extended',
      params: { max_pct_above_50d_ma: -10 },
      explain: 'Stock at or below 50-day MA — beaten down = compressed spring + max-pessimism = catalyst loaded',
    },
    {
      domain: 'news',
      predicate: 'scheduled_catalyst_within',
      params: { catalyst_types: 'earnings,fda,product_launch,contract_award,investor_day,lawsuit,m_a', max_days: 60 },
      explain: 'Binary catalyst within 60 days — IV expansion + reflexive hedging triggers',
    },
  ],
  gradedSignals: [
    'options_flow',
    'unusual_activity',
    'iv_skew',
    'gex_positioning',
    'news_nlp',
    'price_action',
  ],
};

// ─── Library export ─────────────────────────────────────────────────

export const PATTERN_LIBRARY: Record<string, PatternSpec> = {
  dgxx_setup: DGXX_SETUP,
  aschenbrenner_2nd_derivative: ASCHENBRENNER_2ND_DERIVATIVE,
  bottleneck_whisper: BOTTLENECK_WHISPER,
  institutional_accumulation: INSTITUTIONAL_ACCUMULATION,
  catalyst_whisper: CATALYST_WHISPER,
  gamma_squeeze: GAMMA_SQUEEZE_DETECTOR,
};

export function getPattern(id: string): PatternSpec | null {
  return PATTERN_LIBRARY[id] ?? null;
}

export function listPatterns(): PatternSpec[] {
  return Object.values(PATTERN_LIBRARY);
}

export function patternsForOutput(output: PatternSpec['output']): PatternSpec[] {
  return listPatterns().filter(p => p.output === output);
}

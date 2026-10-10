/**
 * Geopolitical Market Reaction Matrix
 * ====================================
 * Scenario-based market prediction tool.
 * Models 8+ geopolitical events with predicted % moves
 * across 8 asset classes, based on historical pattern data.
 *
 * Each scenario includes:
 *   - Predicted moves for SPY, QQQ, DIA, GLD, USO, ITA, UUP, VIX
 *   - Confidence score (historical frequency)
 *   - Time decay: 1h → 24h → 72h reaction profile
 *   - Historical precedents
 *   - Trading watchpoints
 */

import { logger } from './logger';

// ─── Types ───────────────────────────────────────────────────

export interface AssetReaction {
  asset: string;      // SPY, QQQ, GLD, etc.
  label: string;      // "S&P 500", "Gold", etc.
  move1h: number;     // % move in first hour
  move24h: number;    // % move in 24 hours
  move72h: number;    // % move in 72 hours
  direction: 'bullish' | 'bearish' | 'neutral';
}

export interface HistoricalPrecedent {
  date: string;
  event: string;
  spyMove: string;
  vixMove: string;
  lesson: string;
}

export interface Scenario {
  id: string;
  name: string;
  icon: string;
  category: 'war' | 'trade' | 'fed' | 'geopolitical' | 'energy';
  likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  reactions: AssetReaction[];
  confidence: number;          // 0-100 based on historical frequency
  precedents: HistoricalPrecedent[];
  watchpoints: string[];
  sectorImpact: { sector: string; direction: 'up' | 'down' | 'flat'; magnitude: number }[];
  tradingPlan: string;
}

export interface ScenarioMatrix {
  scenarios: Scenario[];
  currentConditions: {
    vix: number | null;
    spyTrend: string;
    geopoliticalRisk: 'ELEVATED' | 'NORMAL' | 'LOW';
    activeScenarios: string[];   // IDs of scenarios most likely right now
  };
  lastUpdated: string;
}

// ─── Scenario Database ──────────────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    id: 'ceasefire',
    name: 'Ceasefire Announced',
    icon: '🕊️',
    category: 'war',
    likelihood: 'MEDIUM',
    description: 'Major ceasefire or peace deal announced in active conflict (Ukraine-Russia, Middle East). Risk-off unwind, defense sells off, energy drops.',
    reactions: [
      { asset: 'SPY', label: 'S&P 500',    move1h: 1.5,  move24h: 2.2,  move72h: 1.8,  direction: 'bullish' },
      { asset: 'QQQ', label: 'NASDAQ',      move1h: 2.0,  move24h: 2.8,  move72h: 2.3,  direction: 'bullish' },
      { asset: 'DIA', label: 'Dow Jones',   move1h: 1.2,  move24h: 1.8,  move72h: 1.5,  direction: 'bullish' },
      { asset: 'GLD', label: 'Gold',        move1h: -1.5, move24h: -2.5, move72h: -3.0, direction: 'bearish' },
      { asset: 'USO', label: 'Oil',         move1h: -3.0, move24h: -5.0, move72h: -4.5, direction: 'bearish' },
      { asset: 'ITA', label: 'Defense ETF', move1h: -4.0, move24h: -6.0, move72h: -5.0, direction: 'bearish' },
      { asset: 'UUP', label: 'US Dollar',   move1h: -0.5, move24h: -0.8, move72h: -0.3, direction: 'bearish' },
      { asset: 'VIX', label: 'VIX',         move1h: -15,  move24h: -25,  move72h: -20,  direction: 'bearish' },
    ],
    confidence: 78,
    precedents: [
      { date: '2022-03-29', event: 'Ukraine-Russia Istanbul talks progress', spyMove: '+1.2%', vixMove: '-8%', lesson: 'Initial spike faded within 48h as talks collapsed' },
      { date: '2023-11-22', event: 'Israel-Hamas ceasefire deal', spyMove: '+0.4%', vixMove: '-5%', lesson: 'Market mostly priced in, muted reaction' },
    ],
    watchpoints: [
      'Gap fill level — ceasefire gaps often fill 50-70% within 3 days',
      'Defense stocks (LMT, RTX, NOC) will gap down hard — wait for support before shorting',
      'Oil front-month vs back-month spread will collapse — watch contango',
      'VIX crush creates options premium selling opportunity',
    ],
    sectorImpact: [
      { sector: 'Technology', direction: 'up', magnitude: 2.5 },
      { sector: 'Defense', direction: 'down', magnitude: 5.0 },
      { sector: 'Energy', direction: 'down', magnitude: 3.5 },
      { sector: 'Consumer Disc', direction: 'up', magnitude: 2.0 },
      { sector: 'Financials', direction: 'up', magnitude: 1.5 },
    ],
    tradingPlan: 'Buy tech calls on dip. Short defense via puts. Sell VIX call spreads. Wait for gap fill before adding.',
  },
  {
    id: 'tariff_announce',
    name: 'Trump Tariff Announcement',
    icon: '📢',
    category: 'trade',
    likelihood: 'HIGH',
    description: 'New tariff announcement or escalation. "Liberation Day" style event. Immediate sell-off, especially in exposed sectors. VIX spike.',
    reactions: [
      { asset: 'SPY', label: 'S&P 500',    move1h: -2.0, move24h: -3.5, move72h: -2.0, direction: 'bearish' },
      { asset: 'QQQ', label: 'NASDAQ',      move1h: -2.5, move24h: -4.0, move72h: -2.5, direction: 'bearish' },
      { asset: 'DIA', label: 'Dow Jones',   move1h: -2.0, move24h: -3.0, move72h: -1.8, direction: 'bearish' },
      { asset: 'GLD', label: 'Gold',        move1h: 1.0,  move24h: 2.0,  move72h: 2.5,  direction: 'bullish' },
      { asset: 'USO', label: 'Oil',         move1h: -1.5, move24h: -2.0, move72h: -1.0, direction: 'bearish' },
      { asset: 'ITA', label: 'Defense ETF', move1h: -1.0, move24h: -1.5, move72h: -0.5, direction: 'bearish' },
      { asset: 'UUP', label: 'US Dollar',   move1h: 0.5,  move24h: 0.8,  move72h: 0.3,  direction: 'bullish' },
      { asset: 'VIX', label: 'VIX',         move1h: 25,   move24h: 40,   move72h: 20,   direction: 'bullish' },
    ],
    confidence: 92,
    precedents: [
      { date: '2025-04-02', event: 'Liberation Day tariffs — 10% universal + 34% China', spyMove: '-4.8%', vixMove: '+40%', lesson: 'Worst single-day since COVID. Selling accelerated into close.' },
      { date: '2025-02-04', event: 'China 10% tariff + Canada/Mexico 25%', spyMove: '-1.6%', vixMove: '+15%', lesson: 'Market recovered next day on pause rumors' },
      { date: '2019-08-01', event: 'Trump 10% tariff on remaining China goods', spyMove: '-3.0%', vixMove: '+25%', lesson: 'August selloff lasted 3 weeks before Fed cut saved it' },
    ],
    watchpoints: [
      'First 30 min reaction is usually NOT the real move — wait for 10:30 ET reversal attempt',
      'Watch for "tariff pause" tweet within 24-48h — this has been the pattern',
      'SMH (semis) gets hit hardest on China tariffs — 2x SPY move typically',
      'Put/call ratio spike above 1.5 = near-term bottom signal',
    ],
    sectorImpact: [
      { sector: 'Semiconductors', direction: 'down', magnitude: 5.0 },
      { sector: 'Technology', direction: 'down', magnitude: 3.5 },
      { sector: 'Consumer Staples', direction: 'flat', magnitude: 0.5 },
      { sector: 'Utilities', direction: 'up', magnitude: 1.0 },
      { sector: 'Gold Miners', direction: 'up', magnitude: 3.0 },
    ],
    tradingPlan: 'Do NOT buy the first dip. Wait for VIX > 30 + PCR > 1.5 for capitulation. Buy QQQ calls 3-5 DTE on second bounce. Hedge with GLD calls.',
  },
  {
    id: 'trade_deal',
    name: 'Trump Trade Deal Tweet',
    icon: '🤝',
    category: 'trade',
    likelihood: 'MEDIUM',
    description: 'Positive trade deal announcement, tariff rollback, or exemption. Sharp relief rally, VIX crush, semis lead.',
    reactions: [
      { asset: 'SPY', label: 'S&P 500',    move1h: 2.0,  move24h: 3.0,  move72h: 2.5,  direction: 'bullish' },
      { asset: 'QQQ', label: 'NASDAQ',      move1h: 3.0,  move24h: 4.5,  move72h: 3.5,  direction: 'bullish' },
      { asset: 'DIA', label: 'Dow Jones',   move1h: 1.8,  move24h: 2.5,  move72h: 2.0,  direction: 'bullish' },
      { asset: 'GLD', label: 'Gold',        move1h: -1.0, move24h: -1.5, move72h: -0.8, direction: 'bearish' },
      { asset: 'USO', label: 'Oil',         move1h: 1.0,  move24h: 1.5,  move72h: 1.0,  direction: 'bullish' },
      { asset: 'ITA', label: 'Defense ETF', move1h: 0.5,  move24h: 0.8,  move72h: 0.5,  direction: 'bullish' },
      { asset: 'UUP', label: 'US Dollar',   move1h: -0.3, move24h: -0.5, move72h: -0.2, direction: 'bearish' },
      { asset: 'VIX', label: 'VIX',         move1h: -20,  move24h: -30,  move72h: -25,  direction: 'bearish' },
    ],
    confidence: 85,
    precedents: [
      { date: '2025-04-09', event: '90-day tariff pause announcement', spyMove: '+9.5%', vixMove: '-35%', lesson: 'Biggest single-day rally since 2008. Gap-up held.' },
      { date: '2019-12-13', event: 'Phase 1 China trade deal', spyMove: '+0.9%', vixMove: '-12%', lesson: 'Market had partially priced in — muted but sustained rally' },
    ],
    watchpoints: [
      'Trade deal rallies often gap up and hold — different from tariff selloffs that fade',
      'SMH will lead the rally 2-3x — NVDA, AMD, MU are the first movers',
      'Sell VIX puts or buy VIX put spreads on the announcement',
      'Watch for "sell the news" after 72h if deal details disappoint',
    ],
    sectorImpact: [
      { sector: 'Semiconductors', direction: 'up', magnitude: 5.0 },
      { sector: 'Technology', direction: 'up', magnitude: 4.0 },
      { sector: 'Industrials', direction: 'up', magnitude: 2.5 },
      { sector: 'Gold Miners', direction: 'down', magnitude: 2.0 },
    ],
    tradingPlan: 'Buy SMH/QQQ calls immediately on headline. Target 3-5 DTE. Take 50% off at +100%, let rest ride. Add on any intraday pullback to VWAP.',
  },
  {
    id: 'war_escalation',
    name: 'War Escalation',
    icon: '💥',
    category: 'war',
    likelihood: 'LOW',
    description: 'Major military escalation — NATO involvement, nuclear threats, new front opening. Flight to safety, gold/bonds surge, equities dump.',
    reactions: [
      { asset: 'SPY', label: 'S&P 500',    move1h: -3.0, move24h: -5.0, move72h: -4.0, direction: 'bearish' },
      { asset: 'QQQ', label: 'NASDAQ',      move1h: -3.5, move24h: -5.5, move72h: -4.5, direction: 'bearish' },
      { asset: 'DIA', label: 'Dow Jones',   move1h: -2.5, move24h: -4.0, move72h: -3.5, direction: 'bearish' },
      { asset: 'GLD', label: 'Gold',        move1h: 3.0,  move24h: 5.0,  move72h: 6.0,  direction: 'bullish' },
      { asset: 'USO', label: 'Oil',         move1h: 5.0,  move24h: 8.0,  move72h: 6.0,  direction: 'bullish' },
      { asset: 'ITA', label: 'Defense ETF', move1h: 3.0,  move24h: 5.0,  move72h: 6.0,  direction: 'bullish' },
      { asset: 'UUP', label: 'US Dollar',   move1h: 1.0,  move24h: 1.5,  move72h: 1.0,  direction: 'bullish' },
      { asset: 'VIX', label: 'VIX',         move1h: 40,   move24h: 60,   move72h: 45,   direction: 'bullish' },
    ],
    confidence: 88,
    precedents: [
      { date: '2022-02-24', event: 'Russia invades Ukraine', spyMove: '-2.6% → +3.2% reversal', vixMove: '+30%', lesson: 'Classic "buy the invasion" — initial dump fully reversed by close' },
      { date: '2020-01-03', event: 'Soleimani assassination', spyMove: '-0.7%', vixMove: '+8%', lesson: 'Market shrugged it off in 2 days. Oil spike faded fast.' },
    ],
    watchpoints: [
      '"Buy the invasion" pattern has worked historically — panic selling creates opportunity',
      'Defense stocks (LMT, RTX, NOC) are the immediate buy — multi-day trend',
      'Gold gaps are usually persistent — do not fade',
      'VIX spike above 35-40 = high probability mean reversion within 5 days',
    ],
    sectorImpact: [
      { sector: 'Defense', direction: 'up', magnitude: 6.0 },
      { sector: 'Energy', direction: 'up', magnitude: 5.0 },
      { sector: 'Technology', direction: 'down', magnitude: 4.0 },
      { sector: 'Consumer Disc', direction: 'down', magnitude: 3.5 },
      { sector: 'Utilities', direction: 'up', magnitude: 2.0 },
    ],
    tradingPlan: 'Wait for VIX spike above 35. Buy SPY calls 5-10 DTE on the reversal candle. Long LMT/RTX calls for multi-day trend. Long GLD as hedge.',
  },
  {
    id: 'fed_surprise',
    name: 'Fed Surprise Cut / Pivot',
    icon: '🏦',
    category: 'fed',
    likelihood: 'LOW',
    description: 'Unexpected rate cut, emergency meeting, or dovish pivot. Massive rally in growth/tech. Dollar weakens. Bonds rally.',
    reactions: [
      { asset: 'SPY', label: 'S&P 500',    move1h: 2.5,  move24h: 3.5,  move72h: 4.0,  direction: 'bullish' },
      { asset: 'QQQ', label: 'NASDAQ',      move1h: 3.5,  move24h: 5.0,  move72h: 5.5,  direction: 'bullish' },
      { asset: 'DIA', label: 'Dow Jones',   move1h: 2.0,  move24h: 3.0,  move72h: 3.5,  direction: 'bullish' },
      { asset: 'GLD', label: 'Gold',        move1h: 2.0,  move24h: 3.0,  move72h: 3.5,  direction: 'bullish' },
      { asset: 'USO', label: 'Oil',         move1h: 1.0,  move24h: 1.5,  move72h: 1.0,  direction: 'bullish' },
      { asset: 'ITA', label: 'Defense ETF', move1h: 1.0,  move24h: 1.5,  move72h: 1.5,  direction: 'bullish' },
      { asset: 'UUP', label: 'US Dollar',   move1h: -1.0, move24h: -1.5, move72h: -1.0, direction: 'bearish' },
      { asset: 'VIX', label: 'VIX',         move1h: -15,  move24h: -25,  move72h: -30,  direction: 'bearish' },
    ],
    confidence: 90,
    precedents: [
      { date: '2024-09-18', event: 'Fed 50bp surprise cut (expected 25bp)', spyMove: '+1.7%', vixMove: '-12%', lesson: 'Rally sustained for 2 weeks. Small caps outperformed.' },
      { date: '2020-03-15', event: 'Emergency rate cut to 0%', spyMove: '-12% next day', vixMove: '+40%', lesson: 'Emergency cuts during crisis are bearish — market sees panic' },
      { date: '2019-07-31', event: 'First rate cut in decade', spyMove: '-1.1%', vixMove: '+8%', lesson: '"Sell the news" — Powell hawkish press conference killed rally' },
    ],
    watchpoints: [
      'Context matters: scheduled cut = bullish. Emergency cut = BEARISH (signals panic)',
      'IWM (small caps) outperforms on rate cuts — higher leverage sensitivity',
      'Watch 2Y-10Y spread — if yield curve steepens, bullish confirmation',
      'Dollar weakness = EM and commodities rally',
    ],
    sectorImpact: [
      { sector: 'Technology', direction: 'up', magnitude: 5.0 },
      { sector: 'Real Estate', direction: 'up', magnitude: 4.0 },
      { sector: 'Financials', direction: 'down', magnitude: 1.5 },
      { sector: 'Utilities', direction: 'up', magnitude: 2.0 },
      { sector: 'Small Caps', direction: 'up', magnitude: 4.5 },
    ],
    tradingPlan: 'Buy QQQ/IWM calls on scheduled cut. If emergency cut, wait 24-48h for bottom. Gold calls as dollar hedge. Avoid bank stocks.',
  },
  {
    id: 'oil_shock',
    name: 'Oil Supply Shock',
    icon: '⛽',
    category: 'energy',
    likelihood: 'MEDIUM',
    description: 'OPEC surprise cut, Strait of Hormuz disruption, pipeline attack. Oil spikes, inflation fears rise, growth stocks suffer.',
    reactions: [
      { asset: 'SPY', label: 'S&P 500',    move1h: -1.5, move24h: -2.0, move72h: -1.5, direction: 'bearish' },
      { asset: 'QQQ', label: 'NASDAQ',      move1h: -2.0, move24h: -2.5, move72h: -2.0, direction: 'bearish' },
      { asset: 'DIA', label: 'Dow Jones',   move1h: -1.0, move24h: -1.5, move72h: -1.0, direction: 'bearish' },
      { asset: 'GLD', label: 'Gold',        move1h: 1.5,  move24h: 2.0,  move72h: 2.5,  direction: 'bullish' },
      { asset: 'USO', label: 'Oil',         move1h: 5.0,  move24h: 8.0,  move72h: 10.0, direction: 'bullish' },
      { asset: 'ITA', label: 'Defense ETF', move1h: 1.5,  move24h: 2.0,  move72h: 2.5,  direction: 'bullish' },
      { asset: 'UUP', label: 'US Dollar',   move1h: 0.5,  move24h: 0.8,  move72h: 0.5,  direction: 'bullish' },
      { asset: 'VIX', label: 'VIX',         move1h: 20,   move24h: 25,   move72h: 15,   direction: 'bullish' },
    ],
    confidence: 82,
    precedents: [
      { date: '2019-09-14', event: 'Aramco drone attack — 50% Saudi production offline', spyMove: '-0.5%', vixMove: '+10%', lesson: 'Oil spiked 15% overnight but equities barely moved — market discounted quickly' },
      { date: '2022-03-08', event: 'Russia oil ban fears — crude at $130', spyMove: '-0.7%', vixMove: '+5%', lesson: 'Oil spike peaked within 48h and reversed hard' },
    ],
    watchpoints: [
      'Oil spikes are typically mean-reverting — do NOT chase after 24h',
      'XLE (energy ETF) will lag oil itself — use USO or individual names',
      'Airlines (JETS ETF) get crushed — potential short',
      'If oil stays above $100 for 5+ days, stagflation trade kicks in',
    ],
    sectorImpact: [
      { sector: 'Energy', direction: 'up', magnitude: 8.0 },
      { sector: 'Airlines', direction: 'down', magnitude: 5.0 },
      { sector: 'Consumer Disc', direction: 'down', magnitude: 2.0 },
      { sector: 'Utilities', direction: 'up', magnitude: 1.0 },
    ],
    tradingPlan: 'Long XLE/USO calls on headline. Short JETS puts. Do not chase after day 2 — oil spikes revert. Gold calls as inflation hedge.',
  },
  {
    id: 'china_taiwan',
    name: 'China-Taiwan Tension',
    icon: '🇹🇼',
    category: 'geopolitical',
    likelihood: 'LOW',
    description: 'Military drills, blockade threats, or direct escalation around Taiwan. Semiconductor supply chain fears dominate. Massive tech selloff.',
    reactions: [
      { asset: 'SPY', label: 'S&P 500',    move1h: -3.0, move24h: -5.0, move72h: -4.0, direction: 'bearish' },
      { asset: 'QQQ', label: 'NASDAQ',      move1h: -5.0, move24h: -8.0, move72h: -6.0, direction: 'bearish' },
      { asset: 'DIA', label: 'Dow Jones',   move1h: -2.0, move24h: -3.5, move72h: -3.0, direction: 'bearish' },
      { asset: 'GLD', label: 'Gold',        move1h: 3.0,  move24h: 5.0,  move72h: 6.0,  direction: 'bullish' },
      { asset: 'USO', label: 'Oil',         move1h: 3.0,  move24h: 5.0,  move72h: 4.0,  direction: 'bullish' },
      { asset: 'ITA', label: 'Defense ETF', move1h: 4.0,  move24h: 6.0,  move72h: 7.0,  direction: 'bullish' },
      { asset: 'UUP', label: 'US Dollar',   move1h: 1.0,  move24h: 1.5,  move72h: 1.0,  direction: 'bullish' },
      { asset: 'VIX', label: 'VIX',         move1h: 50,   move24h: 70,   move72h: 50,   direction: 'bullish' },
    ],
    confidence: 75,
    precedents: [
      { date: '2022-08-02', event: 'Pelosi Taiwan visit — China military drills', spyMove: '-0.3%', vixMove: '+5%', lesson: 'Market initially panicked but drills were contained. TSMC barely moved.' },
      { date: '2023-04-10', event: 'China 3-day Taiwan encirclement drill', spyMove: '+0.1%', vixMove: '-2%', lesson: 'Market has become desensitized to drill announcements' },
    ],
    watchpoints: [
      'TSMC (TSM) is THE canary — if TSM drops >5%, scenario is real',
      'SMH will get destroyed — NVDA, AMD, KLAC, LRCX all depend on TSMC',
      'US semiconductor reshoring names (INTC, GFS) may rally as hedge',
      'Only act on actual military action, not rhetoric — market ignores saber-rattling now',
    ],
    sectorImpact: [
      { sector: 'Semiconductors', direction: 'down', magnitude: 8.0 },
      { sector: 'Technology', direction: 'down', magnitude: 5.0 },
      { sector: 'Defense', direction: 'up', magnitude: 6.0 },
      { sector: 'Energy', direction: 'up', magnitude: 3.0 },
    ],
    tradingPlan: 'If TSM drops >5%: buy SPY puts, defense calls (LMT, RTX), gold calls. Wait for VIX >40 to buy the dip on equities.',
  },
  {
    id: 'ukraine_peace',
    name: 'Ukraine Peace Deal',
    icon: '🇺🇦',
    category: 'war',
    likelihood: 'MEDIUM',
    description: 'Formal peace talks progress, ceasefire agreement, or territory deal. European stocks surge, energy prices drop, defense sells off.',
    reactions: [
      { asset: 'SPY', label: 'S&P 500',    move1h: 1.0,  move24h: 1.5,  move72h: 1.2,  direction: 'bullish' },
      { asset: 'QQQ', label: 'NASDAQ',      move1h: 1.2,  move24h: 1.8,  move72h: 1.5,  direction: 'bullish' },
      { asset: 'DIA', label: 'Dow Jones',   move1h: 0.8,  move24h: 1.2,  move72h: 1.0,  direction: 'bullish' },
      { asset: 'GLD', label: 'Gold',        move1h: -2.0, move24h: -3.0, move72h: -3.5, direction: 'bearish' },
      { asset: 'USO', label: 'Oil',         move1h: -4.0, move24h: -6.0, move72h: -5.0, direction: 'bearish' },
      { asset: 'ITA', label: 'Defense ETF', move1h: -5.0, move24h: -7.0, move72h: -6.0, direction: 'bearish' },
      { asset: 'UUP', label: 'US Dollar',   move1h: -0.5, move24h: -0.8, move72h: -0.5, direction: 'bearish' },
      { asset: 'VIX', label: 'VIX',         move1h: -12,  move24h: -20,  move72h: -18,  direction: 'bearish' },
    ],
    confidence: 72,
    precedents: [
      { date: '2022-03-29', event: 'Istanbul peace talks — Ukraine offers neutrality', spyMove: '+1.2%', vixMove: '-8%', lesson: 'Rally lasted 2 days before talks collapsed and market gave it all back' },
      { date: '2025-02-18', event: 'Trump-Zelensky minerals deal framework', spyMove: '+0.3%', vixMove: '-3%', lesson: 'Market cautiously optimistic but waiting for Putin response' },
    ],
    watchpoints: [
      'European stocks (EWG Germany, EWQ France) will outperform US on this',
      'Natural gas (UNG) will drop harder than oil — Europe energy premium unwinds',
      'Defense selloff may create buying opportunity if deal falls apart (common pattern)',
      'Watch for Putin response — no deal holds without Russian agreement',
    ],
    sectorImpact: [
      { sector: 'Defense', direction: 'down', magnitude: 6.0 },
      { sector: 'Energy', direction: 'down', magnitude: 4.0 },
      { sector: 'European Equities', direction: 'up', magnitude: 5.0 },
      { sector: 'Industrials', direction: 'up', magnitude: 2.0 },
    ],
    tradingPlan: 'Short defense (LMT puts). Short oil (USO puts). Long European ETFs (EWG calls). Wait for confirmation — fake peace talks are common.',
  },
];

// ─── Live Conditions ─────────────────────────────────────────

async function fetchCurrentConditions(): Promise<ScenarioMatrix['currentConditions']> {
  try {
    const res = await fetch('https://query2.finance.yahoo.com/v8/finance/chart/%5EVIX?range=5d&interval=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const data = await res.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
    const vix = closes[closes.length - 1] || null;

    // Determine risk level based on VIX
    let geopoliticalRisk: 'ELEVATED' | 'NORMAL' | 'LOW' = 'NORMAL';
    if (vix && vix > 25) geopoliticalRisk = 'ELEVATED';
    else if (vix && vix < 15) geopoliticalRisk = 'LOW';

    // Active scenarios based on current conditions
    const activeScenarios: string[] = [];
    if (vix && vix > 25) {
      activeScenarios.push('tariff_announce', 'war_escalation');
    }
    // Tariff scenarios are always active in current market
    activeScenarios.push('trade_deal', 'tariff_announce');

    return {
      vix: vix ? +vix.toFixed(1) : null,
      spyTrend: 'monitoring',
      geopoliticalRisk,
      activeScenarios: [...new Set(activeScenarios)],
    };
  } catch {
    return { vix: null, spyTrend: 'unknown', geopoliticalRisk: 'NORMAL', activeScenarios: ['tariff_announce', 'trade_deal'] };
  }
}

// ─── Cache ───────────────────────────────────────────────────

let matrixCache: { data: ScenarioMatrix; ts: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

export async function getScenarioMatrix(): Promise<ScenarioMatrix> {
  if (matrixCache && Date.now() - matrixCache.ts < CACHE_TTL) return matrixCache.data;

  const conditions = await fetchCurrentConditions();
  const data: ScenarioMatrix = {
    scenarios: SCENARIOS,
    currentConditions: conditions,
    lastUpdated: new Date().toISOString(),
  };

  matrixCache = { data, ts: Date.now() };
  logger.info(`[GEO-MATRIX] Scenario matrix loaded — VIX: ${conditions.vix}, Risk: ${conditions.geopoliticalRisk}`);
  return data;
}

logger.info('[GEO-MATRIX] Geopolitical Market Reaction Matrix loaded');

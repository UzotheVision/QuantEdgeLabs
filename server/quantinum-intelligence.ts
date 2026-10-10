/**
 * QUANTINUM INTELLIGENCE — the platform's umbrella brain, on demand for ANY
 * symbol. The cockpit scores the candidates the funnel happened to produce;
 * this runs every engine the platform owns against one name the operator
 * searched, and shows its work: each engine contributes a LAYER with signed
 * points (+bullish / −bearish), a plain-language why, and its source. The sum
 * is a lean, not a trade — no entry/stop/target is fabricated here, and any
 * engine with nothing to say is listed by name under `unavailable` instead of
 * being silently skipped.
 *
 * The confidence figure is a DISPLAY INDEX over evidence weight (|net| scaled
 * to 0-100), not a probability — the same convention the cockpit uses. The
 * short gate verdict rides along so a bearish lean is always shown next to
 * whether the discipline rule would even allow acting on it.
 */
import { logger } from './logger';

export interface QuantinumLayer {
  kind: string;
  label: string;
  /** Signed: positive = bullish evidence, negative = bearish. 0 = measured context. */
  points: number;
  why: string;
  source: string;
}

export interface QuantinumDossier {
  symbol: string;
  asOf: string;
  price: { last: number | null; changePercent: number | null };
  layers: QuantinumLayer[];
  unavailable: string[];
  bullPoints: number;
  bearPoints: number;
  lean: 'bullish' | 'bearish' | 'mixed' | 'quiet';
  confidence: number;
  shortGate: { open: boolean; why: string };
  suggestions: { symbol: string; why: string }[];
  _meta: { note: string };
}

const sma = (xs: number[], n: number) =>
  xs.length >= n ? xs.slice(-n).reduce((a, b) => a + b, 0) / n : null;

export async function getQuantinumDossier(symbol: string): Promise<QuantinumDossier> {
  const sym = symbol.toUpperCase();
  const layers: QuantinumLayer[] = [];
  const unavailable: string[] = [];
  let last: number | null = null;
  let changePercent: number | null = null;
  let above200 = false;
  let hasEventCatalyst = false;

  // ── quote + session tape ──────────────────────────────────────────────────
  try {
    const { getRealtimeQuote } = await import('./realtime-pricing-service');
    const q: any = await getRealtimeQuote(sym, 'stock');
    if (q && Number.isFinite(q.price) && q.price > 0) {
      last = q.price;
      changePercent = Number.isFinite(q.changePercent) ? q.changePercent : null;
    }
  } catch { /* quote layer reports below */ }
  if (changePercent != null && Math.abs(changePercent) >= 1.5) {
    const strong = Math.abs(changePercent) >= 3;
    const pts = (strong ? 8 : 4) * (changePercent > 0 ? 1 : -1);
    layers.push({
      kind: 'session', label: 'Session tape', points: pts,
      why: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}% session move — ${strong ? 'a statement, treated as a leading direction signal (operator rule)' : 'directional but modest'}`,
      source: 'realtime quote',
    });
  } else if (changePercent != null) {
    layers.push({ kind: 'session', label: 'Session tape', points: 0, why: `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}% — session noise, no directional claim`, source: 'realtime quote' });
  } else {
    unavailable.push('session tape (no live quote)');
  }

  // ── structure vs the 50/200-day ───────────────────────────────────────────
  try {
    const { fetchCandles } = await import('./historical-candles');
    const candles = await fetchCandles(sym, '1y', '1d');
    const closes = (candles ?? []).map((c: any) => c.close).filter((v: any) => Number.isFinite(v));
    const s200 = sma(closes, 200);
    const s50 = sma(closes, 50);
    const px = last ?? closes[closes.length - 1];
    if (px && s200) {
      above200 = px > s200;
      const dist = ((px - s200) / s200) * 100;
      const above50 = s50 != null ? px > s50 : null;
      let pts = 0;
      if (above200 && above50) pts = 6;
      else if (above200) pts = 2;
      else if (!above200 && above50 === false) pts = -6;
      else pts = -2;
      layers.push({
        kind: 'structure', label: 'Trend structure', points: pts,
        why: `${dist >= 0 ? '+' : ''}${dist.toFixed(0)}% vs 200-day${above50 != null ? `, ${above50 ? 'above' : 'below'} the 50-day` : ''} — ${pts > 0 ? 'uptrend intact' : 'structure broken'}${Math.abs(dist) > 30 ? ' (extended — chase risk cuts both ways)' : ''}`,
        source: 'daily bars (1y)',
      });
    } else {
      unavailable.push('trend structure (insufficient history)');
    }
  } catch {
    unavailable.push('trend structure (bars fetch failed)');
  }

  // ── pattern engine ────────────────────────────────────────────────────────
  try {
    const { getPatternHits } = await import('./pattern-engine');
    const hits = getPatternHits().hits.filter((h) => h.symbol === sym);
    if (hits.length) {
      for (const h of hits.slice(0, 3)) {
        const pts = h.bias === 'short' ? -5 : h.bias === 'neutral' ? 2 : 5;
        layers.push({
          kind: 'pattern', label: `Pattern: ${h.pattern.replace(/_/g, ' ')}`, points: pts,
          why: h.note || (h.bias === 'neutral' ? 'compression — resolves, direction unproven' : `${h.bias === 'short' ? 'bearish' : 'bullish'} continuation structure`),
          source: 'pattern engine (full-universe daily sweep)',
        });
      }
    } else {
      layers.push({ kind: 'pattern', label: 'Pattern engine', points: 0, why: 'no active pattern on this name in the latest sweep', source: 'pattern engine' });
    }
  } catch {
    unavailable.push('pattern engine (not warmed)');
  }

  // ── options tape (session aggregate, generator rules) ─────────────────────
  try {
    const { getTodayFlows } = await import('./options-flow-scanner');
    const rows = (getTodayFlows() as any[]).filter((f) => f.symbol === sym);
    if (rows.length) {
      let call = 0, put = 0, tapeNet = 0;
      for (const f of rows) {
        if (f.optionType === 'call') call += f.premium; else put += f.premium;
        if (f.biasBasis === 'tape') tapeNet += f.sentiment === 'bullish' ? 1 : f.sentiment === 'bearish' ? -1 : 0;
      }
      // premiums are stored per-contract-price × volume; ×100 restores dollars
      const callD = call * 100, putD = put * 100;
      const dom = callD >= putD ? 'long' : 'short';
      const domD = Math.max(callD, putD), othD = Math.min(callD, putD);
      const skew = othD > 0 ? domD / othD : Infinity;
      const contradicted = (dom === 'long' && tapeNet < 0) || (dom === 'short' && tapeNet > 0);
      if (domD >= 500_000 && skew >= 2 && !contradicted) {
        const pts = (domD >= 1_500_000 || skew >= 4 ? 7 : 5) * (dom === 'long' ? 1 : -1);
        layers.push({
          kind: 'flow', label: 'Options tape', points: pts,
          why: `$${(domD / 1e6).toFixed(1)}M ${dom === 'long' ? 'call' : 'put'}-side premium at ${skew === Infinity ? 'one-sided' : `${skew.toFixed(1)}:1`} skew (buyer/seller ambiguity disclosed — skew is evidence, not proof)`,
          source: 'flow scanner (15-min delayed chains)',
        });
      } else {
        layers.push({
          kind: 'flow', label: 'Options tape', points: 0,
          why: `$${(callD / 1e6).toFixed(1)}M calls vs $${(putD / 1e6).toFixed(1)}M puts — ${contradicted ? 'tape reads contradict the skew' : 'not decisively one-sided'}`,
          source: 'flow scanner',
        });
      }
    } else {
      unavailable.push('options tape (no prints captured this session)');
    }
  } catch {
    unavailable.push('options tape (scanner cold)');
  }

  // ── short interest / squeeze fuel ─────────────────────────────────────────
  try {
    const { getShortInterest } = await import('./short-interest');
    const si = await getShortInterest(sym);
    if (si.shortPercentOfFloat != null) {
      const pct = si.shortPercentOfFloat * 100;
      const hot = si.squeezeContext === 'high fuel' || si.squeezeContext === 'elevated';
      const pts = hot && above200 ? (si.squeezeContext === 'high fuel' ? 4 : 2) : 0;
      layers.push({
        kind: 'short-interest', label: 'Short interest', points: pts,
        why: `${pct.toFixed(1)}% of float short, ${si.shortRatio ?? '—'}d to cover — ${si.squeezeContext}${hot ? (above200 ? ': squeeze fuel in an uptrend' : ': crowded short — violent both ways, no direction claimed') : ''} (exchange-reported, twice-monthly cycle)`,
        source: 'short-interest feed',
      });
    } else {
      unavailable.push('short interest (feed returned no read)');
    }
  } catch {
    unavailable.push('short interest (feed failed)');
  }

  // ── event horizon ─────────────────────────────────────────────────────────
  try {
    const { getEarningsBySymbol } = await import('./earnings-calendar');
    const ev = (await getEarningsBySymbol(14)).get(sym);
    if (ev) {
      layers.push({
        kind: 'event', label: 'Event horizon', points: 0,
        why: `earnings ${ev.date}${ev.session ? ` (${ev.session})` : ''} — binary event inside 14d; direction reads expire at the print`,
        source: 'earnings calendar (Nasdaq)',
      });
    }
  } catch { /* calendar optional */ }

  // ── catalyst feed (also feeds the short gate) ─────────────────────────────
  try {
    const { storage } = await import('./storage');
    const cats: any[] = await (storage as any).getActiveCatalysts();
    const mine = (cats ?? []).filter((c) => String(c.symbol ?? c.ticker ?? '').toUpperCase() === sym);
    const high = mine.filter((c) => String(c.impact ?? '').toLowerCase() === 'high');
    hasEventCatalyst = high.length > 0;
    if (mine.length) {
      layers.push({
        kind: 'catalyst', label: 'Catalyst feed', points: 0,
        why: `${mine.length} active catalyst row(s), ${high.length} impact:high — ${high.length ? 'event on file (short gate can open)' : 'nothing gate-qualifying'}`,
        source: 'news sentry',
      });
    }
  } catch { /* catalyst read optional */ }

  // ── sector rotation — only where the bucket maps cleanly onto a tracked ETF
  try {
    const { getSectorTickers } = await import('./ticker-universe');
    const { getSectorRotation } = await import('./sector-rotation');
    // bucket slug → sector-rotation ETF symbol (unmapped buckets get no layer,
    // which is honest — a fuzzy name match would misattribute rotation)
    const SLUG_TO_ETF: Record<string, string> = {
      semiconductors: 'SMH', tech: 'XLK', ai: 'IGV', financials: 'XLF', banks: 'XLF',
      healthcare: 'XLV', energy: 'XLE', industrials: 'XLI', consumer: 'XLY',
      ecommerce: 'XLY', utilities: 'XLU', communication: 'XLC', telecom: 'XLC', media: 'XLC',
    };
    let bucket: string | null = null;
    let bucketSize = Infinity;
    for (const slug of Object.keys(SLUG_TO_ETF)) {
      const names = getSectorTickers(slug).map((t) => t.toUpperCase());
      if (names.includes(sym) && names.length < bucketSize) { bucket = slug; bucketSize = names.length; }
    }
    if (bucket) {
      const rot: any = await getSectorRotation();
      const all: any[] = [...(rot?.leaders ?? []), ...(rot?.laggards ?? []), ...(rot?.sectors ?? [])];
      const hit = all.find((s) => s?.etf === SLUG_TO_ETF[bucket!]);
      if (hit && Number.isFinite(hit.relChange)) {
        const pts = hit.relChange >= 0.5 ? 3 : hit.relChange <= -0.5 ? -3 : 0;
        layers.push({
          kind: 'sector', label: `Sector (${hit.name})`, points: pts,
          why: `${hit.relChange >= 0 ? '+' : ''}${Number(hit.relChange).toFixed(1)}% vs SPY — ${pts > 0 ? 'money rotating in' : pts < 0 ? 'money rotating out' : 'no rotation edge'}`,
          source: 'sector-rotation engine',
        });
      }
    }
  } catch { /* rotation optional */ }

  // ── cockpit signal — NOT a duplicate brain, an absorbed one ───────────────
  // The conviction board is the funnel's PUBLISHED book: stored candidates,
  // 14-layer scoring, tracked outcomes. Quantinum is the on-demand superset
  // for any symbol; when the board already has a live pick on this name, that
  // verdict joins the dossier as one more evidence layer, so the two systems
  // reference each other instead of dueling.
  try {
    const { getCachedConvictions } = await import('./convictions-engine');
    const board = await getCachedConvictions();
    const pick: any = (board?.picks ?? []).find((p: any) => p.symbol === sym);
    if (pick) {
      const dirLong = pick.direction !== 'short';
      const pts = (pick.convictionScore >= 40 ? 6 : pick.convictionScore >= 25 ? 4 : 2) * (dirLong ? 1 : -1);
      layers.push({
        kind: 'cockpit', label: 'Cockpit signal', points: pts,
        why: `board publishes ${dirLong ? 'LONG' : 'SHORT'} at conviction ${pick.convictionScore}${pick.grade ? ` (${pick.grade})` : ''} — the funnel's own live pick on this name`,
        source: 'conviction board',
      });
    }
  } catch { /* board cold — dossier stands on the other engines */ }

  // ── market tape ───────────────────────────────────────────────────────────
  try {
    const { getTapeConditions } = await import('./tape-conditions');
    const tape = await getTapeConditions();
    const pts = tape.verdict === 'trade' ? 2 : tape.verdict === 'sit_out' ? -3 : 0;
    layers.push({
      kind: 'tape', label: 'Market tape', points: pts,
      why: `${tape.verdict.replace('_', ' ')} — ${tape.headline} (market-wide context, not symbol-specific)`,
      source: 'tape conditions',
    });
  } catch {
    unavailable.push('market tape (read failed)');
  }

  unavailable.push('dealer positioning (GEX) — open the GEX hub for this name; not yet wired into Quantinum');

  // ── verdict ───────────────────────────────────────────────────────────────
  const bullPoints = layers.filter((l) => l.points > 0).reduce((a, l) => a + l.points, 0);
  const bearPoints = -layers.filter((l) => l.points < 0).reduce((a, l) => a + l.points, 0);
  const net = bullPoints - bearPoints;
  const lean: QuantinumDossier['lean'] =
    bullPoints >= 5 && bearPoints >= 5 ? 'mixed'
      : net >= 6 ? 'bullish'
      : net <= -6 ? 'bearish'
      : 'quiet';
  const confidence = Math.min(95, Math.round(Math.abs(net) * 4));

  const { evaluateShortDiscipline } = await import('./short-discipline');
  const gateVerdict = evaluateShortDiscipline({ symbol: sym, direction: 'short', hasEventCatalyst });

  // ── suggestions: nearest bucket peers, flagged when an engine sees them ───
  const suggestions: { symbol: string; why: string }[] = [];
  try {
    const { getSectorTickers } = await import('./ticker-universe');
    const { getPatternHits } = await import('./pattern-engine');
    const patternSyms = new Set(getPatternHits().hits.map((h) => h.symbol));
    const SLUGS = ['optics', 'semiconductors', 'ai', 'defense', 'banks', 'crypto', 'ev', 'space', 'nuclear', 'quantum', 'gaming', 'ecommerce', 'telecom', 'media', 'tech', 'financials', 'healthcare', 'industrials', 'consumer', 'energy', 'utilities', 'communication'];
    let bucketNames: string[] = [];
    let bucketSize = Infinity;
    for (const slug of SLUGS) {
      const names = getSectorTickers(slug).map((t) => t.toUpperCase());
      if (names.includes(sym) && names.length < bucketSize) { bucketNames = names; bucketSize = names.length; }
    }
    for (const peer of bucketNames.filter((n) => n !== sym).slice(0, 8)) {
      if (suggestions.length >= 6) break;
      suggestions.push({ symbol: peer, why: patternSyms.has(peer) ? 'same bucket + active pattern' : 'same bucket' });
    }
  } catch { /* suggestions optional */ }

  return {
    symbol: sym,
    asOf: new Date().toISOString(),
    price: { last, changePercent },
    layers,
    unavailable,
    bullPoints,
    bearPoints,
    lean,
    confidence,
    shortGate: {
      open: gateVerdict.allowed,
      why: gateVerdict.allowed ? 'event catalyst on file — shorts may argue their case' : (gateVerdict.reason ?? 'blocked'),
    },
    suggestions,
    _meta: {
      note: 'Evidence layers, not a recommendation. Confidence is a display index over evidence weight, not a probability. Engines with nothing to say are listed under unavailable — never silently skipped.',
    },
  };
}

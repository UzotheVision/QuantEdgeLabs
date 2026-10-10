/**
 * DAILY SLATE — the BMT-style card set, built from our own measured ideas.
 *
 * Not a new engine: a presentation of the top measured ideas already on the
 * board (aggressor tape, bottom reversals, crypto transmissions), shaped the
 * way a trader reads an evening watchlist — pattern name, dated bottom,
 * entry zone, stop, two targets, contract when the engine has one, and the
 * flow footnote. Derived from the close; the board re-grades continuously.
 */
import { logger } from './logger';

export interface SlateCard {
  symbol: string;
  band: string | null;
  score: number | null;
  patternLabel: string;
  provenance: string;      // "bottomed $X on DATE" / "+$XM net bought" etc.
  lastClose: number | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  stop: number | null;
  t1: number | null;
  t2: number | null;
  t2Basis: string;
  contract: string | null; // "CALL $370 · Sep 30 · 7 DTE" or null
  flowNote: string;
  source: string;
}

const PATTERNS: Array<{ prefix: string; label: string }> = [
  { prefix: 'Aggressor tape:', label: 'AGGRESSOR TAPE' },
  { prefix: 'Higher-Lows Base', label: 'HIGHER-LOWS BASE' },
  { prefix: 'V-Recovery', label: 'V-RECOVERY' },
  { prefix: 'Crypto transmission:', label: 'CRYPTO TRANSMISSION' },
];

function parseT2(analysis: string | null | undefined): { t2: number | null; basis: string } {
  const m = /T2 \$([0-9][0-9,.]*) is the ([^.]+)\./.exec(String(analysis ?? ''));
  if (m) return { t2: Number(m[1].replace(/,/g, '')), basis: m[2].trim() };
  return { t2: null, basis: '' };
}

function parseFlow(catalyst: string): string {
  const m = /· flow: (.+)$/.exec(catalyst);
  if (m) return m[1].trim();
  const t = /Aggressor tape: (.+?) — /.exec(catalyst);
  if (t) return t[1].trim();
  return '—';
}

export async function buildSlate(): Promise<{ generatedAt: string; basis: string; cards: SlateCard[] }> {
  const { getCachedConvictions } = await import('./convictions-engine');
  const data = await getCachedConvictions({ limit: 40, minScore: 10, watchlistOnly: false });
  const cards: SlateCard[] = [];

  for (const p of (data.picks as any[] ?? [])) {
    const catalyst = String(p.catalyst ?? '');
    const pat = PATTERNS.find((x) => catalyst.startsWith(x.prefix));
    if (!pat) continue;
    if (p.direction === 'short') continue;

    const entry = Number(p.entryPrice) || null;
    const stop = Number(p.stopLoss) || null;
    const t1 = Number(p.targetPrice) || null;
    const { t2, basis } = parseT2(p.analysis);
    // Fall back to a declared 3R when the idea recorded no structural T2.
    const t2Final = t2 ?? (entry != null && stop != null ? Number((entry + 3 * (entry - stop)).toFixed(2)) : null);
    const t2Basis = t2 != null ? basis : '3R declared';

    const contract =
      p.strikePrice && p.optionType && p.expiryDate
        ? `${String(p.optionType).toUpperCase()} $${p.strikePrice} · ${String(p.expiryDate).slice(5, 10).replace('-', '/')}${p.optionDte != null ? ` · ${p.optionDte} DTE` : ''}`
        : null;

    // Provenance = first clause of the catalyst, stripped of the flow suffix.
    const provenance = catalyst.split('· flow:')[0].replace(pat.prefix, '').replace(/^[:\s]+/, '').trim();

    cards.push({
      symbol: p.symbol,
      band: p.convictionBand ?? null,
      score: p.convictionScore ?? null,
      patternLabel: pat.label,
      provenance,
      lastClose: entry,
      entryZoneLow: entry,
      entryZoneHigh: entry != null ? Number((entry * 1.012).toFixed(2)) : null,
      stop, t1,
      t2: t2Final, t2Basis,
      contract,
      flowNote: parseFlow(catalyst),
      source: String(p.source ?? ''),
    });
  }

  cards.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top = cards.slice(0, 5);
  logger.info(`[SLATE] built ${top.length} card(s) from ${cards.length} measured idea(s)`);
  return {
    generatedAt: new Date().toISOString(),
    basis: 'derived from the latest close · the board re-grades continuously · educational only, not investment advice',
    cards: top,
  };
}

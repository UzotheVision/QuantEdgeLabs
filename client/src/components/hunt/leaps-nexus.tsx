/**
 * LEAPS — the fifth reference mock, wired to /api/leap-tracker.
 *
 * Every field on the card is the feed's own: grade/score, the three score
 * bars (sector 30 · trend 30 · contract 40 — the engine's actual weights),
 * strike/expiry/premium/DTE, ROI at T1 (the engine's modelled +30% move).
 * The "spec" chip is the feed's own read: a name whose fundamentals row says
 * it is not profitable. Budget and grade filters compute against the real
 * premiums; the over-budget footer count is real; the ⌘K search indexes the
 * real 52. The mock's hardcoded 25 rows, spot jitter and looping countdown
 * do not ship.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { openWorkup } from '@/lib/workup-bus';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useStockContext } from '@/contexts/stock-context';
import { useColResize } from '@/lib/use-col-resize';
import { Heartbeat } from '@/components/viz';
import '@/styles/nexus.css';

interface LeapPick {
  symbol: string; name?: string; grade: 'S' | 'A' | 'B' | 'C'; score: number;
  sectorLabel?: string; sectorScore: number; trendScore: number; contractScore: number;
  strike: number; expiry: string; entryPremium: number; dte: number;
  roiAtT1Pct?: number; roiAtT2Pct?: number; spot: number; ivLabel?: string;
  openInterest?: number; spreadPct?: number;
  fundamentals?: { profitable?: boolean };
}
interface LeapPayload {
  asOf?: string; sessionLabel?: string; isStale?: boolean; spyChange?: number;
  scanned?: number; qualified?: number; picks?: LeapPick[];
}

const GRADE_ORDER: Record<string, number> = { S: 1, A: 2, B: 3, C: 4 };
const GRADE_COLOR: Record<string, string> = {
  S: 'var(--gold)', A: 'var(--cyan)', B: 'var(--blue)', C: 'var(--text-dim)',
};

export function LeapsNexus() {
  const [, setLocation] = useLocation();
  const { setCurrentStock } = useStockContext();
  const rail = useColResize('nx-leaps-side', 320, { sign: -1, min: 240, max: 520 });

  const [budget, setBudget] = useState(1000);
  const [minGrade, setMinGrade] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery<LeapPayload>({
    queryKey: ['/api/leap-tracker', 'nexus'],
    queryFn: async () => {
      const r = await fetch('/api/leap-tracker', { credentials: 'include' });
      if (!r.ok) throw new Error('leap-tracker failed');
      return r.json();
    },
    staleTime: 300_000, refetchInterval: 600_000, retry: 1,
  });

  const picks = data?.picks ?? [];
  const shown = useMemo(
    () => (minGrade ? picks.filter((p) => GRADE_ORDER[p.grade] <= GRADE_ORDER[minGrade]) : picks),
    [picks, minGrade],
  );
  const affordable = shown.filter((p) => p.entryPremium * 100 <= budget).length;
  const overBudget = picks.filter((p) => p.entryPremium * 100 > budget).length;
  const gradeCounts = useMemo(() => {
    const c: Record<string, number> = { S: 0, A: 0, B: 0, C: 0 };
    picks.forEach((p) => { c[p.grade] = (c[p.grade] ?? 0) + 1; });
    return c;
  }, [picks]);
  const avgScore = picks.length ? (picks.reduce((a, p) => a + p.score, 0) / picks.length) : null;
  const avgDte = picks.length ? Math.round(picks.reduce((a, p) => a + p.dte, 0) / picks.length) : null;
  const sNames = picks.filter((p) => p.grade === 'S').map((p) => p.symbol);
  const maxGrade = Math.max(1, ...Object.values(gradeCounts));

  const searchShown = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q
      ? picks.filter((p) => p.symbol.includes(q) || (p.sectorLabel ?? '').toUpperCase().includes(q) || p.grade === q)
      : picks.slice(0, 10);
  }, [picks, query]);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); e.stopPropagation();
        setSearchOpen((o) => !o); setQuery(''); setCursor(0);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);
  useEffect(() => { if (searchOpen) setTimeout(() => inputRef.current?.focus(), 40); }, [searchOpen]);

  const jumpTo = (sym: string) => {
    setSearchOpen(false);
    const el = listRef.current?.querySelector(`[data-sym="${sym}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'box-shadow 0.4s';
      el.style.boxShadow = '0 0 0 2px var(--gold), 0 0 40px rgba(251,191,36,0.3)';
      setTimeout(() => { el.style.boxShadow = ''; }, 1500);
    }
  };
  const research = (sym: string) => {
    setCurrentStock({ symbol: sym });
    setLocation('/t?tab=chart');
  };

  const expiryLabel = (e: string) => e?.slice(0, 7) ?? '';

  return (
    <div className="leapslab">
      <div
        className={`main${rail.dragging ? ' nx-dragging' : ''}`}
        style={{ ['--nx-side' as string]: `${rail.width}px` }}
      >
        <div className={`nx-resize${rail.dragging ? ' active' : ''}`} style={{ right: rail.width - 4, marginLeft: 0 }} title="Drag to resize · double-click to expand" {...rail.handleProps} />

        {/* ══════════ LEAPS AREA ══════════ */}
        <div className="col leaps-area">
          <div className="leaps-header">
            <div className="leaps-eyebrow">Long-horizon opportunities</div>
            <div className="leaps-title-row">
              <div className="leaps-title">LEAPS</div>
              <div className="leaps-badge">
                {data ? `${data.qualified}/${data.scanned} liquid · ${gradeCounts.S} S · ${gradeCounts.A} A` : 'scanning…'}
              </div>
              <button className="focus-action" onClick={() => { setSearchOpen(true); setQuery(''); setCursor(0); }}>⌘K SEARCH →</button>
            </div>
            <div className="leaps-desc">Stock-replacement calls ranked by business quality, structural trend and real contract value.</div>
            <div className="leaps-meta">
              <span className="tag gold">{data?.sessionLabel ?? '—'}</span>
              {data?.isStale && <span className="tag mute">stale</span>}
              {data?.spyChange != null && (
                <span className="tag live"><span className="dot" />SPY {data.spyChange >= 0 ? '+' : ''}{data.spyChange.toFixed(2)}%</span>
              )}
              <span className="tag mute" style={{ display: 'inline-flex', gap: 6 }}>
                <Heartbeat since={data?.asOf ?? null} staleAfterSec={3600} />
              </span>
            </div>
          </div>

          <div className="filters-bar">
            <div className="filter-group">
              <span className="filter-label">Budget</span>
              <div className="budget-input">
                <span className="prefix">$</span>
                <input
                  value={budget}
                  onChange={(e) => setBudget(parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
                  aria-label="Per-trade budget"
                />
              </div>
              <span className="budget-hint">affordable · {affordable}</span>
            </div>
            <div className="filter-sep" />
            <div className="filter-group">
              <span className="filter-label">Min grade</span>
              <div className="grade-chips">
                {(['S', 'A', 'B', 'C'] as const).map((g) => (
                  <button
                    key={g}
                    className={`grade-chip ${g.toLowerCase()}${minGrade === g ? ' active' : ''}`}
                    onClick={() => setMinGrade(minGrade === g ? null : g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="list-wrap" ref={listRef}>
            {!picks.length ? (
              <div style={{ display: 'grid', placeItems: 'center', height: 200, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                scanning leap chains…
              </div>
            ) : shown.map((l) => {
              const dim = l.entryPremium * 100 > budget;
              const spec = l.fundamentals?.profitable === false;
              return (
                <div
                  key={l.symbol}
                  data-sym={l.symbol}
                  className={`leap-card${dim ? ' dim' : ''}`}
                  style={{ ['--grade-color' as string]: GRADE_COLOR[l.grade] }}
                  onClick={() => setCurrentStock({ symbol: l.symbol })}
                >
                  <div className="grade-block">
                    <div className={`grade-badge ${l.grade.toLowerCase()}`}>{l.grade}</div>
                    <div className="grade-score">{l.score}</div>
                  </div>
                  <div className="ticker-block">
                    <div className="ticker-row">
                      <div className="ticker-sym-big">{l.symbol}</div>
                      <div className="ticker-price-big">${l.spot.toFixed(2)}</div>
                      {l.sectorLabel && <div className="ticker-sector">{l.sectorLabel}</div>}
                      {/* "spec" is the feed's own read — not profitable per fundamentals */}
                      {spec && <div className="ticker-spec">spec</div>}
                    </div>
                    <div className="score-bars">
                      {([['Sector', l.sectorScore, 30, 'sector'], ['Trend', l.trendScore, 30, 'trend'], ['Contract', l.contractScore, 40, 'contract']] as const).map(([label, v, max, cls]) => (
                        <div className="score-bar" key={label}>
                          <div className="score-bar-head">
                            <span className="score-bar-label">{label}</span>
                            <span className="score-bar-val">{v}</span>
                          </div>
                          <div className="score-bar-track"><div className={`score-bar-fill ${cls}`} style={{ width: `${Math.min(100, (v / max) * 100)}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="contract-block">
                    <div className="contract-strike">${l.strike}C {expiryLabel(l.expiry)}</div>
                    <div className="contract-meta">
                      <span>$<b>{l.entryPremium.toFixed(2)}</b></span>
                      <span>·</span>
                      <span><b>{l.dte}</b>d</span>
                      {l.ivLabel && <><span>·</span><span>IV <b>{l.ivLabel}</b></span></>}
                    </div>
                    <div className="contract-roi">
                      <span className="roi-label">ROI @ +30%</span>
                      <span className="roi-val">{l.roiAtT1Pct != null ? `+${Math.round(l.roiAtT1Pct)}%` : '—'}</span>
                    </div>
                  </div>
                  <div className="action-block">
                    <button className="action-btn" onClick={(e) => { e.stopPropagation(); openWorkup(l.symbol); }}>Research</button>
                    <button className="action-detail" onClick={(e) => { e.stopPropagation(); setCurrentStock({ symbol: l.symbol }); setLocation('/t?tab=gex'); }}>View surface →</button>
                  </div>
                </div>
              );
            })}
            {picks.length > 0 && !shown.length && (
              <div style={{ padding: 32, textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-mute)' }}>
                nothing at {minGrade} or better
              </div>
            )}
          </div>

          <div className="list-footer">
            <b>Grade</b> = Sector rotation (30) + name trend (30) + contract quality (40). ROI modeled at a +30% underlying move via Black-Scholes off the live mid. Not advice.
            <span className="warn">{overBudget} of {picks.length} cost more than one contract of your ${budget.toLocaleString()} per-trade budget.</span>
          </div>
        </div>

        {/* ══════════ RIGHT SIDEBAR ══════════ */}
        <div className="col col-right">
          <div className="sec-head">
            <div className="sec-num" style={{ color: 'var(--gold)', textShadow: '0 0 8px rgba(251,191,36,0.4)' }}>Long-horizon</div>
            <div className="sec-title" style={{ background: 'linear-gradient(135deg,#fff,var(--gold))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>LEAPS Lab.</div>
            <div className="sec-sub">Stock-replacement calls ranked by business quality, structural trend and real contract value.</div>
            <div className="sec-meta">
              <span className="tag gold">LEAPS</span>
              <span className="tag live"><span className="dot" />engaged</span>
            </div>
          </div>

          <div className="summary">
            <div className="summary-grid">
              <div className="summary-card">
                <div className="summary-label">Liquid LEAPS</div>
                <div className="summary-val gold">{data ? `${data.qualified}/${data.scanned}` : '—'}</div>
                <div className="summary-sub">all tradable</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Top grade</div>
                <div className="summary-val gold">S · {gradeCounts.S}</div>
                <div className="summary-sub">{sNames.slice(0, 5).join(', ') || '—'}</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Avg score</div>
                <div className="summary-val cyan">{avgScore != null ? avgScore.toFixed(1) : '—'}</div>
                <div className="summary-sub">of 100</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Avg DTE</div>
                <div className="summary-val">{avgDte != null ? `${avgDte}d` : '—'}</div>
                <div className="summary-sub">{avgDte != null ? `${Math.round(avgDte / 30)} month horizon` : ''}</div>
              </div>
            </div>
          </div>

          <div className="grade-dist">
            <div className="grade-dist-head">
              <div className="grade-dist-label">Grade distribution</div>
              <div className="ranked-count">{shown.length} shown</div>
            </div>
            <div className="grade-bars">
              {(['S', 'A', 'B', 'C'] as const).map((g) => (
                <div className="grade-bar-row" key={g}>
                  <div className={`grade-bar-letter ${g.toLowerCase()}`}>{g}</div>
                  <div className="grade-bar-track"><div className={`grade-bar-fill ${g.toLowerCase()}`} style={{ width: `${(gradeCounts[g] / maxGrade) * 100}%` }} /></div>
                  <div className="grade-bar-count">{gradeCounts[g]}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="how-graded">
            <div className="how-title">How graded</div>
            {([['Sector rotation', 30], ['Name trend', 30], ['Contract quality', 40]] as const).map(([name, w]) => (
              <div className="how-item" key={name}>
                <span className="how-name">{name}</span>
                <div className="how-bar"><div className="how-bar-fill" style={{ width: `${w}%` }} /></div>
                <span className="how-weight">{w}</span>
              </div>
            ))}
          </div>

          <div className="disclaimer">
            Educational only · not investment advice.<br />
            ROI modeled via Black-Scholes at +30% underlying move.
          </div>
        </div>
      </div>

      {/* ══════════ ⌘K SEARCH — the real 52 ══════════ */}
      {searchOpen && (
        <div className="search-modal" onClick={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}>
          <div className="search-box">
            <div className="search-input-wrap">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                ref={inputRef}
                className="search-input"
                placeholder="Search ticker, sector, or grade…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(searchShown.length - 1, c + 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
                  if (e.key === 'Enter' && searchShown[cursor]) jumpTo(searchShown[cursor].symbol);
                }}
              />
              <span className="search-kbd">ESC</span>
            </div>
            <div className="search-results">
              {searchShown.map((l, i) => (
                <div key={l.symbol} className={`search-item${i === cursor ? ' active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => jumpTo(l.symbol)}>
                  <div className="search-sym" style={{ color: GRADE_COLOR[l.grade] }}>{l.grade}</div>
                  <div className="search-name">{l.symbol} · ${l.spot.toFixed(2)} · {l.sectorLabel ?? ''}</div>
                  <div className="search-price">${l.strike}C</div>
                  <div className="search-chg up">{l.roiAtT1Pct != null ? `+${Math.round(l.roiAtT1Pct)}%` : ''}</div>
                </div>
              ))}
              {!searchShown.length && (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-mute)', fontSize: 12 }}>No results for “{query}”</div>
              )}
            </div>
            <div className="search-footer">
              <span><kbd>↑↓</kbd> navigate</span>
              <span><kbd>↵</kbd> jump to card</span>
              <span><kbd>esc</kbd> close</span>
              <span style={{ marginLeft: 'auto', color: 'var(--gold)' }}>{picks.length} liquid LEAPS indexed</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LeapsNexus;

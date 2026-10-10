/**
 * CATALYST — the ninth reference mock, wired. (The mock arrived after this
 * tab was first composed from docs/DESIGN_SYSTEM.md; his code supersedes.)
 *
 * The mock was drawn FROM this platform's live output — its rows are our
 * board's real symbols and notes — so wiring is one-to-one:
 *
 *   econ card       /api/economic-calendar — FRED forward releases
 *   earnings card   /api/earnings/calendar — the Nasdaq-fed service the
 *                   board actually joins on (the legacy /api/earnings/
 *                   upcoming imports a dead module and returns nothing).
 *                   Day-grouped chips: BMO/AMC/TBD + est EPS, negatives in
 *                   parentheses. Chips in the active book get a soft ring.
 *   impact table    /api/catalysts/board — conviction picks joined to
 *                   verified events. Filters carry real counts and filter.
 *                   Response is the platform's rule, not a button that
 *                   trades: risk → SIZE DOWN, conflict → RE-READ,
 *                   confluence → CONFIRMS.
 *   sidebar         summary/coverage/distance all from the same board —
 *                   coverage is the producer's own X-of-Y, distance bars
 *                   scale by real daysAway.
 *
 * Any symbol click opens the universal workup. The mock's demo search,
 * SPY jitter, fake uptime and looping poll countdown do not ship.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useColResize } from '@/lib/use-col-resize';
import { openWorkup } from '@/lib/workup-bus';
import '@/styles/nexus.css';

interface BoardSignal {
  symbol: string; direction?: string | null; convictionScore?: number | null;
  holdingPeriod?: string | null; horizonDays?: number | null;
  event?: { type?: string; title?: string; date?: string; daysAway?: number; polarity?: string; importance?: number; isBinary?: boolean };
  note?: string;
}
interface BoardPayload {
  generatedAt?: string; signalsScanned?: number; symbolsWithCatalysts?: number;
  confluence?: BoardSignal[]; conflict?: BoardSignal[]; eventRisk?: BoardSignal[]; unclaimed?: BoardSignal[];
  _meta?: { note?: string };
}
interface EarningsEvent { symbol: string; companyName?: string; date: string; session?: 'pre' | 'post' | null; epsForecast?: number | null; daysAway?: number }
interface EarningsPayload { asOf?: string; days?: number; count?: number; events?: EarningsEvent[] }
interface EconPayload {
  upcoming?: { name: string; date: string; time?: string; importance?: string; description?: string; tradingImpact?: string }[];
  coverage?: { source?: string; current?: boolean };
}

const fetchJson = (url: string) => async () => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${url} failed`);
  return r.json();
};

function relTime(iso?: string): string {
  if (!iso) return '—';
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  if (!Number.isFinite(m)) return '—';
  if (m < 60) return `${Math.max(1, Math.round(m))}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
function dayHead(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
}
function fmtEps(v: number | null | undefined): { text: string; neg: boolean } | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v < 0 ? { text: `($${Math.abs(v).toFixed(2)})`, neg: true } : { text: `$${v.toFixed(2)}`, neg: false };
}
const SESSION_LABEL = { pre: 'BMO', post: 'AMC' } as const;

type Bucket = 'risk' | 'conflict' | 'confluence' | 'nosignal';
type Filter = 'all' | Bucket;
const RESPONSE = { risk: 'SIZE DOWN', conflict: 'RE-READ', confluence: 'CONFIRMS', nosignal: 'WATCH' } as const;
const TYPE_LABEL = { risk: 'EVENT RISK', conflict: 'CONFLICT', confluence: 'CONFLUENCE', nosignal: 'NO SIGNAL' } as const;

export function CatalystNexus() {
  const rail = useColResize('nx-cat-side', 320, { sign: -1, min: 240, max: 520 });
  const [filter, setFilter] = useState<Filter>('all');

  const { data: board } = useQuery<BoardPayload>({ queryKey: ['/api/catalysts/board', 'cat'], queryFn: fetchJson('/api/catalysts/board'), refetchInterval: 300_000, staleTime: 120_000, retry: 1 });
  const { data: earn } = useQuery<EarningsPayload>({ queryKey: ['/api/earnings/calendar', 7], queryFn: fetchJson('/api/earnings/calendar?days=7'), refetchInterval: 1800_000, staleTime: 900_000, retry: 1 });
  const { data: econ } = useQuery<EconPayload>({ queryKey: ['/api/economic-calendar', 'cat'], queryFn: fetchJson('/api/economic-calendar'), refetchInterval: 600_000, staleTime: 300_000, retry: 1 });

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  /* board buckets → one row list with type */
  const rows = useMemo(() => {
    const mk = (list: BoardSignal[] | undefined, type: Bucket) => (list ?? []).map((s) => ({ ...s, type }));
    return [
      ...mk(board?.conflict, 'conflict'),
      ...mk(board?.eventRisk, 'risk'),
      ...mk(board?.confluence, 'confluence'),
      ...mk(board?.unclaimed, 'nosignal'),
    ].sort((a, b) => (a.event?.daysAway ?? 99) - (b.event?.daysAway ?? 99));
  }, [board]);
  const counts = useMemo(() => ({
    conflict: rows.filter((r) => r.type === 'conflict').length,
    risk: rows.filter((r) => r.type === 'risk').length,
    confluence: rows.filter((r) => r.type === 'confluence').length,
    nosignal: rows.filter((r) => r.type === 'nosignal').length,
  }), [rows]);
  const filtered = filter === 'all' ? rows : rows.filter((r) => r.type === filter);
  const trackedSyms = useMemo(() => new Set(rows.map((r) => r.symbol)), [rows]);

  /* earnings → day groups */
  const earnDays = useMemo(() => {
    const byDate = new Map<string, EarningsEvent[]>();
    (earn?.events ?? []).forEach((e) => {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date)!.push(e);
    });
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, evs]) => ({
        date,
        label: date === today ? 'today' : date === tomorrow ? 'tomorrow' : '',
        // book names first, then by est EPS presence — his chips read best dense
        tickers: evs.slice().sort((a, b) => Number(trackedSyms.has(b.symbol)) - Number(trackedSyms.has(a.symbol))),
      }));
  }, [earn, today, tomorrow, trackedSyms]);
  const earnCount = earn?.count ?? 0;
  const earnRange = earnDays.length ? `${earnDays[0].date.slice(5)} — ${earnDays[earnDays.length - 1].date.slice(5)}` : '';

  const upcoming = econ?.upcoming ?? [];
  const scanned = board?.signalsScanned ?? 0;
  const withCats = board?.symbolsWithCatalysts ?? 0;
  const coveragePct = scanned > 0 ? Math.round((withCats / scanned) * 100) : 0;

  const distClass = (d: number | undefined) => (d ?? 99) <= 2 ? 'close' : (d ?? 99) <= 6 ? 'med' : 'far';
  const distWidth = (d: number | undefined) => `${Math.max(15, 100 - ((d ?? 10) * 10))}%`;

  return (
    <div className="catalystlab">
      <div className={`nx-resize${rail.dragging ? ' active' : ''}`} style={{ right: rail.width - 4 }} title="Drag to resize · double-click to expand" {...rail.handleProps} />

      {/* ══════════ CATALYST AREA ══════════ */}
      <div className="col catalyst-area" style={{ ['--nx-side' as string]: `${rail.width}px` }}>
        <div className="catalyst-header">
          <div className="catalyst-eyebrow">Event intelligence</div>
          <div className="catalyst-title-row">
            <div className="catalyst-title">Catalyst</div>
          </div>
          <div className="catalyst-desc">
            Cross the event calendar against the active book — <b>conflicts first</b>, then confluence and developing ideas.
          </div>
          <div className="catalyst-meta">
            <span className="tag event">signal-linked calendar</span>
            <span className="tag live"><span className="dot" />{earnCount} reports · 7 days</span>
            <span className="tag mute">{rows.length} signals tracked</span>
          </div>
        </div>

        {/* CALENDAR */}
        <div className="calendar-section">
          <div className="calendar-label">US economic calendar · next 7 days · ET · {econ?.coverage?.source ?? 'FRED'}</div>
          <div className="calendar-grid">

            {/* Economic Calendar */}
            <div className="econ-card">
              <div className="econ-head">
                <div className="econ-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                </div>
                <div>
                  <div className="econ-title">Economic Events</div>
                  <div className="econ-sub">High-impact macro releases</div>
                </div>
              </div>
              <div className="econ-list">
                {upcoming.slice(0, 5).map((e) => (
                  <div className="econ-item" key={`${e.name}-${e.date}`}>
                    <div className="econ-date">
                      {dayHead(e.date)}<br />
                      <span style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)' }}>{e.time ?? ''}{e.date === today ? ' · today' : ''}</span>
                    </div>
                    <div>
                      <div className="econ-name">{e.name}</div>
                      <div className="econ-desc">{e.tradingImpact ?? e.description ?? ''}</div>
                    </div>
                    <div className="econ-impact">{(e.importance ?? 'high').toUpperCase()}</div>
                  </div>
                ))}
                {upcoming.length === 0 && <div className="impact-empty">No releases in the calendar window.</div>}
              </div>
            </div>

            {/* Earnings Calendar */}
            <div className="earnings-card">
              <div className="earnings-head">
                <div className="earnings-title">
                  <div className="earnings-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></svg>
                  </div>
                  Earnings · market calendar
                </div>
                <div className="earnings-count">{earnRange ? `${earnRange} · ` : ''}{earnCount} reports</div>
              </div>
              <div className="earnings-days">
                {earnDays.map((day) => (
                  <div className="earnings-day" key={day.date}>
                    <div className="earnings-day-head">
                      <div className="earnings-day-date">{dayHead(day.date)}</div>
                      {day.label && <div className="earnings-day-label">· {day.label}</div>}
                      <div className="earnings-day-count">{day.tickers.length} reports</div>
                    </div>
                    <div className="earnings-tickers">
                      {day.tickers.map((t) => {
                        const eps = fmtEps(t.epsForecast);
                        return (
                          <div className={`earnings-ticker${trackedSyms.has(t.symbol) ? ' tracked' : ''}`} key={`${day.date}-${t.symbol}`}
                            title={`${t.companyName ?? t.symbol}${trackedSyms.has(t.symbol) ? ' · in the active book' : ''}`}
                            onClick={() => openWorkup(t.symbol)}>
                            {t.symbol}
                            <span className="time">{t.session ? SESSION_LABEL[t.session] : 'TBD'}</span>
                            {eps && <span className={`eps${eps.neg ? ' neg' : ''}`}>{eps.text}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {earnDays.length === 0 && <div className="impact-empty">Earnings calendar unreachable — nothing is shown in its place.</div>}
              </div>
            </div>

          </div>
        </div>

        {/* SIGNAL IMPACT */}
        <div className="impact-section">
          <div className="impact-head">
            <div className="impact-label">Signal impact · how the verified calendar changes the active book</div>
            <div className="impact-filters">
              {([['all', 'All', rows.length], ['conflict', 'CONFLICT', counts.conflict], ['risk', 'EVENT RISK', counts.risk], ['confluence', 'CONFLUENCE', counts.confluence], ['nosignal', 'NO SIGNAL', counts.nosignal]] as const).map(([k, label, n]) => (
                <div key={k} className={`impact-filter${filter === k ? ' active' : ''}`} onClick={() => setFilter(k as Filter)}>
                  {label} <span className="count">{n}</span>
                </div>
              ))}
            </div>
          </div>

          <table className="impact-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Impact</th>
                <th>Oracle side</th>
                <th>Verified event</th>
                <th>Distance</th>
                <th>Response</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const side = (d.direction ?? 'long').toUpperCase();
                return (
                  <tr key={`${d.type}-${d.symbol}-${d.event?.date}`} onClick={() => openWorkup(d.symbol)}>
                    <td>
                      <div className="impact-ticker">
                        {d.symbol}
                        {d.convictionScore != null && <span className="score">{Math.round(d.convictionScore)}</span>}
                      </div>
                    </td>
                    <td><div className={`impact-type ${d.type === 'nosignal' ? 'conflict' : d.type}`}>{TYPE_LABEL[d.type]}</div></td>
                    <td>
                      <div className={`impact-side ${side === 'SHORT' ? 'short' : 'long'}`}>
                        <span className="arrow">{side === 'SHORT' ? '▼' : '▲'}</span>
                        {side}{d.holdingPeriod ? ` · ${d.holdingPeriod}` : ''}
                      </div>
                    </td>
                    <td>
                      <div className="impact-event">
                        <b>{d.event?.title ?? '—'}</b>
                        {d.note && <div className="detail">{d.note}</div>}
                      </div>
                    </td>
                    <td><div className="impact-distance">{d.event?.daysAway != null ? (d.event.daysAway === 0 ? 'today' : `${d.event.daysAway}d`) : '—'}</div></td>
                    <td><div className="impact-response" title="The platform's standing rule for this join — enforced in scoring, not a button">{RESPONSE[d.type]} ↗</div></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6}><div className="impact-empty">No tracked catalyst in this bucket — see the note below for what empty means.</div></td></tr>
              )}
            </tbody>
          </table>

          <div className="impact-note">
            <b>Catalysts joined to live conviction picks.</b> {board?._meta?.note?.replace(/^Catalysts joined to live conviction picks\.?\s*/, '') ?? "'conflict' = tracked events whose polarity opposes the direction we published; it is a flag to re-read the thesis, not an automatic exit. Binary events (earnings) are counted as risk, never as directional tilt. Empty sections mean no tracked catalyst fell inside the horizon — not that none exists."}
          </div>
        </div>
      </div>

      {/* ══════════ RIGHT SIDEBAR ══════════ */}
      <div className="col col-right" style={{ width: rail.width, minWidth: rail.width }}>
        <div className="sec-head">
          <div className="sec-num" style={{ color: 'var(--event-bright)', textShadow: '0 0 8px rgba(251,146,60,0.4)' }}>Event intelligence</div>
          <div className="sec-title" style={{ background: 'linear-gradient(135deg,#fff,var(--event-bright))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Catalyst Lab.</div>
          <div className="sec-sub">Cross the event calendar against the active book. Conflicts first, then confluence.</div>
          <div className="sec-meta">
            <span className="tag event">CATALYST</span>
            <span className="tag live"><span className="dot" />engaged</span>
          </div>
        </div>

        <div className="summary">
          <div className="summary-grid">
            <div className="summary-card">
              <div className="summary-label">Tracked signals</div>
              <div className="summary-val event">{rows.length}</div>
              <div className="summary-sub">of {scanned} live</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Event risk</div>
              <div className="summary-val" style={{ color: 'var(--red)', textShadow: '0 0 6px rgba(255,107,61,0.3)' }}>{counts.risk}</div>
              <div className="summary-sub">earnings inside horizon</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Conflicts</div>
              <div className="summary-val" style={{ color: 'var(--amber)', textShadow: '0 0 6px rgba(250,204,21,0.3)' }}>{counts.conflict}</div>
              <div className="summary-sub">polarity mismatch</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Confluence</div>
              <div className="summary-val cyan">{counts.confluence}</div>
              <div className="summary-sub">event supports thesis</div>
            </div>
          </div>
        </div>

        <div className="coverage">
          <div className="coverage-head">
            <div className="coverage-label">Catalyst coverage</div>
            <div className="coverage-stat">{withCats} of {scanned}</div>
          </div>
          <div className="coverage-bar">
            <div className="coverage-fill" style={{ width: `${coveragePct}%` }} />
          </div>
          <div className="coverage-note">
            <b>{withCats} of {scanned}</b> live signals have a tracked event inside their horizon. Coverage expands as more earnings are verified.
          </div>
        </div>

        <div className="impact-dist">
          <div className="impact-dist-head">
            <div className="impact-dist-label">Distance to event</div>
          </div>
          <div className="impact-dist-list">
            {rows.filter((r) => r.event?.daysAway != null).slice(0, 8).map((r) => (
              <div className="dist-item" key={`d-${r.symbol}-${r.event?.date}`} onClick={() => openWorkup(r.symbol)}>
                <div className="dist-ticker">{r.symbol}</div>
                <div className="dist-bar"><div className={`dist-fill ${distClass(r.event?.daysAway)}`} style={{ width: distWidth(r.event?.daysAway) }} /></div>
                <div className="dist-val">{r.event!.daysAway === 0 ? 'now' : `${r.event!.daysAway}d`}</div>
              </div>
            ))}
            {rows.every((r) => r.event?.daysAway == null) && <div className="impact-empty">No dated events on tracked signals.</div>}
          </div>
        </div>

        <div className="sys-status">
          <div className="sys-row"><span className="k">Board</span><span className="v">{relTime(board?.generatedAt)}</span></div>
          <div className="sys-row"><span className="k">Reports 7d</span><span className="v" style={{ color: 'var(--event-bright)' }}>{earnCount}</span></div>
          <div className="sys-row"><span className="k">Macro window</span><span className="v">{upcoming.length} releases</span></div>
          <div className="sys-row"><span className="k">Calendar</span><span className={`v ${econ?.coverage?.current ? 'ok' : 'warn'}`}>{econ?.coverage?.current ? '● calendar live' : 'stale'}</span></div>
        </div>

        <div className="disclaimer">
          Educational only · not investment advice.<br />
          Binary events are risk, not directional tilt.
        </div>
      </div>
    </div>
  );
}

export default CatalystNexus;

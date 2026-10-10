/**
 * GEXExpiryMatrix — Skylit-style Strike × Expiration heatmap grid.
 *
 * Default view: ~30 strikes centered on spot price (the zone that matters).
 * Expand toggle reveals the full strike chain for deep analysis.
 * GEX / VEX toggle switches between gamma and vanna exposure per cell.
 * Optional expiry filter + strike range filter controlled by parent.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { StrikeExpiryCell, GEXSnapshot } from '../../../../shared/gex-types';

/** Parse "APR 14"-style label into a Date (assumes current year) */
function parseExpiryLabel(label: string): Date | null {
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const parts = label.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const month = months[parts[0].toUpperCase()];
  const day = parseInt(parts[1], 10);
  if (month === undefined || isNaN(day)) return null;
  return new Date(new Date().getFullYear(), month, day);
}

/** Group expiry dates into smart buckets:
 *  - This Week / Next Week / Week of X — for short-DTE (multiple expiries close together)
 *  - "MAY" / "JUN" / "JUL" — when only 1-2 monthly expiries that month
 *  - "Q3" / "Q4" / "LEAPS" — for far-out singleton expiries
 *  Avoids "May 11-15 (1)" confusion when there's just one strike all week.
 */
function groupByWeek(expiryInfo: { label: string; dte: number }[]): { key: string; weekLabel: string; expLabels: string[] }[] {
  if (expiryInfo.length === 0) return [];

  const today = new Date();
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtMonth = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });

  // First pass: group strictly by week (Mon-Fri)
  const byWeek = new Map<string, { monday: Date; labels: string[] }>();
  for (const exp of expiryInfo) {
    const d = parseExpiryLabel(exp.label);
    if (!d) continue;
    const day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + mondayOffset);
    const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    if (!byWeek.has(key)) byWeek.set(key, { monday, labels: [] });
    byWeek.get(key)!.labels.push(exp.label);
  }

  // Second pass: collapse single-expiry weeks beyond ~30d into monthly buckets
  const result: { key: string; weekLabel: string; expLabels: string[] }[] = [];
  const monthlyBuckets = new Map<string, { firstDate: Date; labels: string[] }>();
  const quarterlyBuckets = new Map<string, { firstDate: Date; labels: string[] }>();

  for (const [key, { monday, labels }] of Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const dteFromToday = Math.floor((monday.getTime() - today.getTime()) / 86400000);

    // Near-term (<30d) OR multi-expiry weeks → keep as week buckets
    if (dteFromToday < 30 || labels.length >= 2) {
      const fri = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4);
      const label = labels.length === 1
        ? fmt(parseExpiryLabel(labels[0])!)              // single expiry → just the date
        : `${fmt(monday)}–${fmt(fri)}`;                  // week range
      result.push({ key, weekLabel: label, expLabels: labels });
      continue;
    }

    // 30-180d singleton → group into monthly bucket
    if (dteFromToday < 180) {
      const monthKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyBuckets.has(monthKey)) monthlyBuckets.set(monthKey, { firstDate: monday, labels: [] });
      monthlyBuckets.get(monthKey)!.labels.push(...labels);
      continue;
    }

    // >180d → quarterly / LEAPS
    const q = Math.floor(monday.getMonth() / 3) + 1;
    const quarterKey = `${monday.getFullYear()}-Q${q}`;
    if (!quarterlyBuckets.has(quarterKey)) quarterlyBuckets.set(quarterKey, { firstDate: monday, labels: [] });
    quarterlyBuckets.get(quarterKey)!.labels.push(...labels);
  }

  // Append monthly buckets (sorted)
  for (const [key, { firstDate, labels }] of Array.from(monthlyBuckets.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    result.push({
      key: `m-${key}`,
      weekLabel: fmtMonth(firstDate),  // "JUN" not "Jun 18"
      expLabels: labels
    });
  }

  // Append quarterly / LEAPS (sorted)
  for (const [key, { firstDate, labels }] of Array.from(quarterlyBuckets.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const q = key.split('-Q')[1];
    const yr = firstDate.getFullYear().toString().slice(2);
    result.push({
      key: `q-${key}`,
      weekLabel: `Q${q} '${yr}`,        // "Q3 '26" not "Jun 29 - Jul 3"
      expLabels: labels
    });
  }

  return result;
}

export interface GEXExpiryMatrixProps {
  matrix: StrikeExpiryCell[];
  snapshot: GEXSnapshot;
  /** Which expiry labels to include (all if undefined/empty) */
  visibleExpiries?: string[];
  /** Override default strikes-around-spot (default 15 = ~30 rows) */
  strikesAround?: number;
  /** Hide the internal GEX/VEX toggle + expand controls (parent provides them) */
  hideControls?: boolean;
  /** Controlled GEX/VEX mode from parent */
  externalMode?: 'gex' | 'vex';
  /** Controlled expanded state from parent */
  externalExpanded?: boolean;
}

type MatrixMode = 'gex' | 'vex';

/** Number of strikes to show above and below spot in collapsed view */
const DEFAULT_STRIKES_AROUND = 15;

function formatCellValue(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}B`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}M`;
  if (abs >= 1) return `${sign}$${abs.toFixed(1)}K`;
  if (abs >= 0.1) return `${sign}$${(abs * 1000).toFixed(0)}`;
  if (abs >= 0.001) return `${sign}$${(abs * 1000).toFixed(1)}`;
  return '';
}

// Convert raw values to display value in thousands ($K)
// GEX is in billions ($B), VEX is in millions ($M)
function toDisplayK(v: number, mode: MatrixMode = 'gex'): number {
  return mode === 'gex' ? v * 1e6 : v * 1e3; // B→K or M→K
}

export function GEXExpiryMatrix({
  matrix,
  snapshot,
  visibleExpiries,
  strikesAround,
  hideControls = false,
  externalMode,
  externalExpanded,
}: GEXExpiryMatrixProps) {
  const [internalMode, setInternalMode] = useState<MatrixMode>('gex');
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [internalWeek, setInternalWeek] = useState<string>('all');
  // NEW: DTE preset filter — independent of week buckets
  const [dtePreset, setDtePreset] = useState<'all' | '0-7' | '7-30' | '30-90' | '90+' | 'single'>('all');
  // NEW: when 'single' preset, lets user click a specific expiry to isolate
  const [singleExpiry, setSingleExpiry] = useState<string | null>(null);
  const spotRowRef = useRef<HTMLTableRowElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const mode = externalMode ?? internalMode;
  const expanded = externalExpanded ?? internalExpanded;
  // When externally controlled, local setter is a no-op (parent handles state)
  const setExpanded = externalExpanded !== undefined
    ? (_v: boolean) => {} // parent controls expansion via externalExpanded prop
    : (v: boolean) => setInternalExpanded(v);
  const STRIKES_AROUND = strikesAround ?? DEFAULT_STRIKES_AROUND;

  // Auto-scroll to spot row within the matrix scroll container only (not the page)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const row = spotRowRef.current;
    if (container && row) {
      const rowTop = row.offsetTop;
      const containerH = container.clientHeight;
      container.scrollTop = Math.max(0, rowTop - containerH / 2);
    }
  }, [expanded, matrix.length]);

  // Build the grid: unique strikes (rows) × unique expiry labels (columns)
  const { allStrikes, expiries, lookup } = useMemo(() => {
    const strikeSet = new Set<number>();
    const expiryMap = new Map<string, number>(); // label → dte
    const lk = new Map<string, StrikeExpiryCell>();

    for (const cell of matrix) {
      strikeSet.add(cell.strike);
      if (!expiryMap.has(cell.expiryLabel) || cell.dte < expiryMap.get(cell.expiryLabel)!) {
        expiryMap.set(cell.expiryLabel, cell.dte);
      }
      lk.set(`${cell.strike}|${cell.expiryLabel}`, cell);
    }

    const strikes = Array.from(strikeSet).sort((a, b) => b - a);
    const exps = Array.from(expiryMap.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([label]) => label);

    return { allStrikes: strikes, expiries: exps, lookup: lk };
  }, [matrix]);

  if (!matrix || matrix.length === 0) {
    return (
      <div className="p-6 text-center text-xs font-mono text-muted-foreground">
        No expiration matrix data
      </div>
    );
  }

  // Build expiry info with DTE for filtering
  const expiryInfo = useMemo(() => {
    const info: { label: string; dte: number }[] = [];
    const dteMap = new Map<string, number>();
    for (const cell of matrix) {
      if (!dteMap.has(cell.expiryLabel) || cell.dte < dteMap.get(cell.expiryLabel)!) {
        dteMap.set(cell.expiryLabel, cell.dte);
      }
    }
    dteMap.forEach((dte, label) => {
      info.push({ label, dte });
    });
    return info.sort((a, b) => a.dte - b.dte);
  }, [matrix]);

  // Week groups for internal filter
  const weekGroups = useMemo(() => groupByWeek(expiryInfo), [expiryInfo]);

  // Filter expiries — DTE preset > single expiry > week bucket > all
  const filteredExpiries = useMemo(() => {
    if (visibleExpiries && visibleExpiries.length > 0) {
      return expiries.filter(e => visibleExpiries.includes(e));
    }

    // NEW: Single-expiry mode (user clicked a specific date)
    if (dtePreset === 'single' && singleExpiry) {
      return expiries.filter(e => e === singleExpiry);
    }

    // NEW: DTE preset filter (0-7, 7-30, 30-90, 90+)
    if (dtePreset !== 'all' && dtePreset !== 'single') {
      const ranges: Record<string, [number, number]> = {
        '0-7': [0, 7],
        '7-30': [7, 30],
        '30-90': [30, 90],
        '90+': [90, 9999]
      };
      const [min, max] = ranges[dtePreset];
      const labelsInRange = expiryInfo.filter(e => e.dte >= min && e.dte <= max).map(e => e.label);
      return expiries.filter(e => labelsInRange.includes(e));
    }

    // Internal week-based filtering (legacy)
    if (internalWeek === 'all') return expiries;
    const week = weekGroups.find(w => w.key === internalWeek);
    return week ? expiries.filter(e => week.expLabels.includes(e)) : expiries;
  }, [visibleExpiries, expiries, internalWeek, weekGroups, dtePreset, singleExpiry, expiryInfo]);

  // Find the index of the strike closest to spot
  const { spotPrice, gammaFlipPrice, maxGammaStrike } = snapshot;
  const spotIdx = allStrikes.reduce((best, s, i) =>
    Math.abs(s - spotPrice) < Math.abs(allStrikes[best] - spotPrice) ? i : best, 0);

  // Get the active value for a cell based on mode
  const getCellValue = (cell: StrikeExpiryCell): number => {
    return mode === 'gex' ? cell.netGEX : (cell.netVEX ?? 0);
  };

  // Collapsed view: show STRIKES_AROUND above and below spot
  const startIdx = Math.max(0, spotIdx - STRIKES_AROUND);
  const endIdx = Math.min(allStrikes.length, spotIdx + STRIKES_AROUND + 1);
  const rawStrikes = expanded ? allStrikes : allStrikes.slice(startIdx, endIdx);

  // Filter out strikes with no data in any visible expiry (removes gap rows)
  const strikes = useMemo(() => {
    return rawStrikes.filter(strike => {
      // Always keep spot/flip/maxGamma rows
      if (Math.abs(strike - spotPrice) / spotPrice < 0.003) return true;
      if (strike === gammaFlipPrice || strike === maxGammaStrike) return true;
      // Keep if any visible expiry has data
      return filteredExpiries.some(exp => {
        const cell = lookup.get(`${strike}|${exp}`);
        return cell && Math.abs(getCellValue(cell)) >= 0.0001;
      });
    });
  }, [rawStrikes, filteredExpiries, lookup, spotPrice, gammaFlipPrice, maxGammaStrike, getCellValue]);

  const hiddenAbove = expanded ? 0 : startIdx;
  const hiddenBelow = expanded ? 0 : allStrikes.length - endIdx;
  const totalHidden = hiddenAbove + hiddenBelow;

  // Find max for intensity scaling (across ALL strikes, not just visible)
  let maxVal = 0.001;
  let maxCellKey = '';
  let maxCellMag = 0;
  lookup.forEach((cell, key) => {
    const mag = Math.abs(getCellValue(cell));
    if (mag > maxVal) maxVal = mag;
    if (mag > maxCellMag) {
      maxCellMag = mag;
      maxCellKey = key;
    }
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Controls row: GEX/VEX toggle + expand/collapse — only if not hidden */}
      {!hideControls && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setInternalMode('gex')}
              className={cn(
                'px-2.5 py-1 text-[9px] font-mono font-bold uppercase tracking-widest rounded transition-colors',
                mode === 'gex'
                  ? 'bg-[var(--gex-positive)]/20 text-[var(--gex-positive)] ring-1 ring-[var(--gex-positive)]/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
              )}
            >
              GEX
            </button>
            <button
              type="button"
              onClick={() => setInternalMode('vex')}
              className={cn(
                'px-2.5 py-1 text-[9px] font-mono font-bold uppercase tracking-widest rounded transition-colors',
                mode === 'vex'
                  ? 'bg-violet-400/20 text-violet-400 ring-1 ring-violet-400/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
              )}
            >
              VEX
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-muted-foreground">
              {strikes.length} of {allStrikes.length} strikes
            </span>
            {totalHidden > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground border border-border rounded transition-colors"
              >
                {expanded ? 'COLLAPSE' : `EXPAND ALL (${allStrikes.length})`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* DTE preset bar — toggle between any date or DTE range */}
      {(!visibleExpiries || visibleExpiries.length === 0) && expiryInfo.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0 pb-1 border-b border-border/20">
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mr-1">
            DTE
          </span>
          {(() => {
            const buckets = [
              { id: 'all' as const, label: 'ALL', range: [0, 9999] as [number, number] },
              { id: '0-7' as const, label: '0–7d', range: [0, 7] as [number, number] },
              { id: '7-30' as const, label: '7–30d', range: [7, 30] as [number, number] },
              { id: '30-90' as const, label: '30–90d', range: [30, 90] as [number, number] },
              { id: '90+' as const, label: '90d+', range: [90, 9999] as [number, number] },
            ];
            return buckets.map(p => {
              const count = p.id === 'all'
                ? expiryInfo.length
                : expiryInfo.filter(e => e.dte >= p.range[0] && e.dte <= p.range[1]).length;
              const empty = count === 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={empty}
                  onClick={() => { setDtePreset(p.id); setSingleExpiry(null); }}
                  title={empty ? 'No expiries in this range' : `${count} ${count === 1 ? 'expiry' : 'expiries'}`}
                  className={cn(
                    'px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded border transition-colors',
                    empty && 'opacity-30 cursor-not-allowed line-through',
                    !empty && dtePreset === p.id
                      ? 'border-[var(--brand-cyan)]/40 text-[var(--brand-cyan)] bg-[var(--brand-cyan)]/10'
                      : !empty && 'border-border/30 text-muted-foreground hover:text-foreground hover:border-border'
                  )}
                >
                  {p.label}{!empty && p.id !== 'all' ? ` ·${count}` : ''}
                </button>
              );
            });
          })()}
          <span className="text-[9px] text-muted-foreground mx-1">|</span>
          <select
            value={dtePreset === 'single' ? (singleExpiry ?? '') : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v) { setDtePreset('single'); setSingleExpiry(v); }
              else { setDtePreset('all'); setSingleExpiry(null); }
            }}
            className={cn(
              'px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded border bg-transparent transition-colors cursor-pointer',
              dtePreset === 'single'
                ? 'border-[var(--brand-gold)]/40 text-[var(--brand-gold)] bg-[var(--brand-gold)]/10'
                : 'border-border/30 text-muted-foreground hover:text-foreground hover:border-border'
            )}
          >
            <option value="">PICK DATE…</option>
            {expiryInfo.map(e => (
              <option key={e.label} value={e.label} className="bg-[var(--surface-raised)] text-foreground">
                {e.label} ({e.dte}d)
              </option>
            ))}
          </select>
          <span className="text-[9px] font-mono text-muted-foreground ml-auto">
            {filteredExpiries.length} of {expiries.length} expiries
            {expiryInfo.length > 0 && (
              <span className="ml-2 text-muted-foreground">
                · max {expiryInfo[expiryInfo.length - 1].label} ({expiryInfo[expiryInfo.length - 1].dte}d)
              </span>
            )}
          </span>
        </div>
      )}

      {/* Inline week filter pills — visible when matrix controls its own dates */}
      {(!visibleExpiries || visibleExpiries.length === 0) && weekGroups.length > 1 && dtePreset === 'all' && (
        <div className="flex items-center gap-1 flex-shrink-0 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setInternalWeek('all')}
            className={cn(
              'px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded border transition-colors whitespace-nowrap flex-shrink-0',
              internalWeek === 'all'
                ? 'border-[var(--gex-positive)]/30 text-[var(--gex-positive)] bg-[var(--gex-positive)]/10'
                : 'border-transparent text-muted-foreground hover:text-muted-foreground hover:border-border/20'
            )}
          >
            ALL · {expiries.length}
          </button>
          {weekGroups.map((wk) => {
            const isMonthly = wk.key.startsWith('m-');
            const isQuarterly = wk.key.startsWith('q-');
            const accent = isQuarterly ? 'text-purple-400 border-purple-400/30 bg-purple-400/10'
                          : isMonthly ? 'text-sky-400 border-sky-400/30 bg-sky-400/10'
                          : 'text-amber-400 border-amber-400/30 bg-amber-400/10';
            return (
              <button
                key={wk.key}
                type="button"
                onClick={() => setInternalWeek(internalWeek === wk.key ? 'all' : wk.key)}
                className={cn(
                  'px-2 py-0.5 text-[9px] font-mono font-bold rounded border transition-colors whitespace-nowrap flex-shrink-0',
                  internalWeek === wk.key
                    ? accent
                    : 'border-transparent text-muted-foreground hover:text-muted-foreground hover:border-border/20'
                )}
                title={`${wk.expLabels.length} ${wk.expLabels.length === 1 ? 'expiry' : 'expiries'} · ${wk.expLabels.join(', ')}`}
              >
                {wk.weekLabel}{wk.expLabels.length > 1 ? ` ·${wk.expLabels.length}` : ''}
              </button>
            );
          })}
        </div>
      )}

      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* PERSISTENT SPOT PILL — floats top-right of matrix, always visible.
            "Jump to spot" click scrolls the spot row into view. */}
        <button
          type="button"
          onClick={() => {
            spotRowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }}
          className="absolute top-1.5 right-2 z-30 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-400/10 border border-amber-400/40 text-amber-400 text-[10px] font-mono font-bold uppercase tracking-widest hover:bg-amber-400/20 transition-colors shadow-md"
          title="Jump to spot"
        >
          <span>&#x25BA;</span>
          <span>SPOT</span>
          <span className="tabular-nums">${spotPrice.toFixed(2)}</span>
          {gammaFlipPrice != null && (
            <>
              <span className="text-amber-400/30">·</span>
              <span className="text-violet-400 normal-case tracking-normal">flip ${gammaFlipPrice.toFixed(0)}</span>
            </>
          )}
        </button>

        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-auto overscroll-contain"
          tabIndex={0}
          onKeyDown={(e) => {
            const el = scrollContainerRef.current;
            if (!el) return;
            const step = 120;
            if (e.key === 'ArrowLeft') { el.scrollLeft -= step; e.preventDefault(); }
            if (e.key === 'ArrowRight') { el.scrollLeft += step; e.preventDefault(); }
          }}
        >
        <table className="text-[10px] font-mono border-collapse min-w-max w-full">
          <thead className="sticky top-0 z-20 bg-[var(--surface-raised)]">
            <tr className="border-b border-border/40">
              <th className="text-left py-2 px-2 text-[9px] uppercase tracking-widest text-muted-foreground font-medium sticky left-0 bg-[var(--surface-raised)] z-30">
                STRIKE
              </th>
              {filteredExpiries.map(exp => (
                <th key={exp} className="text-center py-2 px-3 text-[9px] uppercase tracking-widest text-muted-foreground font-medium whitespace-nowrap" style={{ minWidth: '100px' }}>
                  {exp}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Truncation indicator — above */}
            {!expanded && hiddenAbove > 0 && (
              <tr className="border-b border-border/10">
                <td
                  colSpan={filteredExpiries.length + 1}
                  className="py-1.5 px-2 text-center text-[9px] font-mono text-muted-foreground cursor-pointer hover:text-muted-foreground hover:bg-muted/10 transition-colors"
                  onClick={() => setExpanded(true)}
                >
                  ▲ {hiddenAbove} strikes above · click to expand
                </td>
              </tr>
            )}

            {/*
              SPOT INDICATOR — the strike just BELOW spot gets a thick amber bottom border
              (the "spot line"). The closest strike gets the amber row tint + ► marker
              so spot is always visually located even when it falls between strikes.
            */}
            {strikes.map((strike, rowIdx) => {
              // Strike directly above spot (if any)
              const strikeAboveSpot = strikes.find(s => s >= spotPrice);
              const strikeBelowSpot = [...strikes].reverse().find(s => s <= spotPrice);
              // Mark the strike just BELOW spot — the spot-line will render BENEATH this row
              const drawSpotLineBelow = strikeBelowSpot !== undefined && strike === strikeBelowSpot && strikeAboveSpot !== strikeBelowSpot;
              // The "anchor" strike (closest to spot) — for scrolling and the SPOT pill
              const closestStrike = strikes.reduce(
                (best, s) => Math.abs(s - spotPrice) < Math.abs(best - spotPrice) ? s : best,
                strikes[0] ?? spotPrice,
              );
              const isAnchor = strike === closestStrike;
              const isFlip = gammaFlipPrice != null && strike === gammaFlipPrice;
              const isMax = strike === maxGammaStrike;
              // Distance from spot in % — for label coloring
              const distPct = ((strike - spotPrice) / spotPrice) * 100;
              const isVeryClose = Math.abs(distPct) < 0.5;

              return (
                <tr
                  key={strike}
                  ref={isAnchor ? spotRowRef : undefined}
                  className={cn(
                    'border-b border-border/10 transition-colors relative',
                    isAnchor && 'bg-amber-400/[0.07]',
                    isFlip && 'bg-violet-400/5',
                    drawSpotLineBelow && 'border-b-2 border-b-amber-400 shadow-[0_2px_0_rgba(251,191,36,0.4)]',
                  )}
                >
                  <td className={cn(
                    'py-1.5 px-2 font-bold tabular-nums whitespace-nowrap sticky left-0 z-10 bg-[var(--surface-raised)]',
                    isAnchor && 'text-amber-400 bg-amber-400/[0.10]',
                    isFlip && 'text-violet-400',
                    isMax && 'text-[var(--gex-star)]',
                    !isAnchor && !isFlip && !isMax && 'text-foreground',
                  )}>
                    <div className="flex items-center gap-1">
                      {isMax && <span className="text-[var(--gex-star)]" title="Max gamma strike">&#x2299;</span>}
                      {isAnchor && !isMax && <span className="text-amber-400" title={`Spot $${spotPrice.toFixed(2)}`}>&#x25BA;</span>}
                      {isFlip && !isMax && !isAnchor && <span className="text-violet-400" title="Gamma flip">&#x26A1;</span>}
                      <span>${strike.toFixed(strike % 1 === 0 ? 0 : 1)}</span>
                      {isVeryClose && !isAnchor && (
                        <span className="text-[9px] font-mono text-amber-400/60 ml-0.5">{distPct >= 0 ? '+' : ''}{distPct.toFixed(1)}%</span>
                      )}
                    </div>
                  </td>
                  {filteredExpiries.map(exp => {
                    const cell = lookup.get(`${strike}|${exp}`);
                    const val = cell ? getCellValue(cell) : undefined;
                    if (val === undefined || Math.abs(val) < 0.0001) {
                      return (
                        <td key={exp} className="py-1.5 px-3 text-center" style={{ minWidth: '100px' }} />
                      );
                    }
                    const intensity = Math.abs(val) / maxVal;
                    const isPositive = val > 0;
                    const displayVal = toDisplayK(val, mode);
                    const cellKey = `${strike}|${exp}`;
                    const isMaxCell = cellKey === maxCellKey;

                    // Skylit-style colors: green for positive, teal-purple for negative
                    const bgColor = isPositive
                      ? `rgba(34, 197, 94, ${Math.min(0.35, intensity * 0.4)})`
                      : `rgba(168, 85, 247, ${Math.min(0.35, intensity * 0.4)})`;

                    return (
                      <td
                        key={exp}
                        className={cn(
                          'py-1.5 px-3 text-center tabular-nums font-medium whitespace-nowrap',
                          isPositive ? 'text-[var(--gex-positive)]' : 'text-purple-400',
                          isMaxCell && 'ring-1 ring-inset ring-amber-400/60',
                        )}
                        style={{ backgroundColor: bgColor }}
                      >
                        {formatCellValue(displayVal)}
                        {isMaxCell && <span className="text-amber-400 ml-0.5">★</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Truncation indicator — below */}
            {!expanded && hiddenBelow > 0 && (
              <tr>
                <td
                  colSpan={filteredExpiries.length + 1}
                  className="py-1.5 px-2 text-center text-[9px] font-mono text-muted-foreground cursor-pointer hover:text-muted-foreground hover:bg-muted/10 transition-colors"
                  onClick={() => setExpanded(true)}
                >
                  ▼ {hiddenBelow} strikes below · click to expand
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

/**
 * CUSTOMIZE — every arrangement and display choice, in one place.
 * Changes apply live (no save button) and persist on this device.
 * Opened from the board header ("customize") and the account menu.
 */
import { useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown, RotateCcw, X } from 'lucide-react';
import {
  usePrefs, setPrefs, resetPrefs, movePanel, CARD_PARTS, LEFT_PANELS, RIGHT_PANELS, type BoardPrefs,
} from '@/lib/board-prefs';

type RailMode = 'min' | 'hidden' | 'shown' | undefined;

export function CustomizePanel({ open, onClose, railUi, setRail }: {
  open: boolean;
  onClose: () => void;
  /** Present only on the board — enables the Panels section. */
  railUi?: Record<string, RailMode>;
  setRail?: (id: string, mode: 'min' | 'hidden' | null) => void;
}) {
  const p = usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const Seg = <K extends keyof BoardPrefs>({ k, opts }: { k: K; opts: [BoardPrefs[K], string][] }) => (
    <div className="qc-seg" role="radiogroup">
      {opts.map(([v, label]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={p[k] === v}
          className={p[k] === v ? 'on' : ''} onClick={() => setPrefs({ [k]: v } as Partial<BoardPrefs>)}>{label}</button>
      ))}
    </div>
  );

  const Rail = ({ rail, items }: { rail: 'left' | 'right'; items: readonly { id: string; label: string }[] }) => {
    const order = p.order[rail];
    const sorted = [...items].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return (
      <div className="qc-list">
        {sorted.map((it, i) => {
          const mode = railUi?.[it.id];
          const state = mode === 'hidden' ? 'hidden' : mode === 'min' ? 'min' : 'open';
          return (
            <div key={it.id} className="qc-row">
              <span className="qc-name">{it.label}</span>
              <div className="qc-seg small" role="radiogroup" aria-label={`${it.label} display`}>
                {([['open', 'Open'], ['min', 'Collapsed'], ['hidden', 'Hidden']] as const).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={state === v} className={state === v ? 'on' : ''}
                    onClick={() => setRail?.(it.id, v === 'open' ? null : v)}>{l}</button>
                ))}
              </div>
              <div className="qc-move">
                <button type="button" aria-label={`Move ${it.label} up`} disabled={i === 0} onClick={() => movePanel(rail, it.id, -1)}><ChevronUp size={16} /></button>
                <button type="button" aria-label={`Move ${it.label} down`} disabled={i === sorted.length - 1} onClick={() => movePanel(rail, it.id, 1)}><ChevronDown size={16} /></button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="qc-scrim" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} className="qc-panel" role="dialog" aria-modal="true" aria-label="Customize" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qc-head">
          <div>
            <h2>Customize</h2>
            <p>Changes apply instantly and are saved on this device.</p>
          </div>
          <button type="button" className="qc-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        <section>
          <h3>Look</h3>
          <label className="qc-row">
            <span className="qc-name">Calm mode<small>No moving background, glow or pulsing</small></span>
            <input type="checkbox" className="qc-switch" checked={p.calm} onChange={(e) => setPrefs({ calm: e.target.checked })} />
          </label>
          <div className="qc-row"><span className="qc-name">Text size</span><Seg k="textSize" opts={[['m', 'Standard'], ['l', 'Large'], ['xl', 'Extra large']]} /></div>
        </section>

        <section>
          <h3>Idea cards</h3>
          <div className="qc-row"><span className="qc-name">Density</span><Seg k="density" opts={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} /></div>
          <div className="qc-row"><span className="qc-name">Columns</span><Seg k="columns" opts={[['auto', 'Auto'], ['1', '1'], ['2', '2'], ['3', '3']]} /></div>
          <p className="qc-sub">Show on each card</p>
          <div className="qc-checks">
            {CARD_PARTS.map((c) => (
              <label key={c.id} className="qc-check" title={c.hint}>
                <input type="checkbox" checked={p.card[c.id]} onChange={(e) => setPrefs({ card: { ...p.card, [c.id]: e.target.checked } })} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <div className="qc-row"><span className="qc-name">Ideas shown first on a phone</span><Seg k="phoneCount" opts={[[6, '6'], [12, '12'], [0, 'All']]} /></div>
        </section>

        {railUi && setRail && (
          <section>
            <h3>Panels</h3>
            <p className="qc-sub">Market context (left column)</p>
            <Rail rail="left" items={LEFT_PANELS} />
            <p className="qc-sub">Developing (right column)</p>
            <Rail rail="right" items={RIGHT_PANELS} />
          </section>
        )}

        <button type="button" className="qc-reset" onClick={() => { resetPrefs(); if (setRail) { LEFT_PANELS.forEach((x) => setRail(x.id, null)); RIGHT_PANELS.forEach((x) => setRail(x.id, null)); setRail('heat', 'hidden'); setRail('prints', 'hidden'); } }}>
          <RotateCcw size={14} /> Reset to defaults
        </button>
      </div>
    </div>
  );
}

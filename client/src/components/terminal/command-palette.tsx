/**
 * COMMAND PALETTE — the ⌘K the topbar chip always promised. A centered
 * overlay: big input, the platform's own liquid universe answering as you
 * type (with the session's REAL change on every row), tab jumps, and your
 * recent symbols when the input is empty. Keyboard-first: ⌘K open, ↑↓ move,
 * Enter run, Esc out.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface SearchResult { symbol: string; name?: string; type?: string; changePct?: number | null }

type PaletteItem =
  | { kind: 'ticker'; symbol: string; name?: string; changePct?: number | null }
  | { kind: 'tab'; tab: string; label: string };

interface PaletteTab { id: string; label: string }

const readRecents = (): string[] => {
  try { return JSON.parse(localStorage.getItem('nx-recent-syms') || '[]'); } catch { return []; }
};
const pushRecent = (sym: string) => {
  try {
    const cur = readRecents().filter((s) => s !== sym);
    localStorage.setItem('nx-recent-syms', JSON.stringify([sym, ...cur].slice(0, 6)));
  } catch { /* private mode — recents are a convenience, not state */ }
};

export function CommandPalette({
  open, onClose, onTicker, onTab, tabs,
}: {
  open: boolean;
  onClose: () => void;
  onTicker: (symbol: string, name?: string) => void;
  onTab: (tab: string) => void;
  tabs: PaletteTab[];
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQuery(''); setCursor(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const q = query.trim().toUpperCase();
  const { data = [], isFetching } = useQuery<SearchResult[]>({
    queryKey: ['/api/search/symbols', q, 'palette'],
    queryFn: async () => {
      const r = await fetch(`/api/search/symbols?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      if (!r.ok) return [];
      const body = await r.json();
      return Array.isArray(body) ? body : body.results ?? [];
    },
    enabled: open && q.length > 0,
    staleTime: 60_000,
    retry: 0,
  });

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    if (q) {
      for (const t of tabs) {
        if (t.label.startsWith(q)) out.push({ kind: 'tab', tab: t.id, label: `Go to ${t.label}` });
      }
      for (const r of data.slice(0, 8)) out.push({ kind: 'ticker', symbol: r.symbol, name: r.name, changePct: r.changePct });
      if (!out.length && !isFetching) out.push({ kind: 'ticker', symbol: q, name: 'open directly' });
    } else {
      for (const s of readRecents()) out.push({ kind: 'ticker', symbol: s, name: 'recent' });
      if (!out.length) for (const t of tabs.slice(0, 4)) out.push({ kind: 'tab', tab: t.id, label: `Go to ${t.label}` });
    }
    return out;
  }, [q, data, isFetching, tabs]);

  useEffect(() => setCursor(0), [q]);

  const run = (item: PaletteItem) => {
    if (item.kind === 'tab') onTab(item.tab);
    else { pushRecent(item.symbol); onTicker(item.symbol, item.name); }
    onClose();
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(4,5,8,0.62)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '16vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(580px, 92vw)', background: 'var(--bg-2, #0a0c11)',
          border: '1px solid var(--nx-border, rgba(148,163,184,0.16))', borderRadius: 12,
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)', overflow: 'hidden',
          animation: 'pulse-slide 0.18s ease-out',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--nx-border, rgba(148,163,184,0.12))' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim, #8b93a7)" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((i) => Math.min(items.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((i) => Math.max(0, i - 1)); }
              if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
              if ((e.key === 'Enter' || e.key === 'Return') && items[cursor]) { e.preventDefault(); run(items[cursor]); }
            }}
            placeholder="Search any ticker, or jump to a tab…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text, #e8ecf3)', fontFamily: "'JetBrains Mono',monospace", fontSize: 14, letterSpacing: 0.5 }}
          />
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', border: '1px solid var(--nx-border, rgba(148,163,184,0.16))', borderRadius: 4, padding: '2px 6px' }}>ESC</span>
        </div>

        <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
          {!q && items.length > 0 && (
            <div style={{ padding: '8px 16px 2px', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mute)' }}>
              {readRecents().length ? 'Recent' : 'Jump to'}
            </div>
          )}
          {items.map((item, i) => (
            <div
              key={item.kind === 'tab' ? `t-${item.tab}` : `s-${item.symbol}-${i}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => run(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer',
                background: cursor === i ? 'rgba(34,211,238,0.08)' : 'transparent',
                borderLeft: cursor === i ? '2px solid var(--cyan-bright, #3b8cff)' : '2px solid transparent',
              }}
            >
              {item.kind === 'tab' ? (
                <>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: 'var(--cyan-bright, #3b8cff)' }}>→</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{item.label}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 8px)', letterSpacing: 1, color: 'var(--text-mute)', textTransform: 'uppercase' }}>tab</span>
                </>
              ) : (
                <>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, letterSpacing: 0.8, color: 'var(--text)', minWidth: 56 }}>{item.symbol}</span>
                  <span style={{
                    fontSize: 11, color: item.changePct != null ? (item.changePct >= 0 ? 'var(--green, #34d399)' : 'var(--red, #ff6b3d)') : 'var(--text-dim, #8b93a7)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                  }}>{item.name ?? ''}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 8px)', letterSpacing: 1, color: 'var(--text-mute)', textTransform: 'uppercase' }}>↵ workup</span>
                </>
              )}
            </div>
          ))}
          {q && isFetching && !items.length && (
            <div style={{ padding: '14px 16px', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)' }}>searching…</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 14, padding: '8px 16px', borderTop: '1px solid var(--nx-border, rgba(148,163,184,0.12))', fontFamily: "'JetBrains Mono',monospace", fontSize: 8.5, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-mute)' }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
          <span style={{ marginLeft: 'auto' }}>liquid universe · live change</span>
        </div>
      </div>
    </div>
  );
}

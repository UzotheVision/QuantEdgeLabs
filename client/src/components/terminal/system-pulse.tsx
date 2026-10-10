/**
 * SYSTEM PULSE — the bottombar heartbeat. Polls /api/pulse and shows the
 * machine's latest REAL action, sliding in as it happens; click opens the
 * full feed. No synthetic activity: a quiet machine shows its last real
 * event and an honest timestamp, not invented motion.
 */
import { useEffect, useRef, useState } from 'react';

interface PulseEvent { id: number; at: string; kind: string; msg: string }

const KIND_COLOR: Record<string, string> = {
  quant: 'var(--cyan-bright, #3b8cff)',
  pattern: 'var(--purple, #a78bfa)',
  flow: 'var(--amber, #facc15)',
  bot: 'var(--green, #34d399)',
  alert: 'var(--red, #ff6b3d)',
  gate: 'var(--amber, #facc15)',
  universe: 'var(--text-dim, #8b93a7)',
  news: 'var(--event, #fb923c)',
  gex: 'var(--gold, #fbbf24)',
  system: 'var(--text-dim, #8b93a7)',
};

const relTime = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
};

export function SystemPulse() {
  const [events, setEvents] = useState<PulseEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const lastId = useRef(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/pulse?since=0`, { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        if (!alive || !Array.isArray(d.events)) return;
        const newest = d.events[d.events.length - 1];
        if (newest && newest.id !== lastId.current) {
          if (lastId.current !== 0) { setFlash(true); setTimeout(() => setFlash(false), 500); }
          lastId.current = newest.id;
        }
        setEvents(d.events);
      } catch { /* quiet failure — pulse is decoration */ }
    };
    poll();
    const t = setInterval(poll, 7000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const latest = events[events.length - 1];

  return (
    <>
      <div
        className="bb-item"
        style={{ cursor: 'pointer', minWidth: 0, maxWidth: 420, overflow: 'hidden' }}
        onClick={() => setOpen(true)}
        title="System Pulse — every real action the engines take. Click for the full feed."
      >
        <span className="dot" style={{ background: latest ? KIND_COLOR[latest.kind] : undefined }} />
        {latest ? (
          <span
            key={latest.id}
            style={{
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              animation: flash ? 'pulse-slide 0.4s ease-out' : undefined,
            }}
          >
            <b style={{ color: KIND_COLOR[latest.kind] }}>{latest.kind}</b> {latest.msg}
            <span style={{ color: 'var(--text-mute)', marginLeft: 6 }}>{relTime(latest.at)}</span>
          </span>
        ) : (
          <span style={{ color: 'var(--text-mute)' }}>pulse: engines warming…</span>
        )}
      </div>

      {open && (
        <div className="chart-modal" onClick={() => setOpen(false)} style={{ zIndex: 90 }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(680px, 92vw)', maxHeight: '70vh', overflow: 'auto',
              background: 'var(--bg-2, #0a0c11)', border: '1px solid var(--nx-border, rgba(148,163,184,0.14))',
              borderRadius: 10, padding: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 14 }}>System Pulse</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)' }}>
                {events.length} real events held · newest first · nothing synthetic
              </div>
            </div>
            {[...events].reverse().map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--nx-border, rgba(148,163,184,0.08))' }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', minWidth: 34, textAlign: 'right' }}>{relTime(e.at)}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', fontWeight: 700, color: KIND_COLOR[e.kind], minWidth: 58, textTransform: 'uppercase' }}>{e.kind}</span>
                <span style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.4 }}>{e.msg}</span>
              </div>
            ))}
            {!events.length && <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>No events yet this session — the engines report here the moment they act.</div>}
          </div>
        </div>
      )}
    </>
  );
}

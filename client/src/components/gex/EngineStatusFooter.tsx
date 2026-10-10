/**
 * EngineStatusFooter — MomoEdge-style status bar
 * Displays at bottom of GEX/Terminal pages.
 * "● ORACLE ONLINE  UPTIME: 00:07:40  SIGNALS: 7 ACTIVE  ENGINE: SKYNET v3.2"
 */

import { useEffect, useState } from 'react';

interface Props {
  online?: boolean;
  marketState?: 'PRE' | 'OPEN' | 'AFTER' | 'CLOSED';
  signalsActive?: number;
  engineLabel?: string;
}

export function EngineStatusFooter({
  online = true,
  marketState = 'OPEN',
  signalsActive,
  engineLabel = 'CONVERGENCE v1.0'
}: Props) {
  const [uptime, setUptime] = useState('00:00:00');
  const [now, setNow] = useState<Date>(new Date());

  // Tick uptime each second
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
      const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
      const s = (elapsed % 60).toString().padStart(2, '0');
      setUptime(`${h}:${m}:${s}`);
      setNow(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const marketStateLabel = {
    PRE: 'PRE-MARKET',
    OPEN: 'MARKET OPEN',
    AFTER: 'AFTER-HOURS',
    CLOSED: 'MARKET CLOSED'
  }[marketState];

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 mt-6">
      <div className="max-w-7xl mx-auto px-6 py-2">
        <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className={online ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}>
                ORACLE {online ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">
              UPTIME: <span className="text-zinc-300">{uptime}</span>
            </span>
            {signalsActive !== undefined && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-500">
                  SIGNALS: <span className="text-sky-400">{signalsActive} ACTIVE</span>
                </span>
              </>
            )}
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">{marketStateLabel}</span>
          </div>
          <div className="flex items-center gap-4 text-zinc-500">
            <span>ENGINE: <span className="text-zinc-300">{engineLabel}</span></span>
            <span className="text-zinc-600">·</span>
            <span>{now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false })} ET</span>
          </div>
        </div>
      </div>
    </div>
  );
}

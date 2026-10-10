/**
 * SYSTEM PULSE — the platform narrating its own real work, as it happens.
 *
 * The design law forbids synthetic liveliness (no jitter, no fake activity),
 * but the machine genuinely does things all day: sweeps, publishes, blocks,
 * fills, alerts. This is the heartbeat feed that makes that visible — an
 * in-memory ring of REAL events, each recorded at the moment the work
 * happened, served to the shell's bottombar. An empty feed means a quiet
 * machine, and it is allowed to look quiet.
 */

export interface PulseEvent {
  id: number;
  at: string;             // ISO timestamp
  kind: 'quant' | 'pattern' | 'flow' | 'bot' | 'alert' | 'gate' | 'universe' | 'news' | 'gex' | 'system';
  msg: string;            // one plain-language line, already human-readable
}

const CAP = 200;
const ring: PulseEvent[] = [];
let nextId = 1;

/** Record a real event. Call at the moment the work completes, never speculatively. */
export function pulse(kind: PulseEvent['kind'], msg: string): void {
  ring.push({ id: nextId++, at: new Date().toISOString(), kind, msg: msg.slice(0, 160) });
  if (ring.length > CAP) ring.splice(0, ring.length - CAP);
}

/** Events after `since` (0 = everything held). Newest last. */
export function getPulse(since = 0): PulseEvent[] {
  return since > 0 ? ring.filter((e) => e.id > since) : [...ring];
}

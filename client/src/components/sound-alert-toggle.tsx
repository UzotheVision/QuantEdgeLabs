/**
 * SoundAlertToggle — Sound + Alert preferences in nav
 * Inspired by MomoEdge "🔔 ALERTS OFF / 🔊 SOUND OFF" toggles.
 *
 * Plays audio cues on:
 *   - New A+ Discovery push
 *   - Trade idea T1 hit
 *   - Market regime change
 *   - Stop loss approach
 *
 * Uses Web Audio API (no external library).
 */

import { useEffect, useState } from 'react';

interface AlertPreferences {
  soundEnabled: boolean;
  alertsEnabled: boolean;
  newSetupAlerts: boolean;
  tHitAlerts: boolean;
  regimeAlerts: boolean;
  stopAlerts: boolean;
}

const DEFAULT_PREFS: AlertPreferences = {
  soundEnabled: true,
  alertsEnabled: true,
  newSetupAlerts: true,
  tHitAlerts: true,
  regimeAlerts: true,
  stopAlerts: true
};

const STORAGE_KEY = 'quantedge-alert-prefs';

// ═══════════════════════════════════════════════════════════════
// AUDIO ENGINE — Web Audio API beep generator
// ═══════════════════════════════════════════════════════════════

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioContext;
}

function playBeep(freq: number, duration: number = 200, volume: number = 0.1): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.type = 'sine';
  oscillator.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration / 1000);
}

export const AlertSounds = {
  newSetup: () => { playBeep(800, 150); setTimeout(() => playBeep(1000, 150), 150); },
  t1Hit: () => { playBeep(1000, 100); setTimeout(() => playBeep(1200, 100), 100); setTimeout(() => playBeep(1500, 200), 200); },
  regimeChange: () => { playBeep(600, 300); setTimeout(() => playBeep(400, 300), 300); },
  stopWarning: () => { playBeep(400, 100); setTimeout(() => playBeep(300, 100), 100); setTimeout(() => playBeep(200, 200), 200); },
  click: () => { playBeep(800, 50, 0.05); }
};

// ═══════════════════════════════════════════════════════════════
// HOOK — useAlertPreferences()
// ═══════════════════════════════════════════════════════════════

export function useAlertPreferences() {
  const [prefs, setPrefs] = useState<AlertPreferences>(() => {
    if (typeof window === 'undefined') return DEFAULT_PREFS;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...DEFAULT_PREFS, ...JSON.parse(stored) } : DEFAULT_PREFS;
    } catch {
      return DEFAULT_PREFS;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const updatePref = <K extends keyof AlertPreferences>(key: K, value: AlertPreferences[K]) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
  };

  return { prefs, updatePref };
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT — toggle UI
// ═══════════════════════════════════════════════════════════════

interface Props {
  variant?: 'compact' | 'full';
}

export function SoundAlertToggle({ variant = 'compact' }: Props) {
  const { prefs, updatePref } = useAlertPreferences();
  const [showSettings, setShowSettings] = useState(false);

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1 relative">
        <button
          onClick={() => {
            updatePref('alertsEnabled', !prefs.alertsEnabled);
            if (!prefs.alertsEnabled) AlertSounds.click();
          }}
          className={`p-1.5 rounded transition-colors ${
            prefs.alertsEnabled ? 'text-sky-400 hover:bg-sky-500/10' : 'text-zinc-600 hover:bg-zinc-800'
          }`}
          title={prefs.alertsEnabled ? 'Alerts ON' : 'Alerts OFF'}
        >
          {prefs.alertsEnabled ? '🔔' : '🔕'}
        </button>
        <button
          onClick={() => {
            updatePref('soundEnabled', !prefs.soundEnabled);
            if (!prefs.soundEnabled) AlertSounds.click();
          }}
          className={`p-1.5 rounded transition-colors ${
            prefs.soundEnabled ? 'text-[var(--trade-bullish)] hover:bg-emerald-500/10' : 'text-zinc-600 hover:bg-zinc-800'
          }`}
          title={prefs.soundEnabled ? 'Sound ON' : 'Sound OFF'}
        >
          {prefs.soundEnabled ? '🔊' : '🔇'}
        </button>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-1.5 rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          title="Alert settings"
        >
          ⚙️
        </button>

        {showSettings && (
          <div className="absolute top-full right-0 mt-2 w-72 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl p-4 z-50">
            <div className="text-sm font-bold mb-3">Alert Settings</div>
            <div className="space-y-2">
              <ToggleRow
                label="Sound enabled"
                value={prefs.soundEnabled}
                onChange={(v) => updatePref('soundEnabled', v)}
                onTest={AlertSounds.click}
              />
              <ToggleRow
                label="Alerts enabled (master)"
                value={prefs.alertsEnabled}
                onChange={(v) => updatePref('alertsEnabled', v)}
              />
              <div className="border-t border-zinc-800 my-2" />
              <ToggleRow
                label="🎯 New Setup A+/A pushed"
                value={prefs.newSetupAlerts}
                onChange={(v) => updatePref('newSetupAlerts', v)}
                onTest={() => prefs.soundEnabled && AlertSounds.newSetup()}
                disabled={!prefs.alertsEnabled}
              />
              <ToggleRow
                label="🎯 T1 / T2 target hit"
                value={prefs.tHitAlerts}
                onChange={(v) => updatePref('tHitAlerts', v)}
                onTest={() => prefs.soundEnabled && AlertSounds.t1Hit()}
                disabled={!prefs.alertsEnabled}
              />
              <ToggleRow
                label="🌊 Market regime change"
                value={prefs.regimeAlerts}
                onChange={(v) => updatePref('regimeAlerts', v)}
                onTest={() => prefs.soundEnabled && AlertSounds.regimeChange()}
                disabled={!prefs.alertsEnabled}
              />
              <ToggleRow
                label="🛑 Stop loss approaching"
                value={prefs.stopAlerts}
                onChange={(v) => updatePref('stopAlerts', v)}
                onTest={() => prefs.soundEnabled && AlertSounds.stopWarning()}
                disabled={!prefs.alertsEnabled}
              />
            </div>
            <button
              onClick={() => setShowSettings(false)}
              className="mt-3 w-full text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300"
            >
              Close
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function ToggleRow({
  label, value, onChange, onTest, disabled
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  onTest?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${disabled ? 'opacity-40' : ''}`}>
      <span className="text-xs flex-1">{label}</span>
      {onTest && value && !disabled && (
        <button onClick={onTest} className="text-[10px] text-sky-400 hover:underline">test</button>
      )}
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className={`w-9 h-5 rounded-full relative transition-colors ${
          value ? 'bg-emerald-500/40' : 'bg-zinc-700'
        }`}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  );
}

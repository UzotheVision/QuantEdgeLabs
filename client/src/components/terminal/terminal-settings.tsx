/**
 * TERMINAL SETTINGS — the platform's personalization surface.
 *
 * All of this was already in the user_preferences table and none of it was reachable,
 * so every user saw an identical, un-tunable terminal. These settings are not cosmetic:
 * account size and risk-per-trade drive POSITION SIZING on every signal, horizon and
 * asset types filter what the stream shows, and density/motion change how it reads.
 *
 * Saves through the existing /api/preferences endpoint; nothing is stored client-side.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, Check, Loader2, Moon, Monitor, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { EASE, DUR } from '@/lib/motion';
import { TC } from '@/lib/design-tokens';
import { useTheme } from '@/components/theme-provider';

export interface UserPrefs {
  accountSize: number;
  maxRiskPerTrade: number;
  defaultOptionsBudget: number;
  preferredAssets: string[];
  holdingHorizon: string;
  layoutDensity: 'compact' | 'comfortable' | 'spacious';
  animationsEnabled: boolean;
  defaultViewMode: 'card' | 'table';
  theme?: 'dark' | 'night' | 'nexus';
}

const ASSETS = ['stock', 'option', 'crypto', 'futures'] as const;
const HORIZONS = ['intraday', 'swing', 'position'] as const;
const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;

export function useUserPrefs() {
  return useQuery<UserPrefs>({
    queryKey: ['/api/preferences'],
    queryFn: async () => {
      const r = await fetch('/api/preferences', { credentials: 'include' });
      if (!r.ok) throw new Error('prefs failed');
      return r.json();
    },
    staleTime: 300_000,
    retry: 1,
  });
}

export function TerminalSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const { data, isLoading } = useUserPrefs();
  const [draft, setDraft] = useState<Partial<UserPrefs>>({});
  const [saved, setSaved] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => { if (data) setDraft(data); }, [data]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const save = useMutation({
    mutationFn: async (patch: Partial<UserPrefs>) => {
      // apiRequest attaches the CSRF token; a raw fetch gets a 403 on mutations.
      const r = await apiRequest('PATCH', '/api/preferences', patch);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/api/preferences'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    },
  });

  const set = <K extends keyof UserPrefs>(k: K, v: UserPrefs[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setAppearance = (next: 'dark' | 'night' | 'nexus') => {
    setTheme(next);
    set('theme', next);
  };
  const risk$ = ((draft.accountSize ?? 0) * (draft.maxRiskPerTrade ?? 0)) / 100;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: DUR.fast }} onClick={onClose} />
          <motion.aside
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md overflow-y-auto border-l border-border/60 bg-card"
            initial={reduce ? false : { x: '100%' }} animate={{ x: 0 }} exit={reduce ? undefined : { x: '100%' }}
            transition={{ duration: DUR.base, ease: EASE }}
            role="dialog" aria-label="Terminal settings"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/40 bg-card px-4 py-3">
              <div>
                <div className="text-meta font-mono font-bold uppercase tracking-widest text-foreground">Settings</div>
                <div className="text-label font-mono text-muted-foreground">how the terminal works for you</div>
              </div>
              <button onClick={onClose} aria-label="Close settings"
                className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {isLoading ? (
              <div className="flex h-40 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-5 px-4 py-4">
                {/* ── risk: the settings that change the numbers ── */}
                <Section title="Risk" hint="drives position size on every signal">
                  <Field label="Account size">
                    <NumInput value={draft.accountSize ?? 0} onChange={(v) => set('accountSize', v)} prefix="$" step={500} />
                  </Field>
                  <Field label="Max risk per trade">
                    <NumInput value={draft.maxRiskPerTrade ?? 1} onChange={(v) => set('maxRiskPerTrade', v)} suffix="%" step={0.25} max={10} />
                  </Field>
                  <Field label="Options budget">
                    <NumInput value={draft.defaultOptionsBudget ?? 0} onChange={(v) => set('defaultOptionsBudget', v)} prefix="$" step={50} />
                  </Field>
                  <div className="rounded-lg border border-border/40 bg-foreground/[0.03] px-3 py-2">
                    <div className="text-label font-mono uppercase tracking-widest" style={{ color: TC.info }}>Risk budget</div>
                    <div className="mt-0.5 text-body font-mono text-foreground/85">
                      <b className="tabular-nums">${risk$.toFixed(0)}</b> per trade — every signal will size to this.
                    </div>
                  </div>
                </Section>

                {/* ── what you want to see ── */}
                <Section title="Signals" hint="what the stream shows you">
                  <Field label="Asset types">
                    <div className="flex flex-wrap gap-1">
                      {ASSETS.map((a) => {
                        const on = (draft.preferredAssets ?? []).includes(a);
                        return (
                          <button key={a} onClick={() => set('preferredAssets',
                            on ? (draft.preferredAssets ?? []).filter((x) => x !== a) : [...(draft.preferredAssets ?? []), a])}
                            className={cn('cursor-pointer rounded px-2 py-1 text-label font-mono uppercase tracking-wider transition-colors',
                              on ? 'bg-[var(--brand-cyan,#3b8cff)]/15 text-[var(--brand-cyan,#3b8cff)]' : 'bg-foreground/5 text-muted-foreground hover:text-foreground')}>
                            {a}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                  <Field label="Holding horizon">
                    <Seg options={HORIZONS} value={draft.holdingHorizon ?? 'swing'} onChange={(v) => set('holdingHorizon', v)} />
                  </Field>
                  <Field label="Default view">
                    <Seg options={['card', 'table'] as const} value={draft.defaultViewMode ?? 'card'} onChange={(v) => set('defaultViewMode', v as any)} />
                  </Field>
                </Section>

                {/* ── how it reads ── */}
                <Section title="Display">
                  <Field label="Appearance">
                    <span className="flex items-center gap-0.5 rounded bg-foreground/5 p-0.5">
                      <button onClick={() => setAppearance('dark')}
                        className={cn('flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-label font-mono uppercase tracking-wider transition-colors',
                          theme !== 'night' && theme !== 'nexus' ? 'bg-foreground/10 text-[var(--brand-cyan,#3b8cff)]' : 'text-muted-foreground hover:text-foreground')}>
                        <Monitor className="h-3 w-3" /> Terminal
                      </button>
                      <button onClick={() => setAppearance('night')}
                        className={cn('flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-label font-mono uppercase tracking-wider transition-colors',
                          theme === 'night' ? 'bg-foreground/10 text-[var(--brand-cyan,#3b8cff)]' : 'text-muted-foreground hover:text-foreground')}>
                        <Moon className="h-3 w-3" /> Night
                      </button>
                      {/* The reference-terminal palette, verbatim — see .terminal-nexus in index.css */}
                      <button onClick={() => setAppearance('nexus')}
                        className={cn('flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-label font-mono uppercase tracking-wider transition-colors',
                          theme === 'nexus' ? 'bg-foreground/10 text-[var(--brand-cyan,#3b8cff)]' : 'text-muted-foreground hover:text-foreground')}>
                        <Zap className="h-3 w-3" /> Nexus
                      </button>
                    </span>
                  </Field>
                  <Field label="Density">
                    <Seg options={DENSITIES} value={draft.layoutDensity ?? 'comfortable'} onChange={(v) => set('layoutDensity', v as any)} />
                  </Field>
                  <Field label="Animations">
                    <Toggle on={draft.animationsEnabled ?? true} onChange={(v) => set('animationsEnabled', v)} />
                  </Field>
                </Section>

                <button
                  onClick={() => save.mutate(draft)}
                  disabled={save.isPending}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[var(--brand-cyan,#3b8cff)] px-3 py-2 text-meta font-mono font-bold uppercase tracking-wider text-background transition-opacity disabled:opacity-60"
                >
                  {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
                  {save.isPending ? 'Saving' : saved ? 'Saved' : 'Save settings'}
                </button>
                {save.isError && (
                  <p className="text-label font-mono" style={{ color: TC.bear }}>Could not save — {String((save.error as Error)?.message).slice(0, 90)}</p>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-label font-mono font-bold uppercase tracking-widest text-foreground/80">{title}</span>
        {hint && <span className="text-label font-mono text-muted-foreground">{hint}</span>}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-meta font-mono text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, prefix, suffix, step = 1, max }: {
  value: number; onChange: (v: number) => void; prefix?: string; suffix?: string; step?: number; max?: number;
}) {
  return (
    <span className="flex items-center gap-1 rounded border border-border/60 bg-background/60 px-2 py-1">
      {prefix && <span className="text-label font-mono text-muted-foreground">{prefix}</span>}
      <input
        type="number" value={value} step={step} max={max} min={0}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="w-20 bg-transparent text-right text-meta font-mono tabular-nums text-foreground outline-none"
      />
      {suffix && <span className="text-label font-mono text-muted-foreground">{suffix}</span>}
    </span>
  );
}

function Seg<T extends string>({ options, value, onChange }: { options: readonly T[]; value: string; onChange: (v: T) => void }) {
  return (
    <span className="flex items-center gap-0.5 rounded bg-foreground/5 p-0.5">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          className={cn('cursor-pointer rounded px-2 py-0.5 text-label font-mono uppercase tracking-wider transition-colors',
            value === o ? 'bg-foreground/10 text-[var(--brand-cyan,#3b8cff)]' : 'text-muted-foreground hover:text-foreground')}>
          {o}
        </button>
      ))}
    </span>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label="Toggle animations"
      className={cn('relative h-5 w-9 cursor-pointer rounded-full transition-colors', on ? 'bg-[var(--brand-cyan,#3b8cff)]' : 'bg-foreground/15')}>
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

/**
 * Layout density — the SPACING axis (compact default | comfortable | spacious),
 * distinct from content verbosity (hooks/use-content-density.tsx). Writes
 * `data-density` onto <html> so the CSS spacing tokens in index.css
 * ([data-density='...']) drive row height / card padding / grid gaps
 * platform-wide. Persisted per user. Compact is the Bloomberg-dense default.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type LayoutDensity = 'compact' | 'comfortable' | 'spacious';
const KEY = 'qe:density';

interface DensityCtx {
  density: LayoutDensity;
  setDensity: (d: LayoutDensity) => void;
}
const Ctx = createContext<DensityCtx | null>(null);

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensity] = useState<LayoutDensity>(() => {
    try {
      const v = localStorage.getItem(KEY) as LayoutDensity | null;
      return v === 'comfortable' || v === 'spacious' ? v : 'compact';
    } catch {
      return 'compact';
    }
  });
  useEffect(() => {
    try {
      document.documentElement.dataset.density = density;
      localStorage.setItem(KEY, density);
    } catch {
      /* private mode / SSR */
    }
  }, [density]);
  return <Ctx.Provider value={{ density, setDensity }}>{children}</Ctx.Provider>;
}

export function useDensity(): DensityCtx {
  return useContext(Ctx) ?? { density: 'compact', setDensity: () => {} };
}

const OPTIONS: { id: LayoutDensity; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Cozy' },
  { id: 'spacious', label: 'Roomy' },
];

export function QEDensityToggle({ className }: { className?: string }) {
  const { density, setDensity } = useDensity();
  return (
    <div className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5', className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => setDensity(o.id)}
          className={cn(
            'px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded transition-colors',
            density === o.id
              ? 'bg-[var(--brand-cyan)] text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
          title={`${o.label} density`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

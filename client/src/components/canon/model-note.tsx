/**
 * CANON · MODEL NOTE
 *
 * Separates what was MEASURED from what was ASSUMED, on any surface whose output
 * depends on a model the data cannot verify.
 *
 * The pattern already exists in two places and nowhere else: the Flow header
 * ("Direction is NOT measured on this feed…") and the Prism read ("Dealer sign
 * is an assumption, not an observation"). Both were written because a directional
 * inference was rendering as though it were an observation.
 *
 * The rule this encodes is worth stating plainly: state which half of your output
 * is inference. Gamma magnitude at a strike is measured from open interest and is
 * solid; the dealer's SIGN is a model. Flow premium is measured; the direction of
 * that premium is not. Showing both with equal confidence is the failure.
 */
import { cn } from '@/lib/utils';

export function CanonModelNote({
  children,
  tone = 'model',
  className,
}: {
  children: React.ReactNode;
  /** 'model' = an assumption is in play. 'gap' = data is structurally absent. */
  tone?: 'model' | 'gap';
  className?: string;
}) {
  const color = tone === 'model' ? 'var(--brand-gold)' : 'var(--muted-foreground)';
  return (
    <div
      className={cn('flex items-start gap-2 rounded border px-2.5 py-1.5', className)}
      style={{
        borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
        background: `color-mix(in srgb, ${color} 5%, transparent)`,
      }}
    >
      <span
        className="mt-px shrink-0 font-mono text-label font-bold uppercase tracking-wider"
        style={{ color }}
      >
        {tone === 'model' ? 'Model' : 'Gap'}
      </span>
      <span className="text-label leading-relaxed text-muted-foreground">{children}</span>
    </div>
  );
}

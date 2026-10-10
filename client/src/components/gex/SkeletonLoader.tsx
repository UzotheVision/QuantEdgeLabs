/**
 * SkeletonLoader — shimmer placeholder for loading states
 * Replaces blanks during fetch to avoid the "half-baked" feel.
 */

interface Props {
  variant?: 'card' | 'row' | 'metric' | 'header' | 'grid';
  count?: number;
}

export function SkeletonLoader({ variant = 'card', count = 1 }: Props) {
  if (variant === 'card') {
    return (
      <>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4 animate-pulse">
            <div className="h-3 bg-zinc-800 rounded w-1/3 mb-3" />
            <div className="h-6 bg-zinc-800 rounded w-1/2 mb-2" />
            <div className="h-3 bg-zinc-800 rounded w-2/3" />
          </div>
        ))}
      </>
    );
  }

  if (variant === 'row') {
    return (
      <>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-2 animate-pulse">
            <div className="w-12 h-3 bg-zinc-800 rounded" />
            <div className="flex-1 h-3 bg-zinc-800 rounded" />
            <div className="w-16 h-3 bg-zinc-800 rounded" />
          </div>
        ))}
      </>
    );
  }

  if (variant === 'metric') {
    return (
      <div className="animate-pulse">
        <div className="h-2.5 bg-zinc-800 rounded w-16 mb-1.5" />
        <div className="h-5 bg-zinc-800 rounded w-20" />
      </div>
    );
  }

  if (variant === 'header') {
    return (
      <div className="animate-pulse mb-4">
        <div className="h-6 bg-zinc-800 rounded w-1/2 mb-2" />
        <div className="h-3 bg-zinc-800 rounded w-3/4" />
      </div>
    );
  }

  // grid
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
      {Array.from({ length: count * 4 }).map((_, i) => (
        <div key={i} className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
          <div className="h-2.5 bg-zinc-800 rounded w-1/2 mb-2" />
          <div className="h-5 bg-zinc-800 rounded w-3/4" />
        </div>
      ))}
    </div>
  );
}

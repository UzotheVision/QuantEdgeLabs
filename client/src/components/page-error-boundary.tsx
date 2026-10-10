/**
 * PageErrorBoundary — catches React render errors so one broken card
 * doesn't blank-screen the entire page. Shows a recovery UI with
 * the actual error + "retry" button.
 *
 * Use ONE per page (wraps everything) and/or wrap individual cards
 * for finer-grained isolation.
 */

import { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;          // e.g. "Market Pulse" or "Discovery Picks"
  onReset?: () => void;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ error, errorInfo });
    // Log to console for debugging — production should ship to Sentry/etc.
    console.error(`[ErrorBoundary] ${this.props.label || 'page'} crashed:`, error, errorInfo);
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="bg-red-500/5 border border-red-500/30 rounded-lg p-4 my-3">
          <div className="flex items-start gap-3">
            <div className="text-2xl">⚠️</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-[var(--trade-bearish)]">
                {this.props.label || 'Component'} crashed
              </div>
              <div className="text-xs text-zinc-400 mt-1 font-mono break-all">
                {this.state.error.message}
              </div>
              <details className="mt-2">
                <summary className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300">
                  Show stack trace
                </summary>
                <pre className="mt-2 text-[9px] text-zinc-500 font-mono whitespace-pre-wrap max-h-40 overflow-auto bg-zinc-950/50 p-2 rounded">
                  {this.state.error.stack}
                </pre>
              </details>
              <button
                onClick={this.reset}
                className="mt-3 text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200 border border-zinc-700"
              >
                ↻ Retry
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════
// CardErrorBoundary — minimal inline version for individual cards
// ═══════════════════════════════════════════════════════════════
export function CardErrorBoundary({
  children,
  label
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <PageErrorBoundary
      label={label}
      fallback={
        <div className="bg-zinc-900/40 border border-red-500/20 rounded p-2 text-xs text-[var(--trade-bearish)] italic">
          ⚠️ {label || 'Card'} failed to render
        </div>
      }
    >
      {children}
    </PageErrorBoundary>
  );
}

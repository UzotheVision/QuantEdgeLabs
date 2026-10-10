import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isChunkError: boolean;
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("dynamically imported module") ||
    msg.includes("failed to load module script")
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      isChunkError: isChunkLoadError(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('=== ERROR BOUNDARY CAUGHT ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('Component Stack:', errorInfo.componentStack);
    console.error('============================');

    this.setState({ error, errorInfo });

    // For chunk load errors, auto-reload after a short delay
    // This handles the case where a new deployment changed chunk hashes
    if (isChunkLoadError(error)) {
      const reloadKey = "error_boundary_reload";
      const hasReloaded = sessionStorage.getItem(reloadKey);
      if (!hasReloaded) {
        sessionStorage.setItem(reloadKey, "1");
        // Small delay so the user sees we're handling it
        setTimeout(() => window.location.reload(), 1500);
      } else {
        // Already tried auto-reload, clear flag so next time works
        sessionStorage.removeItem(reloadKey);
      }
    }
  }

  render() {
    if (this.state.hasError) {
      // Friendly UI for chunk load errors (stale deployment)
      if (this.state.isChunkError) {
        return (
          <div className="min-h-screen bg-card text-white flex items-center justify-center p-8">
            <div className="max-w-md text-center">
              <div className="mb-6">
                <svg className="h-16 w-16 mx-auto text-sky-400 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-white mb-2">Updating Quant Edge...</h1>
              <p className="text-muted-foreground mb-6 text-sm">
                A new version was deployed. Refreshing to load the latest build.
              </p>
              <button
                onClick={() => {
                  sessionStorage.removeItem("error_boundary_reload");
                  window.location.reload();
                }}
                className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 rounded-lg font-medium transition-colors"
              >
                Reload Now
              </button>
            </div>
          </div>
        );
      }

      // Generic error UI for non-chunk errors
      return (
        <div className="min-h-screen bg-card text-white p-8">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-[var(--trade-bearish)] mb-4">Something went wrong</h1>
            <div className="bg-muted rounded-lg p-4 mb-4">
              <h2 className="text-lg font-semibold text-[var(--trade-bearish)] mb-2">Error Message:</h2>
              <pre className="text-sm text-[var(--trade-bearish)] whitespace-pre-wrap break-all">
                {this.state.error?.message}
              </pre>
            </div>
            <div className="bg-muted rounded-lg p-4 mb-4">
              <h2 className="text-lg font-semibold text-yellow-400 mb-2">Stack Trace:</h2>
              <pre className="text-xs text-foreground/80 whitespace-pre-wrap break-all overflow-auto max-h-64">
                {this.state.error?.stack}
              </pre>
            </div>
            <div className="bg-muted rounded-lg p-4">
              <h2 className="text-lg font-semibold text-sky-400 mb-2">Component Stack:</h2>
              <pre className="text-xs text-foreground/80 whitespace-pre-wrap break-all overflow-auto max-h-64">
                {this.state.errorInfo?.componentStack}
              </pre>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

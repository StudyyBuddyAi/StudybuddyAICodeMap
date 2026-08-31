import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Shown instead of the default panel. Receives a retry that clears the error. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Remounts the boundary's subtree when this changes — e.g. the route path. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * The app had no error boundary of any kind: no `componentDidCatch`, no
 * `errorElement`. `App` wraps its lazy routes in `Suspense` with a loading
 * fallback but no error path, so any throw inside a route chunk — including a
 * failed chunk fetch on a flaky connection — unmounted the tree and left a
 * white screen with nothing to click.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // A new route should get a clean slate rather than inheriting the last
    // route's error panel.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled error in render tree:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        role="alert"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Something went wrong on this page
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Your saved sheets and decks are unaffected. Try again, or head back
            to the dashboard.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={this.reset}
            className="h-10 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="h-10 rounded-lg border border-border px-5 text-sm font-medium leading-10 text-foreground transition-colors hover:bg-secondary"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;

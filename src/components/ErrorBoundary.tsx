import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

/** Keeps one broken panel (e.g. an unexpected API shape) from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
          <TriangleAlert className="size-6" />
        </div>
        <p className="font-semibold">This panel hit an error</p>
        <pre className="selectable max-w-full overflow-auto rounded-lg bg-panel-2 px-3 py-2 text-left text-xs text-muted">
          {this.state.error.message}
        </pre>
      </div>
    );
  }
}

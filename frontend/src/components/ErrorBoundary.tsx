import { Component, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

type ErrorBoundaryProps = {
  children: ReactNode;
  title?: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Keep this in the console for debugging in dev, but show a readable UI to users.
    // eslint-disable-next-line no-console
    console.error('[ui] render error', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const title = this.props.title || 'Etwas ist schiefgelaufen';
    const message = error?.message || 'Unbekannter Fehler';

    return (
      <div className="flex h-full min-h-[50vh] w-full items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl border border-rose-500/20 bg-rose-500/10 p-6 text-rose-50">
          <p className="text-lg font-semibold">{title}</p>
          <p className="mt-2 text-sm text-rose-100/90">{message}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                this.setState({ error: null });
              }}
            >
              Weiter
            </Button>
            <Button
              variant="default"
              onClick={() => {
                window.location.reload();
              }}
            >
              Neu laden
            </Button>
          </div>

          {error.stack ? (
            <details className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-200">
              <summary className="cursor-pointer text-zinc-100">Details</summary>
              <pre className="mt-2 whitespace-pre-wrap">{error.stack}</pre>
            </details>
          ) : null}
        </div>
      </div>
    );
  }
}


import React from 'react';
import { TriangleAlert, RotateCw } from 'lucide-react';

/**
 * Last line of defence for the window.
 *
 * `protocol.normalize.ts` is where malformed frames are supposed to be neutralised, and every known
 * malformed-frame fixture is graded against it. This exists for the unknown one: without a
 * boundary, a single render exception unmounts the tree and the user is left looking at a black
 * rectangle with no way to tell whether Bimax crashed, hung, or is still working.
 *
 * It deliberately does not try to auto-recover. A re-render loop over the same bad state would
 * flash the screen; the user gets an honest statement, the message, and one explicit retry.
 */
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  public state: State = { error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The engine log is the app's own record; the renderer has no channel of its own for this.
    console.error('[renderer] unrecoverable render error', error, info.componentStack);
  }

  public render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
        <TriangleAlert size={24} className="text-amber" />
        <h1 className="text-[15px] font-semibold text-ink">Bimax could not draw this screen</h1>
        <p className="max-w-[440px] text-[12.5px] leading-relaxed text-dim">
          Your work is safe — tasks and changes live outside this window. Reloading rebuilds the
          view from the task Bimax already has.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-ember px-3 py-1.5 text-[12px] font-medium text-bg hover:bg-ember-bright focus-visible:outline-2 focus-visible:outline-ember"
        >
          <RotateCw size={12} /> Reload the view
        </button>
        <details className="mt-1 max-w-[520px] text-[10.5px] text-faint">
          <summary className="cursor-pointer">Technical detail</summary>
          <pre className="mt-1 overflow-x-auto rounded-md bg-well p-2 text-left font-mono text-[10px] whitespace-pre-wrap text-dim">
            {error.message}
          </pre>
        </details>
      </div>
    );
  }
}

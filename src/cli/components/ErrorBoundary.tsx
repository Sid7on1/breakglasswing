import React from 'react';
import { Box, Text } from 'ink';
import { cliEvents } from '../events';
import { ThemeColors } from '../themes';

interface Props {
  // Provided via createElement's third argument; optional so the JSX/createElement overload
  // that supplies children positionally type-checks.
  children?: React.ReactNode;
  theme: ThemeColors;
}
interface State {
  error: Error | null;
}

/**
 * Top-level React error boundary. Without one, a single render-time throw in any component
 * tears down the whole Ink tree and kills the session. This catches it, logs the error
 * (so it lands in the Ctrl+O log panel), and renders a visible fallback so the user keeps
 * their terminal and can read what happened. Modeled on Claude Code's SentryErrorBoundary,
 * but with a logged, user-visible fallback rather than a silent null render.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Best-effort: surface to the log stream. cliEvents is a module singleton, so it is
    // reachable even though the component tree below us has failed.
    try {
      cliEvents.emit('log', {
        id: Date.now() + Math.random(),
        level: 'error',
        text: `UI crashed: ${error.message}`,
        timestamp: new Date(),
      });
      cliEvents.emit('log', {
        id: Date.now() + Math.random(),
        level: 'debug',
        text: (info.componentStack || '').trim().split('\n').slice(0, 4).join('\n'),
        timestamp: new Date(),
      });
    } catch { /* logging is best-effort */ }
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      const { theme } = this.props;
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor={theme.error}>
          <Text color={theme.error} bold>✖ The interface hit an unexpected error.</Text>
          <Text color={theme.text}>{error.message}</Text>
          <Box marginTop={1}>
            <Text color={theme.subtle}>Your session is intact. Press Ctrl+C to exit, or restart bimax.</Text>
          </Box>
        </Box>
      );
    }
    return this.props.children;
  }
}

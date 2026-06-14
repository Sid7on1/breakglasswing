import React from 'react';
import { Box, Text } from 'ink';
import { ThemeColors } from '../themes';
import { GraphSummary } from '../../graph/graph.summary';

interface CodebaseMapPanelProps {
  theme: ThemeColors;
  summary: GraphSummary;
  topN?: number;
}

const CRIT_COLOR = (theme: ThemeColors, crit?: string): string => {
  if (crit === 'CRITICAL') return theme.error;
  if (crit === 'HIGH') return theme.warning;
  if (crit === 'MEDIUM') return theme.accent;
  return theme.inactive;
};

// Compact, right-aligned overview of the codebase map graph, pinned just above the input.
// Proof that a map was generated + a top-level view of the most critical modules. Kept small
// so it never crowds out the prompt; the FullScreen streaming budget reserves rows for it.
export function CodebaseMapPanel({ theme, summary, topN = 4 }: CodebaseMapPanelProps) {
  const modules = summary.topModules.slice(0, topN);
  return (
    <Box justifyContent="flex-end" marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={theme.promptBorder} paddingX={1}>
        <Text color={theme.subtle}>
          Codebase Map · <Text color={theme.inactive}>{summary.nodeCount} nodes · {summary.fileCount} files</Text>
        </Text>
        {modules.length > 0 && (
          <>
            <Text color={theme.subtle}>top modules (by criticality)</Text>
            {modules.map((m, i) => (
              <Box key={`${m.filePath || m.name}-${i}`} flexDirection="row">
                <Text color={CRIT_COLOR(theme, m.criticality)}>{m.criticality ? '● ' : '○ '}</Text>
                <Text color={theme.inactive}>{m.name}</Text>
                {m.criticality ? <Text color={theme.subtle}>  {m.criticality}</Text> : null}
              </Box>
            ))}
          </>
        )}
        <Text color={theme.subtle}>
          AI graph: {summary.aiGraphBuilt
            ? <Text color={theme.success}>✓</Text>
            : <Text color={theme.inactive}>✗ (run /index-ai)</Text>}
        </Text>
      </Box>
    </Box>
  );
}

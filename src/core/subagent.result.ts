export interface SubAgentResultEnvelope {
  version: 1;
  taskId: string;
  outcomeTaskId?: string;
  agentType: string;
  report: string;
  claimedScope: string;
  /** Authoritative parent-side Git inspection; never copied from model prose. */
  observedChangedFiles: string[];
  startedAt: number;
  endedAt: number;
  toolCalls: number;
  isolation?: {
    kind: 'worktree';
    repoRoot: string;
    path: string;
    branch: string;
    baseCommit: string;
    state: 'pending_integration';
  };
}

export function formatSubAgentResult(result: SubAgentResultEnvelope): string {
  const manifest = result.observedChangedFiles.length
    ? `\n\nChanged files (engine-observed):\n${result.observedChangedFiles.map(file => `- ${file}`).join('\n')}`
    : '';
  const isolation = result.isolation
    ? `\n\nIntegration pending: merge ${result.isolation.branch} from ${result.isolation.path}, then confirm integration against the parent checkout.`
    : '';
  return `${result.report}${manifest}${isolation}`;
}

import { globalCommandRegistry } from './registry';
import { globalSubAgentBlackboard, SubAgentClaim } from '../../core/subagent.blackboard';

const ICON: Record<SubAgentClaim['status'], string> = { running: '◍', done: '✓', failed: '✗' };

function fmtAge(c: SubAgentClaim): string {
  const ms = (c.endedAt ?? Date.now()) - c.startedAt;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

export function renderSubagents(claims: SubAgentClaim[]): string {
  if (claims.length === 0) return '● **Sub-agents**\n\n  None spawned this session.';
  const running = claims.filter(c => c.status === 'running').length;
  const lines = ['● **Sub-agents** — ' + `${running} running · ${claims.length} total`, ''];
  for (const c of claims) {
    lines.push(`  ${ICON[c.status]} **${c.agentType}** · \`${c.scope}\` · ${c.toolCalls} tool calls · ${fmtAge(c)}`);
    lines.push(`     ${c.prompt}`);
    if (c.status === 'failed' && c.error) lines.push(`     ✗ ${c.error.slice(0, 160)}`);
  }
  return lines.join('\n');
}

globalCommandRegistry.register({
  name: '/subagents',
  description: 'Live sub-agent coverage — who is running, their scope, and status',
  category: 'Code & Intelligence',
  execute: async () => {
    globalSubAgentBlackboard.prune();
    return { type: 'message', level: 'info', content: renderSubagents(globalSubAgentBlackboard.all()) };
  },
});

const AGENT_COLORS = [
  'agentRed', 'agentBlue', 'agentGreen', 'agentYellow',
  'agentPurple', 'agentOrange', 'agentPink', 'agentCyan',
] as const;

export type AgentColorName = (typeof AGENT_COLORS)[number];

const assignedColors = new Map<string, AgentColorName>();
let colorIndex = 0;

export function assignSubAgentColor(agentId: string): AgentColorName {
  if (assignedColors.has(agentId)) {
    return assignedColors.get(agentId)!;
  }
  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length];
  colorIndex++;
  assignedColors.set(agentId, color);
  return color;
}

export function releaseSubAgentColor(agentId: string) {
  assignedColors.delete(agentId);
}

export function getSubAgentColor(agentId: string): AgentColorName | undefined {
  return assignedColors.get(agentId);
}

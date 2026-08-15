import type { CapabilityGovernor } from './provider.policy';

export interface CapabilityTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  isDestructive?: boolean;
  isConcurrencySafe?: boolean;
  approvalHandledInternally?: boolean;
  execute(args: Record<string, unknown>, context?: unknown): Promise<string>;
}

export function buildCapabilityTool(definition: CapabilityTool, _governor: CapabilityGovernor): CapabilityTool {
  return definition;
}


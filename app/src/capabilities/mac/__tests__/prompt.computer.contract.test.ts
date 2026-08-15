import { buildComputerUseModelPrompt, computerUsePlaybookFor } from '../playbook';

describe('Desktop model prompt contract', () => {
  it('keeps universal target-lock and evidence guidance on Desktop turns', () => {
    const playbook = computerUsePlaybookFor('open Notes');
    expect(playbook).toContain('TARGET LOCK');
    expect(playbook).toContain('EVIDENCE');
    expect(playbook).toContain('postcondition evidence');
  });

  it('requires post-request provider evidence and does not treat memory as proof', () => {
    const prompt = buildComputerUseModelPrompt('open Notes', { toolName: 'mcp__desktop__mac_control' });
    expect(prompt).toContain('mcp__desktop__mac_control results produced after this request');
    expect(prompt).toContain('Prior shell, browser, assistant, memory, and tool values are not evidence');
  });

  it('uses native receipts as the evidence authority for native specialist tools', () => {
    const prompt = buildComputerUseModelPrompt('click Save', { native: true });
    expect(prompt).toContain('native snapshots, receipts, and captures');
  });
});

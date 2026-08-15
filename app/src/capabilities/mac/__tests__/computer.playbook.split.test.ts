import {
  buildComputerUseModelPrompt,
  computerUsePlaybookFor,
  shouldUseFlashComputerPlaybook,
} from '../playbook';

describe('Desktop playbook split', () => {
  it('injects scenario guidance only when the request implicates it', () => {
    expect(computerUsePlaybookFor('arrange Notes and Safari side by side')).toContain('ARRANGING WINDOWS');
    expect(computerUsePlaybookFor('read the frontmost window')).not.toContain('ARRANGING WINDOWS');
  });

  it('names the actual dynamically registered provider tool in the fresh-evidence rule', () => {
    const prompt = buildComputerUseModelPrompt('open Notes', { toolName: 'mcp__host__mac_control' });
    expect(prompt).toContain('mcp__host__mac_control results produced after this request');
    expect(prompt).not.toContain('ComputerTool results produced after this request');
  });

  it('selects the compact controller for small model identifiers', () => {
    expect(shouldUseFlashComputerPlaybook('local-12b')).toBe(true);
    expect(shouldUseFlashComputerPlaybook('nvidia/nemotron-3-nano-30b-a3b')).toBe(true);
    expect(shouldUseFlashComputerPlaybook('large-70b')).toBe(false);
  });
});

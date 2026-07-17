import { Governor } from '../governor/governor';
import { GovernorVetoError } from '../core/errors';
import { EventBus } from '../core/event.bus';
import { GlobalPrompter } from '../cli/prompter';
import * as path from 'path';
import * as fs from 'fs/promises';

jest.mock('../cli/prompter', () => ({
  GlobalPrompter: {
    ask: jest.fn().mockResolvedValue('y'),
    isBusy: jest.fn().mockReturnValue(false),
    register: jest.fn(),
  }
}));

describe('Governor', () => {
  let governor: Governor;

  beforeEach(async () => {
    await fs.rm(path.join(process.cwd(), '.breakglass/credits'), { recursive: true, force: true }).catch(() => undefined);
    const eventBus = new EventBus();
    governor = new Governor(eventBus);
  });

  describe('FileSystemVeto', () => {
    it('allows valid paths', async () => {
      const validPath = path.join(process.cwd(), 'valid.txt');
      await expect(governor.approveTaskExecution('FILE_WRITE', { targetPath: validPath })).resolves.toBeUndefined();
    });

    it('blocks outside workspace', async () => {
      const invalidPath = '/etc/passwd';
      await expect(governor.approveTaskExecution('FILE_WRITE', { targetPath: invalidPath }))
        .rejects.toThrow(GovernorVetoError);
    });

    it('blocks forbidden extensions', async () => {
      const invalidPath = path.join(process.cwd(), 'secret.pem');
      await expect(governor.approveTaskExecution('FILE_WRITE', { targetPath: invalidPath }))
        .rejects.toThrow(GovernorVetoError);
    });

    it('blocks sibling directories that share the workspace prefix', async () => {
      // e.g. workspace is /work and the target is /work-evil/x.txt — must be rejected
      const siblingPath = process.cwd() + '-evil' + path.sep + 'x.txt';
      await expect(governor.approveTaskExecution('FILE_WRITE', { targetPath: siblingPath }))
        .rejects.toThrow(GovernorVetoError);
    });
  });

  describe('BudgetVeto', () => {
    it('allows within budget', async () => {
      await expect(governor.approveTaskExecution('API_CALL', { estimatedCost: 1.0 })).resolves.toBeUndefined();
    });

    it('blocks over budget', async () => {
      await governor.budget.recordSpend(4.5);
      await expect(governor.approveTaskExecution('API_CALL', { estimatedCost: 1.0 }))
        .rejects.toThrow(GovernorVetoError);
    });
  });

  describe('Computer and external tool control', () => {
    it('asks for destructive generic and computer-control tools', async () => {
      await governor.approveTaskExecution('COMPUTER_CONTROL', { tool: 'BrowserTool', action: 'click', isDestructive: true });
      await governor.approveTaskExecution('TOOL_EXECUTION', { tool: 'mcp__desktop__click', isDestructive: true });
      expect(GlobalPrompter.ask).toHaveBeenCalledWith(expect.stringContaining('BrowserTool'), expect.any(Array));
      expect(GlobalPrompter.ask).toHaveBeenCalledWith(expect.stringContaining('mcp__desktop__click'), expect.any(Array));
    });

    it('blocks destructive computer control in plan mode', async () => {
      governor.mode = 'plan';
      await expect(governor.approveTaskExecution('COMPUTER_CONTROL', {
        tool: 'BrowserTool', action: 'click', isDestructive: true,
      })).rejects.toThrow(GovernorVetoError);
    });
  });
});

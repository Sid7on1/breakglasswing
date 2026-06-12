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
    try {
      await fs.rm(path.join(process.cwd(), '.breakglass/credits'), { recursive: true, force: true });
    } catch (e) {}
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
});

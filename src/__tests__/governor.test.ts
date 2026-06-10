import { Governor } from '../governor/governor';
import { GovernorVetoError } from '../core/errors';
import { EventBus } from '../core/event.bus';
import * as path from 'path';

describe('Governor', () => {
  let governor: Governor;

  beforeEach(async () => {
    try {
      await require('fs/promises').rm(path.join(process.cwd(), '.breakglass_credits'), { recursive: true, force: true });
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

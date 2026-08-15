import { loadMacCapabilityConfig } from '../config';

describe('live target preview boundary', () => {
  const prior = process.env.BIMAX_COMPUTER_PIP;

  afterEach(() => {
    if (prior === undefined) delete process.env.BIMAX_COMPUTER_PIP;
    else process.env.BIMAX_COMPUTER_PIP = prior;
  });

  it('is disabled by default until the Phase 5 user-facing Live Target is packaged', async () => {
    delete process.env.BIMAX_COMPUTER_PIP;
    await expect(loadMacCapabilityConfig()).resolves.toMatchObject({ computerPip: false });
  });

  it('can only be enabled by Electron-owned provider configuration, not a tool argument', async () => {
    process.env.BIMAX_COMPUTER_PIP = '1';
    await expect(loadMacCapabilityConfig()).resolves.toMatchObject({ computerPip: true });
  });
});

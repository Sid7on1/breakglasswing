import {
  assertProviderHostArchitecture,
  DesktopCapabilityGovernor,
  isSensitiveMacTarget,
} from '../provider.policy';

describe('Desktop provider hard safety floor', () => {
  const priorAuthority = process.env.BIMAX_MAC_PROVIDER_AUTHORITY;
  const priorConsent = process.env.BIMAX_MAC_CONSENT_CHANNEL;

  afterEach(() => {
    if (priorAuthority === undefined) delete process.env.BIMAX_MAC_PROVIDER_AUTHORITY;
    else process.env.BIMAX_MAC_PROVIDER_AUTHORITY = priorAuthority;
    if (priorConsent === undefined) delete process.env.BIMAX_MAC_CONSENT_CHANNEL;
    else process.env.BIMAX_MAC_CONSENT_CHANNEL = priorConsent;
  });

  it('recognizes credential, security-permission, and wallet surfaces', () => {
    expect(isSensitiveMacTarget('1Password')).toBe(true);
    expect(isSensitiveMacTarget('System Settings Privacy & Security')).toBe(true);
    expect(isSensitiveMacTarget('crypto.wallet.example')).toBe(true);
    expect(isSensitiveMacTarget('System Settings Storage')).toBe(false);
  });

  it('requires Electron authority and the engine consent channel', async () => {
    const governor = new DesktopCapabilityGovernor();
    delete process.env.BIMAX_MAC_PROVIDER_AUTHORITY;
    delete process.env.BIMAX_MAC_CONSENT_CHANNEL;
    await expect(governor.approveTaskExecution('MAC_ACTION', { app: 'Notes' }))
      .rejects.toThrow('Electron-main authority');

    process.env.BIMAX_MAC_PROVIDER_AUTHORITY = 'electron-main';
    await expect(governor.approveTaskExecution('MAC_ACTION', { app: 'Notes' }))
      .rejects.toThrow('user-consent channel');
  });

  it('never lets an outer approval waive the sensitive-target floor', async () => {
    process.env.BIMAX_MAC_PROVIDER_AUTHORITY = 'electron-main';
    process.env.BIMAX_MAC_CONSENT_CHANNEL = 'engine-governor';
    await expect(new DesktopCapabilityGovernor().approveTaskExecution('MAC_ACTION', { app: 'Keychain Access' }))
      .rejects.toThrow('sensitive target');
  });

  it('binds the provider contract to Electron main architecture', () => {
    expect(() => assertProviderHostArchitecture(process.arch, process.arch)).not.toThrow();
    expect(() => assertProviderHostArchitecture(process.arch === 'arm64' ? 'x64' : 'arm64', process.arch))
      .toThrow('provider contract cannot run');
    expect(() => assertProviderHostArchitecture(undefined, process.arch)).toThrow('not declared');
  });
});

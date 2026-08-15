import { MAC_CONTROL_SCHEMA } from '../server';
import {
  assertProviderHostArchitecture,
  DesktopCapabilityGovernor,
  isSensitiveMacTarget,
} from '../provider.policy';

describe('Desktop capability provider surface', () => {
  const previousAuthority = process.env.BIMAX_MAC_PROVIDER_AUTHORITY;
  const previousConsent = process.env.BIMAX_MAC_CONSENT_CHANNEL;

  afterEach(() => {
    if (previousAuthority === undefined) delete process.env.BIMAX_MAC_PROVIDER_AUTHORITY;
    else process.env.BIMAX_MAC_PROVIDER_AUTHORITY = previousAuthority;
    if (previousConsent === undefined) delete process.env.BIMAX_MAC_CONSENT_CHANNEL;
    else process.env.BIMAX_MAC_CONSENT_CHANNEL = previousConsent;
  });

  it('uses the public action catalog and rejects unknown fields', () => {
    const properties = MAC_CONTROL_SCHEMA.properties as Record<string, any>;
    expect(properties.action.enum).toContain('observe');
    expect(properties.action.enum).toContain('click');
    expect(MAC_CONTROL_SCHEMA.additionalProperties).toBe(false);
    expect(properties.fullDisplayToken).toBeUndefined();
  });

  it('refuses acting authority when launched outside Electron main', async () => {
    delete process.env.BIMAX_MAC_PROVIDER_AUTHORITY;
    await expect(new DesktopCapabilityGovernor().approveTaskExecution('MAC_ACTION', { action: 'click' }))
      .rejects.toThrow('lacks Electron-main authority');
  });

  it('accepts the fixed process authority supplied by Electron main', async () => {
    process.env.BIMAX_MAC_PROVIDER_AUTHORITY = 'electron-main';
    process.env.BIMAX_MAC_CONSENT_CHANNEL = 'engine-governor';
    await expect(new DesktopCapabilityGovernor().approveTaskExecution('MAC_ACTION', { action: 'click' }))
      .resolves.toBeUndefined();
  });

  it('hard-denies credential, security-permission, and wallet targets inside the provider', async () => {
    process.env.BIMAX_MAC_PROVIDER_AUTHORITY = 'electron-main';
    process.env.BIMAX_MAC_CONSENT_CHANNEL = 'engine-governor';
    expect(isSensitiveMacTarget('Safari')).toBe(false);
    expect(isSensitiveMacTarget('1Password')).toBe(true);
    expect(isSensitiveMacTarget('System Settings Privacy & Security')).toBe(true);
    expect(isSensitiveMacTarget('my.wallet.example')).toBe(true);
    await expect(new DesktopCapabilityGovernor().approveTaskExecution('MAC_ACTION', {
      action: 'type', app: 'Bitwarden', isDestructive: true,
    })).rejects.toThrow(/sensitive target/i);
  });

  it('binds startup to the architecture declared by Electron main', () => {
    expect(() => assertProviderHostArchitecture(undefined, 'arm64')).toThrow(/not declared/i);
    expect(() => assertProviderHostArchitecture('x64', 'arm64')).toThrow(/cannot run as arm64/i);
    expect(() => assertProviderHostArchitecture('arm64', 'arm64')).not.toThrow();
  });
});

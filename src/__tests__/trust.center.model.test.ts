import type { TrustReport } from '../../app/src/renderer/src/global';
import { summarizeTrustReport } from '../../app/src/renderer/src/trust.center.model';

const report = (overrides: Partial<TrustReport> = {}): TrustReport => {
  const signature = {
    kind: 'unknown' as const,
    hardenedRuntime: null,
    gatekeeper: 'unknown' as const,
    notarization: 'unknown' as const,
  };
  return {
    generatedAt: '2026-08-09T00:00:00.000Z',
    build: {
      packaged: true, appVersion: '1.1.0', electron: '43.3.0', chrome: '150', node: '24',
      platform: 'darwin', osRelease: '25', minimumMacOS: '13.0',
    },
    permissions: { accessibility: 'denied', screenRecording: 'unavailable' },
    components: [],
    appIntegrity: overrides.appIntegrity ?? { signature },
    release: overrides.release ?? {
      qualification: 'manual-alpha',
      warning: 'Manual alpha',
      updatePermissionWarning: 'Permissions may need to be granted again after an update.',
    },
    coding: { available: true, requiresPermissions: [] },
    computerUse: { available: false, blockers: ['Accessibility permission is not granted'] },
    unknowns: ['screenRecording permission state could not be read'],
    ...overrides,
  };
};

describe('Trust Center view model', () => {
  test('keeps coding available while denied or unknown CU facts stay visibly unhealthy', () => {
    expect(summarizeTrustReport(report())).toEqual({
      coding: 'Available',
      computerUse: 'Needs attention',
      permissions: [
        { id: 'screenRecording', label: 'Screen Recording', value: 'unavailable' },
        { id: 'accessibility', label: 'Accessibility', value: 'denied' },
      ],
    });
  });

  test('uses Available only when the report itself established availability', () => {
    expect(summarizeTrustReport(report({
      permissions: { accessibility: 'granted', screenRecording: 'granted' },
      computerUse: { available: true, blockers: [] },
    })).computerUse).toBe('Available');
  });
});

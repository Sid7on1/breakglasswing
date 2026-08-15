import { ComputerUsePackController } from '../computer.use.pack';

const components = ['mac-capability', 'xpc-service', 'bridge', 'helper'];

describe('Phase 9 optional Computer Use pack (S29-D)', () => {
  test('Terminal can never activate or expose the Mac tool', () => {
    const controller = new ComputerUsePackController();
    const state = controller.activate({ host: 'terminal', contentDigest: 'sha256:good', verifiedComponents: components, approved: true });
    expect(state.toolExposed).toBe(false);
    expect(state.blockers.join(' ')).toMatch(/Bimax for Mac/);
  });

  test('Desktop activation is prompt-free until the first actual Control Mac request', () => {
    const controller = new ComputerUsePackController();
    const active = controller.activate({ host: 'desktop', contentDigest: 'sha256:good', verifiedComponents: components, approved: true });
    expect(active).toMatchObject({ state: 'active', toolExposed: true, permissionsRequested: false });
    expect(controller.firstInvocation().permissionsRequested).toBe(true);
  });

  test('deactivation removes tool exposure and keeps macOS revoke instructions', () => {
    const controller = new ComputerUsePackController();
    controller.activate({ host: 'desktop', contentDigest: 'sha256:good', verifiedComponents: components, approved: true });
    const state = controller.deactivate();
    expect(state).toMatchObject({ state: 'revoked', toolExposed: false, contentDigest: null });
    expect(state.revokeInstructions.join(' ')).toMatch(/System Settings/);
  });
});


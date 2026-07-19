import { SurfaceRegistry, chooseMechanism, defaultSurfaceTraits } from '../computer/surface';

describe('execution-surface traits', () => {
  it('encodes the OS physics per surface kind', () => {
    // The physical desktop is user-owned and unsafe to capture wholesale.
    expect(defaultSurfaceTraits('physical-desktop')).toEqual({ focusOwner: 'user', captureSafe: false, backgroundCapable: false });
    // A native window is window-scoped (capture-safe) and can be driven in the background via the
    // sidecar's synthetic PID-post (a real global cursor still requires foreground — see chooseMechanism).
    expect(defaultSurfaceTraits('native-window')).toEqual({ focusOwner: 'none', captureSafe: true, backgroundCapable: true });
    // AX and browser surfaces CAN be driven in the background.
    expect(defaultSurfaceTraits('accessibility').backgroundCapable).toBe(true);
    expect(defaultSurfaceTraits('browser-tab')).toEqual({ focusOwner: 'agent', captureSafe: true, backgroundCapable: true });
  });
});

describe('chooseMechanism — the routing brain', () => {
  it('drives browser surfaces over automation, never the physical cursor', () => {
    const c = chooseMechanism({ kind: 'browser-tab', backgroundCapable: true }, 'click', { delivery: 'foreground' });
    expect(c.mechanism).toBe('browser-automation');
    expect(c.requiresForeground).toBe(false);
  });

  it('routes a value set through accessibility without foregrounding', () => {
    const c = chooseMechanism({ kind: 'native-window', backgroundCapable: false }, 'set_value', { delivery: 'foreground' });
    expect(c.mechanism).toBe('accessibility');
    expect(c.requiresForeground).toBe(false);
  });

  it('uses one real cursor for foreground pointer/keyboard on a native window', () => {
    for (const action of ['click', 'drag', 'scroll', 'move', 'type', 'key']) {
      const c = chooseMechanism({ kind: 'native-window', backgroundCapable: false }, action, { delivery: 'foreground' });
      expect(c.mechanism).toBe('physical-foreground');
      expect(c.requiresForeground).toBe(true);
    }
  });

  it('REFUSES background input on the bare desktop — nothing to target, never faked', () => {
    const c = chooseMechanism({ kind: 'physical-desktop', backgroundCapable: false }, 'click', { delivery: 'background' });
    expect(c.mechanism).toBe('unsupported');
    expect(c.reason).toMatch(/no specific window to target/i);
  });

  it('drives a background native-window click through the sidecar synthetic path (cursor untouched)', () => {
    const c = chooseMechanism({ kind: 'native-window', backgroundCapable: true }, 'click', { delivery: 'background' });
    expect(c.mechanism).toBe('sidecar-background');
    expect(c.requiresForeground).toBe(false);
    expect(c.reason).toMatch(/synthetic event/i);
  });

  it('prefers accessibility over the synthetic path when a real element handle exists', () => {
    const c = chooseMechanism({ kind: 'native-window', backgroundCapable: true }, 'click', { delivery: 'background', hasAxHandle: true });
    expect(c.mechanism).toBe('accessibility');
  });

  it('routes an accessibility surface through accessibility in the background', () => {
    const c = chooseMechanism({ kind: 'accessibility', backgroundCapable: true }, 'key', { delivery: 'background' });
    expect(c.mechanism).toBe('accessibility');
    expect(c.requiresForeground).toBe(false);
  });
});

describe('SurfaceRegistry', () => {
  it('registers, activates, updates, and removes surfaces', () => {
    const reg = new SurfaceRegistry();
    const s = reg.register({ kind: 'native-window', app: 'Calculator', pid: 42, windowId: 7 });
    expect(s.id).toMatch(/native-window-/);
    expect(reg.active()?.id).toBe(s.id); // first surface becomes active
    reg.update(s.id, { bounds: { x: 0, y: 0, w: 400, h: 600 }, scale: 2 });
    expect(reg.get(s.id)?.bounds).toEqual({ x: 0, y: 0, w: 400, h: 600 });
    const s2 = reg.register({ kind: 'browser-tab', app: 'Chromium' });
    expect(reg.all()).toHaveLength(2);
    expect(reg.setActive(s2.id)).toBe(true);
    expect(reg.active()?.id).toBe(s2.id);
    reg.remove(s2.id);
    expect(reg.active()).toBeNull(); // removing the active surface clears active
    expect(reg.all()).toHaveLength(1);
  });

  it('preserves createdAt and explicit trait overrides across re-register', () => {
    const reg = new SurfaceRegistry();
    const a = reg.register({ id: 'w1', kind: 'native-window', focusOwner: 'agent' });
    const b = reg.register({ id: 'w1', kind: 'native-window', app: 'Notes' });
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.focusOwner).toBe('agent'); // prior explicit override retained
    expect(b.app).toBe('Notes');
  });

  it('will not hand the agent a surface the user currently owns unless forced', () => {
    const reg = new SurfaceRegistry();
    const s = reg.register({ kind: 'physical-desktop' }); // focusOwner defaults to 'user'
    const denied = reg.claimInput(s.id, 'agent');
    expect(denied.ok).toBe(false);
    expect(denied.conflict).toMatch(/user currently owns input/i);

    const forced = reg.claimInput(s.id, 'agent', { force: true });
    expect(forced.ok).toBe(true);
    expect(reg.get(s.id)?.focusOwner).toBe('agent');

    reg.releaseInput(s.id);
    expect(reg.get(s.id)?.focusOwner).toBe('user'); // physical surfaces return to the user
  });
});

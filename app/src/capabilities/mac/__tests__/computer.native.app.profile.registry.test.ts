import {
  NativeAppProfileRegistry,
  type NativeAppProfile,
} from '../native.app.profile.registry';

describe('native app profile registry', () => {
  it('matches exact bundle ids and delivers guidance once per bundle and task', () => {
    const registry = new NativeAppProfileRegistry();
    const identity = { pid: 42, bundleId: 'com.apple.finder', displayName: 'Finder' };

    const first = registry.takeGuidance('task-a', identity);
    expect(first?.profileId).toBe('finder');
    expect(first?.guidance.length).toBeGreaterThan(0);
    expect(registry.takeGuidance('task-a', { ...identity, pid: 99 })).toBeNull();
    expect(registry.takeGuidance('task-b', identity)?.profileId).toBe('finder');

    registry.resetTask('task-a');
    expect(registry.takeGuidance('task-a', identity)?.profileId).toBe('finder');
  });

  it('does not use a display-name fallback when a concrete unknown bundle is present', () => {
    const registry = new NativeAppProfileRegistry();
    expect(registry.profileFor({
      pid: 1, bundleId: 'example.untrusted.finder', displayName: 'Finder',
    })).toBeNull();
    expect(registry.profileFor({ pid: 1, displayName: 'Finder' })?.id).toBe('finder');
  });

  it('copies receipts so a caller cannot mutate the registered profile', () => {
    const registry = new NativeAppProfileRegistry();
    const first = registry.takeGuidance('task', { pid: 1, bundleId: 'com.apple.finder' })!;
    first.guidance[0] = 'forged';
    first.recipes[0].preferredActions[0] = 'shell';
    registry.resetTask('task');
    const second = registry.takeGuidance('task', { pid: 1, bundleId: 'com.apple.finder' })!;
    expect(second.guidance[0]).not.toBe('forged');
    expect(second.recipes[0].preferredActions[0]).not.toBe('shell');
  });

  it('refuses duplicate bundle authority and unbounded profile content', () => {
    const duplicate: NativeAppProfile[] = [
      { id: 'one', bundleIds: ['example.app'], guidance: [], recipes: [] },
      { id: 'two', bundleIds: ['EXAMPLE.APP'], guidance: [], recipes: [] },
    ];
    expect(() => new NativeAppProfileRegistry(duplicate)).toThrow('duplicate app profile bundle id');
    expect(() => new NativeAppProfileRegistry([{
      id: 'bad', bundleIds: ['example.bad'], guidance: ['x'.repeat(513)], recipes: [],
    }])).toThrow('safe characters');
    expect(() => new NativeAppProfileRegistry().takeGuidance('', {
      pid: 1, bundleId: 'com.apple.finder',
    })).toThrow('valid task session');
  });
});

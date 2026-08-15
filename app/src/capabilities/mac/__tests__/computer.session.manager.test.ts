import { ComputerBackend, ComputerBackendCapabilities, ComputerBackendDescriptor, ComputerBackendFactory } from '../backend';
import { BimaxComputerRuntime, DesktopCommand, DesktopResult } from '../desktop.runtime';
import { ComputerSessionManager } from '../session.manager';

const descriptor: ComputerBackendDescriptor = {
  id: 'test', name: 'test', priority: 1, platforms: ['test'],
  capabilities: { accessibility: true, screenshots: true, backgroundInput: true, physicalInput: true, windowCapture: true },
};

class FakeBackend implements ComputerBackend {
  public readonly descriptor = descriptor;
  public readonly commands: DesktopCommand[] = [];
  public concurrent = 0;
  public maxConcurrent = 0;
  public disposed = 0;

  public constructor(public readonly id: string, private readonly delayMs = 0) {}

  public async run(cmd: DesktopCommand): Promise<DesktopResult> {
    this.commands.push(cmd);
    this.concurrent++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    this.concurrent--;
    return { ok: true, action: cmd.action, driver: this.id, summary: `${this.id}:${cmd.action}` };
  }

  public quickStatus() { return { driver: this.id, ready: true, accessibility: true, screenRecording: true }; }
  public discoverCapabilities(): ComputerBackendCapabilities {
    return {
      protocolVersion: 1, backendId: descriptor.id, backendName: descriptor.name,
      platform: 'test', driver: this.id, ready: true,
      permissions: { accessibility: true, screenRecording: true },
      actions: ['status'], deliveryModes: ['background', 'foreground'],
      captureModes: ['accessibility'], limits: { maxSessions: null },
    };
  }
  public async frontmostApp() { return 'Fixture'; }
  public async dispose() { this.disposed++; }
}

class FakeFactory implements ComputerBackendFactory {
  public readonly created: FakeBackend[] = [];
  public constructor(private readonly delayMs = 0) {}
  public create(sessionId: string): FakeBackend {
    const backend = new FakeBackend(sessionId, this.delayMs);
    this.created.push(backend);
    return backend;
  }
}

describe('ComputerSessionManager', () => {
  it('namespaces durable compatibility-runtime state per Bimax task', () => {
    const alpha = new BimaxComputerRuntime(undefined, undefined, 'cu-task-alpha-aaaaaaaaaaaa');
    const beta = new BimaxComputerRuntime(undefined, undefined, 'cu-task-beta-bbbbbbbbbbbb');
    const legacy = new BimaxComputerRuntime();
    const alphaFile = (alpha as unknown as { sessionStateFile(cwd: string): string }).sessionStateFile('/tmp/project');
    const betaFile = (beta as unknown as { sessionStateFile(cwd: string): string }).sessionStateFile('/tmp/project');
    const legacyFile = (legacy as unknown as { sessionStateFile(cwd: string): string }).sessionStateFile('/tmp/project');

    expect(alphaFile).toContain('/sessions/cu-task-alpha-aaaaaaaaaaaa/session.json');
    expect(betaFile).toContain('/sessions/cu-task-beta-bbbbbbbbbbbb/session.json');
    expect(alphaFile).not.toBe(betaFile);
    expect(legacyFile).toBe('/tmp/project/.bimax/computer/session.json');
  });

  it('keeps task-local backends and command identities isolated', async () => {
    const factory = new FakeFactory();
    const manager = new ComputerSessionManager(factory);
    const alpha = manager.forSession('task-alpha');
    const beta = manager.forSession('task-beta');

    await alpha.run({ action: 'status' });
    await beta.run({ action: 'status' });
    await alpha.run({ action: 'observe' });

    expect(factory.created).toHaveLength(2);
    expect(factory.created[0]).not.toBe(factory.created[1]);
    expect(factory.created.map(backend => backend.commands.length).sort()).toEqual([1, 2]);
    const identities = factory.created.flatMap(backend => backend.commands.map(command => command.session));
    expect(new Set(identities).size).toBe(2);
  });

  it('retains independent targets while two sessions observe concurrently', async () => {
    const targets = new Map<string, string>();
    const factory: ComputerBackendFactory = {
      create: (sessionId: string) => {
        const backend = new FakeBackend(sessionId);
        backend.run = async (cmd: DesktopCommand): Promise<DesktopResult> => {
          if (cmd.action === 'open') targets.set(sessionId, cmd.app || '');
          return {
            ok: true, action: cmd.action, driver: sessionId,
            app: targets.get(sessionId), summary: targets.get(sessionId) || 'no target',
          };
        };
        return backend;
      },
    };
    const manager = new ComputerSessionManager(factory);
    const alpha = manager.forSession('task-alpha');
    const beta = manager.forSession('task-beta');
    await alpha.run({ action: 'open', app: 'Notes' });
    await beta.run({ action: 'open', app: 'Calendar' });

    const [alphaFrame, betaFrame] = await Promise.all([
      alpha.run({ action: 'observe' }), beta.run({ action: 'observe' }),
    ]);

    expect(alphaFrame.app).toBe('Notes');
    expect(betaFrame.app).toBe('Calendar');
  });

  it('discovers capabilities from the selected live backend', () => {
    const manager = new ComputerSessionManager(new FakeFactory());
    const capabilities = manager.discoverCapabilities('task-alpha');
    expect(capabilities).toEqual(expect.objectContaining({
      protocolVersion: 1, backendId: 'test', ready: true,
    }));
    expect(capabilities.permissions.accessibility).toBe(true);
  });

  it('serializes mutating desktop actions across different tasks', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const created: FakeBackend[] = [];
    const factory: ComputerBackendFactory = {
      create: (sessionId: string) => {
        const backend = new FakeBackend(sessionId);
        backend.run = async (cmd: DesktopCommand): Promise<DesktopResult> => {
          backend.commands.push(cmd);
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise(resolve => setTimeout(resolve, 15));
          concurrent--;
          return { ok: true, action: cmd.action, driver: sessionId, summary: 'acted' };
        };
        created.push(backend);
        return backend;
      },
    };
    const manager = new ComputerSessionManager(factory);
    const alpha = manager.forSession('task-alpha');
    const beta = manager.forSession('task-beta');

    await Promise.all([
      alpha.run({ action: 'click', x: 1, y: 1, frameId: 'a' }),
      beta.run({ action: 'type', text: 'hello' }),
    ]);

    expect(created).toHaveLength(2);
    expect(maxConcurrent).toBe(1);
    const starts = created.flatMap(backend => backend.commands).map(command => command.action);
    expect(starts).toEqual(expect.arrayContaining(['click', 'type']));
  });

  it('allows read-only observations to overlap across tasks', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const factory: ComputerBackendFactory = {
      create: (sessionId: string) => {
        const backend = new FakeBackend(sessionId);
        backend.run = async (cmd: DesktopCommand): Promise<DesktopResult> => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise(resolve => setTimeout(resolve, 15));
          concurrent--;
          return { ok: true, action: cmd.action, driver: sessionId, summary: 'observed' };
        };
        return backend;
      },
    };
    const manager = new ComputerSessionManager(factory);

    await Promise.all([
      manager.forSession('task-alpha').run({ action: 'observe' }),
      manager.forSession('task-beta').run({ action: 'screenshot' }),
    ]);

    expect(maxConcurrent).toBe(2);
  });

  it('disposes only the selected task at a turn boundary', async () => {
    const factory = new FakeFactory();
    const manager = new ComputerSessionManager(factory);
    const alpha = manager.forSession('task-alpha');
    const beta = manager.forSession('task-beta');
    await alpha.run({ action: 'status' });
    await beta.run({ action: 'status' });

    await alpha.dispose?.();

    const alphaBackend = factory.created.find(backend => backend.commands[0]?.session?.includes('task-alpha'))!;
    const betaBackend = factory.created.find(backend => backend.commands[0]?.session?.includes('task-beta'))!;
    expect(alphaBackend.disposed).toBe(1);
    expect(betaBackend.disposed).toBe(0);
  });

  it('bounds retained task runtimes and evicts an idle least-recent session', async () => {
    const factory = new FakeFactory();
    const manager = new ComputerSessionManager(factory, 2);
    await manager.forSession('task-alpha').run({ action: 'status' });
    await new Promise(resolve => setTimeout(resolve, 2));
    await manager.forSession('task-beta').run({ action: 'status' });
    await new Promise(resolve => setTimeout(resolve, 2));
    await manager.forSession('task-gamma').run({ action: 'status' });
    await Promise.resolve();

    expect(manager.sessionCount()).toBe(2);
    expect(factory.created).toHaveLength(3);
    expect(factory.created.filter(backend => backend.disposed > 0)).toHaveLength(1);
  });
});

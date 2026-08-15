jest.mock('../mcp.client', () => ({ openClient: jest.fn(), isDeadConnectionError: jest.fn(() => false) }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SidecarTransport, discoverCachedDriver } from '../transport';

/** The transport only trusts cache entries big enough to be the real extracted driver (>1MB). */
const DRIVER_BYTES = (1 << 20) + 1;

describe('sidecar driver discovery', () => {
  let cacheRoot: string;

  beforeEach(() => {
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-driver-cache-'));
    process.env.BIMAX_CACHE_DIR = cacheRoot;
    delete process.env.BIMAX_COMPUTER_USE_DRIVER;
  });

  afterEach(() => {
    delete process.env.BIMAX_CACHE_DIR;
    delete process.env.BIMAX_COMPUTER_USE_DRIVER;
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  function stageDriver(name: string, bytes = DRIVER_BYTES): string {
    const dir = path.join(cacheRoot, 'bimax');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.alloc(bytes));
    return file;
  }

  it('finds the content-addressed driver the packaged TUI extracted', () => {
    const staged = stageDriver('bimax-computer-use-c1c015ccceda');
    expect(discoverCachedDriver()).toBe(staged);
  });

  it('ignores undersized stubs and unrelated cache files', () => {
    stageDriver('bimax-computer-use-tiny', 128);
    stageDriver('bimax-engine-a6684ae69855');
    expect(discoverCachedDriver()).toBeNull();
  });

  it('returns null when the cache dir does not exist', () => {
    expect(discoverCachedDriver()).toBeNull();
  });

  it('makes the transport available without BIMAX_COMPUTER_USE_DRIVER when a cached driver exists', () => {
    stageDriver('bimax-computer-use-c1c015ccceda');
    expect(new SidecarTransport('test').available()).toBe(true);
  });

  it('an explicit BIMAX_COMPUTER_USE_DRIVER=off opt-out beats discovery', () => {
    stageDriver('bimax-computer-use-c1c015ccceda');
    process.env.BIMAX_COMPUTER_USE_DRIVER = 'off';
    expect(new SidecarTransport('test').available()).toBe(false);
  });

  it('a configured driver path still wins over the cache scan', () => {
    stageDriver('bimax-computer-use-c1c015ccceda');
    const configured = stageDriver('bimax-computer-use-configured');
    process.env.BIMAX_COMPUTER_USE_DRIVER = configured;
    const transport = new SidecarTransport('test') as any;
    expect(transport.driverPath()).toBe(configured);
  });
});

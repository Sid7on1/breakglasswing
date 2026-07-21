import {
  PowerMonitor,
  parsePmsetBatt,
  parsePmsetTherm,
  powerThrottleAdvice,
  powerMonitor,
  powerAwarenessEnabled,
  defaultThresholds,
  UNKNOWN_POWER,
  MAX_CONCURRENT_SUBAGENTS_REEXPORT_CHECK,
  type PowerThresholds,
  type PowerState,
} from '../governor/power.monitor';
import { MAX_CONCURRENT_SUBAGENTS } from '../core/subagent.capacity';

const THRESHOLDS: PowerThresholds = {
  batteryPct: 30,
  criticalBatteryPct: 15,
  softMaxSubagents: 2,
  loopBackoffMs: 4000,
};

/** A monitor with fully injected, deterministic I/O and clock. */
function makeMonitor(opts: {
  platform?: NodeJS.Platform;
  exec?: (cmd: string, args: string[]) => Promise<string>;
  readFile?: (p: string) => string | null;
} = {}): PowerMonitor {
  return new PowerMonitor({
    platform: opts.platform ?? 'darwin',
    exec: opts.exec ?? (async () => ''),
    readFile: opts.readFile ?? (() => null),
    now: () => 1_700_000_000_000,
    thresholds: THRESHOLDS,
    announce: false,
  });
}

// Preserve env the suite mutates.
const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('parsePmsetBatt', () => {
  it('reads AC power and percent', () => {
    const out = `Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t100%; charged; 0:00 remaining present: true`;
    expect(parsePmsetBatt(out)).toEqual({ source: 'ac', batteryPercent: 100, charging: true });
  });

  it('reads discharging battery', () => {
    const out = `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t47%; discharging; 2:41 remaining present: true`;
    expect(parsePmsetBatt(out)).toEqual({ source: 'battery', batteryPercent: 47, charging: false });
  });

  it('treats "charging" while plugged in as AC even without the AC-Power banner', () => {
    const out = ` -InternalBattery-0 (id=1234)\t63%; charging; 1:12 remaining present: true`;
    expect(parsePmsetBatt(out)).toEqual({ source: 'ac', batteryPercent: 63, charging: true });
  });

  it('returns null percent when unparseable', () => {
    expect(parsePmsetBatt('garbage').batteryPercent).toBeNull();
  });
});

describe('parsePmsetTherm', () => {
  it('flags throttle when CPU_Speed_Limit < 100', () => {
    expect(parsePmsetTherm('CPU_Speed_Limit \t= 70')).toEqual({ thermalThrottled: true, cpuSpeedLimitPct: 70 });
  });
  it('is not throttled at 100', () => {
    expect(parsePmsetTherm('CPU_Speed_Limit = 100')).toEqual({ thermalThrottled: false, cpuSpeedLimitPct: 100 });
  });
  it('reports unknown (no throttle) when the line is absent', () => {
    expect(parsePmsetTherm('Note: No thermal warning level has been recorded')).toEqual({
      thermalThrottled: false,
      cpuSpeedLimitPct: null,
    });
  });
});

describe('advice() thresholds', () => {
  const mon = makeMonitor();
  const state = (p: Partial<PowerState>): PowerState => ({ ...UNKNOWN_POWER, ...p });

  beforeEach(() => { delete process.env.BIMAX_POWER_AWARE; });

  it('does not throttle on AC', () => {
    expect(mon.advice(state({ source: 'ac', charging: true, batteryPercent: 20 })).level).toBe('none');
  });

  it('does not throttle on healthy battery', () => {
    expect(mon.advice(state({ source: 'battery', batteryPercent: 80 })).level).toBe('none');
  });

  it('soft-throttles to softMax on low battery', () => {
    const a = mon.advice(state({ source: 'battery', batteryPercent: 25 }));
    expect(a.level).toBe('soft');
    expect(a.maxConcurrentSubagents).toBe(2);
    expect(a.loopBackoffMs).toBe(4000);
    expect(a.reason).toMatch(/on battery \(25%\)/);
  });

  it('drops to a single sub-agent at critical battery', () => {
    const a = mon.advice(state({ source: 'battery', batteryPercent: 10 }));
    expect(a.level).toBe('soft');
    expect(a.maxConcurrentSubagents).toBe(1);
    expect(a.reason).toMatch(/critically low/);
  });

  it('soft-throttles on thermal even while on AC', () => {
    const a = mon.advice(state({ source: 'ac', charging: true, thermalThrottled: true, cpuSpeedLimitPct: 60 }));
    expect(a.level).toBe('soft');
    expect(a.reason).toMatch(/thermal throttling.*60%/);
  });

  it('honors BIMAX_POWER_AWARE=off', () => {
    process.env.BIMAX_POWER_AWARE = 'off';
    expect(mon.advice(state({ source: 'battery', batteryPercent: 5 })).level).toBe('none');
  });
});

describe('readDarwin', () => {
  it('composes battery + thermal from pmset', async () => {
    const exec = async (_cmd: string, args: string[]) =>
      args[1] === 'batt'
        ? `Now drawing from 'Battery Power'\n -InternalBattery-0\t22%; discharging; 1:30 remaining`
        : 'CPU_Speed_Limit = 100';
    const mon = makeMonitor({ platform: 'darwin', exec });
    const s = await mon.refresh();
    expect(s.source).toBe('battery');
    expect(s.batteryPercent).toBe(22);
    expect(s.thermalThrottled).toBe(false);
    expect(mon.advice(s).maxConcurrentSubagents).toBe(2);
  });

  it('treats a batteryless Mac as AC', async () => {
    const mon = makeMonitor({ platform: 'darwin', exec: async () => 'Now drawing from \'AC Power\'' });
    const s = await mon.refresh();
    expect(s.source).toBe('ac');
    expect(mon.advice(s).level).toBe('none');
  });
});

describe('readLinux', () => {
  it('reads discharging battery from sysfs', async () => {
    const readFile = (p: string): string | null => {
      if (p === '/sys/class/power_supply/BAT0/capacity') return '18\n';
      if (p === '/sys/class/power_supply/BAT0/status') return 'Discharging\n';
      return null; // no AC online
    };
    const mon = makeMonitor({ platform: 'linux', readFile });
    const s = await mon.refresh();
    expect(s.source).toBe('battery');
    expect(s.batteryPercent).toBe(18);
    expect(mon.advice(s).level).toBe('soft');
  });

  it('reads AC-online as charging', async () => {
    const readFile = (p: string): string | null => {
      if (p === '/sys/class/power_supply/AC/online') return '1\n';
      if (p === '/sys/class/power_supply/BAT0/capacity') return '18';
      if (p === '/sys/class/power_supply/BAT0/status') return 'Charging';
      return null;
    };
    const mon = makeMonitor({ platform: 'linux', readFile });
    const s = await mon.refresh();
    expect(s.source).toBe('ac');
    expect(mon.advice(s).level).toBe('none');
  });
});

describe('unsupported platform fails open', () => {
  it('reads unknown and never throttles on win32', async () => {
    const mon = makeMonitor({ platform: 'win32' });
    const s = await mon.refresh();
    expect(s.source).toBe('unknown');
    expect(mon.advice(s).level).toBe('none');
  });
});

describe('caching + failure resilience', () => {
  it('snapshot starts unknown and updates after refresh', async () => {
    const mon = makeMonitor({ exec: async () => 'Now drawing from \'AC Power\'' });
    expect(mon.snapshot().source).toBe('unknown');
    await mon.refresh();
    expect(mon.snapshot().source).toBe('ac');
  });

  it('keeps last good state when a reader throws', async () => {
    let call = 0;
    const exec = async () => {
      call++;
      if (call <= 2) return 'Now drawing from \'AC Power\'';
      throw new Error('pmset vanished');
    };
    const mon = makeMonitor({ exec });
    await mon.refresh();
    expect(mon.snapshot().source).toBe('ac');
    await mon.refresh(); // throws internally, swallowed
    expect(mon.snapshot().source).toBe('ac');
  });

  it('coalesces concurrent refreshes into one in-flight read', async () => {
    let calls = 0;
    const exec = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return 'CPU_Speed_Limit = 100'; };
    const mon = makeMonitor({ exec });
    await Promise.all([mon.refresh(), mon.refresh(), mon.refresh()]);
    // darwin does 2 execs (batt + therm) per single read; 3 coalesced calls => still one read.
    expect(calls).toBe(2);
  });
});

describe('module wiring', () => {
  it('re-exports the shared hard cap so callers agree on the ceiling', () => {
    expect(defaultThresholds().softMaxSubagents).toBeLessThanOrEqual(MAX_CONCURRENT_SUBAGENTS);
    expect(MAX_CONCURRENT_SUBAGENTS_REEXPORT_CHECK).toBe(MAX_CONCURRENT_SUBAGENTS);
  });

  it('powerThrottleAdvice reads the singleton (unknown → no throttle by default)', () => {
    delete process.env.BIMAX_POWER_AWARE;
    expect(powerMonitor.snapshot().source).toBe('unknown');
    expect(powerThrottleAdvice().level).toBe('none');
  });

  it('powerAwarenessEnabled respects the env switch', () => {
    delete process.env.BIMAX_POWER_AWARE;
    expect(powerAwarenessEnabled()).toBe(true);
    process.env.BIMAX_POWER_AWARE = 'off';
    expect(powerAwarenessEnabled()).toBe(false);
    process.env.BIMAX_POWER_AWARE = '0';
    expect(powerAwarenessEnabled()).toBe(false);
  });
});

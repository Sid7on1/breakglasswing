import '../cli/commands/a11y';
import { globalCommandRegistry } from '../cli/commands/registry';
import { prefersReducedMotion } from '../cli/components/ShimmerText';

function getCmd(name: string): any {
  return (globalCommandRegistry as any).commands.get(name);
}

describe('/a11y — reduced-motion toggle', () => {
  it('registers with /reduced-motion + /motion aliases', () => {
    expect(getCmd('/a11y')).toBeDefined();
    expect(getCmd('/reduced-motion')).toBe(getCmd('/a11y'));
    expect(getCmd('/motion')).toBe(getCmd('/a11y'));
  });

  it('`/a11y on` and `/a11y off` persist the flag', async () => {
    const saveConfig = jest.fn().mockResolvedValue(undefined);
    await getCmd('/a11y').execute(['on'], { saveConfig } as any);
    expect(saveConfig).toHaveBeenCalledWith({ reducedMotion: true });
    await getCmd('/a11y').execute(['off'], { saveConfig } as any);
    expect(saveConfig).toHaveBeenCalledWith({ reducedMotion: false });
  });

  it('bare /a11y returns an on/off menu wired to runnable commands', async () => {
    const res = await getCmd('/a11y').execute([], { saveConfig: jest.fn() } as any);
    expect(res.type).toBe('menu');
    expect(res.options.map((o: any) => o.value)).toEqual(['/a11y on', '/a11y off']);
  });
});

describe('prefersReducedMotion — env gate', () => {
  const ENV = { ...process.env };
  afterEach(() => { process.env = { ...ENV }; });

  it('honors the BGW_REDUCED_MOTION env flag', () => {
    delete process.env.BGW_REDUCED_MOTION;
    expect(prefersReducedMotion()).toBe(false);
    process.env.BGW_REDUCED_MOTION = 'true';
    expect(prefersReducedMotion()).toBe(true);
  });
});

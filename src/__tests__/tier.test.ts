import '../cli/commands/tier';
import { globalCommandRegistry } from '../cli/commands/registry';
import { cliEvents } from '../cli/events';

function getCmd(name: string): any {
  return (globalCommandRegistry as any).commands.get(name);
}

describe('/tier — manual model-tier control', () => {
  it('registers with /model-tier + /route aliases', () => {
    expect(getCmd('/tier')).toBeDefined();
    expect(getCmd('/model-tier')).toBe(getCmd('/tier'));
    expect(getCmd('/route')).toBe(getCmd('/tier'));
  });

  it.each(['auto', 'lite', 'heavy'])('emits set_tier "%s" and confirms', async (sub) => {
    const seen: string[] = [];
    const onSet = (t: string) => seen.push(t);
    cliEvents.on('set_tier', onSet);
    try {
      const res = await getCmd('/tier').execute([sub], {} as any);
      expect(res.type).toBe('message');
      expect(res.level).toBe('success');
    } finally {
      cliEvents.off('set_tier', onSet);
    }
    expect(seen).toEqual([sub]);
  });

  it('returns a picker menu for a bare /tier', async () => {
    const res = await getCmd('/tier').execute([], {} as any);
    expect(res.type).toBe('menu');
    expect(res.options.map((o: any) => o.value)).toEqual(['/tier auto', '/tier lite', '/tier heavy']);
  });

  it('ignores an invalid tier and shows the menu instead', async () => {
    let emitted = false;
    const onSet = () => { emitted = true; };
    cliEvents.on('set_tier', onSet);
    try {
      const res = await getCmd('/tier').execute(['turbo'], {} as any);
      expect(res.type).toBe('menu');
    } finally {
      cliEvents.off('set_tier', onSet);
    }
    expect(emitted).toBe(false);
  });
});

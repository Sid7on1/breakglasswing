import '../cli/commands/meta';
import '../cli/commands/builtins';
import '../cli/commands/session';
import '../cli/commands/help';
import '../cli/commands/git';
import '../cli/commands/code';
import { globalCommandRegistry } from '../cli/commands/registry';

// The Ctrl+K command palette derives its options from the live registry — the single source of
// truth — so it can never drift from the commands that actually exist (the bug the old hardcoded
// FullScreen list had). These tests lock that contract.
describe('CommandRegistry.getPaletteOptions — palette single source of truth', () => {
  const opts = globalCommandRegistry.getPaletteOptions();

  it('returns one row per registered command (deduped by identity, not by alias)', () => {
    const all = globalCommandRegistry.getAllCommands();
    expect(opts.length).toBe(all.length);
    // No duplicate command values.
    const values = opts.map(o => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('every row is a runnable slash command with a description and category', () => {
    expect(opts.length).toBeGreaterThan(5);
    for (const o of opts) {
      expect(o.value.startsWith('/')).toBe(true);
      expect(o.label).toBe(o.value);
      expect(typeof o.desc).toBe('string');
      expect(o.desc.length).toBeGreaterThan(0);
      expect(typeof o.category).toBe('string');
      expect(o.category.length).toBeGreaterThan(0);
    }
  });

  it('includes representative commands and is sorted by category then name', () => {
    const values = opts.map(o => o.value);
    expect(values).toEqual(expect.arrayContaining(['/help', '/config', '/model']));
    // Sorted: category asc, then label asc within a category.
    for (let i = 1; i < opts.length; i++) {
      const prev = opts[i - 1], cur = opts[i];
      const order = prev.category.localeCompare(cur.category) || prev.label.localeCompare(cur.label);
      expect(order).toBeLessThanOrEqual(0);
    }
  });
});

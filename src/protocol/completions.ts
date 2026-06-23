import { globalCommandRegistry } from '../cli/commands/registry';
import { suggestAtSymbols, suggestPaths, looksLikePath } from '../cli/atMention';
import { IGraphStore } from '../graph/models';
import { CompletionItem } from './protocol';

// Engine-side autocomplete — the data behind the Go client's dropdown. Reuses the exact sources the
// Ink UI uses (the live command registry + the @-mention symbol/path suggesters), so completions
// can never drift from what actually exists.

export function completeInput(text: string, store: IGraphStore, cwd: string, limit = 8): CompletionItem[] {
  // Slash command: only while the whole input is a single /token (no space yet).
  if (text.startsWith('/') && !text.includes(' ')) {
    const kw = text.toLowerCase();
    // The slash palette is a scrollable component on the client, so don't truncate it to the small
    // @-mention cap — surface the whole matching command set (just "/" lists every command).
    const cmdLimit = Math.max(limit, 60);
    return globalCommandRegistry.getPaletteOptions()
      .filter(o => o.value.toLowerCase().startsWith(kw))
      .slice(0, cmdLimit)
      .map(o => ({ value: o.value, label: o.label, desc: o.desc, kind: 'command' as const }));
  }

  // @-mention: a trailing @token (symbol or filesystem path).
  const m = text.match(/@([A-Za-z0-9_./~-]*)$/);
  if (m) {
    const token = m[1];
    if (token !== '' && looksLikePath(token)) {
      return suggestPaths(token, cwd, limit).map(r => {
        const [val, type] = r.split(/\s{2,}/); // suggestPaths returns "@<path>  <type>"
        return { value: val, label: val, desc: type || 'path', kind: 'path' as const };
      });
    }
    return suggestAtSymbols(store, token, limit).map(n => ({
      value: '@' + n, label: n, desc: 'symbol', kind: 'symbol' as const,
    }));
  }

  return [];
}

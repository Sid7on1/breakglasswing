import { IGovernor } from '../../core/interfaces';
import { buildTool, BuiltTool } from '../tool.factory';

const SEARCH_TIMEOUT_MS = 15000;

/** Strip tags + decode the few HTML entities that show up in result titles/snippets. */
function clean(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** DuckDuckGo HTML wraps result links in a redirector (…/l/?uddg=<encoded real url>). Unwrap it. */
function resolveHref(href: string): string {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : u.toString();
  } catch {
    return href;
  }
}

/** Parse DuckDuckGo's HTML results page into {title, url, snippet} items. Exported for testing. */
export function parseDuckDuckGoHtml(html: string, max: number): { title: string; url: string; snippet: string }[] {
  const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const titles: { title: string; url: string }[] = [];
  const snippets: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(html)) && titles.length < max) titles.push({ url: resolveHref(m[1]), title: clean(m[2]) });
  while ((m = snippetRe.exec(html)) && snippets.length < max) snippets.push(clean(m[1]));
  return titles.map((t, i) => ({ ...t, snippet: snippets[i] || '' }));
}

/**
 * WebSearchTool — live web search so the agent can look up current docs / library usage / errors
 * instead of relying on stale training data. Uses DuckDuckGo's HTML endpoint (no API key required).
 */
export function createWebSearchTool(governor: IGovernor): BuiltTool {
  return buildTool({
    name: 'WebSearchTool',
    description: `Search the web and return the top results (title, URL, snippet). Use it to look up current library/API usage, errors, docs, or anything your training data may be stale on. Follow up with WebFetchTool to read a result's full page.`,
    isDestructive: false,
    isConcurrencySafe: true,
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        maxResults: { type: 'number', description: 'How many results to return (default 5, max 10).' },
      },
      required: ['query'],
    },
    execute: async (args: { query: string; maxResults?: number }) => {
      const q = (args.query || '').trim();
      if (!q) return 'WebSearchTool needs a non-empty "query".';
      const max = Math.min(Math.max(1, args.maxResults || 5), 10);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
      try {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BiMax-Agent/1.0)', Accept: 'text/html' },
        });
        const html = await res.text();
        const results = parseDuckDuckGoHtml(html, max);
        if (results.length === 0) return `No web results for "${q}".`;
        return `Top ${results.length} result(s) for "${q}":\n\n` +
          results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`).join('\n\n');
      } catch (e: any) {
        if (e.name === 'AbortError') return `Web search timed out after ${SEARCH_TIMEOUT_MS / 1000}s.`;
        return `Web search failed: ${e.message}`;
      } finally {
        clearTimeout(timer);
      }
    },
  }, governor);
}

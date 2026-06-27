// Curated catalog of well-known MCP servers, so the AGENT can DISCOVER a capability by intent
// ("I need to query Postgres", "search the web", "drive a browser") instead of having to already
// know the exact npx package or URL. McpManageTool's `discover` action scores this list against a
// free-text query; `add` accepts a catalog `id` and resolves the full spec automatically.
//
// These are the canonical specs for each server. A few python-based ones use `uvx` (the uv runner);
// the rest are `npx`. Where a server needs credentials we list `needsEnv` so the agent knows to ask
// the user for a key before (or right after) connecting. Connect-time failures are already reported
// with actionable messages by McpManageTool, so a stale package name degrades gracefully.

export interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  /** Local stdio launch. Omit for a remote URL server. */
  command?: string;
  args?: string[];
  /** A positional path/connection arg the agent must fill in (e.g. a folder, a DB URL). */
  argHint?: string;
  /** Remote (hosted) server URL instead of a command. */
  url?: string;
  /** Env vars the server needs (API keys/tokens) — agent should collect these from the user. */
  needsEnv?: string[];
}

export const MCP_CATALOG: CatalogEntry[] = [
  {
    id: 'filesystem',
    title: 'Filesystem',
    description: 'Read/write/search files in folders you expose. Sandboxed to the paths you pass.',
    keywords: ['file', 'files', 'filesystem', 'directory', 'folder', 'read', 'write', 'disk'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'],
    argHint: 'one or more absolute folder paths to expose, e.g. the project root',
  },
  {
    id: 'github',
    title: 'GitHub',
    description: 'Search repos/issues/PRs, read files, create issues and PRs via the GitHub API.',
    keywords: ['github', 'git', 'repo', 'repository', 'issue', 'pull request', 'pr', 'gist'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
    needsEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
  },
  {
    id: 'git',
    title: 'Git (local)',
    description: 'Inspect and operate on a LOCAL git repo — log, diff, blame, status, commit.',
    keywords: ['git', 'commit', 'diff', 'log', 'blame', 'branch', 'local repo'],
    command: 'uvx', args: ['mcp-server-git'],
    argHint: 'optionally --repository <path> to a local git repo',
  },
  {
    id: 'postgres',
    title: 'PostgreSQL',
    description: 'Run read-only SQL queries and inspect schema of a Postgres database.',
    keywords: ['postgres', 'postgresql', 'sql', 'database', 'db', 'query', 'table'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'],
    argHint: 'a postgres connection URL, e.g. postgresql://user:pass@host:5432/db',
  },
  {
    id: 'sqlite',
    title: 'SQLite',
    description: 'Query and explore a local SQLite database file.',
    keywords: ['sqlite', 'sql', 'database', 'db', 'local database', 'query'],
    command: 'uvx', args: ['mcp-server-sqlite', '--db-path'],
    argHint: 'path to the .sqlite/.db file',
  },
  {
    id: 'puppeteer',
    title: 'Browser (Puppeteer)',
    description: 'Drive a headless Chrome — navigate, click, fill forms, screenshot, scrape pages.',
    keywords: ['browser', 'puppeteer', 'chrome', 'web', 'scrape', 'screenshot', 'automation', 'click', 'navigate'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  },
  {
    id: 'playwright',
    title: 'Browser (Playwright)',
    description: 'Cross-browser automation (Chromium/Firefox/WebKit) — navigate, act, snapshot the DOM.',
    keywords: ['browser', 'playwright', 'web', 'automation', 'e2e', 'test', 'scrape', 'dom'],
    command: 'npx', args: ['-y', '@playwright/mcp@latest'],
  },
  {
    id: 'brave-search',
    title: 'Brave Web Search',
    description: 'Search the live web (and local/places) via the Brave Search API.',
    keywords: ['search', 'web search', 'brave', 'google', 'internet', 'lookup', 'find online'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'],
    needsEnv: ['BRAVE_API_KEY'],
  },
  {
    id: 'fetch',
    title: 'Fetch (URL → markdown)',
    description: 'Fetch a web page or API and return clean markdown/text for the model to read.',
    keywords: ['fetch', 'http', 'url', 'web page', 'scrape', 'download', 'request', 'api'],
    command: 'uvx', args: ['mcp-server-fetch'],
  },
  {
    id: 'memory',
    title: 'Knowledge-graph Memory',
    description: 'Persistent knowledge graph the agent can write facts/entities/relations into and recall.',
    keywords: ['memory', 'remember', 'knowledge graph', 'persist', 'recall', 'notes', 'facts'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'sequential-thinking',
    title: 'Sequential Thinking',
    description: 'A structured step-by-step reasoning scratchpad for hard, multi-step problems.',
    keywords: ['thinking', 'reasoning', 'plan', 'step by step', 'chain of thought', 'problem solving'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    id: 'slack',
    title: 'Slack',
    description: 'Read channels and post messages to a Slack workspace.',
    keywords: ['slack', 'chat', 'message', 'channel', 'notify', 'team'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'],
    needsEnv: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
  },
  {
    id: 'google-maps',
    title: 'Google Maps',
    description: 'Geocoding, places search, directions and distance via the Google Maps API.',
    keywords: ['maps', 'google maps', 'location', 'directions', 'geocode', 'places', 'distance', 'address'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-google-maps'],
    needsEnv: ['GOOGLE_MAPS_API_KEY'],
  },
  {
    id: 'gitlab',
    title: 'GitLab',
    description: 'Browse projects, issues and merge requests via the GitLab API.',
    keywords: ['gitlab', 'merge request', 'mr', 'issue', 'repo', 'pipeline'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-gitlab'],
    needsEnv: ['GITLAB_PERSONAL_ACCESS_TOKEN'],
  },
  {
    id: 'sentry',
    title: 'Sentry',
    description: 'Pull error events and issue details from Sentry for debugging.',
    keywords: ['sentry', 'error', 'crash', 'exception', 'monitoring', 'stack trace', 'debug'],
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-sentry'],
    needsEnv: ['SENTRY_AUTH_TOKEN'],
  },
  {
    id: 'time',
    title: 'Time / Timezones',
    description: 'Current time and timezone conversions.',
    keywords: ['time', 'date', 'timezone', 'clock', 'convert time', 'utc'],
    command: 'uvx', args: ['mcp-server-time'],
  },
];

/** Token-overlap score of a free-text query against one entry. Higher = better match. */
function scoreEntry(entry: CatalogEntry, queryTokens: string[]): number {
  const hay = `${entry.id} ${entry.title} ${entry.description} ${entry.keywords.join(' ')}`.toLowerCase();
  let score = 0;
  for (const tok of queryTokens) {
    if (!tok) continue;
    // Exact keyword hit is worth more than a loose substring hit.
    if (entry.keywords.some(k => k === tok)) score += 3;
    else if (entry.keywords.some(k => k.includes(tok) || tok.includes(k))) score += 2;
    else if (hay.includes(tok)) score += 1;
  }
  return score;
}

/** Rank catalog entries by relevance to a plain-language capability query. */
export function discoverServers(query: string, limit = 5): CatalogEntry[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
  if (tokens.length === 0) return MCP_CATALOG.slice(0, limit);
  return MCP_CATALOG
    .map(e => ({ e, s: scoreEntry(e, tokens) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.e);
}

export function catalogEntry(id: string): CatalogEntry | undefined {
  return MCP_CATALOG.find(e => e.id === id.toLowerCase());
}

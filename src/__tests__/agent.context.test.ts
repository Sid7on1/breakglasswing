// Enrichment helper: assembles graph + goals + memory context for orchestrated sub-agents, best-effort.
jest.mock('../graph/codemem/backend', () => ({
  globalCodemem: { isReady: jest.fn(() => false), architecture: jest.fn(), blastRadius: jest.fn() },
}));
jest.mock('../memory/goal.manager', () => ({ getGoalManager: jest.fn(() => ({ getSystemPromptBlock: () => '' })) }));
jest.mock('../memory/project.memory', () => ({ globalProjectMemory: { recallBlock: jest.fn(async () => '') } }));
jest.mock('../memory/context.manager', () => ({ getContextManagerGraphStore: jest.fn(() => null) }));
jest.mock('../graph/pagerank', () => ({ formatRepoMapOutline: jest.fn(() => '') }));

import { buildAgentContextBlock, focusTermsFromText, symbolCandidates } from '../evolution/agent.context';
import { globalCodemem } from '../graph/codemem/backend';
import { getGoalManager } from '../memory/goal.manager';
import { globalProjectMemory } from '../memory/project.memory';

describe('focusTermsFromText', () => {
  it('extracts code-ish identifiers and skips plain prose', () => {
    const terms = focusTermsFromText('refactor getUserToken in src/auth/session.ts and improve speed');
    expect(terms).toContain('getUserToken');
    expect(terms).toContain('src/auth/session.ts');
    expect(terms).not.toContain('improve');
    expect(terms).not.toContain('speed');
  });
});

describe('symbolCandidates (only blast-radius REAL symbols, not capitalized prose)', () => {
  it('keeps camelCase and snake_case identifiers', () => {
    const syms = symbolCandidates('refactor getUserToken and parse_token in the auth flow', 5);
    expect(syms).toContain('getUserToken');
    expect(syms).toContain('parse_token');
  });
  it('excludes capitalized prose that spammed blastRadius (Add/Run/JSDoc)', () => {
    const syms = symbolCandidates('Add a JSDoc comment and Run the TypeScript check', 5);
    expect(syms).not.toContain('Add');
    expect(syms).not.toContain('Run');
    expect(syms).not.toContain('JSDoc');
  });
  it('takes the final segment of a dotted member access', () => {
    expect(symbolCandidates('call obj.doThing here', 5)).toContain('doThing');
  });
  it('does not pull file paths in as symbols', () => {
    const syms = symbolCandidates('edit src/utils/path.util.ts', 5);
    expect(syms.some(s => s.includes('/'))).toBe(false);
  });
});

describe('buildAgentContextBlock', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns empty string when nothing is available (no throw)', async () => {
    const block = await buildAgentContextBlock({ goal: 'g', subtask: 'do a thing' });
    expect(block).toBe('');
  });

  it('includes goals and recalled memory when present', async () => {
    (getGoalManager as jest.Mock).mockReturnValue({ getSystemPromptBlock: () => '## Goals\n- ship auth' });
    (globalProjectMemory.recallBlock as jest.Mock).mockResolvedValue('## Memory\n- always validate input');
    const block = await buildAgentContextBlock({ goal: 'auth', subtask: 'add validation to login' });
    expect(block).toContain('ship auth');
    expect(block).toContain('always validate input');
    expect(block).toContain('Project context');
    expect(block.endsWith('---\n\n')).toBe(true);
  });

  it('includes architecture + blast radius when codemem is ready', async () => {
    (globalCodemem.isReady as jest.Mock).mockReturnValue(true);
    (globalCodemem.architecture as jest.Mock).mockResolvedValue('packages: auth, api');
    (globalCodemem.blastRadius as jest.Mock).mockResolvedValue('12 callers across 4 files');
    const block = await buildAgentContextBlock({ goal: 'g', subtask: 'change parseToken signature' });
    expect(block).toContain('Architecture overview');
    expect(block).toContain('packages: auth, api');
    expect(block).toContain('Blast radius');
    expect(block).toContain('12 callers');
  });

  it('survives a source that throws (best-effort)', async () => {
    (getGoalManager as jest.Mock).mockImplementation(() => { throw new Error('boom'); });
    (globalProjectMemory.recallBlock as jest.Mock).mockResolvedValue('## Memory\n- keep going');
    const block = await buildAgentContextBlock({ goal: 'g', subtask: 't' });
    expect(block).toContain('keep going');   // memory still made it in despite goals throwing
  });
});

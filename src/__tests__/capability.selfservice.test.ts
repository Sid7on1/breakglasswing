// os.homedir() is non-configurable (can't spyOn), so redirect the whole module to a temp home for the
// author() tests. `mock`-prefixed name is required for jest.mock factory hoisting.
let mockTestHome = '';
jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return { ...actual, homedir: () => mockTestHome || actual.homedir() };
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverServers, catalogEntry, MCP_CATALOG } from '../mcp/catalog';
import { SkillService, parseSkillFile } from '../skills/skill.service';

describe('MCP catalog discovery (agent finds a server by intent)', () => {
  it('ranks the right server for a plain-language need', () => {
    expect(discoverServers('I need to query a postgres database')[0].id).toBe('postgres');
    expect(discoverServers('search the web for docs')[0].id).toBe('brave-search');
    expect(discoverServers('drive a headless browser and screenshot a page').map(e => e.id)).toContain('puppeteer');
    expect(discoverServers('control a native desktop app with computer use').map(e => e.id)).toContain('open-computer-use');
    expect(discoverServers('work with github issues and pull requests')[0].id).toBe('github');
  });

  it('returns nothing for an unrelated query (no false install)', () => {
    expect(discoverServers('xyzzy quux frobnicate')).toEqual([]);
  });

  it('resolves a catalog id to a full launch spec', () => {
    const pg = catalogEntry('postgres');
    expect(pg?.command).toBe('npx');
    expect(pg?.args?.join(' ')).toContain('server-postgres');
    expect(catalogEntry('nope')).toBeUndefined();
  });

  it('every catalog entry is installable (has command+args or url)', () => {
    for (const e of MCP_CATALOG) {
      expect(Boolean((e.command && e.args) || e.url)).toBe(true);
      expect(e.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe('SkillService.author (agent writes its own skill)', () => {
  let home: string;
  let svc: SkillService;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-skill-'));
    mockTestHome = home;            // author() writes under os.homedir()/.bimax/skills
    svc = new SkillService();
  });
  afterEach(() => {
    mockTestHome = '';
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes a valid SKILL.md and makes it immediately loadable', () => {
    const res = svc.author({
      name: 'Release Checklist',
      description: 'Use when cutting a release: bump version, update changelog, tag.',
      body: 'Step 1: bump version.\nStep 2: update CHANGELOG.\nStep 3: git tag.',
    });
    expect(res.ok).toBe(true);
    expect(res.name).toBe('release-checklist');               // kebab-cased

    const file = path.join(home, '.bimax', 'skills', 'release-checklist', 'SKILL.md');
    const { meta, body } = parseSkillFile(fs.readFileSync(file, 'utf8'));
    expect(meta.name).toBe('release-checklist');
    expect(meta.description).toContain('cutting a release');
    expect(body).toContain('git tag');

    // Loadable live without restart.
    expect(svc.get('release-checklist')?.description).toContain('cutting a release');
    expect(svc.renderBody('release-checklist')).toContain('Step 1');
  });

  it('writes bundled files inside the skill dir and rejects path escapes', () => {
    const res = svc.author({
      name: 'with-template',
      description: 'Has a bundled template.',
      body: 'Use template.md',
      files: [
        { path: 'template.md', content: '# Template' },
        { path: '../../escape.txt', content: 'should not be written' },
      ],
    });
    expect(res.ok).toBe(true);
    const dir = path.join(home, '.bimax', 'skills', 'with-template');
    expect(fs.existsSync(path.join(dir, 'template.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, 'escape.txt'))).toBe(false);   // escape blocked
  });

  it('refuses to clobber an existing skill unless overwrite=true', () => {
    const a = svc.author({ name: 'dup', description: 'first.', body: 'one' });
    expect(a.ok).toBe(true);
    const b = svc.author({ name: 'dup', description: 'second.', body: 'two' });
    expect(b.ok).toBe(false);
    const c = svc.author({ name: 'dup', description: 'second.', body: 'two', overwrite: true });
    expect(c.ok).toBe(true);
    expect(svc.renderBody('dup')).toContain('two');
  });

  it('validates required fields', () => {
    expect(svc.author({ name: '', description: 'x', body: 'y' }).ok).toBe(false);
    expect(svc.author({ name: 'n', description: '', body: 'y' }).ok).toBe(false);
    expect(svc.author({ name: 'n', description: 'x', body: '' }).ok).toBe(false);
  });
});

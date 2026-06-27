import { projectNameFromPath } from '../graph/codemem/projectName';

// Mirrors codebase-memory-mcp src/pipeline/fqn.c `cbm_project_name_from_path`. The names must
// match byte-for-byte or query tools resolve the wrong (or no) project DB.
describe('projectNameFromPath (codebase-memory slug parity)', () => {
  it('slugs a unix path, separators -> dashes', () => {
    expect(projectNameFromPath('/Users/vish/Desktop/Bimax')).toBe('Users-vish-Desktop-Bimax');
  });

  it('matches the C docstring example /tmp/bench/... -> tmp-bench-...', () => {
    expect(projectNameFromPath('/tmp/bench/foo')).toBe('tmp-bench-foo');
  });

  it('maps spaces and other unsafe chars to dash (issue #349 case)', () => {
    expect(projectNameFromPath('/home/u/my project')).toBe('home-u-my-project');
  });

  it('collapses consecutive dashes and dots', () => {
    expect(projectNameFromPath('/a//b   c')).toBe('a-b-c');
    expect(projectNameFromPath('/a..b')).toBe('a.b');
  });

  it('trims leading dashes/dots and trailing dashes', () => {
    expect(projectNameFromPath('/.hidden/')).toBe('hidden');
    expect(projectNameFromPath('///')).toBe('root');
  });

  it('preserves the allowed [A-Za-z0-9._-] set', () => {
    expect(projectNameFromPath('/repo/my_app-2.0')).toBe('repo-my_app-2.0');
  });

  it('falls back to "root" for empty/degenerate input', () => {
    expect(projectNameFromPath('')).toBe('root');
    expect(projectNameFromPath('/')).toBe('root');
  });
});

import { resolvePath, countOccurrences } from '../tools/path.util';

describe('resolvePath', () => {
  const fakeCwd = '/project/root';

  it('returns cwd when input is empty', () => {
    expect(resolvePath('', fakeCwd)).toBe(fakeCwd);
  });

  it('expands ~ to the home directory', () => {
    const result = resolvePath('~', fakeCwd);
    expect(result).toBe(require('os').homedir());
  });

  it('expands ~/sub/path correctly', () => {
    const home = require('os').homedir();
    expect(resolvePath('~/docs/notes.md', fakeCwd)).toBe(
      require('path').join(home, 'docs/notes.md'),
    );
  });

  it('resolves a relative path against cwd', () => {
    expect(resolvePath('src/index.ts', fakeCwd)).toBe(
      require('path').resolve(fakeCwd, 'src/index.ts'),
    );
  });

  it('resolves a nested relative path', () => {
    expect(resolvePath('a/b/c.txt', fakeCwd)).toBe(
      require('path').resolve(fakeCwd, 'a/b/c.txt'),
    );
  });

  it('handles cwd with a trailing slash', () => {
    const cwd = '/project/root/';
    expect(resolvePath('file.ts', cwd)).toBe(
      require('path').resolve(cwd, 'file.ts'),
    );
  });
});

describe('countOccurrences', () => {
  it('returns 0 for an empty needle', () => {
    expect(countOccurrences('abc', '')).toBe(0);
  });

  it('returns 0 when needle is not found', () => {
    expect(countOccurrences('hello world', 'xyz')).toBe(0);
  });

  it('returns 0 for an empty haystack', () => {
    expect(countOccurrences('', 'a')).toBe(0);
  });

  it('counts a single occurrence', () => {
    expect(countOccurrences('hello', 'll')).toBe(1);
  });

  it('counts multiple non-overlapping occurrences', () => {
    expect(countOccurrences('ababab', 'ab')).toBe(3);
  });

  it('does not count overlapping occurrences', () => {
    // 'aaa' contains 'aa' at index 0 and index 1, but they overlap;
    // the implementation advances past the match, so only 1 is counted.
    expect(countOccurrences('aaa', 'aa')).toBe(1);
  });

  it('returns 0 when needle is longer than haystack', () => {
    expect(countOccurrences('hi', 'hello')).toBe(0);
  });

  it('counts occurrences at the end of the string', () => {
    expect(countOccurrences('banana', 'na')).toBe(2);
  });

  it('handles special regex-like characters in needle literally', () => {
    // needle is passed to indexOf, so no regex interpretation occurs
 expect(countOccurrences('a.b.c', '.')).toBe(2);
 });
});


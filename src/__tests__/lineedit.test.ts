import { editLine } from '../cli/components/SimpleInput';

// `offset` is the cursor distance from the END of the string (SimpleInput's model).
describe('editLine — shell-style line editing', () => {
  it('home/end move the cursor without changing the text', () => {
    expect(editLine('home', 'hello world', 0)).toEqual({ value: 'hello world', offset: 11 });
    expect(editLine('end', 'hello world', 11)).toEqual({ value: 'hello world', offset: 0 });
  });

  it('killEnd (Ctrl+K) drops everything after the cursor', () => {
    // cursor after "hello " (offset 5 from end → before="hello ", after="world")
    expect(editLine('killEnd', 'hello world', 5)).toEqual({ value: 'hello ', offset: 0 });
  });

  it('killStart (Ctrl+U) drops everything before the cursor', () => {
    expect(editLine('killStart', 'hello world', 5)).toEqual({ value: 'world', offset: 5 });
  });

  it('deleteWord (Ctrl+W) removes the word before the cursor, incl. trailing spaces', () => {
    // cursor at end: "foo bar " → delete "bar " (and its trailing space) → "foo "
    expect(editLine('deleteWord', 'foo bar ', 0)).toEqual({ value: 'foo ', offset: 0 });
    // mid-string: before="foo bar", after=" baz" → "foo  baz"
    expect(editLine('deleteWord', 'foo bar baz', 4)).toEqual({ value: 'foo  baz', offset: 4 });
  });

  it('deleteWord on leading text clears it', () => {
    expect(editLine('deleteWord', 'hello', 0)).toEqual({ value: '', offset: 0 });
  });
});

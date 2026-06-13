import { ResponseSanitizer } from '../core/response.sanitizer';

const san = new ResponseSanitizer();
const strip = (s: string) => san.stripFiller(s);

describe('ResponseSanitizer.stripFiller — removes whole-line tool-meta filler', () => {
  it('removes a standalone "no function call is needed" line', () => {
    expect(strip('No function call is needed for this response.')).toBe('');
  });

  it('removes "no tool call is required" variants', () => {
    expect(strip('No tool call is required here.')).toBe('');
  });

  it('removes "no function calls necessary"', () => {
    expect(strip('No function calls necessary for this.')).toBe('');
  });

  it('removes a leaked "I will now call X tool" line', () => {
    expect(strip('I will now call the BashTool function.')).toBe('');
  });

  it('removes "let me use the X tool" narration', () => {
    expect(strip('Let me use the Bash tool to check that.')).toBe('');
  });

  it('removes "there is no need to call a tool"', () => {
    expect(strip('There is no need to call a tool here.')).toBe('');
  });

  it("removes \"I don't need to use any tools\"", () => {
    expect(strip("I don't need to use any tools for this.")).toBe('');
  });

  it('tolerates list/quote markers and indentation before the filler', () => {
    expect(strip('- No function call is needed.')).toBe('');
    expect(strip('> I will now call the BashTool function.')).toBe('');
    expect(strip('   No tool call is required.')).toBe('');
  });
});

describe('ResponseSanitizer.stripFiller — preserves genuine content', () => {
  it('keeps the real answer when filler precedes it', () => {
    expect(strip('No function call is needed.\n\nThe capital of France is Paris.'))
      .toBe('The capital of France is Paris.');
  });

  it('keeps the real answer when filler follows it', () => {
    expect(strip('The capital of France is Paris.\nNo function call is needed.'))
      .toBe('The capital of France is Paris.');
  });

  it('leaves a normal greeting untouched', () => {
    expect(strip('Hey! What are we building today?')).toBe('Hey! What are we building today?');
  });

  it('does not eat a sentence that merely mentions function calls', () => {
    const s = 'This function is called on every render, so keep it cheap.';
    expect(strip(s)).toBe(s);
  });

  it('does not eat prose explaining when a tool would be needed', () => {
    const s = 'A function call is needed whenever you want to read a file from disk.';
    // This is real explanatory content, not the standalone "no ... needed" filler.
    expect(strip(s)).toBe(s);
  });

  it('collapses the blank run left behind by a removed middle line', () => {
    expect(strip('Here is the plan:\nNo function call is needed.\nStep one is to build.'))
      .toBe('Here is the plan:\n\nStep one is to build.');
  });
});

describe('ResponseSanitizer.sanitize — flags a turn that was nothing but filler', () => {
  it('reports wasPureFiller for a filler-only turn', () => {
    const r = san.sanitize('No function call is needed for this response.');
    expect(r.text).toBe('');
    expect(r.wasPureFiller).toBe(true);
  });

  it('does NOT flag a turn that still has a real answer', () => {
    const r = san.sanitize('No function call is needed.\n\nParis.');
    expect(r.text).toBe('Paris.');
    expect(r.wasPureFiller).toBe(false);
  });

  it('does NOT flag a genuinely empty turn (nothing to regenerate from)', () => {
    expect(san.sanitize('').wasPureFiller).toBe(false);
    expect(san.sanitize('   \n  ').wasPureFiller).toBe(false);
  });

  it('does NOT flag a normal reply', () => {
    const r = san.sanitize('Hey! What are we building today?');
    expect(r.text).toBe('Hey! What are we building today?');
    expect(r.wasPureFiller).toBe(false);
  });
});

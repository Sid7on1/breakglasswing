import {
  classifyExecutorLevel,
  describeLevel,
  isLegalDescent,
  levelForMechanism,
} from '../executor.ladder';

describe('Desktop executor ladder completion contract', () => {
  it('maps the existing runtime mechanism choice instead of inventing a second router', () => {
    expect(levelForMechanism('accessibility')).toBe('semantic');
    expect(levelForMechanism('browser-automation')).toBe('semantic');
    expect(levelForMechanism('physical-foreground')).toBe('physical');
    expect(levelForMechanism('sidecar-background')).toBe('physical');
    expect(levelForMechanism('unsupported')).toBe('stop');
  });

  it('attributes visual grounding and refusal without flattering the receipt', () => {
    expect(classifyExecutorLevel({ mechanism: 'accessibility', visualOnlyTarget: true })).toBe('visual');
    expect(classifyExecutorLevel({ mechanism: 'physical-foreground', refused: true })).toBe('stop');
    expect(describeLevel('stop', { refused: true })).toContain('refused');
  });

  it('permits fallback only toward weaker levels inside one action', () => {
    expect(isLegalDescent('semantic', 'physical')).toBe(true);
    expect(isLegalDescent('physical', 'visual')).toBe(true);
    expect(isLegalDescent('visual', 'stop')).toBe(true);
    expect(isLegalDescent('visual', 'semantic')).toBe(false);
  });
});

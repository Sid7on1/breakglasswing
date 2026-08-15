import {
  EXECUTOR_ORDER,
  classifyExecutorLevel,
  describeLevel,
  isLegalDescent,
  levelForMechanism,
} from '../executor.ladder';

describe('the one product executor ladder', () => {
  it('keeps the architecture order exact', () => {
    expect(EXECUTOR_ORDER).toEqual(['semantic', 'physical', 'visual', 'stop']);
  });

  it.each([
    ['accessibility', 'semantic'],
    ['browser-automation', 'semantic'],
    ['physical-foreground', 'physical'],
    ['sidecar-background', 'physical'],
    ['unsupported', 'stop'],
  ] as const)('maps the existing %s mechanism to %s', (mechanism, level) => {
    expect(levelForMechanism(mechanism)).toBe(level);
  });

  it('reports visual grounding even when delivery used a stronger mechanism', () => {
    expect(classifyExecutorLevel({
      mechanism: 'accessibility',
      visualOnlyTarget: true,
    })).toBe('visual');
    expect(describeLevel('visual')).toMatch(/recognised on-screen text/i);
  });

  it('reports a refusal as stop instead of the mechanism that was contemplated', () => {
    const evidence = {
      mechanism: 'physical-foreground',
      refused: true,
    } as const;
    expect(classifyExecutorLevel(evidence)).toBe('stop');
    expect(describeLevel('stop', evidence)).toMatch(/refused.*before delivery/i);
  });

  it('allows descent and rejects a silent climb within one action', () => {
    expect(isLegalDescent('semantic', 'physical')).toBe(true);
    expect(isLegalDescent('physical', 'stop')).toBe(true);
    expect(isLegalDescent('visual', 'semantic')).toBe(false);
  });
});

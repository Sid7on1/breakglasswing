import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  elementSignature, diffSnapshots, matchesElementFilter, denormalizeCoordinate,
  SnapshotElementInfo,
} from '../browser/browser.runtime';
import {
  screenshotFromToolResult, buildScreenshotObservation, pruneScreenshotObservations,
  SCREENSHOT_OBSERVATION_MARKER, MAX_SCREENSHOT_BYTES,
} from '../core/multimodal';

// Deterministic fixtures for the observation layer: successor diffs, progressive filters,
// normalized coordinates, and the vision screenshot→next-turn pipeline. No browser launched.

const el = (over: Partial<SnapshotElementInfo>): SnapshotElementInfo => ({
  tag: 'button', role: 'button', name: 'Run', ...over,
});

describe('snapshot successor diff', () => {
  it('reports added and removed elements by signature, order-independently', () => {
    const prev = [el({ name: 'Run' }), el({ name: 'Cancel' })].map(elementSignature);
    const next = [el({ name: 'Cancel' }), el({ name: 'Save' })].map(elementSignature);
    const diff = diffSnapshots(prev, next);
    expect(diff.changed).toBe(true);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]).toContain('Save');
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]).toContain('Run');
  });

  it('treats identical snapshots as unchanged even when reordered', () => {
    const a = [el({ name: 'A' }), el({ name: 'B' })].map(elementSignature);
    const b = [el({ name: 'B' }), el({ name: 'A' })].map(elementSignature);
    expect(diffSnapshots(a, b).changed).toBe(false);
  });

  it('sees value and checked state changes (a typed field or toggled box IS a change)', () => {
    const before = [elementSignature(el({ tag: 'input', role: 'input', name: 'Name', value: 'old' }))];
    const after = [elementSignature(el({ tag: 'input', role: 'input', name: 'Name', value: 'BiMax' }))];
    const diff = diffSnapshots(before, after);
    expect(diff.changed).toBe(true);
    expect(diff.added[0]).toContain('BiMax');
  });

  it('handles duplicate signatures by count (two identical buttons → removing one is a change)', () => {
    const twice = [elementSignature(el({})), elementSignature(el({}))];
    const once = [elementSignature(el({}))];
    const diff = diffSnapshots(twice, once);
    expect(diff.changed).toBe(true);
    expect(diff.removed).toHaveLength(1);
  });

  it('caps reported add/remove lists at 20 on a full page swap', () => {
    const prev = Array.from({ length: 50 }, (_, i) => elementSignature(el({ name: `old-${i}` })));
    const next = Array.from({ length: 50 }, (_, i) => elementSignature(el({ name: `new-${i}` })));
    const diff = diffSnapshots(prev, next);
    expect(diff.added).toHaveLength(20);
    expect(diff.removed).toHaveLength(20);
    expect(diff.changed).toBe(true);
  });
});

describe('progressive element filter', () => {
  it('matches case-insensitively across name, role, tag and type', () => {
    const info = el({ name: 'Submit order', role: 'button', tag: 'button', type: 'submit' });
    expect(matchesElementFilter(info, 'submit')).toBe(true);
    expect(matchesElementFilter(info, 'ORDER')).toBe(true);
    expect(matchesElementFilter(info, 'button')).toBe(true);
    expect(matchesElementFilter(info, 'checkbox')).toBe(false);
  });

  it('empty or whitespace filter matches everything', () => {
    expect(matchesElementFilter(el({}), undefined)).toBe(true);
    expect(matchesElementFilter(el({}), '   ')).toBe(true);
  });
});

describe('normalized coordinate mapping (0–1000 VLM space)', () => {
  it('denormalizes with the reference math and clamps into the viewport', () => {
    expect(denormalizeCoordinate(500, 1280)).toBe(640);
    expect(denormalizeCoordinate(0, 1280)).toBe(0);
    expect(denormalizeCoordinate(1000, 1280)).toBe(1279); // clamped to the last pixel
    expect(denormalizeCoordinate(2000, 100)).toBe(99);
    expect(denormalizeCoordinate(-50, 100)).toBe(0);
  });

  it('degrades to 0 on nonsense sizes instead of NaN', () => {
    expect(denormalizeCoordinate(500, 0)).toBe(0);
    expect(denormalizeCoordinate(NaN, 100)).toBe(0);
  });
});

describe('screenshot → next-turn vision observation', () => {
  it('extracts the screenshot path only from a successful BrowserTool result', () => {
    const ok = JSON.stringify({ ok: true, action: 'screenshot', screenshot: '/tmp/shot.png' });
    expect(screenshotFromToolResult('BrowserTool', ok)).toBe('/tmp/shot.png');
    expect(screenshotFromToolResult('BashTool', ok)).toBeNull();
    expect(screenshotFromToolResult('BrowserTool', JSON.stringify({ ok: false, screenshot: '/tmp/shot.png' }))).toBeNull();
    expect(screenshotFromToolResult('BrowserTool', 'not json')).toBeNull();
    expect(screenshotFromToolResult('BrowserTool', JSON.stringify({ ok: true, action: 'assert' }))).toBeNull();
  });

  it('builds a marked user message with the image, and refuses missing or oversized files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-vision-'));
    try {
      const shot = path.join(dir, 'page.png');
      fs.writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // tiny PNG-ish payload
      const msg = buildScreenshotObservation(shot);
      expect(msg).not.toBeNull();
      expect(msg!.role).toBe('user');
      expect(Array.isArray(msg!.content)).toBe(true);
      expect((msg!.content[0] as any).text).toContain(SCREENSHOT_OBSERVATION_MARKER);
      expect((msg!.content[0] as any).text).toContain('screen DATA');
      expect((msg!.content[1] as any).image_url.url).toMatch(/^data:image\/png;base64,/);

      expect(buildScreenshotObservation(path.join(dir, 'missing.png'))).toBeNull();

      const big = path.join(dir, 'big.png');
      fs.writeFileSync(big, Buffer.alloc(MAX_SCREENSHOT_BYTES + 1));
      expect(buildScreenshotObservation(big)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prunes to the newest observations without touching other messages', () => {
    const obs = (n: number) => ({
      role: 'user',
      content: [{ type: 'text', text: `${SCREENSHOT_OBSERVATION_MARKER} shot ${n}` }, { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }],
    });
    const messages: any[] = [
      { role: 'user', content: 'do the thing' },
      obs(1),
      { role: 'assistant', content: 'working' },
      obs(2),
      { role: 'user', content: [{ type: 'text', text: 'a real user image turn' }] },
      obs(3),
    ];
    pruneScreenshotObservations(messages, 2);
    const remaining = messages.filter(m => Array.isArray(m.content) && String(m.content[0]?.text || '').startsWith(SCREENSHOT_OBSERVATION_MARKER));
    expect(remaining).toHaveLength(2);
    expect((remaining[0].content[0] as any).text).toContain('shot 2');
    expect((remaining[1].content[0] as any).text).toContain('shot 3');
    expect(messages.some(m => m.content === 'do the thing')).toBe(true);
    expect(messages.some(m => Array.isArray(m.content) && (m.content[0] as any)?.text === 'a real user image turn')).toBe(true);
  });
});

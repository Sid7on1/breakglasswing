import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  looksLikeImagePath,
  imagePartFromSource,
  buildUserContent,
  contentToText,
  extractImagePaths,
  IMAGE_EXTENSIONS,
} from '../core/multimodal';

describe('looksLikeImagePath', () => {
  it('accepts known raster extensions, case-insensitively', () => {
    expect(looksLikeImagePath('a.png')).toBe(true);
    expect(looksLikeImagePath('shot.JPG')).toBe(true);
    expect(looksLikeImagePath('/x/y/z.jpeg')).toBe(true);
    expect(looksLikeImagePath('anim.GIF')).toBe(true);
    expect(looksLikeImagePath('logo.webp')).toBe(true);
  });
  it('rejects non-images and extension-less paths', () => {
    expect(looksLikeImagePath('notes.txt')).toBe(false);
    expect(looksLikeImagePath('report.pdf')).toBe(false);
    expect(looksLikeImagePath('Makefile')).toBe(false);
    expect(looksLikeImagePath('')).toBe(false);
  });
  it('exposes the supported extension set', () => {
    expect(IMAGE_EXTENSIONS).toContain('png');
    expect(IMAGE_EXTENSIONS).toContain('webp');
  });
});

describe('imagePartFromSource', () => {
  it('passes through data and http(s) URLs verbatim', () => {
    expect(imagePartFromSource('data:image/png;base64,AAAA')).toEqual({
      type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' },
    });
    expect(imagePartFromSource('https://x/y.png')?.image_url.url).toBe('https://x/y.png');
    expect(imagePartFromSource('http://x/y.jpg')?.image_url.url).toBe('http://x/y.jpg');
  });
  it('returns null for an unknown extension', () => {
    expect(imagePartFromSource('/tmp/file.txt')).toBeNull();
    expect(imagePartFromSource('/tmp/noext')).toBeNull();
  });
  it('returns null for an unreadable file', () => {
    expect(imagePartFromSource('/no/such/dir/missing.png')).toBeNull();
  });
  it('base64-encodes a real local file into a data URL with the right mime', () => {
    const p = path.join(os.tmpdir(), 'bimax-mm-test.png');
    fs.writeFileSync(p, Buffer.from([1, 2, 3, 4]));
    try {
      const part = imagePartFromSource(p);
      expect(part?.type).toBe('image_url');
      expect(part?.image_url.url).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}`);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('buildUserContent', () => {
  it('returns plain text when no images are attached', () => {
    const r = buildUserContent('hello', [], true);
    expect(r.content).toBe('hello');
    expect(r.attached).toBe(0);
    expect(r.notice).toBeUndefined();
  });

  it('drops images with a notice when the model has no vision', () => {
    const r = buildUserContent('describe this', ['data:image/png;base64,AA'], false);
    expect(r.content).toBe('describe this');
    expect(r.attached).toBe(0);
    expect(r.notice).toMatch(/no vision support/i);
  });

  it('builds array content with the text part first for a vision model', () => {
    const r = buildUserContent('what is this', ['data:image/png;base64,AA'], true);
    expect(Array.isArray(r.content)).toBe(true);
    const parts = r.content as any[];
    expect(parts[0]).toEqual({ type: 'text', text: 'what is this' });
    expect(parts[1].type).toBe('image_url');
    expect(r.attached).toBe(1);
    expect(r.notice).toBeUndefined();
  });

  it('falls back to text when every image fails to load', () => {
    const r = buildUserContent('hi', ['/no/such.png'], true);
    expect(r.content).toBe('hi');
    expect(r.attached).toBe(0);
    expect(r.notice).toMatch(/could not load/i);
  });

  it('attaches the loadable images and reports the failed ones', () => {
    const r = buildUserContent('look', ['data:image/png;base64,AA', '/no/such.png'], true);
    expect(r.attached).toBe(1);
    expect(r.notice).toMatch(/could not load/i);
  });

  it('ignores blank sources', () => {
    const r = buildUserContent('x', ['', '   '], true);
    expect(r.content).toBe('x');
    expect(r.attached).toBe(0);
  });
});

describe('extractImagePaths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bimax-extract-'));
  const img = path.join(dir, 'pic.png');
  beforeAll(() => fs.writeFileSync(img, Buffer.from([0])));
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('finds an existing image path referenced by absolute path', () => {
    expect(extractImagePaths(`describe ${img} please`, process.cwd())).toEqual([img]);
  });
  it('resolves a relative path against cwd and tolerates a leading @ and trailing punctuation', () => {
    expect(extractImagePaths('look at @pic.png.', dir)).toEqual([img]);
  });
  it('ignores image-looking tokens that do not exist on disk', () => {
    expect(extractImagePaths('see ghost.png here', dir)).toEqual([]);
  });
  it('ignores non-image tokens and dedupes repeats', () => {
    expect(extractImagePaths(`x ${img} y ${img} notes.txt`, process.cwd())).toEqual([img]);
  });
  it('returns empty for a plain prompt', () => {
    expect(extractImagePaths('just some text', process.cwd())).toEqual([]);
  });
});

describe('contentToText', () => {
  it('passes strings through and flattens part arrays', () => {
    expect(contentToText('plain')).toBe('plain');
    expect(contentToText(undefined)).toBe('');
    expect(contentToText([
      { type: 'text', text: 'a' },
      { type: 'image_url', image_url: { url: 'data:...' } },
      { type: 'text', text: 'b' },
    ])).toBe('a\n[image]\nb');
  });
});

import { validateFetchUrl, htmlToText } from '../tools/implementations/webfetch.tool';

describe('validateFetchUrl', () => {
  it('accepts public http/https URLs', () => {
    expect(validateFetchUrl('https://example.com/docs').ok).toBe(true);
    expect(validateFetchUrl('http://api.github.com/repos').ok).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(validateFetchUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateFetchUrl('ftp://example.com').ok).toBe(false);
  });

  it('rejects loopback and private network hosts', () => {
    for (const u of [
      'http://localhost:3000/admin',
      'http://127.0.0.1/secret',
      'http://10.0.0.5/internal',
      'http://192.168.1.1/router',
      'http://172.16.0.1/',
      'http://169.254.169.254/latest/meta-data', // cloud metadata endpoint
      'http://service.internal/api',
    ]) {
      const res = validateFetchUrl(u);
      expect(res.ok).toBe(false);
    }
  });

  it('rejects malformed URLs', () => {
    expect(validateFetchUrl('not a url').ok).toBe(false);
  });
});

describe('htmlToText', () => {
  it('strips tags, scripts, and styles while keeping text', () => {
    const html = `<html><head><style>body{color:red}</style>
      <script>alert('x')</script></head>
      <body><h1>Title</h1><p>Hello &amp; welcome.</p><div>Line</div></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain('Title');
    expect(text).toContain('Hello & welcome.');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('<');
  });

  it('decodes common entities and collapses whitespace', () => {
    expect(htmlToText('a&nbsp;&lt;b&gt;   c')).toBe('a <b> c');
  });
});

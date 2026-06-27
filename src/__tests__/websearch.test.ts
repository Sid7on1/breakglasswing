import { parseDuckDuckGoHtml } from '../tools/implementations/websearch.tool';

// A trimmed snippet of DuckDuckGo's HTML results shape.
const SAMPLE = `
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fapi%2Ffs.html&rut=abc">Node.js fs &amp; docs</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">The <b>fs</b> module enables interacting with the file system.</a>
</div>
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="https://example.com/page">Example &lt;Page&gt;</a>
  <a class="result__snippet" href="#">A second result snippet.</a>
</div>
`;

describe('parseDuckDuckGoHtml', () => {
  it('extracts title, unwrapped url, and snippet', () => {
    const out = parseDuckDuckGoHtml(SAMPLE, 5);
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('Node.js fs & docs');
    expect(out[0].url).toBe('https://nodejs.org/api/fs.html'); // uddg redirect unwrapped
    expect(out[0].snippet).toContain('file system');
    // HTML entities in the title are decoded, tags stripped.
    expect(out[1].title).toBe('Example <Page>');
  });

  it('respects the max-results cap', () => {
    expect(parseDuckDuckGoHtml(SAMPLE, 1)).toHaveLength(1);
  });

  it('returns empty on non-result HTML', () => {
    expect(parseDuckDuckGoHtml('<html><body>nothing here</body></html>', 5)).toEqual([]);
  });
});

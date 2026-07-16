#!/usr/bin/env node
// Deterministic OpenAI-compatible mock provider for latency/streaming tests.
//
// Streams `chat/completions` responses token-by-token over SSE with a controllable
// cadence, so every millisecond of Bimax overhead can be measured without a live
// (and variable) provider in the loop.
//
//   node scripts/mock-provider.mjs [port]
//
// Env:
//   MOCK_TTFT_MS       delay before the first token (default 120)
//   MOCK_TOKEN_MS      delay between tokens (default 25)
//   MOCK_TOKENS        number of tokens in the reply (default 40)
//   MOCK_REPLY         fixed reply text (overrides MOCK_TOKENS; split on spaces)
//   MOCK_THINK         when "1", prefix the reply with a <think>…</think> block
//
// Per-request overrides via the model name suffix, e.g. "mock?ttft=500&tok=5&n=200".
import http from 'node:http';

const PORT = parseInt(process.argv[2] || '8901', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tokensFor(opts) {
  if (opts.reply) return opts.reply.match(/\S+\s*/g) || [];
  const words = ['stream', 'tokens', 'arrive', 'one', 'at', 'a', 'time', 'so', 'the', 'UI', 'renders', 'them', 'incrementally', 'without', 'bursting'];
  const out = [];
  for (let i = 0; i < opts.n; i++) out.push(words[i % words.length] + ' ');
  return out;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock', object: 'model' }] }));
    return;
  }
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404); res.end();
    return;
  }
  let body = '';
  for await (const c of req) body += c;
  let parsed = {};
  try { parsed = JSON.parse(body); } catch { /* ignore */ }

  const q = new URLSearchParams((parsed.model || '').split('?')[1] || '');
  const opts = {
    ttft: parseInt(q.get('ttft') || process.env.MOCK_TTFT_MS || '120', 10),
    tok: parseInt(q.get('tok') || process.env.MOCK_TOKEN_MS || '25', 10),
    n: parseInt(q.get('n') || process.env.MOCK_TOKENS || '40', 10),
    reply: q.get('reply') || process.env.MOCK_REPLY || '',
    think: (q.get('think') || process.env.MOCK_THINK || '') === '1',
  };
  const toks = tokensFor(opts);
  const id = 'chatcmpl-mock';
  const chunk = (delta, finish = null) =>
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  if (parsed.stream === false) {
    const text = (opts.think ? '' : '') + toks.join('');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id, object: 'chat.completion', created: 0, model: 'mock', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: toks.length, total_tokens: 10 + toks.length } }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(chunk({ role: 'assistant' }));
  await sleep(opts.ttft);
  let aborted = false;
  req.on('close', () => { aborted = true; });
  if (opts.think) {
    for (const t of ['<think>', 'reasoning ', 'quietly ', 'here ', '</think>']) {
      if (aborted) return;
      res.write(chunk({ content: t }));
      await sleep(opts.tok);
    }
  }
  for (const t of toks) {
    if (aborted) return;
    res.write(chunk({ content: t }));
    await sleep(opts.tok);
  }
  res.write(chunk({}, 'stop'));
  res.write('data: [DONE]\n\n');
  res.end();
});

server.listen(PORT, () => console.log(`mock provider on http://127.0.0.1:${PORT}/v1  (ttft=${process.env.MOCK_TTFT_MS || 120}ms tok=${process.env.MOCK_TOKEN_MS || 25}ms)`));

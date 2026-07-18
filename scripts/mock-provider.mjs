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
//   MOCK_TOOL_CALL     JSON {"name": "...", "arguments": {...}} — the FIRST request gets a
//                      single tool_calls delta (finish_reason "tool_calls") for this call
//                      instead of a text reply. Every later request (the follow-up turn after
//                      the tool result comes back) gets a normal short text reply, so the agent
//                      loop actually finishes instead of looping. Used to drive real approval
//                      prompts (e.g. ComputerTool) through the PTY harness deterministically.
//   MOCK_TOOL_CALLS    JSON array of the same shape — pops one tool call per request, in order,
//                      so a multi-step agentic task (open → type → key → close) can be scripted
//                      as a sequence of real approval round-trips. Once exhausted, falls through
//                      to a normal text reply. Takes priority over MOCK_TOOL_CALL.
//
// Per-request overrides via the model name suffix, e.g. "mock?ttft=500&tok=5&n=200".
import http from 'node:http';

const PORT = parseInt(process.argv[2] || '8901', 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let toolCallFired = false;
let toolCallQueue = null;
try { if (process.env.MOCK_TOOL_CALLS) toolCallQueue = JSON.parse(process.env.MOCK_TOOL_CALLS); } catch { toolCallQueue = null; }

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

  // Pop one scripted tool call per request (queue mode), or fire the single one-shot call on the
  // first request only. Either way, once exhausted every later request falls through to plain
  // text so the agent loop actually finishes instead of looping forever.
  let toolCall = null;
  if (toolCallQueue && toolCallQueue.length > 0) {
    toolCall = toolCallQueue.shift();
  } else if (process.env.MOCK_TOOL_CALL && !toolCallFired) {
    toolCallFired = true;
    try { toolCall = JSON.parse(process.env.MOCK_TOOL_CALL); } catch { toolCall = null; }
  }

  if (toolCall) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(chunk({ role: 'assistant', content: '' }));
    await sleep(opts.ttft);
    res.write(chunk({
      tool_calls: [{
        index: 0, id: `call_mock_${Date.now()}`, type: 'function',
        function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments || {}) },
      }],
    }));
    res.write(chunk({}, 'tool_calls'));
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

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

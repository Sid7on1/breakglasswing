import { EventEmitter } from 'events';
import { JsonRpcConnection, LineBuffer, RpcError, RpcErrorCode } from '../protocol/acp/jsonrpc';
import { AcpAgent, AcpSessionDriver } from '../protocol/acp/agent';
import { AgentMethod, ClientMethod, ACP_PROTOCOL_VERSION, StopReason, promptText, toolKind } from '../protocol/acp/types';

/** A connection wired to an in-memory sink; `feed` parses a JSON message in. */
function harness() {
  const out: any[] = [];
  const errors: Error[] = [];
  const conn = new JsonRpcConnection((line) => out.push(JSON.parse(line)), (e) => errors.push(e));
  const feed = (msg: any) => conn.handleLine(JSON.stringify(msg));
  return { conn, out, errors, feed };
}

describe('JsonRpcConnection', () => {
  it('dispatches a request to its handler and writes a result response', async () => {
    const { conn, out, feed } = harness();
    conn.on('add', (p: { a: number; b: number }) => p.a + p.b);
    feed({ jsonrpc: '2.0', id: 7, method: 'add', params: { a: 2, b: 3 } });
    await new Promise((r) => setImmediate(r));
    expect(out).toEqual([{ jsonrpc: '2.0', id: 7, result: 5 }]);
  });

  it('returns MethodNotFound for an unknown request, but ignores unknown notifications', async () => {
    const { conn, out, feed } = harness();
    feed({ jsonrpc: '2.0', id: 1, method: 'nope' });
    feed({ jsonrpc: '2.0', method: 'also-nope' }); // notification → dropped
    await new Promise((r) => setImmediate(r));
    expect(out).toHaveLength(1);
    expect(out[0].error.code).toBe(RpcErrorCode.MethodNotFound);
  });

  it('maps a thrown RpcError to a JSON-RPC error response', async () => {
    const { conn, out, feed } = harness();
    conn.on('boom', () => { throw new RpcError(RpcErrorCode.InvalidParams, 'bad params'); });
    feed({ jsonrpc: '2.0', id: 2, method: 'boom' });
    await new Promise((r) => setImmediate(r));
    expect(out[0].error).toMatchObject({ code: RpcErrorCode.InvalidParams, message: 'bad params' });
  });

  it('correlates a response to an outbound request', async () => {
    const { conn, out } = harness();
    const p = conn.request('ping', { x: 1 });
    expect(out[0]).toMatchObject({ method: 'ping', id: 1, params: { x: 1 } });
    conn.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'pong' }));
    await expect(p).resolves.toBe('pong');
  });

  it('rejects an outbound request when the peer returns an error', async () => {
    const { conn } = harness();
    const p = conn.request('do');
    conn.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'nope' } }));
    await expect(p).rejects.toBeInstanceOf(RpcError);
  });

  it('emits a ParseError for malformed JSON', () => {
    const { conn, out } = harness();
    conn.handleLine('{not json');
    expect(out[0].error.code).toBe(RpcErrorCode.ParseError);
  });

  it('close() rejects all in-flight requests', async () => {
    const { conn } = harness();
    const p = conn.request('slow');
    conn.close();
    await expect(p).rejects.toThrow(/closed/);
  });
});

describe('LineBuffer', () => {
  it('splits complete lines and holds a partial tail across chunks', () => {
    const lb = new LineBuffer();
    expect(lb.push('{"a":1}\n{"b":2}\n{"c":')).toEqual(['{"a":1}', '{"b":2}']);
    expect(lb.push('3}\n')).toEqual(['{"c":3}']);
    expect(lb.flush()).toBeNull();
  });

  it('flush() returns an unterminated trailing line', () => {
    const lb = new LineBuffer();
    expect(lb.push('partial')).toEqual([]);
    expect(lb.flush()).toBe('partial');
  });
});

describe('toolKind heuristic', () => {
  it('classifies common Bimax tool names', () => {
    expect(toolKind('BashTool')).toBe('execute');
    expect(toolKind('EditTool')).toBe('edit');
    expect(toolKind('WriteTool')).toBe('edit');
    expect(toolKind('ReadTool')).toBe('read');
    expect(toolKind('ScoutTool')).toBe('search');
    expect(toolKind('WebSearchTool')).toBe('search');
    expect(toolKind('BrowserTool')).toBe('execute');
    expect(toolKind('SomethingWeird')).toBe('other');
  });
});

describe('promptText', () => {
  it('flattens text, resource_link, and embedded resource blocks', () => {
    expect(promptText([
      { type: 'text', text: 'fix' },
      { type: 'resource_link', uri: 'src/a.ts' },
      { type: 'resource', resource: { uri: 'x', text: 'context' } },
      { type: 'image', mimeType: 'image/png', data: '...' },
    ])).toBe('fix\n@src/a.ts\ncontext');
  });
});

/** A driver that streams a couple of tokens through the event seam, then ends the turn. */
class FakeDriver implements AcpSessionDriver {
  readonly events = new EventEmitter();
  public cancelled = false;
  newSession() { return 'sess-1'; }
  async prompt(sessionId: string, _text: string, signal: AbortSignal): Promise<StopReason> {
    this.events.emit('stream_token', 'Hello ');
    this.events.emit('stream_token', 'world');
    this.events.emit('message', { role: 'system', content: '◇ note' });
    if (signal.aborted) return 'cancelled';
    return 'end_turn';
  }
  cancel() { this.cancelled = true; }
}

describe('AcpAgent', () => {
  function agentHarness() {
    const out: any[] = [];
    const conn = new JsonRpcConnection((line) => out.push(JSON.parse(line)));
    const driver = new FakeDriver();
    const agent = new AcpAgent(conn, driver);
    const feed = (msg: any) => conn.handleLine(JSON.stringify(msg));
    return { conn, out, driver, agent, feed };
  }

  it('initialize negotiates the protocol version and advertises capabilities', async () => {
    const { out, feed } = agentHarness();
    feed({ jsonrpc: '2.0', id: 1, method: AgentMethod.Initialize, params: { protocolVersion: 99 } });
    await new Promise((r) => setImmediate(r));
    const res = out[0].result;
    expect(res.protocolVersion).toBe(ACP_PROTOCOL_VERSION); // clamped down from 99
    expect(res.authMethods).toEqual([]);
    expect(res.agentCapabilities.promptCapabilities.image).toBe(true);
  });

  it('session/new returns a session id from the driver', async () => {
    const { out, feed } = agentHarness();
    feed({ jsonrpc: '2.0', id: 2, method: AgentMethod.NewSession, params: { cwd: '/tmp' } });
    await new Promise((r) => setImmediate(r));
    expect(out[0].result).toEqual({ sessionId: 'sess-1' });
  });

  it('session/prompt streams tokens as agent_message_chunk updates and ends with a stopReason', async () => {
    const { out, feed } = agentHarness();
    feed({ jsonrpc: '2.0', id: 3, method: AgentMethod.Prompt, params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'hi' }] } });
    await new Promise((r) => setImmediate(r));

    const updates = out.filter((m) => m.method === ClientMethod.SessionUpdate);
    const chunks = updates.filter((u) => u.params.update.sessionUpdate === 'agent_message_chunk').map((u) => u.params.update.content.text);
    expect(chunks).toEqual(['Hello ', 'world', '◇ note']); // 2 tokens + 1 system message
    for (const u of updates) expect(u.params.sessionId).toBe('sess-1');

    const response = out.find((m) => m.id === 3);
    expect(response.result).toEqual({ stopReason: 'end_turn' });
  });

  it('detaches its streaming listeners after the turn (no leak across prompts)', async () => {
    const { out, driver, feed } = agentHarness();
    feed({ jsonrpc: '2.0', id: 4, method: AgentMethod.Prompt, params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'hi' }] } });
    await new Promise((r) => setImmediate(r));
    const before = out.length;
    // A stray token emitted OUTSIDE a turn must not produce an update.
    driver.events.emit('stream_token', 'leak');
    expect(out.length).toBe(before);
    expect(driver.events.listenerCount('stream_token')).toBe(0);
  });

  it('bridges veto_prompt to session/request_permission and resolves with the chosen option', async () => {
    const out: any[] = [];
    const conn = new JsonRpcConnection((line) => out.push(JSON.parse(line)));
    const driver = new FakeDriver();
    let approved: string | undefined;
    // Override prompt to raise an approval mid-turn and capture the resolved answer.
    driver.prompt = async (sessionId: string) => {
      await new Promise<void>((resolve) => {
        driver.events.emit('veto_prompt', 'Run rm -rf?', ['Approve', 'Reject'], (ans: string) => { approved = ans; resolve(); });
      });
      return 'end_turn';
    };
    new AcpAgent(conn, driver);
    conn.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 5, method: AgentMethod.Prompt, params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'go' }] } }));
    await new Promise((r) => setImmediate(r));

    const permReq = out.find((m) => m.method === ClientMethod.RequestPermission);
    expect(permReq.params.options.map((o: any) => o.optionId)).toEqual(['Approve', 'Reject']);
    // Editor selects "Approve".
    conn.handleLine(JSON.stringify({ jsonrpc: '2.0', id: permReq.id, result: { outcome: { outcome: 'selected', optionId: 'Approve' } } }));
    await new Promise((r) => setImmediate(r));
    expect(approved).toBe('Approve');
  });

  it('maps tool_call/tool_call_result to ACP tool_call + tool_call_update, deduped per id', async () => {
    const out: any[] = [];
    const conn = new JsonRpcConnection((line) => out.push(JSON.parse(line)));
    const driver = new FakeDriver();
    driver.prompt = async (_sid: string) => {
      // Bimax emits tool_call TWICE for one id (partial + authoritative), then a result.
      driver.events.emit('tool_call', { id: 't1', toolName: 'BashTool', input: '{"cmd":"ls"}', status: 'running' });
      driver.events.emit('tool_call', { id: 't1', toolName: 'BashTool', input: '{"cmd":"ls -la"}', status: 'running' });
      driver.events.emit('tool_call_result', { id: 't1', toolName: 'BashTool', output: 'a.ts\nb.ts', status: 'success' });
      return 'end_turn';
    };
    new AcpAgent(conn, driver);
    conn.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 9, method: AgentMethod.Prompt, params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'ls' }] } }));
    await new Promise((r) => setImmediate(r));

    const updates = out.filter((m) => m.method === ClientMethod.SessionUpdate).map((m) => m.params.update);
    const starts = updates.filter((u) => u.sessionUpdate === 'tool_call');
    const finishes = updates.filter((u) => u.sessionUpdate === 'tool_call_update');
    expect(starts).toHaveLength(1); // deduped despite two tool_call emits
    expect(starts[0]).toMatchObject({ toolCallId: 't1', title: 'BashTool', kind: 'execute', status: 'in_progress', rawInput: { cmd: 'ls' } });
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({ toolCallId: 't1', status: 'completed' });
    expect(finishes[0].content[0].content.text).toBe('a.ts\nb.ts');
  });

  it('marks a failed tool result as status failed', async () => {
    const out: any[] = [];
    const conn = new JsonRpcConnection((line) => out.push(JSON.parse(line)));
    const driver = new FakeDriver();
    driver.prompt = async () => {
      driver.events.emit('tool_call_result', { id: 't2', toolName: 'EditTool', output: 'boom', status: 'error' });
      return 'end_turn';
    };
    new AcpAgent(conn, driver);
    conn.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 10, method: AgentMethod.Prompt, params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'x' }] } }));
    await new Promise((r) => setImmediate(r));
    const finishes = out.filter((m) => m.method === ClientMethod.SessionUpdate).map((m) => m.params.update).filter((u) => u.sessionUpdate === 'tool_call_update');
    expect(finishes[0]).toMatchObject({ toolCallId: 't2', status: 'failed' });
  });

  it('session/cancel aborts the turn and flips the stopReason to cancelled', async () => {
    const out: any[] = [];
    const conn = new JsonRpcConnection((line) => out.push(JSON.parse(line)));
    const driver = new FakeDriver();
    driver.prompt = (sessionId: string, _t: string, signal: AbortSignal) =>
      new Promise<StopReason>((resolve) => {
        signal.addEventListener('abort', () => resolve('cancelled'));
      });
    new AcpAgent(conn, driver);
    conn.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 6, method: AgentMethod.Prompt, params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'go' }] } }));
    await new Promise((r) => setImmediate(r));
    conn.handleLine(JSON.stringify({ jsonrpc: '2.0', method: AgentMethod.Cancel, params: { sessionId: 'sess-1' } }));
    await new Promise((r) => setImmediate(r));
    expect(driver.cancelled).toBe(true);
    const response = out.find((m) => m.id === 6);
    expect(response.result).toEqual({ stopReason: 'cancelled' });
  });
});

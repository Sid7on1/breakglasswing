import {
  COMPUTER_SCHEMA,
  createComputerMcpCallHandler,
  createLaunchFlagAuthorizer,
} from '../mcp/computer.server';

describe('external computer MCP surface', () => {
  it('uses the public action catalog and rejects unknown fields', () => {
    const properties = (COMPUTER_SCHEMA.properties as Record<string, any>);
    expect(properties.action.enum).toContain('observe');
    expect(COMPUTER_SCHEMA.additionalProperties).toBe(false);
    expect(properties.fullDisplayToken).toBeUndefined();
  });

  it('is read-only without a host approval broker', async () => {
    const run = jest.fn(async (_command: unknown, _context: unknown) => ({ ok: true }));
    const call = createComputerMcpCallHandler({ run } as any, '/workspace');
    await expect(call({ action: 'observe', pid: 42 })).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);

    await expect(call({ action: 'click', x: 1, y: 2 })).resolves.toMatchObject({
      ok: false, code: 'external_approval_unavailable', action: 'click',
    });
    expect(run).toHaveBeenCalledTimes(1);

    await expect(call({ action: 'not_a_real_action' })).resolves.toMatchObject({
      ok: false, code: 'invalid_external_action',
    });
  });

  it('executes an acting verb only after the injected broker approves it', async () => {
    const run = jest.fn(async (_command: unknown, _context: unknown) => ({
      ok: true, actionResult: { status: 'delivered' },
    }));
    const denied = createComputerMcpCallHandler({ run } as any, '/workspace', async () => ({
      allowed: false, reason: 'human declined',
    }));
    await expect(denied({ action: 'type', text: 'hello' })).resolves.toMatchObject({
      ok: false, code: 'external_action_denied', error: 'human declined',
    });
    expect(run).not.toHaveBeenCalled();

    const approved = createComputerMcpCallHandler({ run } as any, '/workspace', async command =>
      command.action === 'type');
    await expect(approved({ action: 'type', text: 'hello', fullDisplayToken: 'forged' }))
      .resolves.toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).not.toHaveProperty('fullDisplayToken');
  });

  it('the launch-flag broker allows acting verbs and announces each one for audit', async () => {
    const run = jest.fn(async (_command: unknown, _context: unknown) => ({ ok: true }));
    const lines: string[] = [];
    const call = createComputerMcpCallHandler(
      { run } as any, '/workspace', createLaunchFlagAuthorizer(line => lines.push(line)),
    );

    await expect(call({ action: 'click', query: 'Send' })).resolves.toMatchObject({ ok: true });
    await expect(call({ action: 'type', text: 'hello' })).resolves.toMatchObject({ ok: true });
    expect(run).toHaveBeenCalledTimes(2);

    // The operator's only visibility into what a remote agent drove is this log, so the target has
    // to be in it — "an acting verb happened" is not an audit trail.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('click');
    expect(lines[0]).toContain('Send');
    expect(lines[1]).toContain('hello');
  });

  it('read-only verbs are never announced, because they were never gated', async () => {
    const run = jest.fn(async (_command: unknown, _context: unknown) => ({ ok: true }));
    const lines: string[] = [];
    const call = createComputerMcpCallHandler(
      { run } as any, '/workspace', createLaunchFlagAuthorizer(line => lines.push(line)),
    );
    await call({ action: 'observe' });
    expect(lines).toHaveLength(0);
  });
});

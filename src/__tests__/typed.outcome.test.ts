import { buildTool } from '../tools/tool.factory';
import {
  outcomeOk, outcomeError, outcomeRejected, outcomeBlocked, isTypedOutcome,
  classifiedError, typedFromError, TypedOutcome,
} from '../tools/outcome';
import { createBashTool } from '../tools/implementations/bash.tool';
import { createEditFileTool } from '../tools/implementations/edit.tool';
import { IGovernor } from '../core/interfaces';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const governor = { approveTaskExecution: jest.fn().mockResolvedValue(undefined) } as unknown as IGovernor;

describe('typed tool outcomes (v2 Phase 0)', () => {
  it('factory unwraps a TypedOutcome: caller gets the plain text, context gets the typed part', async () => {
    const tool = buildTool({
      name: 'TypedTool', description: 't', schema: { type: 'object', properties: {} },
      execute: async () => outcomeError('not_found', 'Error: nope'),
    }, governor);
    let reported: TypedOutcome | undefined;
    const res = await tool.execute({}, { reportOutcome: (o: TypedOutcome) => { reported = o; } });
    expect(res).toBe('Error: nope');                      // wire behavior: string, unchanged
    expect(reported?.status).toBe('error');
    expect(reported?.errorClass).toBe('not_found');
    expect(reported?.confidence).toBe('high');
  });

  it('legacy tools (plain string return) report nothing — callers fall back to the regex classifier', async () => {
    const tool = buildTool({
      name: 'LegacyTool', description: 't', schema: { type: 'object', properties: {} },
      execute: async () => 'Error: something prose-y',
    }, governor);
    let reported: TypedOutcome | undefined;
    const res = await tool.execute({}, { reportOutcome: (o: TypedOutcome) => { reported = o; } });
    expect(res).toBe('Error: something prose-y');
    expect(reported).toBeUndefined();
  });

  it('typedFromError recovers classification from classified throws and governor vetoes', () => {
    const e = classifiedError('boom', 'timeout');
    expect(typedFromError(e, 'Tool Error: boom')).toMatchObject({ status: 'error', errorClass: 'timeout' });
    const blocked = classifiedError('no', 'permission', 'blocked');
    expect(typedFromError(blocked, 'x')).toMatchObject({ status: 'blocked', errorClass: 'permission' });
    const veto: any = new Error('veto'); veto.name = 'GovernorVetoError';
    expect(typedFromError(veto, 'x')).toMatchObject({ status: 'blocked', errorClass: 'permission' });
    expect(typedFromError(new Error('plain'), 'x')).toBeUndefined();
  });

  it('constructors produce consistent statuses', () => {
    expect(outcomeOk('y').status).toBe('ok');
    expect(outcomeRejected('n').status).toBe('rejected');
    expect(outcomeBlocked('n')).toMatchObject({ status: 'blocked', errorClass: 'permission' });
    expect(isTypedOutcome(outcomeOk('y'))).toBe(true);
    expect(isTypedOutcome('Error: prose')).toBe(false);
    expect(isTypedOutcome({ status: 'ok' })).toBe(false);
  });

  it('BashTool declares exit codes: 0 on success, the real code on a useful failure', async () => {
    let reported: TypedOutcome | undefined;
    const ctx = { cwd: process.cwd(), reportOutcome: (o: TypedOutcome) => { reported = o; } };
    await createBashTool(governor).execute({ command: 'echo ok' }, ctx);
    expect(reported).toMatchObject({ status: 'ok', exitCode: 0 });

    await createBashTool(governor).execute({ command: 'echo failing_output; exit 3' }, ctx);
    expect(reported).toMatchObject({ status: 'ok', exitCode: 3 });   // ran fine, evidence is red
  });

  it('EditFileTool declares its error classes (not_found / ambiguous / invalid_args)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgw-typed-'));
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'alpha\nbeta\nalpha\n');
    let reported: TypedOutcome | undefined;
    const ctx = { cwd: dir, reportOutcome: (o: TypedOutcome) => { reported = o; } };
    const tool = createEditFileTool(governor);
    try {
      await tool.execute({ path: file, oldString: 'MISSING_TOKEN_XYZ', newString: 'x' }, ctx);
      expect(reported?.errorClass).toBe('not_found');
      await tool.execute({ path: file, oldString: 'alpha', newString: 'x' }, ctx);
      expect(reported?.errorClass).toBe('ambiguous_match');
      await tool.execute({ path: file, oldString: 'beta', newString: 'beta' }, ctx);
      expect(reported?.errorClass).toBe('invalid_args');
      await tool.execute({ path: file, oldString: 'beta', newString: 'gamma' }, ctx);
      expect(reported?.status).toBe('ok');
      expect(fs.readFileSync(file, 'utf8')).toContain('gamma');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  approveManualAlphaService,
  inspectManualAlphaService,
  revokeManualAlphaService,
} from '../manual-alpha.trust';
import { __resetAdHocApprovalCacheForTests } from '../../capabilities/mac/adhoc.approval.store';

const describeMac = process.platform === 'darwin' ? describe : describe.skip;
const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

function service(dir: string, permissions: Record<string, unknown>): string {
  const file = join(dir, `service-${Math.random().toString(16).slice(2)}`);
  const payload = JSON.stringify({
    selectedProtocol: 'bimax.cu.v1',
    serviceVersion: 'test-1',
    permissions,
  });
  writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${payload}'\n`, { mode: 0o700 });
  chmodSync(file, 0o700);
  return file;
}

describeMac('manual-alpha exact-hash Trust Center bridge', () => {
  let dir: string;
  let prior: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bimax-manual-alpha-'));
    prior = process.env.BIMAX_BREAKGLASS_DIR;
    process.env.BIMAX_BREAKGLASS_DIR = join(dir, 'state');
    __resetAdHocApprovalCacheForTests();
  });

  afterEach(() => {
    if (prior === undefined) delete process.env.BIMAX_BREAKGLASS_DIR;
    else process.env.BIMAX_BREAKGLASS_DIR = prior;
    __resetAdHocApprovalCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it('requires explicit consent, approves the exact intact seal, and revokes it', async () => {
    const binary = service(dir, {
      serviceSigned: false,
      adHocSigned: true,
      signatureIntact: true,
      codeDirectoryHash: HASH_A,
    });

    expect(await inspectManualAlphaService(binary)).toMatchObject({
      state: 'approval-required', ready: false, canApprove: true, codeDirectoryHash: HASH_A,
    });
    expect(await approveManualAlphaService(binary, HASH_A)).toMatchObject({
      state: 'approved-ad-hoc', ready: true, canApprove: false, approvedHash: HASH_A,
    });
    expect(await revokeManualAlphaService(binary)).toMatchObject({
      state: 'approval-required', ready: false, canApprove: true,
    });
  });

  it('kills wrong-hash and tampered-service mutants', async () => {
    const intact = service(dir, {
      serviceSigned: false,
      adHocSigned: true,
      signatureIntact: true,
      codeDirectoryHash: HASH_A,
    });
    expect(await approveManualAlphaService(intact, HASH_B)).toMatchObject({ ready: false });

    const tampered = service(dir, {
      serviceSigned: false,
      adHocSigned: true,
      signatureIntact: false,
      codeDirectoryHash: HASH_A,
    });
    expect(await inspectManualAlphaService(tampered)).toMatchObject({
      state: 'invalid', ready: false, canApprove: false,
    });
  });
});

import { mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { globalCommandRegistry } from '../cli/commands/registry';
import {
  BIMAX_CU_PROTOCOL,
  globalNativeServiceCapabilityClient,
  type NativeServiceHandshake,
} from '../computer/native.service.client';
import {
  __resetAdHocApprovalCacheForTests,
  currentAdHocServiceApproval,
  recordAdHocServiceApproval,
} from '../computer/adhoc.approval.store';
import '../cli/commands/computer'; // registers /computer

// /computer trust-service is the user's half of the ad-hoc trust decision. What matters here is
// what it REFUSES: the command must never offer to approve a binary whose seal does not verify,
// and must never record consent for bytes the user was not shown.

const CDHASH = '0fa45ab41e395b996479ea2de29ccdaaf7cefd7c';
const OTHER = 'cafebabe'.repeat(5);

function permissions(over: Record<string, unknown> = {}): NativeServiceHandshake['permissions'] {
  return {
    accessibility: 'granted', screenRecording: 'granted', screenCapturable: true,
    inputMonitoring: 'not_required', serviceSigned: false,
    adHocSigned: true, signatureIntact: true, codeDirectoryHash: CDHASH,
    ...over,
  } as NativeServiceHandshake['permissions'];
}

function probeResult(perms: NativeServiceHandshake['permissions']) {
  return {
    configured: true, reachable: true, routingEligible: false, cutoverBlockers: [],
    binary: '/tmp/bimax-cu-service', attempts: 1,
    handshake: {
      selectedProtocol: BIMAX_CU_PROTOCOL, serviceVersion: '0.6.0',
      platform: { os: 'macos', version: 'test', architecture: 'arm64' },
      permissions: perms,
    } as unknown as NativeServiceHandshake,
  };
}

let dir: string;
let messages: { level: string; msg: string }[];
const originalDir = process.env.BIMAX_BREAKGLASS_DIR;
let probeSpy: jest.SpyInstance;

function ctx(): any {
  return {
    cwd: '/tmp/project',
    options: {},
    addSystemMessage: (level: string, msg: string) => { messages.push({ level, msg }); },
    executeCommand: jest.fn(),
    setActiveMenu: jest.fn(),
    setActivePrompt: jest.fn(),
    saveConfig: jest.fn(),
  };
}

const said = () => messages.map(m => m.msg).join('\n');

function serviceIs(perms: NativeServiceHandshake['permissions']): void {
  probeSpy.mockResolvedValue(probeResult(perms) as any);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bimax-trust-service-'));
  process.env.BIMAX_BREAKGLASS_DIR = dir;
  __resetAdHocApprovalCacheForTests();
  messages = [];
  probeSpy = jest.spyOn(globalNativeServiceCapabilityClient, 'probe');
  jest.spyOn(globalNativeServiceCapabilityClient, 'invalidate').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalDir === undefined) delete process.env.BIMAX_BREAKGLASS_DIR;
  else process.env.BIMAX_BREAKGLASS_DIR = originalDir;
  __resetAdHocApprovalCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('/computer trust-service — what it refuses', () => {
  test('a binary modified after it was sealed is refused and never offered for approval', async () => {
    serviceIs(permissions({ signatureIntact: false }));
    const result: any = await globalCommandRegistry.execute('/computer trust-service', ctx());
    expect(result.type).toBe('none'); // no menu — there is nothing here to consent to
    expect(said()).toMatch(/REFUSED/);
    expect(said()).toMatch(/modified after it was sealed/i);
    expect(currentAdHocServiceApproval()).toBeUndefined();
  });

  test('an entirely unsigned binary has no seal to pin, and approval is not a substitute', async () => {
    serviceIs(permissions({ adHocSigned: false, signatureIntact: false, codeDirectoryHash: undefined }));
    const result: any = await globalCommandRegistry.execute('/computer trust-service', ctx());
    expect(result.type).toBe('none');
    expect(said()).toMatch(/no signature at all/i);
    expect(currentAdHocServiceApproval()).toBeUndefined();
  });

  test('a production-signed service has nothing to approve', async () => {
    serviceIs(permissions({ serviceSigned: true, adHocSigned: false, signingIdentifier: 'ai.bimax.cu.service' }));
    const result: any = await globalCommandRegistry.execute('/computer trust-service', ctx());
    expect(result.type).toBe('none');
    expect(said()).toMatch(/nothing to approve/i);
    expect(currentAdHocServiceApproval()).toBeUndefined();
  });

  test('an unreachable service offers nothing', async () => {
    probeSpy.mockResolvedValue({
      configured: true, reachable: false, routingEligible: false,
      cutoverBlockers: ['service_unreachable'], attempts: 2, error: 'spawn ENOENT',
    } as any);
    const result: any = await globalCommandRegistry.execute('/computer trust-service', ctx());
    expect(result.type).toBe('none');
    expect(said()).toMatch(/not reachable/i);
    expect(currentAdHocServiceApproval()).toBeUndefined();
  });

  test('confirming a hash the service no longer reports records nothing', async () => {
    // Re-signing ad-hoc is free, so between the disclosure and the confirmation the binary could
    // have been swapped for another perfectly intact one. The user consented to bytes, not to a
    // command, and this is the check that keeps those the same thing.
    serviceIs(permissions({ codeDirectoryHash: OTHER }));
    const result: any = await globalCommandRegistry.execute(`/computer trust-service approve ${CDHASH}`, ctx());
    expect(result.type).toBe('none');
    expect(said()).toMatch(/REFUSED/);
    expect(said()).toMatch(/changed since that hash was shown/i);
    expect(currentAdHocServiceApproval()).toBeUndefined();
  });

  test('approving without naming a hash records nothing', async () => {
    serviceIs(permissions());
    await globalCommandRegistry.execute('/computer trust-service approve', ctx());
    expect(said()).toMatch(/requires the hash you were shown/i);
    expect(currentAdHocServiceApproval()).toBeUndefined();
  });
});

describe('/computer trust-service — informed consent', () => {
  test('the disclosure shows the full hash and states plainly what is NOT proven', async () => {
    serviceIs(permissions());
    const result: any = await globalCommandRegistry.execute('/computer trust-service', ctx());

    expect(said()).toContain(CDHASH); // the full hash, not an abbreviation
    expect(said()).toMatch(/NOT verified.*WHO built it/s);
    expect(said()).toMatch(/names nobody/i);
    expect(said()).toMatch(/has not been altered since it was sealed/i);
    expect(said()).toMatch(/Nothing is approved yet/i);

    // Nothing is recorded by merely looking.
    expect(currentAdHocServiceApproval()).toBeUndefined();
    expect(result.type).toBe('menu');
    const approve = result.options.find((o: any) => o.value.startsWith('/computer trust-service approve'));
    // The approve action carries the exact hash that was displayed, so the confirmation can check
    // that it is still the running one.
    expect(approve.value).toBe(`/computer trust-service approve ${CDHASH}`);
  });

  test('approving the running binary records it, and the run is still not called signed', async () => {
    serviceIs(permissions());
    await globalCommandRegistry.execute(`/computer trust-service approve ${CDHASH}`, ctx());

    const approval = currentAdHocServiceApproval();
    expect(approval?.codeDirectoryHash).toBe(CDHASH);
    expect(approval?.serviceVersion).toBe('0.6.0');
    expect(approval?.binary).toBe('/tmp/bimax-cu-service');
    // Advisory, never silent: the blocker survives approval so no later surface can imply this
    // build carried a production identity.
    expect(said()).toMatch(/service_ad_hoc_user_approved/);
    expect(globalNativeServiceCapabilityClient.invalidate).toHaveBeenCalled();
  });

  test('revoking withdraws it', async () => {
    recordAdHocServiceApproval({ codeDirectoryHash: CDHASH });
    serviceIs(permissions());
    await globalCommandRegistry.execute('/computer trust-service revoke', ctx());
    expect(currentAdHocServiceApproval()).toBeUndefined();
    expect(said()).toMatch(/withdrawn/i);
  });

  test('an approval for a different binary is reported as NOT the running one', async () => {
    recordAdHocServiceApproval({ codeDirectoryHash: OTHER });
    serviceIs(permissions());
    const result: any = await globalCommandRegistry.execute('/computer trust-service', ctx());
    expect(said()).toMatch(/this is NOT the running binary/);
    // Still approvable — the user can consent to the binary actually in front of them.
    expect(result.options.some((o: any) => o.value === `/computer trust-service approve ${CDHASH}`)).toBe(true);
  });
});

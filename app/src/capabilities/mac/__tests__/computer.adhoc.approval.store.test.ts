import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, statSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  __resetAdHocApprovalCacheForTests,
  adHocApprovalStorePath,
  currentAdHocServiceApproval,
  readAdHocServiceApproval,
  recordAdHocServiceApproval,
  revokeAdHocServiceApproval,
} from '../adhoc.approval.store';
import { assessAdHocServiceTrust } from '../native.service.client';

// The store is the user's half of the ad-hoc trust decision, so these tests are about one
// question: can anything other than an explicit approval by THIS user end up being read as one?

const CDHASH = '0fa45ab41e395b996479ea2de29ccdaaf7cefd7c';
const OTHER = 'deadbeef'.repeat(5);

let dir: string;
const original = process.env.BIMAX_BREAKGLASS_DIR;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bimax-adhoc-approval-'));
  process.env.BIMAX_BREAKGLASS_DIR = dir;
  __resetAdHocApprovalCacheForTests();
});

afterEach(() => {
  if (original === undefined) delete process.env.BIMAX_BREAKGLASS_DIR;
  else process.env.BIMAX_BREAKGLASS_DIR = original;
  __resetAdHocApprovalCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

/** Write the store file directly, as a hostile or legacy writer would. */
function plant(contents: string, mode = 0o600): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(adHocApprovalStorePath(), contents, { mode });
  chmodSync(adHocApprovalStorePath(), mode);
  __resetAdHocApprovalCacheForTests();
}

describe('ad-hoc service approval store', () => {
  test('nothing is approved until the user approves something', () => {
    expect(readAdHocServiceApproval()).toEqual({});
    expect(currentAdHocServiceApproval()).toBeUndefined();
  });

  test('records, reads back, and revokes one approval', () => {
    const written = recordAdHocServiceApproval({ codeDirectoryHash: CDHASH, serviceVersion: '0.6.0', binary: '/tmp/bimax-cu-service' });
    expect(written.ok).toBe(true);

    const approval = currentAdHocServiceApproval();
    expect(approval?.codeDirectoryHash).toBe(CDHASH);
    expect(approval?.serviceVersion).toBe('0.6.0');
    expect(Date.parse(approval!.approvedAt)).not.toBeNaN();

    expect(revokeAdHocServiceApproval().ok).toBe(true);
    expect(currentAdHocServiceApproval()).toBeUndefined();
  });

  test('the record is owner-only on disk', () => {
    recordAdHocServiceApproval({ codeDirectoryHash: CDHASH });
    expect(statSync(adHocApprovalStorePath()).mode & 0o777).toBe(0o600);
  });

  test('approving replaces rather than accumulates, so a stale hash cannot be fallen back to', () => {
    recordAdHocServiceApproval({ codeDirectoryHash: CDHASH });
    recordAdHocServiceApproval({ codeDirectoryHash: OTHER });
    const approval = currentAdHocServiceApproval();
    expect(approval?.codeDirectoryHash).toBe(OTHER);
    // And the superseded binary is now refused with the precise reason, not a generic one — that
    // message is only reachable because the store keeps a single current approval.
    const permissions = { accessibility: 'granted', screenRecording: 'granted', screenCapturable: true, inputMonitoring: 'not_required', serviceSigned: false, adHocSigned: true, signatureIntact: true, codeDirectoryHash: CDHASH };
    expect(assessAdHocServiceTrust(permissions, approval).reason).toMatch(/changed since it was approved/i);
  });

  test('an in-process write is visible immediately despite the stat-guarded cache', () => {
    expect(currentAdHocServiceApproval()).toBeUndefined(); // primes the "absent" cache entry
    recordAdHocServiceApproval({ codeDirectoryHash: CDHASH });
    expect(currentAdHocServiceApproval()?.codeDirectoryHash).toBe(CDHASH);
    revokeAdHocServiceApproval();
    expect(currentAdHocServiceApproval()).toBeUndefined();
  });

  test('the hash is normalised, so case or padding cannot look like a different binary', () => {
    recordAdHocServiceApproval({ codeDirectoryHash: `  ${CDHASH.toUpperCase()}  ` });
    expect(currentAdHocServiceApproval()?.codeDirectoryHash).toBe(CDHASH);
  });

  test('refuses to record something that is not a code directory hash', () => {
    for (const bad of ['', '   ', 'not-a-hash', 'abc', `${CDHASH}zz`, '*']) {
      const result = recordAdHocServiceApproval({ codeDirectoryHash: bad });
      expect(result.ok).toBe(false);
      expect(currentAdHocServiceApproval()).toBeUndefined();
    }
  });
});

describe('a planted or corrupt store fails CLOSED', () => {
  test('a corrupt file approves nothing and says why', () => {
    plant('{ not json');
    const result = readAdHocServiceApproval();
    expect(result.approval).toBeUndefined();
    expect(result.refusedReason).toMatch(/not valid JSON/i);
  });

  test('a wildcard-shaped hash is not a wildcard', () => {
    // The gate compares by exact string, so these could never match a real service — they are
    // rejected here so the surface says "nothing approved" rather than "approval mismatch".
    for (const junk of ['*', '', '.*', CDHASH.slice(0, 8)]) {
      plant(JSON.stringify({ codeDirectoryHash: junk, approvedAt: new Date().toISOString() }));
      expect(currentAdHocServiceApproval()).toBeUndefined();
    }
  });

  test('an approval another account could have written is refused, not repaired', () => {
    // chmod-on-read cannot un-plant a record that is already on disk, so a group/world-writable
    // store is refused outright rather than tightened and trusted.
    plant(JSON.stringify({ codeDirectoryHash: CDHASH, approvedAt: new Date().toISOString() }), 0o666);
    const result = readAdHocServiceApproval();
    expect(result.approval).toBeUndefined();
    expect(result.refusedReason).toMatch(/writable by group or others/i);
    // Refused means refused: the file is left exactly as it was for the user to inspect.
    expect(statSync(adHocApprovalStorePath()).mode & 0o777).toBe(0o666);
  });

  test('a symlinked store is not followed, in either direction', () => {
    const elsewhere = path.join(os.tmpdir(), `bimax-adhoc-target-${process.pid}.json`);
    writeFileSync(elsewhere, JSON.stringify({ codeDirectoryHash: CDHASH, approvedAt: new Date().toISOString() }), { mode: 0o600 });
    mkdirSync(dir, { recursive: true });
    symlinkSync(elsewhere, adHocApprovalStorePath());
    __resetAdHocApprovalCacheForTests();
    try {
      const result = readAdHocServiceApproval();
      expect(result.approval).toBeUndefined();
      expect(result.refusedReason).toMatch(/symlink/i);
      // Writing through it would clobber the attacker-chosen target with our content.
      const written = recordAdHocServiceApproval({ codeDirectoryHash: OTHER });
      expect(written.ok).toBe(false);
      expect(written.error).toMatch(/symlink/i);
    } finally {
      rmSync(elsewhere, { force: true });
    }
  });

  test('the store is not reachable through an environment variable', () => {
    // The cardinal rule of this design: any process that can set the environment could forge an
    // approval, so no env var may supply one. BIMAX_BREAKGLASS_DIR relocates WHERE the file lives
    // (as it does for config and secrets) but cannot BE the approval.
    process.env.BIMAX_CU_ALLOW_UNSIGNED_SERVICE = '1';
    process.env.BIMAX_CU_ADHOC_APPROVAL = CDHASH;
    process.env.BIMAX_CU_SERVICE_APPROVED = '1';
    try {
      expect(currentAdHocServiceApproval()).toBeUndefined();
    } finally {
      delete process.env.BIMAX_CU_ALLOW_UNSIGNED_SERVICE;
      delete process.env.BIMAX_CU_ADHOC_APPROVAL;
      delete process.env.BIMAX_CU_SERVICE_APPROVED;
    }
  });
});

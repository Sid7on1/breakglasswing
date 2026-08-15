import { mkdtempSync, readFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  NativeRolloutController,
  NativeRolloutRollbackError,
  classifyNativeRolloutError,
  nativeRolloutBucket,
} from '../native.rollout';

describe('native Phase 9 rollout controller', () => {
  test('assigns a cohort deterministically and keeps holdouts closed', () => {
    const bucket = nativeRolloutBucket('release-one', 'install-one');
    expect(bucket).toBe(nativeRolloutBucket('release-one', 'install-one'));
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(10_000);

    const selected = new NativeRolloutController({
      mode: 'cohort', rolloutId: 'release-one', cohortKey: 'install-one',
      cohortBps: bucket + 1, evidenceApproved: true, statePath: null,
    });
    expect(selected.status()).toMatchObject({ selected: true, state: 'eligible', bucket });

    const holdout = new NativeRolloutController({
      mode: 'cohort', rolloutId: 'release-one', cohortKey: 'install-one',
      cohortBps: bucket, evidenceApproved: true, statePath: null,
    });
    expect(holdout.status()).toMatchObject({ selected: false, state: 'holdout', bucket });
    expect(() => holdout.assertAllowed()).toThrow(NativeRolloutRollbackError);
  });

  test('requires explicit evidence and a stable key for automatic cohorts', () => {
    const controller = new NativeRolloutController({
      mode: 'cohort', rolloutId: 'release-one', cohortBps: 500,
      evidenceApproved: false, statePath: null,
    });
    expect(controller.status().blockers).toEqual(expect.arrayContaining([
      'cohort_key_missing', 'cohort_evidence_not_approved',
    ]));
  });

  test('trips immediately on ambiguous-delivery safety failures and never auto-replays', () => {
    const controller = new NativeRolloutController({ mode: 'native', statePath: null });
    controller.recordError('BimaxActionTool', { code: 'bridge_timeout' });
    expect(controller.status()).toMatchObject({
      tripped: true, selected: false, state: 'rolled_back', safetyFailures: 1,
      tripReason: 'safety_failure:bridge_timeout',
    });
    expect(() => controller.assertAllowed()).toThrow(/not replayed/);
  });

  test('trips on a bounded failure-rate budget but ignores validation and user refusals', () => {
    const controller = new NativeRolloutController({
      mode: 'native', minSamples: 5, maxFailureBps: 2_000, maxSamples: 5, statePath: null,
    });
    controller.recordError('BimaxActionTool', new Error('Governor refused'));
    controller.recordError('BimaxActionTool', { code: 'stale_element' });
    for (let i = 0; i < 4; i += 1) controller.recordSuccess('BimaxObserveTool');
    controller.recordError('BimaxObserveTool', { code: 'xpc_unavailable' });
    expect(controller.status()).toMatchObject({ samples: 5, failures: 1, tripped: false });
    controller.recordError('BimaxObserveTool', { code: 'bridge_unavailable' });
    expect(controller.status()).toMatchObject({
      samples: 5, failures: 2, failureBps: 4_000, tripped: true,
    });
  });

  test('persists a trip atomically and only an explicit reset clears it', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'bimax-native-rollout-'));
    const statePath = path.join(root, 'rollout.json');
    try {
      const first = new NativeRolloutController({
        mode: 'native', rolloutId: 'release-persist', statePath,
      });
      first.recordError('BimaxTransactionTool', { code: 'service_correlation_failed' });
      const stored = JSON.parse(readFileSync(statePath, 'utf8'));
      expect(stored).toMatchObject({ version: 1, tripped: true });
      expect(JSON.stringify(stored)).not.toContain('task');

      const restored = new NativeRolloutController({
        mode: 'native', rolloutId: 'release-persist', statePath,
      });
      expect(restored.status().tripped).toBe(true);
      restored.setMode('off');
      expect(restored.status().tripped).toBe(true);
      expect(restored.resetCircuit()).toMatchObject({ tripped: false, samples: 0, state: 'off' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('classifies only native transport health as rollout evidence', () => {
    expect(classifyNativeRolloutError({ code: 'bridge_timeout' })).toBe('safety_failure');
    expect(classifyNativeRolloutError({ code: 'xpc_unavailable' })).toBe('failure');
    expect(classifyNativeRolloutError({ code: 'invalid_operation' })).toBeNull();
    expect(classifyNativeRolloutError(new Error('approval refused'))).toBeNull();
  });
});

import { NativeProductFeatureController } from '../native.product.features';

describe('native task-owned product features', () => {
  const capabilities = {
    cursorOverlay: true, trajectory: true, video: false,
    replayModes: ['dry_run', 'validate', 'live'],
  };

  it('gates cursor state and keeps it isolated by task', () => {
    let now = 1;
    const controller = new NativeProductFeatureController(capabilities, () => now++);
    expect(controller.configureCursor('a', { enabled: true }).style).toBe('ring');
    expect(controller.moveCursorOverlay('a', { x: 10, y: 20, targetPid: 42 })).toMatchObject({
      x: 10, y: 20, targetPid: 42,
    });
    expect(controller.cursorStatus('b')).toBeNull();
    controller.configureCursor('a', { enabled: false });
    expect(() => controller.moveCursorOverlay('a', { x: 1, y: 2, targetPid: 42 }))
      .toThrow('cursor_overlay_disabled');
  });

  it('refuses unadvertised cursor and recording features', () => {
    const controller = new NativeProductFeatureController({
      cursorOverlay: false, trajectory: false, video: false, replayModes: [],
    });
    expect(() => controller.configureCursor('task', { enabled: true })).toThrow('cursor_overlay_unavailable');
    expect(() => controller.startTrajectory('task')).toThrow('trajectory_recording_unavailable');
  });

  it('records bounded receipt digests and validates every replay step', async () => {
    let now = 100;
    const controller = new NativeProductFeatureController(capabilities, () => now++);
    const recordingId = controller.startTrajectory('task');
    controller.appendTrajectoryStep('task', {
      operation: 'invoke', target: { pid: 42, windowId: 7, windowGeneration: 3 }, receiptDigest: 'abc',
    });
    controller.appendTrajectoryStep('task', {
      operation: 'set_value', target: { pid: 42, windowId: 7, windowGeneration: 3 }, receiptDigest: 'def',
    });
    const recording = controller.stopTrajectory('task');
    expect(recording.recordingId).toBe(recordingId);
    expect(recording.steps.map(step => step.index)).toEqual([0, 1]);

    const validated: number[] = [];
    const validateReceipt = await controller.replay('task', recording, 'validate', {
      validate: step => { validated.push(step.index); return true; },
    });
    expect(validateReceipt).toMatchObject({ outcome: 'validated', validatedSteps: 2, executedSteps: 0 });
    expect(validated).toEqual([0, 1]);

    const refused = await controller.replay('task', recording, 'live', {
      validate: () => true, execute: () => undefined,
    });
    expect(refused).toMatchObject({ outcome: 'refused', reason: 'live_replay_requires_approval_and_executor' });

    const executed: number[] = [];
    const live = await controller.replay('task', recording, 'live', {
      approvedLive: true, validate: step => step.index < 2,
      execute: step => { executed.push(step.index); },
    });
    expect(live).toMatchObject({ outcome: 'performed', validatedSteps: 2, executedSteps: 2 });
    expect(executed).toEqual([0, 1]);
  });

  it('refuses cross-task and stale-step replay before execution', async () => {
    const controller = new NativeProductFeatureController(capabilities);
    controller.startTrajectory('owner');
    controller.appendTrajectoryStep('owner', {
      operation: 'invoke', target: { pid: 1 }, receiptDigest: 'receipt',
    });
    const recording = controller.stopTrajectory('owner');
    await expect(controller.replay('other', recording, 'validate', { validate: () => true }))
      .rejects.toThrow('trajectory_session_mismatch');

    const execute = jest.fn();
    const refused = await controller.replay('owner', recording, 'live', {
      approvedLive: true, validate: () => false, execute,
    });
    expect(refused).toMatchObject({ outcome: 'refused', stoppedAtStep: 0 });
    expect(execute).not.toHaveBeenCalled();
  });
});

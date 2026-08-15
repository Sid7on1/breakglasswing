import { decideDesktopProductionRouting } from '../production.routing';

describe('packaged Desktop Computer Use routing', () => {
  test('forces the full native route and disables compatibility in a packaged app', () => {
    expect(decideDesktopProductionRouting({
      desktopHost: true,
      packaged: true,
      nativeFullRequested: false,
      nativeRolloutSelected: false,
    })).toEqual({
      attemptNative: true,
      nativeMode: 'full',
      registerCompatibility: false,
      failClosedWithoutNative: true,
    });
  });

  test('keeps compatibility available only during Desktop development', () => {
    expect(decideDesktopProductionRouting({
      desktopHost: true,
      packaged: false,
      nativeFullRequested: false,
      nativeRolloutSelected: false,
    })).toEqual({
      attemptNative: false,
      nativeMode: 'semantic',
      registerCompatibility: true,
      failClosedWithoutNative: false,
    });
  });

  test('never gives Terminal a Computer Use surface', () => {
    expect(decideDesktopProductionRouting({
      desktopHost: false,
      packaged: true,
      nativeFullRequested: true,
      nativeRolloutSelected: true,
    }).registerCompatibility).toBe(false);
  });
});

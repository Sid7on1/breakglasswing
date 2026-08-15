import {
  browserPageRouteReceipt,
  clearConvergedHandoffs,
  mintConvergedHandoff,
  resolveConvergedComputerRoute,
  validateConvergedHandoff,
} from '../browser.convergence.route';

describe('Desktop browser/native convergence routing', () => {
  beforeEach(() => clearConvergedHandoffs());

  test('prefers DOM semantics, then native AX, and never launders compatibility as native', () => {
    expect(resolveConvergedComputerRoute(
      { surface: 'browser_page', url: 'https://example.com', elementRef: 'ref' },
      { browserCdp: true, nativeAX: true, nativeCapture: true },
    ).receipt).toMatchObject({ backend: 'browser_cdp', deliveryPath: 'browser_semantic' });
    expect(resolveConvergedComputerRoute(
      { surface: 'browser_page', url: 'https://example.com', pid: 42 },
      { browserCdp: false, nativeAX: true, nativeCapture: true },
    ).receipt).toMatchObject({ backend: 'native_service', deliveryPath: 'native_ax_scrape' });
    expect(resolveConvergedComputerRoute(
      { surface: 'browser_page', url: 'https://example.com', pid: 42 },
      { browserCdp: false, nativeAX: false, nativeCapture: false, compatibilityAX: true },
    ).receipt).toMatchObject({ backend: 'computer_compat', deliveryPath: 'native_ax_scrape' });
  });

  test('requires a proven native capture route for visual-only content', () => {
    expect(resolveConvergedComputerRoute(
      { surface: 'visual_only', displayId: 1 },
      { browserCdp: true, nativeAX: true, nativeCapture: false },
    )).toEqual({ eligible: false, blockers: ['native_capture_unavailable'] });
  });

  test('binds handoff authority to one task and expiry', () => {
    const authority = mintConvergedHandoff('task-a', {
      surface: 'browser_page', url: 'https://example.com', pid: 42,
      tabRef: 'tab', documentRef: 'document',
    }, 1000);
    expect(validateConvergedHandoff(authority.handoffRef, 'task-a', 1001)).toMatchObject({ ok: true });
    expect(validateConvergedHandoff(authority.handoffRef, 'task-b', 1001))
      .toMatchObject({ ok: false, error: expect.stringMatching(/different/) });
    expect(validateConvergedHandoff(authority.handoffRef, 'task-a', 61_001))
      .toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
  });

  test('route receipts preserve exact browser authority', () => {
    expect(browserPageRouteReceipt('https://example.com', {
      tabRef: 'tab-one', documentRef: 'document-two',
    }).target).toEqual({
      surface: 'browser_page', url: 'https://example.com',
      tabRef: 'tab-one', documentRef: 'document-two',
    });
  });
});

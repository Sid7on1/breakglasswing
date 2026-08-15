import {
  allowsEvidenceFocus,
  BIMAX_CU_DELIVERY_POLICIES,
  deliveryPathAuthorized,
  isBackgroundDelivery,
  keepsForegroundAfterAction,
  permitsForegroundLease,
} from '../delivery.policy';

describe('Bimax-Cu delivery policy', () => {
  it('publishes the four explicit native policies', () => {
    expect(BIMAX_CU_DELIVERY_POLICIES).toEqual([
      'background_only',
      'background_preferred',
      'foreground_once',
      'foreground_persistent',
    ]);
  });

  it.each(['background', 'background_only', 'background_preferred'] as const)(
    '%s never permits evidence capture to steal focus',
    delivery => {
      expect(isBackgroundDelivery(delivery)).toBe(true);
      expect(allowsEvidenceFocus(delivery)).toBe(false);
      expect(permitsForegroundLease(delivery)).toBe(false);
      expect(deliveryPathAuthorized(delivery, 'foreground')).toBe(false);
    },
  );

  it.each(['foreground', 'foreground_once', 'foreground_persistent'] as const)(
    '%s authorizes an explicit foreground path',
    delivery => {
      expect(isBackgroundDelivery(delivery)).toBe(false);
      expect(allowsEvidenceFocus(delivery)).toBe(true);
      expect(permitsForegroundLease(delivery)).toBe(true);
      expect(deliveryPathAuthorized(delivery, 'foreground')).toBe(true);
    },
  );

  it('keeps focus only for the persistent policy', () => {
    expect(keepsForegroundAfterAction('foreground')).toBe(false);
    expect(keepsForegroundAfterAction('foreground_once')).toBe(false);
    expect(keepsForegroundAfterAction('foreground_persistent')).toBe(true);
  });

  it('always allows a background candidate without broadening the requested contract', () => {
    for (const delivery of [...BIMAX_CU_DELIVERY_POLICIES, 'background', 'foreground'] as const) {
      expect(deliveryPathAuthorized(delivery, 'background')).toBe(true);
    }
  });
});

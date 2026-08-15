const HIGH_IMPACT = /submit|send|purchase|buy|pay|checkout|order|confirm|delete|remove|erase|approve|authorize|grant|revoke|permission|transfer|withdraw|security/i;

export function classifyMacActionImpact(action: string, args?: Record<string, unknown>): { high: boolean; reason?: string } {
  const text = [action, ...Object.entries(args || {})
    .filter(([key, value]) => typeof value === 'string' && !/password|secret|token|credential|key$/i.test(key))
    .map(([, value]) => String(value))].join(' ');
  const match = text.match(HIGH_IMPACT);
  return match ? { high: true, reason: `matches "${match[0]}"` } : { high: false };
}


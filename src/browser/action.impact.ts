import type { SnapshotElementInfo } from './browser.runtime';

/**
 * Semantic high-impact classification for computer-use actions.
 *
 * "High-impact" = the action plausibly commits an outward-facing or hard-to-reverse effect:
 * submitting/sending content, purchases/payments, deletions, approvals, permission or security
 * changes, and file uploads. High-impact actions ALWAYS face an action-time Yes/No confirmation
 * in the Governor — no session grant, persistent rule, or bypass mode waives them.
 *
 * The classifier is deliberately conservative and PURE: it looks only at the action verb, the
 * value-safe element metadata captured by the snapshot (accessible name / role / tag / type —
 * password values are never captured), and explicit selector/text intent. Ordinary navigation,
 * scrolling, hovering, and typing into fields are NOT flagged — commitment happens at the
 * click/press/submit boundary, which is where the confirmation belongs.
 */

const HIGH_IMPACT_INTENT = new RegExp(
  [
    'submit', 'send', 'purchase', 'buy now', '\\bbuy\\b', 'pay(?:ment)?', 'checkout',
    'place (?:an )?order', 'order now', 'confirm', 'delete', '\\bremove\\b', '\\berase\\b',
    'approve', 'authorize', '\\bgrant\\b', 'revoke', 'permission', 'allow access',
    'transfer', 'withdraw', 'security setting',
  ].join('|'),
  'i',
);

export interface ImpactVerdict {
  high: boolean;
  /** Human-readable reason shown in the confirmation label. Never contains field values. */
  reason?: string;
}

/** Classify one BrowserTool action against the element it targets (when known). */
export function classifyBrowserActionImpact(
  command: { action: string; selector?: string; text?: string; key?: string },
  element?: SnapshotElementInfo | null,
): ImpactVerdict {
  if (command.action === 'upload') {
    return { high: true, reason: 'moves a workspace file into the page' };
  }
  // Commitment boundary: activating a control. Typing/scrolling/hovering/selecting stage state
  // but commit nothing; the submit/confirm click that follows is what gets confirmed.
  if (command.action !== 'click' && command.action !== 'press') return { high: false };

  if (element?.type === 'submit') return { high: true, reason: 'submit control' };
  // Value-safe identity fields only. The element VALUE is included solely because the snapshot
  // layer already strips password values; for buttons it is the visible label.
  const identity = [element?.name, element?.value, command.selector]
    .filter((part): part is string => !!part)
    .join(' ');
  const match = identity.match(HIGH_IMPACT_INTENT);
  if (match) return { high: true, reason: `target reads "${match[0].trim()}"` };
  return { high: false };
}

/**
 * Classify one native desktop action (mcp__open-computer-use__* tool) from its tool name and
 * value-safe string arguments. Keys that look credential-shaped are never inspected.
 */
export function classifyDesktopActionImpact(
  action: string,
  args?: Record<string, unknown>,
): ImpactVerdict {
  const parts: string[] = [action.replace(/_/g, ' ')];
  for (const [key, value] of Object.entries(args || {})) {
    if (/password|secret|token|credential|key$/i.test(key)) continue;
    if (typeof value === 'string') parts.push(value);
  }
  const match = parts.join(' ').match(HIGH_IMPACT_INTENT);
  if (match) return { high: true, reason: `matches "${match[0].trim()}"` };
  return { high: false };
}

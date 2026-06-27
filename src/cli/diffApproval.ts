/**
 * Inline diff approval. When enabled, mutating tools render their proposed change
 * as a diff and wait for the user to accept or reject before writing. The approver
 * is registered by the interactive UI; in sub-agent worker threads and print mode
 * no approver exists, so requests auto-approve and never hang.
 */
export type DiffApprover = (summary: string, diff: string) => Promise<boolean>;

let enabled = false;
let approver: DiffApprover | null = null;

export function setDiffApprovalEnabled(value: boolean): void {
  enabled = value;
}

export function isDiffApprovalEnabled(): boolean {
  return enabled;
}

export function registerDiffApprover(fn: DiffApprover | null): void {
  approver = fn;
}

/**
 * Returns true if the change may proceed. Auto-approves when the feature is off or
 * no interactive approver is registered (workers / non-interactive runs).
 */
export async function requestDiffApproval(summary: string, diff: string): Promise<boolean> {
  if (!enabled || !approver) return true;
  try {
    return await approver(summary, diff);
  } catch {
    // Approval is ON and an approver is registered — the user asked to gate writes. A failure here
    // must fail CLOSED (reject), not silently auto-approve, or it's a security bypass.
    return false;
  }
}

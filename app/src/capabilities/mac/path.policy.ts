import path from 'node:path';

export function resolveCapabilityWorkspacePath(root: string, supplied: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (!path.isAbsolute(root)) return { ok: false, reason: 'workspace root must be absolute' };
  const base = path.resolve(root);
  const candidate = path.resolve(base, supplied);
  return candidate === base || candidate.startsWith(base + path.sep)
    ? { ok: true, path: candidate }
    : { ok: false, reason: 'path escapes the active workspace' };
}

export function capabilityWriteBlock(_path: string): string | null { return null; }


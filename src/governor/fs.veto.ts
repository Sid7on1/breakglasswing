import { Logger } from '../utils';
import { SafetyPolicy } from './policy.engine';
import { GovernorVetoError } from '../core/errors';
import * as path from 'path';
import * as fs from 'fs/promises';

export class FileSystemVeto {
  async checkVeto(targetPath: string): Promise<void> {
    // 1. Resolve symlinks FIRST (Sandbox escape prevention)
    let realPath: string;
    try {
      realPath = await fs.realpath(targetPath);
    } catch (e) {
      realPath = path.resolve(targetPath); // Fallback if file doesn't exist yet
    }
    
    // Normalize and canonicalize
    const normalized = path.normalize(realPath).toLowerCase();
    const canonicalWorkspace = path.resolve(SafetyPolicy.allowedWorkspace).toLowerCase();

    // 1. Must be inside workspace
    if (!normalized.startsWith(canonicalWorkspace)) {
      Logger.error(`[Governor: Veto] File operation blocked. Target is outside the allowed workspace: ${realPath}`);
      throw new GovernorVetoError('Path outside workspace boundary.');
    }

    // 2. Cannot touch forbidden system paths
    for (const forbidden of SafetyPolicy.forbiddenPaths) {
      if (normalized.includes(forbidden.toLowerCase())) {
        Logger.error(`[Governor: Veto] File operation blocked. Target contains forbidden path: ${forbidden}`);
        throw new GovernorVetoError('Forbidden path access.');
      }
    }

    // 3. Mathematical Regex Signature scanning
    for (const regex of SafetyPolicy.forbiddenRegex) {
      if (regex.test(normalized)) {
        Logger.error(`[Governor: Veto] File operation blocked. Target matches forbidden regex signature: ${regex}`);
        throw new GovernorVetoError('Forbidden cryptographic signature match.');
      }
    }

    // 4. Cannot touch forbidden extensions
    const ext = path.extname(normalized);
    if (SafetyPolicy.forbiddenExtensions.includes(ext)) {
      Logger.error(`[Governor: Veto] File operation blocked. Extension is forbidden: ${ext}`);
      throw new GovernorVetoError('Forbidden file extension.');
    }
  }
}

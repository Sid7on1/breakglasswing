import { IGovernor } from '../../core/interfaces';
import { buildTool } from '../tool.factory';
import { tryGetWorkspace } from '../../core/workspace.manager';

interface WorkspaceArgs {
  action: 'list' | 'register' | 'ignore' | 'scope' | 'scan';
  path?: string;
  purpose?: string;
  scope?: 'write' | 'read';
  dir?: string;
}

/**
 * WorkspaceTool — the model's handle on the multi-repo workspace (workspace.manager.ts).
 * Registration decisions are the USER's: register/ignore only after they answered the
 * one-time ask surfaced by the workspace context block.
 */
export const createWorkspaceTool = (governor: IGovernor) => buildTool({
  name: 'WorkspaceTool',
  description: `Manages the multi-repo workspace: which locally-cloned repos this session can see, read, and edit.

The workspace manifest registers repos (path, branch, purpose, scope). Registered repos appear in your context every turn; you can read and cross-reference ALL of them and edit the WRITABLE ones — e.g. "pull this pattern from repo Y and adapt it into repo X" reads Y, edits X.

# Actions
- **list**: Show registered repos, scopes, branches, and any unregistered clones detected.
- **register**: Add a repo (requires path; purpose recommended; scope defaults to "read"). Call ONLY after the user agreed to add it — the detection ask is one-time.
- **ignore**: Permanently dismiss a detected clone the user declined (never suggested again).
- **scope**: Change a repo's scope to "write" (user asked for edits there) or back to "read".
- **scan**: Re-scan a directory (defaults to the project root) for unregistered clones.

# When to call
- The workspace block reports UNREGISTERED CLONES and the user has answered whether to add them
- The user says "also work with <repo I cloned>", "make <repo> editable", or "stop tracking <repo>"
- You need to see exactly which repos are in context before cross-repo work`,
  isDestructive: false,
  isConcurrencySafe: true,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'register', 'ignore', 'scope', 'scan'], description: 'What to do.' },
      path: { type: 'string', description: 'Repo path (required for register/ignore/scope). Absolute or relative to the primary project.' },
      purpose: { type: 'string', description: 'Why this repo is in the workspace, e.g. "pattern reference for FSRS memory decay" (register).' },
      scope: { type: 'string', enum: ['write', 'read'], description: 'Edit scope (register/scope). Default read — reference repos stay untouched.' },
      dir: { type: 'string', description: 'Directory to scan for clones (scan; defaults to the project root).' },
    },
    required: ['action'],
  },
  execute: async (args: WorkspaceArgs) => {
    const ws = tryGetWorkspace();
    if (!ws) return 'Workspace manager not initialized yet — try again in a moment.';

    switch (args.action) {
      case 'register': {
        if (!args.path) return 'register requires "path".';
        const r = ws.register(args.path, { purpose: args.purpose, scope: args.scope });
        return `Registered ${r.name} (${r.scope}) at ${r.path}${r.branch ? ` [${r.branch}]` : ''}. It is now part of the workspace context.`;
      }
      case 'ignore': {
        if (!args.path) return 'ignore requires "path".';
        ws.ignore(args.path);
        return `Ignored ${args.path} — it will never be suggested again.`;
      }
      case 'scope': {
        if (!args.path || !args.scope) return 'scope requires "path" and "scope".';
        const r = ws.setScope(args.path, args.scope);
        if (!r) return `No registered repo at ${args.path}. Use action:"list" to see paths.`;
        return `${r.name} is now ${r.scope === 'write' ? 'WRITABLE' : 'read-only'}.`;
      }
      case 'scan': {
        const found = ws.scan(args.dir || process.cwd());
        return found.length
          ? `Unregistered clones found:\n${found.map(f => `- ${f}`).join('\n')}\nAsk the user whether to register each, then call register/ignore.`
          : 'No unregistered clones found.';
      }
      default: {
        const act = ws.active();
        const pending = ws.pending();
        const lines = act.map(r =>
          `${r.scope === 'write' ? '✎' : '👁'} ${r.name} (${r.scope})${r.branch ? ` [${r.branch}]` : ''} — ${r.path}${r.purpose ? `\n    ${r.purpose}` : ''}`);
        let out = act.length ? `Workspace repos (${act.length}):\n${lines.join('\n')}` : 'No repos registered (single-repo session).';
        if (pending.length) out += `\n\nUnregistered clones awaiting a decision:\n${pending.map(p => `- ${p}`).join('\n')}`;
        return out;
      }
    }
  },
}, governor);

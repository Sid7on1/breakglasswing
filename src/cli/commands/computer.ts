import { globalCommandRegistry } from './registry';
import { globalMcpManager } from '../../mcp/manager';
import { catalogEntry } from '../../mcp/catalog';
import { globalBrowserRuntime } from '../../browser/browser.runtime';
import { getTaintTracker } from '../../mind/taint';

// /computer — the truthful status hub for computer use: what BiMax can currently OBSERVE and ACT
// on (browser + native desktop), whether the active model can actually see screenshots, which
// session grants are standing, and the one-keystroke installer for the pinned desktop companion.
// Every row reflects live engine state; nothing here is invented (no fake permission probes:
// macOS only reveals Accessibility/Screen Recording status to the native companion at first use).

const DESKTOP_SERVER = 'open-computer-use';

globalCommandRegistry.register({
  name: '/computer',
  description: 'Computer use — browser & desktop control status, vision, grants',
  category: 'Configuration',
  execute: async (args, context) => {
    const governor = context.options?.governor as any;
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'revoke-grants') {
      const n = governor?.revokeComputerGrants?.() ?? 0;
      context.addSystemMessage('success', n > 0
        ? `Revoked ${n} session computer-control grant${n === 1 ? '' : 's'}.`
        : 'No session computer-control grants to revoke.');
      return { type: 'none' };
    }

    if (sub === 'install-desktop') {
      const entry = catalogEntry(DESKTOP_SERVER);
      if (!entry || !entry.command) {
        return { type: 'message', level: 'error', content: `Catalog entry '${DESKTOP_SERVER}' is unavailable.` };
      }
      // Reuse the /mcp add pipeline (persists to .bimax/mcp.json + connects + registers tools)
      // with the catalog's PINNED command line, so the installed version is always the audited one.
      await context.executeCommand(`/mcp add ${DESKTOP_SERVER} ${entry.command} ${(entry.args || []).join(' ')}`);
      return { type: 'none' };
    }

    // --- status hub (default) -----------------------------------------------------------------
    const options: any[] = [];

    // Browser: first-party, always present. Show live page when the runtime has one.
    const liveUrl = (() => { try { return globalBrowserRuntime.currentUrl?.() || null; } catch { return null; } })();
    options.push({
      label: '● Browser automation',
      value: '/computer',
      desc: liveUrl
        ? `active — ${liveUrl} (profile persists in .bimax/browser)`
        : 'ready — native Chromium via BrowserTool; profile persists in .bimax/browser',
      category: 'Capabilities',
    });

    // Vision: does the ACTIVE model actually see screenshots?
    let visionDesc = 'unknown — model capabilities unavailable';
    let visionOk = false;
    try {
      const caps = await context.options?.llmAdapter?.activeCapabilities?.();
      const model = context.options?.model || '(not set)';
      visionOk = !!caps?.visionInput;
      visionDesc = visionOk
        ? `${model} accepts images — browser screenshots are attached to its next turn`
        : `${model} is text-only — screenshots stay on disk; pick a vision model for visual operation`;
    } catch { /* adapter optional in some contexts */ }
    options.push({
      label: `${visionOk ? '●' : '○'} Model vision`,
      value: visionOk ? '/computer' : '/model one',
      desc: visionDesc,
      category: 'Capabilities',
    });

    // Desktop control: pinned local MCP companion.
    const configured = (() => { try { return globalMcpManager.configuredNames().includes(DESKTOP_SERVER); } catch { return false; } })();
    const connected = (() => { try { return !!globalMcpManager.get(DESKTOP_SERVER); } catch { return false; } })();
    const entry = catalogEntry(DESKTOP_SERVER);
    const pin = entry?.args?.find(a => a.startsWith(`${DESKTOP_SERVER}@`)) || `${DESKTOP_SERVER}@pinned`;
    if (connected) {
      const tools = globalMcpManager.get(DESKTOP_SERVER)?.toolNames.length ?? 0;
      options.push({
        label: '● Desktop control', value: `/mcp server ${DESKTOP_SERVER}`,
        desc: `connected — ${tools} native desktop tool(s) via ${pin}; actions face the computer-control approval ladder`,
        category: 'Capabilities',
      });
    } else if (configured) {
      options.push({
        label: '◌ Desktop control', value: `/mcp server ${DESKTOP_SERVER}`,
        desc: `configured but not connected (${pin}) — open to reconnect or diagnose`,
        category: 'Capabilities',
      });
    } else {
      options.push({
        label: '○ Desktop control — install', value: '/computer install-desktop',
        desc: `installs the pinned local companion (${pin}, MIT) for native macOS/Windows/Linux app control`,
        category: 'Capabilities',
      });
    }
    if (process.platform === 'darwin' && !connected) {
      options.push({
        label: 'ⓘ macOS requirements', value: '/computer',
        desc: 'macOS 14+; grant Accessibility + Screen Recording in System Settings when the companion first asks — BiMax cannot pre-check those for you',
        category: 'Capabilities',
      });
    }

    // Safety posture: session grants + taint, with the one-keystroke revoke.
    const grants: string[] = governor?.computerGrants?.() ?? [];
    options.push({
      label: grants.length ? `⚑ Session grants (${grants.length})` : '⚑ Session grants (none)',
      value: grants.length ? '/computer revoke-grants' : '/computer',
      desc: grants.length
        ? `${grants.join(' · ')} — Enter revokes all; grants never outlive the session`
        : 'each browser domain / desktop app asks once; you can grant it for the session at the prompt',
      category: 'Safety',
    });
    const taint = (() => { try { return getTaintTracker(); } catch { return null; } })();
    const latest = taint?.latest();
    options.push({
      label: taint?.isTainted() ? '⚠ Context taint: ACTIVE' : '✓ Context taint: clean',
      value: '/taint',
      desc: taint?.isTainted()
        ? `untrusted content in context (latest: ${latest?.source} — ${latest?.detail}); network-capable commands are narrowed until /taint clear`
        : 'no untrusted web/MCP/page content in the conversation window yet',
      category: 'Safety',
    });

    return {
      type: 'menu',
      title: 'Computer use',
      subtitle: 'Observation is free; actions ask per domain/app. High-impact actions (uploads, sends) always ask. Sensitive apps (credential managers, wallets, system security) are always denied.',
      options,
      onSelect: (opt: any) => context.executeCommand(opt.value),
    };
  },
});

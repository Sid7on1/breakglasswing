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

    // /computer vision → the dedicated vision SLOT picker (/model vision). Screenshots/images
    // route to the slot; the user's coding model is never displaced by enabling vision.
    if (sub === 'vision') {
      return { type: 'redirect', command: '/model vision' };
    }

    // --- status hub (default) -----------------------------------------------------------------
    const options: any[] = [];

    // Browser: first-party, always present. Show live page when the runtime has one.
    const liveUrl = (() => { try { return globalBrowserRuntime.currentUrl?.() || null; } catch { return null; } })();
    options.push({
      label: '● Browser automation',
      value: '/computer',
      desc: liveUrl ? `active — ${liveUrl}` : 'ready — built-in Chromium',
      category: 'Capabilities',
    });

    // Vision: can screenshots be SEEN — by the coding model itself, or by the dedicated vision
    // slot (image turns reroute there automatically)? Text-only + no slot → one keystroke to the
    // vision-slot picker.
    let visionOk = false;
    let model = '(not set)';
    let visionSlot = '';
    try {
      model = context.options?.model || '(not set)';
      visionSlot = (context.options?.llmAdapter as any)?.visionModel || '';
      visionOk = (context.options?.llmAdapter as any)?.canSeeImages?.()
        ?? !!(await context.options?.llmAdapter?.activeCapabilities?.())?.visionInput;
    } catch { /* adapter optional in some contexts */ }
    options.push({
      label: visionOk ? '● Vision' : '○ Vision — pick a model…',
      value: visionOk ? '/model vision' : '/computer vision',
      desc: visionOk
        ? (visionSlot ? `screenshots → ${visionSlot}` : `${model} sees screenshots itself`)
        : `${model} can't see images and no vision slot is set`,
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
        desc: `connected — ${tools} native tools`,
        category: 'Capabilities',
      });
    } else if (configured) {
      options.push({
        label: '◌ Desktop control', value: `/mcp server ${DESKTOP_SERVER}`,
        desc: 'not connected — open to diagnose',
        category: 'Capabilities',
      });
    } else {
      options.push({
        label: '○ Desktop control — install', value: '/computer install-desktop',
        desc: `pinned companion (${pin}, MIT)`,
        category: 'Capabilities',
      });
    }
    if (process.platform === 'darwin' && !connected) {
      options.push({
        label: 'ⓘ macOS requirements', value: '/computer',
        desc: 'macOS 14+ · grant Accessibility + Screen Recording on first ask',
        category: 'Capabilities',
      });
    }

    // Safety posture: session grants + taint, with the one-keystroke revoke.
    const grants: string[] = governor?.computerGrants?.() ?? [];
    options.push({
      label: grants.length ? `⚑ Session grants (${grants.length})` : '⚑ Session grants (none)',
      value: grants.length ? '/computer revoke-grants' : '/computer',
      desc: grants.length
        ? `${grants.join(' · ')} — Enter revokes all`
        : 'each domain/app asks once per session',
      category: 'Safety',
    });
    const taint = (() => { try { return getTaintTracker(); } catch { return null; } })();
    const latest = taint?.latest();
    options.push({
      label: taint?.isTainted() ? '⚠ Context taint: ACTIVE' : '✓ Context taint: clean',
      value: '/taint',
      desc: taint?.isTainted()
        ? `untrusted content in context (${latest?.source}) — network commands narrowed until /taint clear`
        : 'no untrusted web/MCP content yet',
      category: 'Safety',
    });

    return {
      type: 'menu',
      title: 'Computer use',
      subtitle: 'Watching is free · acting asks per app/domain · sensitive apps always denied',
      options,
      onSelect: (opt: any) => context.executeCommand(opt.value),
    };
  },
});

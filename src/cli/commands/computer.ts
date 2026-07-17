import { globalCommandRegistry } from './registry';
import { globalMcpManager } from '../../mcp/manager';
import { catalogEntry } from '../../mcp/catalog';
import { globalBrowserRuntime } from '../../browser/browser.runtime';
import { getTaintTracker } from '../../mind/taint';
import { MODEL_CATALOG } from '../models';

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

    // /computer vision — vision models ONLY, one keystroke from the hub's "text-only" row. Each
    // pick applies via `/model one <id>` (quick replies stay on the plain lite model automatically
    // when the pick is a reasoner — see applyEverywhere).
    if (sub === 'vision') {
      const cur = context.options?.model;
      let served: Set<string> | null = null;
      try {
        const live = await context.options?.llmAdapter?.listProviderModels?.();
        if (live && live.length) served = new Set(live);
      } catch { /* offline — show the curated set unfiltered */ }
      const rows = MODEL_CATALOG
        .filter(m => m.tier === 'vision' && (!served || served.has(m.value)))
        .map(m => ({
          label: m.value === cur ? `● ${m.label}` : m.label,
          value: `/model one ${m.value}`,
          desc: m.desc,
          category: 'Vision',
        }));
      return {
        type: 'menu',
        title: 'Pick a vision model',
        subtitle: 'These see screenshots — required for visual computer use',
        options: [
          ...rows,
          { label: '⌕ Browse all…', value: '/model browse one', desc: 'Full provider catalog', category: 'More' },
        ],
        onSelect: (opt: any) => context.executeCommand(opt.value),
      };
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

    // Vision: does the ACTIVE model actually see screenshots? Text-only → one keystroke to the
    // vision-only picker (not the full model hub).
    let visionOk = false;
    let model = '(not set)';
    try {
      const caps = await context.options?.llmAdapter?.activeCapabilities?.();
      model = context.options?.model || '(not set)';
      visionOk = !!caps?.visionInput;
    } catch { /* adapter optional in some contexts */ }
    options.push({
      label: visionOk ? '● Model vision' : '○ Model vision — pick one…',
      value: visionOk ? '/computer' : '/computer vision',
      desc: visionOk ? `${model} sees screenshots` : `${model} can't see images`,
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

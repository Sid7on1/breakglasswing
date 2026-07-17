import { globalCommandRegistry } from './registry';
import { globalMcpManager } from '../../mcp/manager';
import { globalBrowserRuntime } from '../../browser/browser.runtime';
import { globalDesktopRuntime } from '../../computer/desktop.runtime';
import { getTaintTracker } from '../../mind/taint';

// /computer — the truthful status hub for computer use: what BiMax can currently OBSERVE and ACT
// on (browser + native desktop), whether the active model can actually see screenshots, and which
// session grants are standing. Desktop control is FIRST-PARTY (ComputerTool + the in-repo Swift
// helper) — the old open-computer-use MCP companion is legacy and only surfaces here when it is
// still configured, with removal as the suggested action.

const LEGACY_DESKTOP_SERVER = 'open-computer-use';

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
      // Legacy alias from the MCP-companion era: desktop control is built in now.
      context.addSystemMessage('info', 'Desktop control is built into BiMax now (ComputerTool) — nothing to install. Use "/computer perms" to grant macOS permissions.');
      return { type: 'none' };
    }

    if (sub === 'perms') {
      // Trigger the OS permission prompts, then report the live verdict.
      const req = await globalDesktopRuntime.run({ action: 'request_access' });
      const st = await globalDesktopRuntime.run({ action: 'status' });
      const level = st.ok && st.accessibility !== false && st.screenRecording !== false ? 'success' : 'info';
      context.addSystemMessage(level, st.ok
        ? `Desktop control (${st.driver}): accessibility ${st.accessibility == null ? 'unknown' : st.accessibility ? 'granted' : 'NOT granted'} · screen recording ${st.screenRecording == null ? 'unknown' : st.screenRecording ? 'granted' : 'NOT granted'}${st.accessibility === false || st.screenRecording === false ? ' — approve BiMax\'s terminal in System Settings → Privacy & Security' : ''}`
        : `Desktop control unavailable: ${st.error || req.error || 'unknown error'}`);
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

    // Desktop control: first-party (ComputerTool + in-repo native driver). quickStatus never
    // spawns or compiles — permissions show as "unknown" until the first real probe.
    const desktop = globalDesktopRuntime.quickStatus();
    const permBits = [
      desktop.accessibility == null ? null : `accessibility ${desktop.accessibility ? '✓' : '✗'}`,
      desktop.screenRecording == null ? null : `screen recording ${desktop.screenRecording ? '✓' : '✗'}`,
    ].filter(Boolean).join(' · ');
    options.push(desktop.ready
      ? {
          label: '● Desktop control — built in', value: '/computer perms',
          desc: `${desktop.driver}${permBits ? ` · ${permBits}` : ' · Enter checks/grants macOS permissions'}`,
          category: 'Capabilities',
        }
      : {
          label: '○ Desktop control', value: '/computer',
          desc: `not supported on this platform (driver: ${desktop.driver})`,
          category: 'Capabilities',
        });

    // Legacy MCP companion: only surfaces if it is still configured, and the action is removal.
    const legacyConfigured = (() => { try { return globalMcpManager.configuredNames().includes(LEGACY_DESKTOP_SERVER); } catch { return false; } })();
    if (legacyConfigured) {
      options.push({
        label: '◌ Legacy MCP companion', value: `/mcp remove ${LEGACY_DESKTOP_SERVER}`,
        desc: 'desktop control is native now — Enter removes open-computer-use',
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

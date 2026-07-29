import { globalCommandRegistry } from './registry';
import { globalMcpManager } from '../../mcp/manager';
import { globalBrowserRuntime } from '../../browser/browser.runtime';
import { globalDesktopRuntime } from '../../computer/desktop.runtime';
import { getTaintTracker } from '../../mind/taint';
import { loadConfig, saveConfig } from '../config';

// /computer — the truthful status hub for computer use: what BiMax can currently OBSERVE and ACT
// on (browser + native desktop), whether the active model can actually see screenshots, and which
// session grants are standing. The user-facing runtime is Bimax Computer Use (semantic native
// sidecar in shipped builds, in-repo Swift fallback in dev) — the old user-configured
// open-computer-use MCP companion is legacy and only surfaces here with a removal action.

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

    if (sub === 'approvals') {
      const cfg = await loadConfig();
      const next = cfg.computerApprovals === 'high-impact-only' ? 'always' : 'high-impact-only';
      await saveConfig({ computerApprovals: next });
      context.addSystemMessage('success', next === 'high-impact-only'
        ? 'Computer-use approvals: only high-impact actions (delete/send/purchase/submit/permissions) will ask. Routine clicks and typing run without prompts; credential managers and wallets stay hard-denied.'
        : 'Computer-use approvals: every acting verb asks again (per app/domain session grants still apply).');
      return { type: 'none' };
    }

    if (sub === 'pause' || sub === 'takeover') {
      const r = globalDesktopRuntime.pauseForUser?.() ?? { ok: false };
      const surface = globalDesktopRuntime.activeSurface?.();
      context.addSystemMessage(r.ok ? 'success' : 'info', r.ok
        ? `You have control${surface?.app ? ` of ${surface.app}` : ''}. The agent will not click, type, or move the cursor until you run /computer resume.`
        : 'No active computer-use surface to take over.');
      return { type: 'none' };
    }

    if (sub === 'resume') {
      const r = globalDesktopRuntime.resume?.() ?? { ok: false };
      context.addSystemMessage(r.ok ? 'success' : 'info', r.ok
        ? 'Resumed — the agent has control of the surface again.'
        : 'Nothing to resume.');
      return { type: 'none' };
    }

    if (sub === 'visible' || sub === 'background') {
      // These are explicit setters, not a toggle. A command named "visible" must never silently
      // turn the physical cursor back off when it is run twice (or selected from stale UI state).
      // Keep the alternative mode available under its own equally explicit subcommand.
      const next = sub === 'visible';
      await saveConfig({ computerVisible: next });
      await globalDesktopRuntime.dispose?.();
      context.addSystemMessage('success', next
        ? 'Computer input is visible: target windows come forward and the physical mouse/keyboard performs actions.'
        : 'Computer input is background-first: semantic Accessibility handles are preferred, the physical cursor stays with you, and each step is checked from a fresh target-window frame.');
      return { type: 'none' };
    }

    if (sub === 'pip') {
      const cfg = await loadConfig();
      const next = !cfg.computerPip;
      await saveConfig({ computerPip: next });
      await globalDesktopRuntime.dispose?.();
      context.addSystemMessage('success', next
        ? 'Computer-use PiP enabled. ScreenCaptureKit continuously streams the active target window; it is never used for model input coordinates.'
        : 'Computer-use PiP disabled.');
      return { type: 'none' };
    }

    if (sub === 'recording') {
      const cfg = await loadConfig();
      const next = !cfg.computerRecord;
      await saveConfig({ computerRecord: next });
      const state = next
        ? await globalDesktopRuntime.run({ action: 'record_start', recordVideo: true })
        : await globalDesktopRuntime.run({ action: 'record_stop' });
      context.addSystemMessage(state.ok ? 'success' : 'info', state.ok
        ? state.summary
        : `Could not ${next ? 'start' : 'stop'} computer-use recording: ${state.error || 'unknown error'}`);
      return { type: 'none' };
    }

    if (sub === 'install-desktop') {
      // Legacy alias from the MCP-companion era: desktop control is built in now.
      context.addSystemMessage('info', 'Desktop control is built into BiMax now (ComputerTool) — nothing to install. Use "/computer perms" to grant macOS permissions.');
      return { type: 'none' };
    }

    if (sub === 'perms') {
      // Probe the responsible host's OS grants and report the live verdict. Embedded macOS drivers
      // cannot grant themselves permission; the result points to the exact Settings pane.
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

    // Desktop control: Bimax-owned ComputerTool + embedded native sidecar (Swift fallback). quickStatus never
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

    // Behavior toggles: approval cadence + visible cursor.
    const cfg = await loadConfig();
    const pip = await globalDesktopRuntime.pipStatus?.().catch(() => null);
    options.push({
      label: cfg.computerApprovals === 'high-impact-only' ? '⚙ Approvals: high-impact only' : '⚙ Approvals: every action',
      value: '/computer approvals',
      desc: cfg.computerApprovals === 'high-impact-only'
        ? 'only delete/send/purchase/submit ask — Enter switches to asking every action'
        : 'every click/type asks — Enter switches to high-impact-only',
      category: 'Behavior',
    });
    options.push({
      label: cfg.computerPip
        ? (pip?.running ? '● PiP preview: live' : '⚙ PiP preview: waiting')
        : '⚙ PiP preview: off',
      value: '/computer pip',
      desc: cfg.computerPip
        ? (pip?.error
          ? `${pip.error} — Enter turns off`
          : pip?.surface
            ? `continuous ScreenCaptureKit stream of ${pip.surface} — Enter turns off`
            : 'waiting for an active target window — Enter turns off')
        : 'Enter turns on the continuous ScreenCaptureKit preview',
      category: 'Behavior',
    });
    options.push({
      label: cfg.computerRecord ? '⚙ Screen recording: on' : '⚙ Screen recording: off',
      value: '/computer recording',
      desc: cfg.computerRecord
        ? 'trajectory screenshots + MP4 under .bimax/computer/recordings — Enter stops'
        : 'Enter starts trajectory screenshots + MP4 recording',
      category: 'Behavior',
    });
    options.push({
      label: cfg.computerVisible ? '✓ Input: visible native cursor' : '✓ Input: background-first',
      value: cfg.computerVisible ? '/computer background' : '/computer visible',
      desc: cfg.computerVisible
        ? 'target comes forward; Enter switches to background semantic delivery'
        : 'AX handles first, target remains behind your work; Enter switches to visible cursor',
      category: 'Behavior',
    });

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
    // Live control: which surface the agent is operating on and who owns input right now, with a
    // one-keystroke takeover/resume. This is the user's coexistence control (Stage 3).
    const surface = (() => { try { return globalDesktopRuntime.activeSurface?.() || null; } catch { return null; } })();
    if (surface) {
      const owner = surface.focusOwner;
      options.push({
        label: owner === 'user' ? '⏸ You have control (paused)' : '▶ Agent has control',
        value: owner === 'user' ? '/computer resume' : '/computer pause',
        desc: owner === 'user'
          ? `${surface.app || 'surface'} — Enter resumes agent control`
          : `${surface.app || 'surface'}${surface.captureSafe ? '' : ' (whole desktop)'} — Enter pauses so you can take over`,
        category: 'Behavior',
      });
    }

    // Durability (Stage 7): the bounded action history for this session — proof nothing accumulates
    // unbounded across an hours-long run, and it survives a crash+relaunch of the same app via
    // .bimax/computer/session.json. Only shown once the session has actually acted.
    const hist = (() => { try { return globalDesktopRuntime.history?.() || null; } catch { return null; } })();
    if (hist && hist.total > 0) {
      const foot = (() => { try { return globalDesktopRuntime.memoryFootprint?.() || null; } catch { return null; } })();
      options.push({
        label: `◷ Session: ${hist.total} action${hist.total === 1 ? '' : 's'}`,
        value: '/computer',
        desc: `${hist.kept} kept in memory${foot ? ` · ${foot.observedElements} observed element${foot.observedElements === 1 ? '' : 's'}` : ''}${hist.noChangeStreak >= 2 ? ` · ${hist.noChangeStreak} no-change in a row` : ''} — bounded + persisted for resume`,
        category: 'Behavior',
      });
    }

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
      subtitle: 'Watching is free · acting asks per app/domain · credentials and wallets stay denied',
      options,
      onSelect: (opt: any) => context.executeCommand(opt.value),
    };
  },
});

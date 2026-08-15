import { globalCommandRegistry } from './registry';
import { globalMcpManager } from '../../mcp/manager';
import { globalBrowserRuntime } from '../../browser/browser.runtime';
import type { DesktopRuntimePort } from '../../computer/desktop.runtime';
import { globalComputerSessionManager, isSessionRoutableDesktopRuntime } from '../../computer/session.manager';
import {
  assessAdHocServiceTrust,
  assessNativeSemanticOptIn,
  globalNativeServiceCapabilityClient,
  type NativeServiceHandshake,
} from '../../computer/native.service.client';
import {
  adHocApprovalStorePath,
  readAdHocServiceApproval,
  recordAdHocServiceApproval,
  revokeAdHocServiceApproval,
} from '../../computer/adhoc.approval.store';
import { globalNativeComputerShadowObserver } from '../../computer/native.shadow.comparison';
import { globalNativeRolloutController, type NativeRolloutMode } from '../../computer/native.rollout';
import { getTaintTracker } from '../../mind/taint';
import { loadConfig, saveConfig } from '../config';

// /computer — the truthful status hub for computer use: what BiMax can currently OBSERVE and ACT
// on (browser + native desktop), whether the active model can actually see screenshots, and which
// session grants are standing. The user-facing runtime is Bimax Computer Use (semantic native
// sidecar in shipped builds, in-repo Swift fallback in dev) — the old user-configured
// open-computer-use MCP companion is legacy and only surfaces here with a removal action.

const LEGACY_DESKTOP_SERVER = 'open-computer-use';

/**
 * How the running native service is sealed, for status lines. Deliberately never collapses an
 * approved ad-hoc build into "verified": the user vouched for its provenance, nobody verified it,
 * and a status line that said otherwise would be the one place this design could mislead.
 */
function describeServiceSigning(
  permissions: NativeServiceHandshake['permissions'] | undefined,
  approval: { codeDirectoryHash: string } | undefined,
): string {
  if (!permissions) return 'unknown';
  if (permissions.serviceSigned) return 'verified';
  if (permissions.adHocSigned !== true) return 'unsigned';
  return assessAdHocServiceTrust(permissions, approval).trusted
    ? 'ad-hoc, approved by you'
    : 'ad-hoc, not approved';
}

globalCommandRegistry.register({
  name: '/computer',
  description: 'Computer use — browser & desktop control status, vision, grants',
  category: 'Configuration',
  execute: async (args, context) => {
    const configuredRuntime = (context.options?.desktopRuntime as DesktopRuntimePort | undefined)
      ?? globalComputerSessionManager;
    const desktopRuntime = context.sessionId && isSessionRoutableDesktopRuntime(configuredRuntime)
      ? configuredRuntime.forSession(context.sessionId)
      : configuredRuntime;
    const governor = context.options?.governor as any;
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'revoke-grants') {
      const n = governor?.revokeComputerGrants?.() ?? 0;
      context.addSystemMessage('success', n > 0
        ? `Revoked ${n} session computer-control grant${n === 1 ? '' : 's'}.`
        : 'No session computer-control grants to revoke.');
      return { type: 'none' };
    }

    if (sub === 'backend') {
      const requested = (args[1] || 'status').toLowerCase();
      if (requested === 'reset') {
        const status = globalNativeRolloutController.resetCircuit();
        context.addSystemMessage('success',
          `Native safety circuit reset; backend is ${status.mode}/${status.state}. Restart Bimax if native tools were absent at startup.`);
        return { type: 'none' };
      }
      const mode: NativeRolloutMode | undefined = requested === 'compatibility' ? 'off'
        : requested === 'auto' || requested === 'native' ? 'native'
          : requested === 'cohort' ? 'cohort' : undefined;
      if (mode) {
        const status = globalNativeRolloutController.setMode(mode);
        context.addSystemMessage('success', mode === 'off'
          ? 'Computer backend rolled back to compatibility immediately. Native calls now refuse before delivery; restart Bimax to remove their schemas.'
          : `Computer backend set to ${requested}: rollout is ${status.state}. Restart Bimax if native tools were absent at startup.`);
        return { type: 'none' };
      }
      const status = globalNativeRolloutController.status();
      context.addSystemMessage('info',
        `Native rollout: ${status.mode}/${status.state} · ${status.samples} samples · ${status.failureBps}bps failures${status.tripReason ? ` · ${status.tripReason}` : ''}. Use /computer backend compatibility|native|cohort|reset.`);
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

    // /computer trust-service — the user's half of the ad-hoc trust decision (Phase 4).
    //
    // Bimax refuses a native service that carries no Developer-ID signature, because an unsigned
    // binary in the expected path could be anyone's. That is right for provenance and wrong as an
    // absolute: a build whose author has no Apple Developer account is refused however intact it
    // is. This command lets the user stand in for the provenance check that Developer-ID would
    // otherwise provide — and says plainly that it is standing in, not proving.
    //
    // Everything mechanical is still MEASURED: the seal must verify (SecStaticCodeCheckValidity)
    // and the hash must match this exact binary. Consent cannot approve a capability into
    // existence, and the resulting `service_ad_hoc_user_approved` blocker stays in every
    // assessment so no receipt can later imply a production identity.
    if (sub === 'trust-service') {
      const action = (args[1] || 'show').toLowerCase();
      const stored = readAdHocServiceApproval();

      if (action === 'revoke') {
        if (!stored.approval) {
          context.addSystemMessage('info', `No ad-hoc service approval to revoke (${adHocApprovalStorePath()}).`);
          return { type: 'none' };
        }
        const result = revokeAdHocServiceApproval();
        globalNativeServiceCapabilityClient.invalidate();
        context.addSystemMessage(result.ok ? 'success' : 'error', result.ok
          ? `Approval withdrawn for ${stored.approval.codeDirectoryHash.slice(0, 16)}…. The native service is refused again until you approve it; restart Bimax to drop its tools from this session.`
          : `Could not remove ${result.path}: ${result.error}`);
        return { type: 'none' };
      }

      // Always re-probe rather than trusting a cached handshake: the whole point is to approve the
      // bytes running RIGHT NOW, and a cached probe can be up to 30s old.
      const probe = await globalNativeServiceCapabilityClient.probe(true).catch(() => null);
      const permissions = probe?.handshake?.permissions;
      if (!probe?.reachable || !permissions) {
        context.addSystemMessage('info', `Native service is not reachable, so there is no binary to approve${probe?.error ? ` — ${probe.error}` : ''}.`);
        return { type: 'none' };
      }
      if (permissions.serviceSigned) {
        context.addSystemMessage('info',
          `This service is signed with a production identity (${permissions.signingIdentifier || 'unknown identifier'}) — nothing to approve. Ad-hoc approval only applies to builds without one.`);
        return { type: 'none' };
      }
      if (permissions.adHocSigned !== true) {
        context.addSystemMessage('error',
          'This service carries no signature at all, so there is no seal to verify and nothing an approval could pin. '
          + 'Approval attests to provenance; it cannot substitute for integrity, and integrity here is unmeasurable. '
          + 'Sign the binary (`codesign -s - <path>` produces an ad-hoc seal) and run this again.');
        return { type: 'none' };
      }
      if (permissions.signatureIntact !== true) {
        // Never offer to approve this. The bytes no longer match their own seal — whatever the user
        // believes they are approving, this is not it.
        context.addSystemMessage('error',
          `REFUSED: the ad-hoc signature on this service does not cover the bytes on disk — the binary was modified after it was sealed${probe.binary ? ` (${probe.binary})` : ''}. `
          + 'This is not something you can approve away. Rebuild and re-sign it, then run /computer trust-service again.');
        return { type: 'none' };
      }
      const runningHash = String(permissions.codeDirectoryHash || '').trim().toLowerCase();
      if (!runningHash) {
        context.addSystemMessage('error',
          'This service reports no code directory hash, so there is nothing an approval could pin to. It predates the fields this check needs — rebuild the native service.');
        return { type: 'none' };
      }

      if (action === 'approve') {
        // The hash is required as an explicit argument and must still match. Between the disclosure
        // above and this confirmation the binary could have been replaced with another perfectly
        // intact ad-hoc build — re-signing ad-hoc is free — and the user would be consenting to
        // bytes they were never shown.
        const confirmed = String(args[2] || '').trim().toLowerCase();
        if (!confirmed) {
          context.addSystemMessage('error', 'Approval requires the hash you were shown: /computer trust-service approve <codeDirectoryHash>.');
          return { type: 'none' };
        }
        if (confirmed !== runningHash) {
          context.addSystemMessage('error',
            `REFUSED: the service binary changed since that hash was shown to you (you confirmed ${confirmed.slice(0, 16)}…, the service now reports ${runningHash.slice(0, 16)}…). Nothing was approved — run /computer trust-service again to see the current binary.`);
          return { type: 'none' };
        }
        const written = recordAdHocServiceApproval({
          codeDirectoryHash: runningHash,
          serviceVersion: probe.handshake?.serviceVersion,
          binary: probe.binary,
        });
        globalNativeServiceCapabilityClient.invalidate();
        context.addSystemMessage(written.ok ? 'success' : 'error', written.ok
          ? `Approved ${runningHash.slice(0, 16)}… — recorded in ${written.path}. `
            + 'Every assessment still reports service_ad_hoc_user_approved, so nothing claims this build carries a production identity. '
            + 'Replacing or rebuilding the service changes its hash and revokes this automatically. Restart Bimax to register the native tools.'
          : `Could not record the approval in ${written.path}: ${written.error}`);
        return { type: 'none' };
      }

      // --- the disclosure ---------------------------------------------------------------------
      if (stored.refusedReason) {
        context.addSystemMessage('error', `An existing approval was ignored: ${stored.refusedReason}`);
      }
      const alreadyTrusted = assessAdHocServiceTrust(permissions, stored.approval).trusted;
      context.addSystemMessage('info', [
        `Native service: ${probe.binary || 'unknown path'} (v${probe.handshake?.serviceVersion || '?'})`,
        `Code directory hash: ${runningHash}`,
        '',
        'Verified by measurement: the ad-hoc signature is intact — every page of this binary still',
        'hashes to what the signature recorded, so it has not been altered since it was sealed.',
        '',
        'NOT verified, and this is the part you are being asked to stand in for: WHO built it.',
        'An ad-hoc signature is free to produce and names nobody. Approving this says you obtained',
        'this binary from a source you trust — no one else has vouched for it, and Bimax cannot.',
        '',
        'The approval covers this exact hash only. Rebuilding or replacing the service changes the',
        'hash and revokes it automatically. Approval never grants a capability the service lacks.',
        stored.approval
          ? `\nCurrently approved: ${stored.approval.codeDirectoryHash.slice(0, 16)}…${stored.approval.approvedAt ? ` on ${stored.approval.approvedAt}` : ''}${alreadyTrusted ? ' — this is the running binary.' : ' — this is NOT the running binary.'}`
          : '\nNothing is approved yet.',
      ].join('\n'));

      return {
        type: 'menu',
        title: alreadyTrusted ? 'Ad-hoc native service (already approved)' : 'Approve this ad-hoc native service?',
        options: [
          ...(alreadyTrusted ? [] : [{
            label: `✓ Approve ${runningHash.slice(0, 16)}…`,
            value: `/computer trust-service approve ${runningHash}`,
            desc: 'records consent for this exact binary — integrity is measured, provenance is yours to vouch for',
            category: 'Ad-hoc service',
          }]),
          ...(stored.approval ? [{
            label: '✗ Revoke the recorded approval',
            value: '/computer trust-service revoke',
            desc: 'the native service is refused again until approved',
            category: 'Ad-hoc service',
          }] : []),
          {
            label: '← Cancel', value: '/computer',
            desc: 'nothing is recorded', category: 'Ad-hoc service',
          },
        ],
        onSelect: (opt: any) => context.executeCommand(opt.value),
      };
    }

    if (sub === 'pause' || sub === 'takeover') {
      const r = desktopRuntime.pauseForUser?.() ?? { ok: false };
      const surface = desktopRuntime.activeSurface?.();
      context.addSystemMessage(r.ok ? 'success' : 'info', r.ok
        ? `You have control${surface?.app ? ` of ${surface.app}` : ''}. The agent will not click, type, or move the cursor until you run /computer resume.`
        : 'No active computer-use surface to take over.');
      return { type: 'none' };
    }

    if (sub === 'resume') {
      const r = desktopRuntime.resume?.() ?? { ok: false };
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
      await desktopRuntime.dispose?.();
      context.addSystemMessage('success', next
        ? 'Computer input is visible: target windows come forward and the physical mouse/keyboard performs actions.'
        : 'Computer input is background-first: semantic Accessibility handles are preferred, the physical cursor stays with you, and each step is checked from a fresh target-window frame.');
      return { type: 'none' };
    }

    if (sub === 'pip') {
      const cfg = await loadConfig();
      const next = !cfg.computerPip;
      await saveConfig({ computerPip: next });
      await desktopRuntime.dispose?.();
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
        ? await desktopRuntime.run({ action: 'record_start', recordVideo: true })
        : await desktopRuntime.run({ action: 'record_stop' });
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
      const req = await desktopRuntime.run({ action: 'request_access' });
      const st = await desktopRuntime.run({ action: 'status' });
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
    const desktop = desktopRuntime.quickStatus();
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

    const nativeService = await globalNativeServiceCapabilityClient.probe().catch(error => ({
      configured: true,
      reachable: false,
      routingEligible: false,
      cutoverBlockers: ['service_unreachable'],
      attempts: 0,
      handshake: undefined,
      adHocApproval: undefined,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (nativeService.configured) {
      const workspace = nativeService.handshake?.capabilities.workspace;
      const approval = nativeService.adHocApproval;
      const semanticReady = assessNativeSemanticOptIn(nativeService.handshake, true, approval).eligible;
      const rollout = globalNativeRolloutController.status();
      const semanticEnabled = rollout.selected;
      options.push({
        label: nativeService.reachable ? '◌ Bimax-Cu native service' : '○ Bimax-Cu native service',
        value: '/computer',
        desc: nativeService.reachable
          ? `${nativeService.routingEligible ? 'full cutover ready' : semanticReady
            ? `Phase 9 semantic native ${semanticEnabled ? rollout.state : 'ready'}` : 'foundation ready'} · rollout ${rollout.mode}/${rollout.state}${rollout.samples ? ` ${rollout.failureBps}bps failures` : ''} · workspace ${workspace?.apps && workspace?.windows && workspace?.displays ? 'apps/windows/displays ✓' : 'partial'} · AX ${nativeService.handshake?.permissions.accessibility} · capture ${nativeService.handshake?.permissions.screenRecording} · signing ${describeServiceSigning(nativeService.handshake?.permissions, approval)} · ${nativeService.routingEligible ? 'native surface eligible' : `${nativeService.cutoverBlockers.length} full-cutover blocker${nativeService.cutoverBlockers.length === 1 ? '' : 's'}`}`
          : `probe unavailable${nativeService.error ? ` · ${nativeService.error}` : ''}`,
        category: 'Capabilities',
      });
      // The ad-hoc trust decision, surfaced only when there is actually one to make: a service with
      // a production identity needs nothing, and an unsigned one cannot be approved at all.
      const permissions = nativeService.handshake?.permissions;
      if (nativeService.reachable && permissions && !permissions.serviceSigned && permissions.adHocSigned === true) {
        const trust = assessAdHocServiceTrust(permissions, approval);
        options.push({
          label: trust.trusted ? '⚑ Ad-hoc service: approved by you' : '○ Ad-hoc service: not approved',
          value: '/computer trust-service',
          desc: trust.trusted
            ? `${trust.reason} — integrity measured, provenance vouched for by you; Enter shows it or revokes`
            : `${trust.reason} — Enter shows the hash and what approving does and does not prove`,
          category: 'Safety',
        });
      }
      const shadow = globalNativeComputerShadowObserver.status();
      if (shadow.enabled) {
        options.push({
          label: '◌ Bimax-Cu shadow comparison', value: '/computer',
          desc: `${shadow.compared} compared · ${shadow.skipped} skipped · ${shadow.failed} failed${shadow.lastAgreement ? ` · last agreement ${shadow.lastAgreement}` : ''} · never affects ComputerTool results`,
          category: 'Capabilities',
        });
      }
    }

    const rollout = globalNativeRolloutController.status();
    options.push({
      label: rollout.tripped ? '⚠ Native backend: automatic rollback'
        : rollout.selected ? `● Native backend: ${rollout.mode}` : `○ Native backend: ${rollout.state}`,
      value: '/computer backend status',
      desc: `${rollout.samples} bounded samples · ${rollout.failureBps}bps failures${rollout.bucket !== undefined ? ` · bucket ${rollout.bucket}/${rollout.cohortBps}` : ''}${rollout.tripReason ? ` · ${rollout.tripReason}` : ''} · Enter shows controls`,
      category: 'Safety',
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
    const pip = await desktopRuntime.pipStatus?.().catch(() => null);
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
    const surface = (() => { try { return desktopRuntime.activeSurface?.() || null; } catch { return null; } })();
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
    const hist = (() => { try { return desktopRuntime.history?.() || null; } catch { return null; } })();
    if (hist && hist.total > 0) {
      const foot = (() => { try { return desktopRuntime.memoryFootprint?.() || null; } catch { return null; } })();
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

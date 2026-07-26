/**
 * Live end-to-end receipt check. This intentionally moves the real cursor and types into a new,
 * disposable TextEdit document. It never closes pre-existing documents and discards the new one.
 */
import { BimaxComputerRuntime, DesktopCommand, DesktopResult } from '../src/computer/desktop.runtime';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function requireOk(result: DesktopResult, step: string): DesktopResult {
  if (!result.ok) throw new Error(`${step}: ${result.error || result.summary}`);
  return result;
}

function handleFor(element: any): Partial<DesktopCommand> {
  if (element?.element_token) return { elementToken: String(element.element_token) };
  if (element?.element_index != null) return { elementIndex: Number(element.element_index) };
  if (element?.label) return { query: String(element.label) };
  return {};
}

async function actFresh(
  runtime: BimaxComputerRuntime,
  command: DesktopCommand,
  cwd: string,
): Promise<DesktopResult> {
  let result = await runtime.run(command, { cwd });
  if (!result.ok && /changed after (?:the )?screenshot|accessibility state changed/i.test(result.error || '')) {
    const observed = requireOk(await runtime.run({ action: 'observe', maxElements: 500 }, { cwd }), 'refresh after AX event');
    result = await runtime.run({ ...command, frameId: observed.frameId }, { cwd });
  }
  return result;
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('live receipt verification is macOS-only');
  const runtime = new BimaxComputerRuntime();
  const cwd = process.cwd();
  const marker = `BIMAX-LIVE-RECEIPT-${Date.now()}`;
  let createdDocument = false;
  let discarded = false;
  const evidence: Record<string, unknown> = { marker };

  try {
    const status = requireOk(await runtime.run({ action: 'status' }, { cwd }), 'status');
    if (status.accessibility !== true || status.screenRecording !== true) {
      throw new Error(`permissions are not ready (Accessibility=${status.accessibility}, ScreenRecording=${status.screenRecording})`);
    }
    requireOk(await runtime.run({
      action: 'open', app: 'TextEdit', bundleId: 'com.apple.TextEdit', deliveryMode: 'foreground',
    }, { cwd }), 'open TextEdit');
    await sleep(150);
    const beforeNew = requireOk(await runtime.run({ action: 'observe', maxElements: 300 }, { cwd }), 'observe TextEdit');
    const madeNew = requireOk(await actFresh(runtime, {
      action: 'key', combo: 'cmd+n', frameId: beforeNew.frameId, deliveryMode: 'foreground',
    }, cwd), 'create disposable document');
    createdDocument = true;
    await sleep(180);

    let document = requireOk(await runtime.run({ action: 'observe', maxElements: 500 }, { cwd }), 'observe new document');
    let editable = (document.elements as any[] || []).find(element =>
      ['AXTextArea', 'AXTextField'].includes(String(element?.role || '')));
    if (!editable) {
      document = requireOk(await runtime.run({ action: 'observe', query: 'text area', maxElements: 1000 }, { cwd }), 'find editor');
      editable = (document.elements as any[] || []).find(element =>
        ['AXTextArea', 'AXTextField'].includes(String(element?.role || '')));
    }
    if (!editable) throw new Error('TextEdit exposed no editable AX field in the new document');

    // Force the ambiguity path once with an intentionally absent query. This validates that the
    // installed v20 helper is really running Vision, without depending on OCR reproducing a long
    // punctuation-heavy marker byte-for-byte.
    const visualProbe = requireOk(await runtime.run({
      action: 'observe', query: '__bimax_absent_visual_probe__', maxElements: 500,
    }, { cwd }), 'run foveated vision probe');
    const foveated = (visualProbe.details as any)?.perception?.foveated;
    if (foveated?.triggered !== true || !(Number(foveated.ocrTextRegions) > 0)) {
      throw new Error(`foveated on-device OCR did not produce evidence: ${JSON.stringify(foveated)}`);
    }
    evidence.foveated = foveated;
    document = visualProbe;
    editable = (document.elements as any[] || []).find(element =>
      ['AXTextArea', 'AXTextField'].includes(String(element?.role || '')));
    if (!editable) throw new Error('the editor handle disappeared during the vision probe');

    const typed = requireOk(await actFresh(runtime, {
      action: 'type', text: marker, ...handleFor(editable), frameId: document.frameId,
      deliveryMode: 'foreground',
    }, cwd), 'focus/click/type');
    const receipt = typed.actionReceipt;
    const keyboardReceipt = (typed.details as any)?.keyboardReceipt;
    const beforeLength = Number(keyboardReceipt?.before?.valueLength);
    const afterLength = Number(keyboardReceipt?.after?.valueLength);
    const exactLengthDelta = Number.isFinite(beforeLength) && Number.isFinite(afterLength)
      ? afterLength - beforeLength
      : NaN;
    if (!receipt?.commit.delivered || receipt.preflight.windowMatched !== true
      || receipt.preflight.editable !== true || typed.actionResult?.confidence !== 'proven'
      || exactLengthDelta !== marker.length || keyboardReceipt?.sameElement !== true) {
      throw new Error(`typing receipt was not proven: ${JSON.stringify({ receipt, keyboardReceipt, actionResult: typed.actionResult })}`);
    }
    evidence.typing = {
      receipt,
      actionResult: typed.actionResult,
      progressCheck: typed.progressCheck,
      sameFocusedElement: keyboardReceipt.sameElement,
      exactValueLengthDelta: exactLengthDelta,
      frameId: typed.frameId,
    };

    const closed = requireOk(await actFresh(runtime, {
      action: 'key', combo: 'cmd+w', frameId: typed.frameId, deliveryMode: 'foreground',
    }, cwd), 'close disposable document');
    await sleep(150);
    const closeState = closed.elements?.length
      ? closed
      : await runtime.run({ action: 'observe', maxElements: 500 }, { cwd });
    const discard = (closeState.elements as any[] || []).find(element =>
      element?.role === 'AXButton' && /^(?:don['’]t save|delete|discard)$/i.test(String(element?.label || '').trim()));
    if (discard) {
      const discardedResult = requireOk(await actFresh(runtime, {
        action: 'click', ...handleFor(discard), frameId: closeState.frameId, deliveryMode: 'foreground',
      }, cwd), 'discard disposable document');
      evidence.discard = { label: discard.label, receipt: discardedResult.actionReceipt };
    } else {
      evidence.discard = { prompt: 'not shown; TextEdit closed the untitled document directly' };
    }
    discarded = true;

    process.stdout.write(`${JSON.stringify({ ok: true, ...evidence }, null, 2)}\n`);
  } finally {
    // If an earlier assertion failed after the new document was created, make one bounded cleanup
    // attempt. Never quit TextEdit: the user may have had other documents open before this check.
    if (createdDocument && !discarded) {
      try {
        const fresh = await runtime.run({ action: 'observe', maxElements: 500 }, { cwd });
        if (fresh.ok) {
          const closed = await actFresh(runtime, {
            action: 'key', combo: 'cmd+w', frameId: fresh.frameId, deliveryMode: 'foreground',
          }, cwd);
          const discard = (closed.elements as any[] || []).find(element =>
            element?.role === 'AXButton' && /^(?:don['’]t save|delete|discard)$/i.test(String(element?.label || '').trim()));
          if (discard) await actFresh(runtime, {
            action: 'click', ...handleFor(discard), frameId: closed.frameId, deliveryMode: 'foreground',
          }, cwd);
        }
      } catch { /* original failure remains the actionable report */ }
    }
    await runtime.dispose();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

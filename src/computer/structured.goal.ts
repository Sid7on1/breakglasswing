import { Message } from '../core/llm.provider';
import { contentToText, isScreenshotObservationMessage } from '../core/multimodal';
import { computerToolResults } from './action.evidence';

type Requirement =
  | { kind: 'text'; value: string }
  | { kind: 'checkbox'; label: string }
  | { kind: 'popup'; value: string }
  | { kind: 'radio'; label: string };

interface StructuredComputerGoal {
  request: string;
  app?: string;
  requirements: Requirement[];
}

const clean = (value: string): string => value.trim().replace(/^['"“”]|['"“”]$/g, '').trim();
const norm = (value: unknown): string => String(value ?? '').trim().toLocaleLowerCase();
const role = (element: any): string => String(element?.role || '');
const label = (element: any): string => String(element?.label || '');
const value = (element: any): string => String(element?.value ?? '');
const isOn = (element: any): boolean => /^(?:1|true|yes|on|selected|checked)$/i.test(value(element).trim());

function userRequest(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'user' || isScreenshotObservationMessage(message)) continue;
    const full = contentToText(message.content as any).trim();
    if (!full || /^\[(?:COMPUTER|OPERATION|LOOP)\b/i.test(full)) continue;
    return full
      .split('\n\n[Compact desktop playbook]', 1)[0]
      .split('\n\n[Desktop operation playbook', 1)[0]
      .trim();
  }
  return '';
}

/** Parse only explicit, deterministic GUI end states. Ambiguous desktop prose yields no contract. */
export function inferStructuredComputerGoal(messages: Message[]): StructuredComputerGoal | undefined {
  const request = userRequest(messages);
  if (!request) return undefined;
  const requirements: Requirement[] = [];

  const text = request.match(/(?:single[- ]line\s+)?text field[\s\S]{0,160}?\bto exactly:\s*([^\n]+)/i);
  if (text?.[1]) requirements.push({ kind: 'text', value: clean(text[1]) });

  const checkbox = request.match(/(?:tick|check)\s+the\s+checkbox\s+labelled\s+["“]([^"”]+)["”]/i);
  if (checkbox?.[1]) requirements.push({ kind: 'checkbox', label: clean(checkbox[1]) });

  const popup = request.match(/pop-up button[\s\S]{0,180}?\bselect:\s*([^\n]+)/i);
  if (popup?.[1]) requirements.push({ kind: 'popup', value: clean(popup[1]) });

  const radio = request.match(/radio button\s+labelled exactly:\s*([^\n]+)/i);
  if (radio?.[1]) requirements.push({ kind: 'radio', label: clean(radio[1]) });

  if (!requirements.length) return undefined;
  const app = request.match(/application named\s+([\p{L}\p{N}._ -]+?)\s+and\b/iu)?.[1]?.trim();
  return { request, ...(app ? { app } : {}), requirements };
}

function observedElements(messages: Message[]): any[] {
  const results = computerToolResults(messages);
  const latest = results[results.length - 1];
  // Element tokens are snapshot-scoped capabilities. If the newest action failed or returned no
  // state, walking backward would resurrect an expired handle from an older screen.
  return Array.isArray(latest?.elements) ? latest.elements as any[] : [];
}

function matchingElement(requirement: Requirement, elements: any[]): any | undefined {
  if (requirement.kind === 'text') return elements.find(element => role(element) === 'AXTextField');
  if (requirement.kind === 'checkbox') return elements.find(element => role(element) === 'AXCheckBox'
    && norm(label(element)) === norm(requirement.label));
  if (requirement.kind === 'popup') return elements.find(element => role(element) === 'AXPopUpButton');
  return elements.find(element => role(element) === 'AXRadioButton'
    && norm(label(element)) === norm(requirement.label));
}

function satisfied(requirement: Requirement, elements: any[]): boolean {
  const element = matchingElement(requirement, elements);
  if (!element) return false;
  if (requirement.kind === 'text') return value(element) === requirement.value;
  if (requirement.kind === 'popup') return norm(value(element) || label(element)) === norm(requirement.value);
  return isOn(element);
}

/** True only when the newest ComputerTool result independently exposes every exact requested end
 * state. This lets the loop finish a deterministic fixture/form operation without spending more
 * model rounds asking a weak controller whether visibly proven values mean "done". */
export function structuredComputerGoalSatisfied(messages: Message[]): boolean {
  const goal = inferStructuredComputerGoal(messages);
  if (!goal) return false;
  const results = computerToolResults(messages);
  const latest = results[results.length - 1];
  const elements = observedElements(messages);
  return Boolean(latest && latest.ok !== false && elements.length
    && goal.requirements.every(requirement => satisfied(requirement, elements)));
}

function selector(element: any, fallbackQuery?: string): Record<string, unknown> {
  const token = element?.element_token ?? element?.elementToken;
  if (token) return { elementToken: String(token) };
  const index = element?.element_index ?? element?.elementIndex;
  if (Number.isFinite(Number(index))) return { elementIndex: Number(index) };
  return fallbackQuery ? { query: fallbackQuery } : {};
}

/**
 * Add intent that the user made mechanically unambiguous before the call enters provider history.
 * This is the GUI equivalent of exact prose word-count constraints: it never invents content or a
 * target, and it only makes an explicitly exact/idempotent request survive a weak model's omission.
 */
export function applyImplicitComputerGoalConstraints(rawArgs: string, messages: Message[]): string {
  let args: any;
  try { args = JSON.parse(rawArgs || '{}'); } catch { return rawArgs; }
  const goal = inferStructuredComputerGoal(messages);
  if (!goal || !args || typeof args !== 'object') return JSON.stringify(args);

  const results = computerToolResults(messages);
  const elements = observedElements(messages);
  if (!results.length && goal.app && !/bundle\s*(?:id|identifier)/i.test(goal.request)) {
    // No owned/fresh form state exists yet. Small models often stuff an `open` call with remembered
    // fields from unrelated actions (fake pid/window ids, recording output, or a stale BrowserTool
    // handoff); those fields change the authority path before the runtime can even resolve the app.
    // The user supplied one exact launch target, so compile the only faithful first step.
    return JSON.stringify({ action: 'open', app: goal.app });
  }
  if (results.length && !elements.length) {
    // A failed/stale action invalidates the older frame. Force one clean read before selecting any
    // control; this also strips coordinates, fake generations, and other model-invented baggage.
    return JSON.stringify({ action: 'observe', includeScreenshot: false });
  }
  if (elements.length) {
    const unmet = goal.requirements.find(requirement => !satisfied(requirement, elements));
    if (!unmet) {
      // The explicit contract is already satisfied. A weak controller sometimes emits the same
      // toggle call again after reading value=1; turn every redundant mutation into a fresh read.
      return JSON.stringify({ action: 'observe', includeScreenshot: false });
    }
    const element = matchingElement(unmet, elements);
    // Only compile when the fresh state exposes the exact required role/control. If it is absent,
    // preserve the model's navigation/recovery action rather than guessing a hidden target.
    if (element) {
      if (unmet.kind === 'text') {
        return JSON.stringify({
          action: 'set_value', value: unmet.value,
          ...selector(element, label(element)), expect: unmet.value, expectMode: 'present',
        });
      }
      if (unmet.kind === 'popup') {
        return JSON.stringify({
          action: 'set_value', value: unmet.value,
          ...selector(element, label(element)),
        });
      }
      return JSON.stringify({ action: 'click', ...selector(element, unmet.label) });
    }
  }

  const textGoal = goal.requirements.find((item): item is Extract<Requirement, { kind: 'text' }> => item.kind === 'text');
  if (args.action === 'type' && textGoal && String(args.text ?? '') === textGoal.value) args.replaceExisting = true;
  return JSON.stringify(args);
}

/** Hold a success reply until the latest semantic state proves every explicit form requirement. */
export function structuredComputerCompletionNudge(messages: Message[], proposedAnswer: string): string {
  const goal = inferStructuredComputerGoal(messages);
  if (!goal) return '';
  const results = computerToolResults(messages);
  const latest = results[results.length - 1];
  const elements = observedElements(messages);
  const unmet = goal.requirements.find(requirement => !satisfied(requirement, elements));
  if (!unmet) return '';

  // A concrete runtime failure may be reported honestly. This escape cannot authorize a success
  // claim, and a guessed limitation with no failed result does not count as a blocker.
  const claimsSuccess = /\b(?:done|complete|completed|success|succeeded|now\s+(?:holds|shows|is)|already\s+(?:holds|shows|is))\b/i.test(proposedAnswer);
  const reportsFailure = /\b(?:blocked|failed|could\s*n['’]?t|cannot|unable)\b/i.test(proposedAnswer);
  const recoverableFailure = latest?.ok === false
    && /\b(?:stale|expired|too old|observe again|fresh (?:frame|state|observation)|frame[^.]{0,40}old)\b/i.test(JSON.stringify(latest));
  if (latest?.ok === false && !recoverableFailure && reportsFailure && !claimsSuccess) return '';

  const element = matchingElement(unmet, elements);
  let call: Record<string, unknown>;
  let missing: string;
  if (!latest) {
    call = { action: 'open', ...(goal.app ? { app: goal.app } : {}) };
    missing = 'No fresh semantic state proves the requested form values.';
  } else if (!elements.length) {
    call = { action: 'observe', includeScreenshot: false };
    missing = 'The latest action returned no fresh control state, so older element handles are invalid.';
  } else if (unmet.kind === 'text') {
    call = {
      action: 'set_value', value: unmet.value,
      ...selector(element, element ? label(element) : undefined),
      expect: unmet.value, expectMode: 'present',
    };
    missing = `The text field is ${JSON.stringify(element ? value(element) : 'not found')}, not exactly ${JSON.stringify(unmet.value)}.`;
  } else if (unmet.kind === 'popup') {
    call = { action: 'set_value', value: unmet.value, ...selector(element, element ? label(element) : undefined) };
    missing = `The pop-up is ${JSON.stringify(element ? value(element) || label(element) : 'not found')}, not ${JSON.stringify(unmet.value)}.`;
  } else {
    call = { action: 'click', ...selector(element, unmet.label) };
    missing = `The ${unmet.kind} ${JSON.stringify(unmet.label)} is not selected.`;
  }
  return `[COMPUTER FORM COMPLETION GATE] ${missing} Do not claim completion. Call ComputerTool with exactly this one action now: ${JSON.stringify(call)} Then inspect the returned values; do not repeat a click after a checkbox or radio becomes 1/true.`;
}

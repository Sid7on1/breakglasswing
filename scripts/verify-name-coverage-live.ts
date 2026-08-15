/**
 * Live close-out for the three items section 14.6 of COMPUTER_USE_HANDOFF_LOG.md left open.
 *
 * Read-only by design: it opens apps and observes them. It never clicks, types or sends anything, so
 * it is safe to run against a signed-in messaging client. Not part of headless CI — it drives the
 * real desktop.
 *
 *   npx tsx scripts/verify-name-coverage-live.ts [App Name ...]
 *
 * Reports, per app:
 *   - name coverage: how many actionable controls a caller could actually name (14.6a)
 *   - published AX actions: which controls cannot take a background press, read from the tree, so
 *     the -25206 set is enumerated by evidence instead of discovered one refusal at a time (14.6b)
 *   - the scan-cap curve: named rows and wall time against max_elements (14.6c)
 */
import { BimaxComputerRuntime } from '../src/computer/desktop.runtime';

const CAPS = [80, 120, 180, 260, 400, 600];
const ACTIONABLE = new Set([
  'AXButton', 'AXCheckBox', 'AXComboBox', 'AXDisclosureTriangle', 'AXLink', 'AXMenuButton',
  'AXPopUpButton', 'AXRadioButton', 'AXSearchField', 'AXSlider', 'AXSwitch', 'AXTab',
  'AXTextArea', 'AXTextField',
]);

const synthesized = (element: any) => String(element?.label_source || '') === 'synthesized'
  || /^unlabeled /.test(String(element?.label || ''));

/** The predicate this session replaced: "nameless" meant an empty `original_label`, which is only
 * ever populated on a control some rewrite touched. Kept here so BEFORE and AFTER are computed from
 * the same live payload rather than from two separate runs. */
const namelessBefore = (element: any) => !String(element?.original_label || '').trim();
const namelessAfter = (element: any) => synthesized(element) || !String(element?.label || '').trim();

/** Would the old code have told the model to stop using names? Same thresholds as the shipped notice. */
const noticeFires = (actionable: any[], nameless: (element: any) => boolean) => {
  const hits = actionable.filter(nameless);
  return hits.length >= 6 && hits.length / actionable.length >= 0.6;
};

async function profile(runtime: BimaxComputerRuntime, app: string) {
  console.log(`\n${'='.repeat(72)}\n${app}\n${'='.repeat(72)}`);
  const opened = await runtime.run({ action: 'open', app });
  if (!opened.ok) { console.log(`  SKIPPED — ${opened.error || opened.summary}`); return; }

  const rows: string[] = [];
  let richest: any[] = [];
  for (const cap of CAPS) {
    const started = Date.now();
    // Screenshots ON: this is what a caller actually pays, and it is the figure section 14.3 quoted.
    const observed = await runtime.run({ action: 'observe', maxElements: cap });
    const ms = Date.now() - started;
    if (!observed.ok) { rows.push(`  cap ${String(cap).padStart(4)} | FAILED: ${observed.error}`); continue; }
    const elements: any[] = (observed as any).elements || [];
    const actionable = elements.filter(element => ACTIONABLE.has(String(element?.role || '')));
    const named = actionable.filter(element => !namelessAfter(element));
    // Rows/cells carry a list's content and are the thing a caller names in Notes or Mail, but they
    // are not in ACTIONABLE_AX_ROLES, so count them separately rather than reporting an empty app.
    const namedRows = elements.filter(element => /^AX(Row|Cell|StaticText)$/.test(String(element?.role || ''))
      && !namelessAfter(element)).length;
    rows.push(`  cap ${String(cap).padStart(4)} | ${String(elements.length).padStart(3)} elements`
      + ` | ${String(actionable.length).padStart(3)} actionable`
      + ` | ${String(named.length).padStart(3)} nameable`
      + ` | ${String(namedRows).padStart(3)} named rows`
      + ` | ${String(ms).padStart(5)} ms`);
    if (elements.length >= richest.length) richest = elements;
  }
  console.log('  scan-cap curve (14.6c) — screenshots ON');
  rows.forEach(row => console.log(row));

  const actionable = richest.filter(element => ACTIONABLE.has(String(element?.role || '')));
  const before = actionable.filter(namelessBefore);
  const nameless = actionable.filter(namelessAfter);
  console.log('\n  name coverage (14.6a) — same payload, both predicates');
  console.log(`    BEFORE  ${String(actionable.length - before.length).padStart(3)}/${actionable.length} nameable`
    + `   notice fires: ${noticeFires(actionable, namelessBefore) ? 'YES — "stop using names"' : 'no'}`);
  console.log(`    AFTER   ${String(actionable.length - nameless.length).padStart(3)}/${actionable.length} nameable`
    + `   notice fires: ${noticeFires(actionable, namelessAfter) ? 'YES — "stop using names"' : 'no'}`);
  if (nameless.length) {
    console.log(`    genuinely nameless: ${nameless.slice(0, 6).map(element => `${element.role}@${element.element_index}`).join(', ')}`);
  }
  // Spot-check that the names are real words rather than our placeholders.
  const sample = actionable.filter(element => !namelessAfter(element)).slice(0, 6)
    .map(element => `"${String(element.label).slice(0, 28)}"`);
  if (sample.length) console.log(`    sample names: ${sample.join(', ')}`);

  // 14.6b — controls the tree says cannot take a background press. These are exactly the ones that
  // would have answered -25206 after the attempt; they are now known from the observation itself.
  const notPressable = richest.filter(element => element?.background_activatable === false);
  console.log(`\n  published actions (14.6b): ${notPressable.length}/${richest.length} elements cannot take a background press`);
  const byRole = new Map<string, number>();
  for (const element of notPressable) {
    const role = String(element.role || '?');
    byRole.set(role, (byRole.get(role) || 0) + 1);
  }
  for (const [role, count] of byRole) {
    const example = notPressable.find(element => element.role === role);
    console.log(`      ${role} ×${count} — e.g. "${String(example?.label || '').slice(0, 40)}" → needs deliveryMode="foreground"`);
  }
  if (!notPressable.length) console.log('      (none — every described control here accepts a background press)');
}

async function main() {
  const apps = process.argv.slice(2);
  const runtime = new BimaxComputerRuntime();
  try {
    const status = await runtime.run({ action: 'status' });
    if (!status.ok) throw new Error(status.error || status.summary);
    console.log(`driver: ${status.driver}`);
    for (const app of apps.length ? apps : ['Notes']) await profile(runtime, app);
  } finally {
    await runtime.dispose?.();
  }
}

main().catch(error => { console.error(error); process.exit(1); });

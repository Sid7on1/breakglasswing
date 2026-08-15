const readline = require('node:readline');

const digest = process.env.BIMAX_FIXTURE_DIGEST || 'sha256:fixture';
process.stdout.write(`${JSON.stringify({ t: 'hello', protocol: 'bimax-capability/1', contentDigest: digest })}\n`);

const timers = new Map();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const frame = JSON.parse(line);
  if (frame.t === 'cancel') {
    const timer = timers.get(frame.id);
    if (timer) clearTimeout(timer);
    timers.delete(frame.id);
    return;
  }
  if (frame.t !== 'invoke') return;
  if (frame.action === 'hang') {
    timers.set(frame.id, setTimeout(() => {}, 60_000));
    return;
  }
  process.stdout.write(`${JSON.stringify({
    t: 'result', id: frame.id, ok: true, output: JSON.stringify(frame.args),
    observed: { reads: [], writes: [], hosts: [], processes: [] }, taint: ['fixture'],
  })}\n`);
});


import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Repo root = one level up from scripts/, so the smoke test runs from wherever the repo is checked
// out (main working tree or a git worktree).
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn('npx', ['tsx', 'src/index.ts', '--acp'], {
  cwd,
  env: { ...process.env, BIMAX_ACP: '1', BIMAX_SKIP_KEY_ONBOARDING: '1', BIMAX_AUTO_INDEX: '0', BIMAX_DRIVES_BOOT: '0', BIMAX_HEARTBEAT_MS: '0' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const responses = [];
const wanted = new Set([1, 2]);
let settled = false;

child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { console.log('NON-JSON STDOUT:', line.slice(0, 120)); continue; }
    responses.push(msg);
    if (msg.id != null) wanted.delete(msg.id);
    if (wanted.size === 0 && !settled) { settled = true; finish(); }
  }
});
child.stderr.on('data', (d) => process.stderr.write('[child stderr] ' + d));

function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); }

// Drive the handshake once the process is up.
setTimeout(() => {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true } } } });
}, 500);
// session/new after initialize round-trips.
setTimeout(() => {
  send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd } });
}, 1500);

function finish() {
  const init = responses.find((r) => r.id === 1);
  const sess = responses.find((r) => r.id === 2);
  console.log('\n=== initialize result ===');
  console.log(JSON.stringify(init?.result, null, 2));
  console.log('=== session/new result ===');
  console.log(JSON.stringify(sess?.result, null, 2));
  const ok = init?.result?.protocolVersion === 1 && typeof sess?.result?.sessionId === 'string';
  console.log('\nSMOKE:', ok ? 'PASS ✅' : 'FAIL ❌');
  try { child.stdin.end(); } catch {}
  setTimeout(() => { child.kill('SIGTERM'); process.exit(ok ? 0 : 1); }, 300);
}

// Hard timeout.
setTimeout(() => { if (!settled) { console.log('SMOKE: TIMEOUT ❌ (got ids:', responses.map(r=>r.id).filter(x=>x!=null), ')'); child.kill('SIGKILL'); process.exit(2); } }, 60000);

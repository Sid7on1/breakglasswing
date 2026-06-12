import * as dotenv from 'dotenv';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as readline from 'readline';
import * as crypto from 'crypto';

export function loadGlobalEnv(): void {
  const globalEnvPath = path.join(os.homedir(), '.breakglass', '.env');
  if (fs.existsSync(globalEnvPath)) {
    const parsed = dotenv.parse(fs.readFileSync(globalEnvPath, 'utf-8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    console.log(`[Env] Loaded global env from ${globalEnvPath}`);
  }
}

export async function ensureApiKeys(): Promise<void> {
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEYS;
  if (nvidiaKey || openaiKey) return;

  const globalEnvPath = path.join(os.homedir(), '.breakglass', '.env');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nNo API keys found. Set up your NVIDIA API key to use bimax:');
  console.log('  (get one free at https://build.nvidia.com/explore/)');
  const answer = await new Promise<string>(resolve => {
    rl.question('Paste your NVIDIA_API_KEY: ', resolve);
  });
  rl.close();

  const trimmed = answer.trim();
  if (!trimmed) {
    console.log('No key provided. You can set NVIDIA_API_KEY later in ~/.breakglass/.env');
    return;
  }

  fs.mkdirSync(path.dirname(globalEnvPath), { recursive: true });
  fs.writeFileSync(globalEnvPath, `NVIDIA_API_KEY=${trimmed}\n`, 'utf-8');
  process.env.NVIDIA_API_KEY = trimmed;
  console.log(`[Env] Saved API key to ${globalEnvPath}`);
}

export function saveApiKeyToEnv(envVar: string, key: string): void {
  const globalEnvPath = path.join(os.homedir(), '.breakglass', '.env');
  fs.mkdirSync(path.dirname(globalEnvPath), { recursive: true });
  const existing: Record<string, string> = {};
  if (fs.existsSync(globalEnvPath)) {
    const parsed = dotenv.parse(fs.readFileSync(globalEnvPath, 'utf-8'));
    Object.assign(existing, parsed);
  }
  existing[envVar] = key;
  const content = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
  fs.writeFileSync(globalEnvPath, content, 'utf-8');
  process.env[envVar] = key;
}

export function ensureJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  
  const newSecret = crypto.randomBytes(32).toString('hex');
  saveApiKeyToEnv('JWT_SECRET', newSecret);
  process.env.JWT_SECRET = newSecret;
  return newSecret;
}

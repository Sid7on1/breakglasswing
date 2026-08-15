const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

export async function openLocalMcpClient(spec: { name: string; command: string; args?: string[]; env?: Record<string, string>; forceScrubEnv?: boolean }): Promise<any> {
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args || [],
    env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', TMPDIR: process.env.TMPDIR || '', ...(spec.env || {}) },
    stderr: 'pipe',
  });
  const client = new Client({ name: `bimax-mac-${spec.name}`, version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

export function isDeadLocalMcpConnection(error: unknown): boolean {
  return /connection closed|not connected|transport (?:closed|error)|EPIPE|ECONNRESET|write after end/i
    .test(String((error as { message?: unknown })?.message || error));
}

export const openClient = openLocalMcpClient;
export const isDeadConnectionError = isDeadLocalMcpConnection;
export const withTimeout = withCapabilityTimeout;

export async function withCapabilityTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

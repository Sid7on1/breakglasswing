import type { Inbound, Outbound } from './protocol';

export interface GitFile {
  path: string;
  status: string;
  staged: boolean;
  insertions: number;
  deletions: number;
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFile[];
}

export interface GitCommitEntry { hash: string; subject: string; when: string }

export interface FileEntry { name: string; dir: boolean }

export interface FilePreview { content: string; truncated: boolean; size: number; binary: boolean }

export interface SessionMetaRecord {
  id: string;
  title: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  messageCount: number;
  tokenEstimate: number;
}

declare global {
  interface Window {
    bimax: {
      send: (msg: Inbound) => void;
      onMessage: (cb: (msg: Outbound) => void) => () => void;
      onEngineState: (cb: (state: string, detail: string) => void) => () => void;
      onProject: (cb: (dir: string) => void) => () => void;
      pickFolder: () => Promise<string | null>;
      pickFiles: () => Promise<string[]>;
      restartEngine: () => Promise<string>;
      getProject: () => Promise<string>;
      rendererReady: () => void;
      git: {
        status: () => Promise<GitStatusResult | null>;
        diff: (file: string, untracked: boolean) => Promise<string>;
        branches: () => Promise<{ current: string; all: string[] }>;
        log: (n: number) => Promise<GitCommitEntry[]>;
      };
      files: {
        list: (rel: string) => Promise<FileEntry[]>;
        read: (rel: string) => Promise<FilePreview>;
        reveal: (rel: string) => Promise<void>;
        write: (rel: string, content: string) => Promise<void>;
        onChanged: (cb: () => void) => () => void;
      };
      sessionsMeta: () => Promise<SessionMetaRecord[]>;
      pty: {
        create: (cols: number, rows: number) => Promise<number>;
        input: (id: number, data: string) => void;
        resize: (id: number, cols: number, rows: number) => void;
        kill: (id: number) => void;
        onData: (cb: (id: number, data: string) => void) => () => void;
        onExit: (cb: (id: number, code: number) => void) => () => void;
      };
    };
  }
}

export {};

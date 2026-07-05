import Parser from 'web-tree-sitter';
import { Logger, treeSitterRuntimeAvailable } from '../utils';

export interface Classification {
  category: 'read' | 'write' | 'network_exec' | 'install' | 'unknown';
  risk: 'none' | 'low' | 'medium' | 'high' | 'unknown';
}

// Numeric ordering so we can aggregate the riskiest sub-command of a compound line.
const RISK_ORDER: Record<Classification['risk'], number> = {
  none: 0, low: 1, unknown: 1, medium: 2, high: 3,
};

// Commands that "wrap" another command — the real command is the first non-flag argument
// after them (e.g. `sudo rm -rf /`, `env FOO=1 bash`, `xargs rm`). Unwrapping these is the
// single biggest win over the old first-token tokenizer, which classified `sudo rm` as the
// unknown command "sudo" and missed the dangerous payload entirely.
const WRAPPERS = new Set([
  'sudo', 'doas', 'env', 'command', 'exec', 'nice', 'nohup', 'setsid', 'stdbuf', 'nohup',
]);

// Shell / script interpreters — the dangerous tail of a `curl … | sh` pipeline.
const INTERPRETERS = new Set([
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh',
  'python', 'python2', 'python3', 'perl', 'ruby', 'node', 'php', 'rscript', 'osascript',
]);

// Tools that pull bytes off the network — the dangerous head of a download-pipe-to-shell.
const DOWNLOADERS = new Set(['curl', 'wget', 'fetch', 'aria2c', 'http', 'https']);

// Paths a write redirection (`>`, `>>`) should never touch without an explicit prompt.
const SENSITIVE_PREFIXES = [
  '/etc/', '/usr/', '/bin/', '/sbin/', '/boot/', '/sys/', '/dev/', '/var/',
  '/system/', '/library/', '/private/etc/',
];
const SENSITIVE_DOTFILES = ['.ssh/', '.bashrc', '.zshrc', '.bash_profile', '.profile', '.aws/', '.kube/'];

export class BashStaticAnalyzer {
  private static languagePromise: Promise<Parser.Language> | null = null;
  private readonly READ_ONLY_COMMANDS = new Set([
    'ls', 'cat', 'echo', 'pwd', 'whoami', 'date', 'ps', 'top',
    'head', 'tail', 'less', 'more', 'find', 'grep', 'awk', 'sed', 'wc',
    'diff', 'stat', 'file', 'type', 'which', 'whereis', 'git status', 'git log', 'git diff', 'git show',
  ]);

  private readonly WRITE_COMMANDS = new Set([
    'touch', 'mkdir', 'rm', 'rmdir', 'mv', 'cp', 'chmod', 'chown', 'ln',
    'git add', 'git commit', 'git push', 'git checkout', 'git branch', 'git reset',
    'npm run', 'yarn run', 'pnpm run',
  ]);

  private readonly CURL_PIPE_PATTERN = /(curl|wget).*\|\s*(sh|bash|zsh)/i;
  private readonly INSTALL_PATTERNS = [
    /npm\s+(i|install)/i,
    /yarn\s+(add|install)/i,
    /pnpm\s+(add|install)/i,
    /pip\s+install/i,
    /apt(-get)?\s+install/i,
    /brew\s+install/i,
    /gem\s+install/i,
  ];

  // tree-sitter state. Loaded lazily/asynchronously (WASM); analyze() stays synchronous and
  // simply falls back to the regex path until the grammar is ready (or if it never loads).
  private parser: Parser | null = null;
  private warmStarted = false;

  /**
   * Pre-load the tree-sitter-bash grammar so analyze() can use the AST path. Idempotent and
   * best-effort: on any failure we log once and leave the analyzer on its regex fallback.
   * Fire-and-forget this at startup (the Governor does) — there's no need to await it.
   */
  public async warmUp(): Promise<void> {
    if (this.warmStarted) return;
    this.warmStarted = true;
    // Standalone-binary guard: Parser.init() with no wasm on disk aborts with an unhandled
    // rejection that escapes this try/catch (Emscripten). Check before touching it.
    if (!treeSitterRuntimeAvailable()) {
      Logger.warn('[BashAnalyzer] tree-sitter wasm runtime not present — using regex fallback.');
      return;
    }
    try {
      // Parser.init + WASM loading are process-wide work. Governors can be created repeatedly in
      // tests and sub-systems; sharing the promise prevents parallel WASM loads and descriptor
      // spikes while still giving each analyzer its own lightweight Parser instance.
      if (!BashStaticAnalyzer.languagePromise) {
        BashStaticAnalyzer.languagePromise = (async () => {
          await Parser.init();
          const wasmPath = require.resolve('tree-sitter-wasms/out/tree-sitter-bash.wasm');
          return Parser.Language.load(wasmPath);
        })();
      }
      const lang = await BashStaticAnalyzer.languagePromise;
      const parser = new Parser();
      parser.setLanguage(lang);
      this.parser = parser;
      Logger.info('[BashAnalyzer] tree-sitter-bash loaded — AST command analysis active.');
    } catch (e: any) {
      this.parser = null;
      BashStaticAnalyzer.languagePromise = null;
      Logger.warn(`[BashAnalyzer] AST grammar unavailable, using regex fallback: ${e?.message ?? e}`);
    }
  }

  /** True once the AST path is live (mainly for diagnostics/tests). */
  public isAstReady(): boolean { return this.parser !== null; }

  public analyze(command: string): Classification {
    const trimmed = command.trim();
    if (!trimmed) return { category: 'read', risk: 'none' }; // Empty command is safe

    // Prefer the AST path; it inspects EVERY command in a compound line (`a && rm -rf /`),
    // sees into command substitutions (`$(curl … | sh)`), and reads pipelines structurally.
    if (this.parser) {
      const ast = this.analyzeAst(trimmed);
      if (ast) return ast;
    }
    return this.analyzeRegex(trimmed);
  }

  // --- AST path -----------------------------------------------------------------------------

  private analyzeAst(command: string): Classification | null {
    let root: Parser.SyntaxNode;
    try {
      root = this.parser!.parse(command).rootNode;
    } catch {
      return null; // parser blew up — let the regex path try
    }

    const cmdNodes = root.descendantsOfType('command');

    // 1) Download-piped-into-a-shell, detected structurally (catches multi-stage pipes and
    //    reordering the old `curl … | sh` regex missed, e.g. `curl x | tee y | sudo bash`).
    for (const pipe of root.descendantsOfType('pipeline')) {
      if (this.isDownloadToInterpreter(pipe)) {
        return { category: 'network_exec', risk: 'high' };
      }
    }

    const errored = typeof (root as any).hasError === 'function'
      ? (root as any).hasError()
      : (root as any).hasError;
    if (cmdNodes.length === 0) {
      // Nothing we recognise as a command — only trust "safe" if the parse was clean.
      return errored ? null : { category: 'read', risk: 'none' };
    }

    // 2) Classify every command and keep the riskiest. This closes the biggest hole in the
    //    old analyzer: it only ever looked at the FIRST token, so `ls && rm -rf /` read as
    //    a harmless `ls`. Here `rm -rf /` is seen and wins.
    let worst: Classification = { category: 'read', risk: 'none' };
    for (const node of cmdNodes) {
      const cls = this.classifyCommandText(this.effectiveCommandText(node));
      if (RISK_ORDER[cls.risk] > RISK_ORDER[worst.risk]) worst = cls;
    }

    // 3) Write redirections into sensitive paths (`echo x > /etc/passwd`).
    const redir = this.redirectRisk(root);
    if (redir && RISK_ORDER[redir.risk] > RISK_ORDER[worst.risk]) worst = redir;

    return worst;
  }

  /** Does this pipeline pull from the network and feed a shell/interpreter? */
  private isDownloadToInterpreter(pipeNode: Parser.SyntaxNode): boolean {
    let sawDownloader = false;
    let sawInterpreter = false;
    for (const cmd of pipeNode.descendantsOfType('command')) {
      const name = this.effectiveCommandName(cmd);
      if (DOWNLOADERS.has(name)) sawDownloader = true;
      if (INTERPRETERS.has(name)) sawInterpreter = true;
    }
    return sawDownloader && sawInterpreter;
  }

  /** The basename of a command, unwrapping a leading wrapper like `sudo`/`env`/`xargs`. */
  private effectiveCommandName(cmdNode: Parser.SyntaxNode): string {
    const name = basename(cmdNode.childForFieldName('name')?.text ?? '');
    if (WRAPPERS.has(name)) {
      // Skip by node type — web-tree-sitter hands back fresh wrappers, so a `===` identity
      // check against the name node would never match.
      for (const child of cmdNode.namedChildren) {
        if (child.type === 'command_name') continue;
        const t = child.text;
        if (!t || t.startsWith('-') || t.includes('=')) continue; // skip flags / env assignments
        return basename(t);
      }
    }
    return name;
  }

  /**
   * The text of a command with any leading wrapper stripped, so per-command classification
   * (which reuses the regex sets + write-risk heuristics) sees the real payload. For a plain
   * command this is just its text.
   */
  private effectiveCommandText(cmdNode: Parser.SyntaxNode): string {
    const name = basename(cmdNode.childForFieldName('name')?.text ?? '');
    if (!WRAPPERS.has(name)) return cmdNode.text;
    // Drop the wrapper word and any immediately-following flags / env assignments.
    const parts: string[] = [];
    let skipping = true;
    for (const child of cmdNode.namedChildren) {
      if (child.type === 'command_name') continue; // the wrapper itself
      const t = child.text;
      if (skipping && (t.startsWith('-') || t.includes('='))) continue;
      skipping = false;
      parts.push(t);
    }
    return parts.join(' ') || cmdNode.text;
  }

  /** Classify a single, already-unwrapped command string. */
  private classifyCommandText(text: string): Classification {
    const trimmed = text.trim();
    if (!trimmed) return { category: 'read', risk: 'none' };

    if (this.INSTALL_PATTERNS.some(p => p.test(trimmed))) {
      return { category: 'install', risk: 'medium' };
    }

    const tokens = this.tokenize(trimmed);
    const cmdBase = tokens[0] || '';
    const cmdWithSub = tokens.length > 1 ? `${cmdBase} ${tokens[1]}` : cmdBase;

    if (this.READ_ONLY_COMMANDS.has(cmdWithSub) || this.READ_ONLY_COMMANDS.has(cmdBase)) {
      return { category: 'read', risk: 'none' };
    }
    if (this.WRITE_COMMANDS.has(cmdWithSub) || this.WRITE_COMMANDS.has(cmdBase)) {
      return { category: 'write', risk: this.assessWriteRisk(tokens) };
    }
    return { category: 'unknown', risk: 'unknown' };
  }

  /** Escalate write redirections aimed at sensitive system / dotfile paths. */
  private redirectRisk(root: Parser.SyntaxNode): Classification | null {
    const redirects = root.descendantsOfType(['file_redirect', 'redirected_statement']);
    for (const r of redirects) {
      const txt = r.text;
      // Only writes/appends, not reads (`<`). file_redirect text looks like `> /etc/passwd`.
      if (!/(^|\s)>>?(?!\|)/.test(txt) && !txt.includes('>')) continue;
      if (txt.includes('<') && !txt.includes('>')) continue;
      const dest = txt.replace(/^.*?>>?/, '').trim().split(/\s+/)[0] || '';
      if (this.isSensitivePath(dest)) return { category: 'write', risk: 'high' };
    }
    return null;
  }

  private isSensitivePath(p: string): boolean {
    const clean = p.replace(/^['"]|['"]$/g, '');
    if (SENSITIVE_PREFIXES.some(pre => clean.toLowerCase().startsWith(pre))) return true;
    if (clean.startsWith('~/') && SENSITIVE_DOTFILES.some(d => clean.slice(2).startsWith(d))) return true;
    return false;
  }

  // --- Regex fallback (original behaviour, unchanged) ---------------------------------------

  private analyzeRegex(trimmed: string): Classification {
    // Pipe to bash/sh detection
    if (this.CURL_PIPE_PATTERN.test(trimmed)) {
      return { category: 'network_exec', risk: 'high' };
    }

    // Package installs
    if (this.INSTALL_PATTERNS.some(p => p.test(trimmed))) {
      return { category: 'install', risk: 'medium' };
    }

    const tokens = this.tokenize(trimmed);
    const cmdBase = tokens[0] || '';
    const cmdWithSub = tokens.length > 1 ? `${cmdBase} ${tokens[1]}` : cmdBase;

    if (this.READ_ONLY_COMMANDS.has(cmdWithSub) || this.READ_ONLY_COMMANDS.has(cmdBase)) {
      return { category: 'read', risk: 'none' };
    }

    if (this.WRITE_COMMANDS.has(cmdWithSub) || this.WRITE_COMMANDS.has(cmdBase)) {
      const risk = this.assessWriteRisk(tokens);
      return { category: 'write', risk };
    }

    return { category: 'unknown', risk: 'unknown' };
  }

  private tokenize(command: string): string[] {
    // Basic tokenizer that splits by spaces but respects quotes
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const tokens: string[] = [];
    let match;
    while ((match = regex.exec(command)) !== null) {
      tokens.push(match[1] || match[2] || match[0]);
    }
    return tokens;
  }

  private assessWriteRisk(tokens: string[]): 'low' | 'medium' | 'high' {
    const cmd = tokens.join(' ');

    // Recursive+force delete: high risk when aimed at root, home, an absolute path,
    // a parent dir, or anything containing a glob; medium otherwise. Detect the flags
    // regardless of ordering or whether they are combined (e.g. -rf, -fr, -r -f).
    const isRecursiveForce =
      /\brm\b/.test(cmd) &&
      /-[a-z]*r[a-z]*/.test(cmd) &&
      /-[a-z]*f[a-z]*/.test(cmd);
    if (isRecursiveForce) {
      const dangerous = tokens.some(t =>
        t === '/' || t === '~' || t === '.' || t === '..' ||
        t.startsWith('/') || t.startsWith('~') ||
        t.includes('*') || t.includes('..')
      );
      return dangerous ? 'high' : 'medium';
    }

    return 'low';
  }
}

/** basename without pulling in path: `/usr/bin/curl` → `curl`, `./foo` → `foo`. */
function basename(s: string): string {
  const cleaned = s.replace(/^['"]|['"]$/g, '');
  const slash = cleaned.lastIndexOf('/');
  return slash >= 0 ? cleaned.slice(slash + 1) : cleaned;
}

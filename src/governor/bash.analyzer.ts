export interface Classification {
  category: 'read' | 'write' | 'network_exec' | 'install' | 'unknown';
  risk: 'none' | 'low' | 'medium' | 'high' | 'unknown';
}

export class BashStaticAnalyzer {
  private readonly READ_ONLY_COMMANDS = new Set([
    'ls', 'cat', 'echo', 'pwd', 'whoami', 'date', 'ps', 'top', 
    'head', 'tail', 'less', 'more', 'find', 'grep', 'awk', 'sed', 'wc',
    'diff', 'stat', 'file', 'type', 'which', 'whereis', 'git status', 'git log', 'git diff', 'git show'
  ]);

  private readonly WRITE_COMMANDS = new Set([
    'touch', 'mkdir', 'rm', 'rmdir', 'mv', 'cp', 'chmod', 'chown', 'ln',
    'git add', 'git commit', 'git push', 'git checkout', 'git branch', 'git reset',
    'npm run', 'yarn run', 'pnpm run'
  ]);

  private readonly CURL_PIPE_PATTERN = /(curl|wget).*\|\s*(sh|bash|zsh)/i;
  private readonly INSTALL_PATTERNS = [
    /npm\s+(i|install)/i,
    /yarn\s+(add|install)/i,
    /pnpm\s+(add|install)/i,
    /pip\s+install/i,
    /apt(-get)?\s+install/i,
    /brew\s+install/i,
    /gem\s+install/i
  ];

  public analyze(command: string): Classification {
    const trimmed = command.trim();
    if (!trimmed) return { category: 'read', risk: 'none' }; // Empty command is safe

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

    // Check Read-Only
    if (this.READ_ONLY_COMMANDS.has(cmdWithSub) || this.READ_ONLY_COMMANDS.has(cmdBase)) {
      // In a real system we'd extract paths and check if they are forbidden (e.g. /etc/shadow)
      // For now, we consider them none-risk if they are read-only commands
      return { category: 'read', risk: 'none' };
    }

    // Check Write
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
    
    // High risk: rm -rf, especially to root or home
    if (cmd.includes('rm -rf') || cmd.includes('rm -r -f') || cmd.includes('rm -f -r')) {
      if (tokens.some(t => t === '/' || t === '~' || t === '/*')) {
        return 'high';
      }
      return 'medium';
    }

    return 'low';
  }
}

import { AppState, appStore } from '../../state/app.state';
import { IGovernor } from '../../core/interfaces';

export type CommandCategory = 'Configuration' | 'Code & Intelligence' | 'Source Control' | 'General' | 'Session & Context';

export type CommandResult = 
  | { type: 'message'; content: string; level: 'info' | 'success' | 'error' }
  | { type: 'menu'; title: string; options: any[]; onSelect?: (val: any) => void | Promise<void> }
  | { type: 'prompt'; title: string; onResolve: (val: string) => void }
  | { type: 'redirect'; command: string }
  // A rich front-end panel (HelpDashboard / StatsDashboard / DataTableDashboard) forwarded to the
  // TUI as a message carrying a uiComponent + payload.
  | { type: 'dashboard'; uiComponent: string; payload: any }
  | { type: 'none' }; // Handled externally

export interface CommandContext {
  cwd: string;
  options: any; // The global cli options
  codebaseIndexer?: any; // To support /index commands
  graphStore?: any; // Dependency graph, for /impact and /ask
  saveConfig: (updates: any) => Promise<any>;
  addSystemMessage: (level: 'info' | 'success' | 'error', msg: string) => void;
  setActiveMenu: (menu: any) => void;
  setActivePrompt: (prompt: any) => void;
  executeCommand: (cmd: string) => void;
  /** Inject a past session's messages into the current live conversation (session resume). */
  restoreMessages?: (messages: any[]) => void;
  /** Return the current live conversation messages (for branching). */
  getMessages?: () => any[];
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  category: CommandCategory;
  isEnabled?: (context: Partial<CommandContext>) => { enabled: boolean; reason?: string };
  execute(args: string[], context: CommandContext): Promise<CommandResult>;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();
  
  register(command: Command) {
    this.commands.set(command.name.toLowerCase(), command);
    command.aliases?.forEach(a => this.commands.set(a.toLowerCase(), command));
  }
  
  async execute(input: string, context: CommandContext): Promise<CommandResult> {
    const [name, ...args] = input.trim().split(/\s+/);
    const command = this.commands.get(name.toLowerCase());
    
    if (!command) {
      throw new Error(`Unknown command: ${name}`);
    }
    
    return command.execute(args, context);
  }
  
  getSuggestions(partial: string): string[] {
    const matches = new Set<string>();
    for (const [key, cmd] of this.commands.entries()) {
      if (key.startsWith(partial.toLowerCase())) {
        matches.add(`${cmd.name} — ${cmd.description}`);
      }
    }
    return Array.from(matches);
  }

  getAllCommands(): Command[] {
    const uniqueCommands = new Set<Command>();
    for (const cmd of this.commands.values()) {
      uniqueCommands.add(cmd);
    }
    return Array.from(uniqueCommands);
  }

  /**
   * Palette rows for the Ctrl+K command palette: one entry per registered command (deduped by
   * object identity, so aliases don't double-list), sorted by category then name. This is the
   * SINGLE SOURCE OF TRUTH for "what commands exist" — the palette derives from the live registry
   * (built-ins + user `.bimax/commands/*.md`), so it can never drift from reality the way a
   * hardcoded list does.
   */
  getPaletteOptions(store?: any): { label: string; value: string; desc: string; category: string; disabled?: boolean; disabledReason?: string }[] {
    const ctx: Partial<CommandContext> = { graphStore: store };
    return this.getAllCommands()
      .map(c => {
        let disabled = false;
        let disabledReason: string | undefined;
        if (c.isEnabled) {
          const res = c.isEnabled(ctx);
          disabled = !res.enabled;
          disabledReason = res.reason;
        }
        return { label: c.name, value: c.name, desc: c.description, category: c.category, disabled, disabledReason };
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  }
}

export const globalCommandRegistry = new CommandRegistry();

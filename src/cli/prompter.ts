import { cliEvents } from './events';

export class GlobalPrompter {
  private static isPrompting = false;

  public static register() {
    // No longer needs readline interface, React manages UI.
  }

  public static async ask(question: string, options: string[] = ['Yes', 'No', 'Always']): Promise<string> {
    if (this.isPrompting) {
      throw new Error('[GlobalPrompter] Cannot prompt while another prompt is active.');
    }

    this.isPrompting = true;

    try {
      cliEvents.emit('spinner_state', 'vetoing', 'Governor is evaluating safety constraints...');
    } catch {
      this.isPrompting = false;
      throw new Error('[GlobalPrompter] Failed to emit spinner state.');
    }

    return new Promise((resolve) => {
      try {
        cliEvents.emit('veto_prompt', question, options, (answer: string) => {
          this.isPrompting = false;
          cliEvents.emit('spinner_state', 'idle', 'Ready');
          resolve(answer.trim());
        });
      } catch (e) {
        this.isPrompting = false;
        cliEvents.emit('spinner_state', 'idle', 'Ready');
        throw e;
      }
    });
  }

  public static isBusy(): boolean {
    return this.isPrompting;
  }
}

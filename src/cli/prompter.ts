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

    return new Promise((resolve) => {
      cliEvents.emit('spinner_state', 'vetoing', 'Governor is evaluating safety constraints...');

      cliEvents.emit('veto_prompt', question, options, (answer: string) => {
        this.isPrompting = false;
        cliEvents.emit('spinner_state', 'idle', 'Awaiting orders...');
        resolve(answer.trim());
      });
    });
  }

  public static isBusy(): boolean {
    return this.isPrompting;
  }
}

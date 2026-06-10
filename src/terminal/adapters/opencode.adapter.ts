import { BaseAdapter } from '../base.adapter';

export class OpenCodeAdapter extends BaseAdapter {
  constructor(id: string) {
    super(id, 'OpenCode');
  }

  async spawnSession(): Promise<void> {
    console.log(`[${this.toolName}-${this.id}] Spawning session...`);
    // Implementation for spawning OpenCode process
  }

  async execute(command: string): Promise<string> {
    this.isBusy = true;
    console.log(`[${this.toolName}-${this.id}] Executing: ${command}`);
    
    // Mock execution delay
    return new Promise((resolve) => {
      setTimeout(() => {
        this.isBusy = false;
        resolve(`[${this.toolName}-${this.id}] Output for: ${command}`);
      }, 500);
    });
  }

  async killSession(): Promise<void> {
    console.log(`[${this.toolName}-${this.id}] Killing session...`);
    this.isBusy = false;
  }
}

import { BaseAdapter } from '../base.adapter';

export class ClaudeAdapter extends BaseAdapter {
  constructor(id: string) {
    super(id, 'ClaudeCode');
  }
  // Inherits robust spawnSession, execute, and killSession from BaseAdapter
}

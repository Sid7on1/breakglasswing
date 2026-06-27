import { globalCommandRegistry } from './registry';
import { globalTransactionManager } from '../../core/transaction.manager';
import { randomUUID } from 'crypto';

/**
 * /tx — Atomic multi-file edit transactions.
 *
 * /tx begin             — open a transaction (assigns an ID)
 * /tx commit            — finalize, keep all edits
 * /tx rollback          — undo every edit made since /tx begin
 * /tx status            — show whether a transaction is open
 *
 * While a transaction is open, every EditFileTool call records the file's
 * pre-edit state. If any edit fails, or if /tx rollback is called, ALL
 * previously-touched files in the transaction are restored to their
 * original content automatically.
 */
globalCommandRegistry.register({
  name: '/tx',
  description: 'Atomic multi-file edit transaction — begin / commit / rollback',
  category: 'Code & Intelligence',
  execute: async (args, _context) => {
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'begin' || sub === 'start') {
      // Begin fails if one is already open — report that at error level, not success.
      if (globalTransactionManager.isOpen()) {
        return { type: 'message', level: 'error', content: `Transaction ${globalTransactionManager.currentId()} is already open. Commit or roll it back first (/tx commit · /tx rollback).` };
      }
      const id = `TX-${randomUUID().slice(0, 6).toUpperCase()}`;
      const msg = globalTransactionManager.begin(id);
      return { type: 'message', level: 'success', content: msg };
    }

    if (sub === 'commit' || sub === 'done') {
      const msg = globalTransactionManager.commit();
      return { type: 'message', level: 'success', content: msg };
    }

    if (sub === 'rollback' || sub === 'abort' || sub === 'undo') {
      const msg = await globalTransactionManager.rollback();
      return { type: 'message', level: 'info', content: msg };
    }

    if (sub === 'status') {
      if (globalTransactionManager.isOpen()) {
        return { type: 'message', level: 'info', content: `Transaction ${globalTransactionManager.currentId()} is OPEN. Use /tx commit or /tx rollback.` };
      }
      return { type: 'message', level: 'info', content: 'No open transaction. Use /tx begin to start one.' };
    }

    return {
      type: 'message',
      level: 'info',
      content: [
        '/tx begin    — open a transaction (tracks all edits for atomic rollback)',
        '/tx commit   — finalize and keep all edits',
        '/tx rollback — undo every edit made in this transaction',
        '/tx status   — check if a transaction is open',
      ].join('\n'),
    };
  },
});

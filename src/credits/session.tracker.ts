import { Logger } from '../utils';

interface TrackedSession {
  sessionId: string;
  lastPing: number;
}

export class SessionTracker {
  private activeSessions: Map<string, TrackedSession> = new Map();
  private gcInterval?: NodeJS.Timeout;

  constructor() {
    this.startGarbageCollector();
  }

  private startGarbageCollector() {
    // Run GC every 1 minute. Evict sessions silent for > 1 hour (3600000ms).
    this.gcInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.activeSessions.entries()) {
        if (now - session.lastPing > 3600000) {
          Logger.warn(`[SessionTracker] GC: Evicting stale CLI session: ${id}`);
          this.activeSessions.delete(id);
        }
      }
    }, 60000);
  }

  pingSession(sessionId: string) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastPing = Date.now();
    } else {
      this.startSession(sessionId);
    }
  }

  startSession(sessionId: string) {
    this.activeSessions.set(sessionId, { sessionId, lastPing: Date.now() });
    Logger.info(`[SessionTracker] Tracking active CLI session: ${sessionId}`);
  }

  endSession(sessionId: string) {
    this.activeSessions.delete(sessionId);
    Logger.info(`[SessionTracker] Ended tracking for CLI session: ${sessionId}`);
  }

  hasActiveSessions(): boolean {
    return this.activeSessions.size > 0;
  }
  
  stop() {
    if (this.gcInterval) clearInterval(this.gcInterval);
  }
}

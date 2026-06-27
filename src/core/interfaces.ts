/**
 * Core interface contracts for BreakGlassWing.
 * These decouple concrete implementations from consumers,
 * enabling dependency injection and testability.
 */

export interface IDatabase {
  connect(uri: string): Promise<void>;
  saveEvent(payload: any): Promise<void>;
}

export interface IGovernor {
  approveTaskExecution(taskType: string, payload: any): Promise<void>;
}

export interface IEventBus {
  emit(event: string, ...args: any[]): boolean;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
}

export interface ILogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface IShutdownCoordinator {
  registerTeardownHook(hook: () => Promise<void>): void;
  initiateShutdown(): Promise<void>;
}

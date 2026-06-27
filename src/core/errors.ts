/**
 * Structured error hierarchy for BreakGlassWing.
 * Replaces raw `throw new Error(...)` with typed, categorized errors
 * that support `instanceof` checks and carry machine-readable codes.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    // Preserve prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the Governor vetoes a task for safety violations. */
export class GovernorVetoError extends AppError {
  constructor(reason: string) {
    super(`GOVERNOR_VETO: ${reason}`, 'GOVERNOR_VETO');
    this.name = 'GovernorVetoError';
  }
}

/** Thrown on database connection or write failures. */
export class DatabaseError extends AppError {
  constructor(message: string, isOperational = true) {
    super(message, 'DATABASE_ERROR', isOperational);
    this.name = 'DatabaseError';
  }
}

/** Thrown on LLM API communication failures. */
export class LlmError extends AppError {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly retryAfterSecs: number | null = null
  ) {
    super(message, 'LLM_ERROR');
    this.name = 'LlmError';
  }
}

/** Thrown on LLM request timeouts specifically. */
export class LlmTimeoutError extends LlmError {
  constructor(message: string) {
    super(message, 408, 0);
    this.name = 'LlmTimeoutError';
  }
}

/** Thrown on LLM rate limit (429) errors. */
export class LlmRateLimitError extends LlmError {
  constructor(message: string, retryAfterSecs: number | null = null) {
    super(message, 429, retryAfterSecs);
    this.name = 'LlmRateLimitError';
  }
}

/** Thrown on invalid configuration or environment. */
export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

/** Thrown on authentication/authorization failures. */
export class AuthError extends AppError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

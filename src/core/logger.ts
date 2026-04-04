// ── Logger ────────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_METHODS: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.log,
  warn: console.warn,
  error: console.error,
};

const STYLES: Record<LogLevel, string> = {
  debug: 'color: #888',
  info: 'color: #4fc3f7',
  warn: 'color: #ffb74d',
  error: 'color: #ef5350; font-weight: bold',
};

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

let _enabled = true;

export function setLogging(enabled: boolean): void {
  _enabled = enabled;
}

export function createLogger(scope: string): Logger {
  const make = (level: LogLevel) => (...args: unknown[]) => {
    if (!_enabled) return;
    LOG_METHODS[level](`%c[peerchat:${scope}]`, STYLES[level], ...args);
  };

  return {
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
  };
}

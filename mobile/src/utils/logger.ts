// Mobile Logger with Sensitive Data Sanitization

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEYS = ['password', 'password_hash', 'token', 'secret', 'authorization', 'bearer'];

function sanitize(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // Check if looks like JWT
    if (data.startsWith('eyJ') && data.split('.').length === 3) {
      return '[REDACTED_JWT]';
    }
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(sanitize);
  }
  if (typeof data === 'object') {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = sanitize(value);
      }
    }
    return sanitizedObj;
  }
  return data;
}

class Logger {
  private isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

  private formatMessage(level: LogLevel, tag: string, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    const prefix = `[${timestamp}][${level.toUpperCase()}][${tag}]`;
    return `${prefix} ${message}`;
  }

  debug(tag: string, message: string, data?: unknown): void {
    if (this.isDev) {
      console.log(this.formatMessage('debug', tag, message), data ? sanitize(data) : '');
    }
  }

  info(tag: string, message: string, data?: unknown): void {
    console.info(this.formatMessage('info', tag, message), data ? sanitize(data) : '');
  }

  warn(tag: string, message: string, data?: unknown): void {
    console.warn(this.formatMessage('warn', tag, message), data ? sanitize(data) : '');
  }

  error(tag: string, message: string, error?: unknown): void {
    console.error(this.formatMessage('error', tag, message), error ? sanitize(error) : '');
  }
}

export const logger = new Logger();
export default logger;

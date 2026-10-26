import pino, { type Logger } from 'pino';

export type { Logger };

/** Structured logger. Sensitive fields are redacted; never log tokens, passwords or chat bodies. */
export function createLogger(level = 'info', pretty = false): Logger {
  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'password', 'token', '*.password', '*.token', 'body'],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true } } } : {}),
  });
}

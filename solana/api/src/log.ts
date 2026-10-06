import pino from 'pino';

/** Structured JSON logs. Never log request bodies, signatures, keys or connection strings. */
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['*.password', '*.databaseUrl', '*.apiKey', 'req.headers.authorization'], censor: '[redacted]' },
  base: { service: 'tradgents-solana' },
});

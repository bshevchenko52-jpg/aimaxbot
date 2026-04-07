import { getConfig } from '../config';

type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function allow(level: Level): boolean {
  try {
    const cfg = getConfig();
    return order[level] >= order[cfg.LOG_LEVEL];
  } catch {
    return true;
  }
}

export const log = {
  debug: (msg: string, meta?: unknown) => {
    if (allow('debug')) console.debug(msg, meta ?? '');
  },
  info: (msg: string, meta?: unknown) => {
    if (allow('info')) console.info(msg, meta ?? '');
  },
  warn: (msg: string, meta?: unknown) => {
    if (allow('warn')) console.warn(msg, meta ?? '');
  },
  error: (msg: string, meta?: unknown) => {
    if (allow('error')) console.error(msg, meta ?? '');
  },
};

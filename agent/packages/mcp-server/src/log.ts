type Level = 'debug' | 'info' | 'warn' | 'error';
const rank: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, f?: Record<string, unknown>): void;
  info(msg: string, f?: Record<string, unknown>): void;
  warn(msg: string, f?: Record<string, unknown>): void;
  error(msg: string, f?: Record<string, unknown>): void;
}

/** One JSON object per line on stderr-safe stream. Fields include agent_id, addr, duration_ms, costUnits when known. */
export function createLogger(level: Level = 'info', write: (line: string) => void = (l) => process.stderr.write(`${l}\n`)): Logger {
  const emit = (lv: Level, msg: string, f?: Record<string, unknown>) => {
    if (rank[lv] < rank[level]) return;
    write(JSON.stringify({ ts: new Date().toISOString(), level: lv, msg, ...f }));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

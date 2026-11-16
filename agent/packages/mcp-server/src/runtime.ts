import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import { MemoryCache, RedisCache, type Cache } from './cache.js';
import { loadConfig, parseApiKeys, type Config } from './config.js';
import { createLogger, type Logger } from './log.js';
import { keyHash } from './mcp/tools.js';
import { OracleClient } from './oracle.js';
import { ChainRegistry } from './skills/chains.js';
import { VerdictService } from './service.js';
import { buildSources } from './sources.js';
import { MemoryStore } from './store/memory.js';
import { PgStore } from './store/pg.js';
import type { Store } from './store/types.js';

export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Wire config → store, cache, sources, service. Falls back to in-memory when DB/Redis are not configured. */
export async function bootstrap(env: NodeJS.ProcessEnv = process.env): Promise<{ cfg: Config; svc: VerdictService; log: Logger; shutdown: () => Promise<void> }> {
  const cfg = loadConfig(env);
  const log = createLogger(cfg.LOG_LEVEL);
  let store: Store;
  if (cfg.DATABASE_URL) {
    store = await PgStore.connect(cfg.DATABASE_URL, migrationsFolder);
    log.info('store_ready', { kind: 'postgres' });
  } else {
    store = new MemoryStore();
    log.warn('store_ready', { kind: 'memory', note: 'DATABASE_URL not set; data is lost on restart' });
  }
  let cache: Cache;
  if (cfg.REDIS_URL) {
    cache = new RedisCache(new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false }));
    log.info('cache_ready', { kind: 'redis' });
  } else {
    cache = new MemoryCache();
    log.warn('cache_ready', { kind: 'memory' });
  }
  const keys = parseApiKeys(cfg.API_KEYS);
  if (cfg.NODE_ENV === 'production' && keys.some((k) => k.key.length < 24 || /^(dev|test|demo|changeme)/i.test(k.key))) {
    throw new Error('API_KEYS contains a short or demo key; use random keys of 24+ characters in production');
  }
  for (const k of keys) await store.grantScopes(keyHash(k.key), k.scopes); // only hashes are stored
  const sources = buildSources(cfg);
  log.info('sources', { enabled: sources.map((s) => s.name), disabled: cfg.DISABLE_SOURCES });
  const oracle = cfg.ORACLE_ADDRESS
    ? new OracleClient({ address: cfg.ORACLE_ADDRESS as `0x${string}`, rpcUrl: cfg.ORACLE_RPC_URL ?? cfg.RPC_URL ?? 'https://rpc-robinhood.globalstake.io', chainId: cfg.ORACLE_CHAIN_ID, ...(cfg.ATTESTER_PRIVATE_KEY ? { privateKey: cfg.ATTESTER_PRIVATE_KEY as `0x${string}` } : {}) })
    : null;
  if (oracle) log.info('oracle', { address: oracle.address, chainId: oracle.chainId, writable: oracle.writable });
  const svc = new VerdictService({ chains: new ChainRegistry(cfg.RPC_URL, undefined, cfg.ARCHIVE_RPC_URL), walletRange: BigInt(cfg.RPC_LOG_RANGE), oracle,  store, cache, sources, log, quotaPerDay: cfg.QUOTA_UNITS_PER_DAY, scanCacheSeconds: cfg.SCAN_CACHE_SECONDS, leaderboardMinCalls: cfg.LEADERBOARD_MIN_CALLS, allowInsecureUrls: cfg.ALLOW_INSECURE_URLS === '1' });
  return { cfg, svc, log, shutdown: async () => { await Promise.allSettled([store.close(), cache.close()]); } };
}

/** SIGTERM / SIGINT → stop accepting work, finish in-flight, close connections. */
export function onShutdown(log: Logger, fn: () => Promise<void>) {
  let done = false;
  const handler = (sig: string) => {
    if (done) return;
    done = true;
    log.info('shutdown', { signal: sig });
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    fn().then(() => process.exit(0), (e) => { log.error('shutdown_failed', { err: (e as Error).message }); process.exit(1); });
  };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

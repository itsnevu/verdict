import { z } from 'zod';

const list = z.string().optional().transform((s) => (s ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));

const Env = z.object({
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  RPC_URL: z.string().optional(),
  RPC_LOG_RANGE: z.coerce.number().int().positive().default(400000),
  DEX_BASE_URL: z.string().default('https://api.dexscreener.com'),
  DEX_CHAIN_ID: z.string().default('robinhood'),
  BASEDBOT_BASE_URL: z.string().optional(),
  BASEDBOT_LAUNCH_PATH: z.string().optional(),
  BASEDBOT_SCHEMA_VERIFIED: z.enum(['0', '1']).default('0'),
  /** comma list of adapters to switch off: dexscreener,rpc,basedbot */
  DISABLE_SOURCES: list,
  /** use the bundled synthetic fixtures as a data source (local dev, seed, tests) */
  USE_MOCK_SOURCE: z.enum(['0', '1']).default('0'),
  /** "key:scope1|scope2,key2:scope" */
  API_KEYS: z.string().default(''),
  QUOTA_UNITS_PER_DAY: z.coerce.number().positive().default(500),
  SCAN_CACHE_SECONDS: z.coerce.number().int().positive().default(45),
  LEADERBOARD_MIN_CALLS: z.coerce.number().int().positive().default(200),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().min(30).default(30),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** number of reverse proxies in front of the API (0 = trust none; X-Forwarded-For is ignored) */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** local dev only: allow http:// webhooks and probe targets */
  ALLOW_INSECURE_URLS: z.enum(['0', '1']).default('0'),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}

export function parseApiKeys(s: string): { key: string; scopes: string[] }[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [key, sc = ''] = x.split(':');
    return { key: key!.trim(), scopes: sc.split('|').map((y) => y.trim()).filter(Boolean) };
  });
}

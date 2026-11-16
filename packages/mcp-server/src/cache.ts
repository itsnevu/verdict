import type { Redis } from 'ioredis';

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** increments a fixed-window counter and returns the count and seconds until reset */
  hit(key: string, windowSeconds: number): Promise<{ count: number; resetIn: number }>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryCache implements Cache {
  private m = new Map<string, { v: unknown; exp: number }>();
  constructor(private now: () => number = Date.now) {}
  async get<T>(k: string) {
    const e = this.m.get(k);
    if (!e) return null;
    if (e.exp <= this.now()) { this.m.delete(k); return null; }
    return e.v as T;
  }
  async set(k: string, v: unknown, ttl: number) { this.m.set(k, { v, exp: this.now() + ttl * 1000 }); }
  async hit(k: string, win: number) {
    const now = this.now();
    const e = this.m.get(k);
    if (!e || e.exp <= now) { this.m.set(k, { v: 1, exp: now + win * 1000 }); return { count: 1, resetIn: win }; }
    e.v = (e.v as number) + 1;
    return { count: e.v as number, resetIn: Math.ceil((e.exp - now) / 1000) };
  }
  async ping() { return true; }
  async close() { this.m.clear(); }
}

export class RedisCache implements Cache {
  constructor(private r: Redis) {}
  async get<T>(k: string) { const v = await this.r.get(k); return v ? (JSON.parse(v) as T) : null; }
  async set(k: string, v: unknown, ttl: number) { await this.r.set(k, JSON.stringify(v), 'EX', ttl); }
  async hit(k: string, win: number) {
    const res = await this.r.multi().incr(k).expire(k, win, 'NX').ttl(k).exec();
    const count = Number(res?.[0]?.[1] ?? 1);
    const ttl = Number(res?.[2]?.[1] ?? win);
    return { count, resetIn: ttl > 0 ? ttl : win };
  }
  async ping() { try { return (await this.r.ping()) === 'PONG'; } catch { return false; } }
  async close() { await this.r.quit(); }
}

export interface RateResult { limit: number; remaining: number; reset: number; ok: boolean }

export async function rateLimit(c: Cache, key: string, limit: number, windowSeconds = 60): Promise<RateResult> {
  const { count, resetIn } = await c.hit(`rl:${key}`, windowSeconds);
  return { limit, remaining: Math.max(0, limit - count), reset: resetIn, ok: count <= limit };
}

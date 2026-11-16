import type { SourceResult } from '../types.js';

export interface RetryOpts {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs `fn` with a per-attempt timeout, retrying with exponential backoff + jitter. */
export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, o: RetryOpts = {}): Promise<T> {
  const timeoutMs = o.timeoutMs ?? 4000;
  const retries = o.retries ?? 2;
  const base = o.baseDelayMs ?? 250;
  const rnd = o.random ?? Math.random;
  const sleep = o.sleep ?? defaultSleep;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
      return await fn(ac.signal);
    } catch (e) {
      last = e;
      if (e instanceof NonRetryable) throw e;
    } finally {
      clearTimeout(t);
    }
    if (attempt < retries) await sleep(base * 2 ** attempt + rnd() * base);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export class NonRetryable extends Error {}
export class RateLimited extends Error {}

export const nowIso = () => new Date().toISOString();

export function incomplete<T>(source: string, error: string): SourceResult<T> {
  return { data: null, fetchedAt: nowIso(), source, complete: false, error };
}

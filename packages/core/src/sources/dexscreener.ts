import type { DataSource, MarketData, SourceResult } from '../types.js';
import { NonRetryable, RateLimited, incomplete, nowIso, withRetry, type RetryOpts } from './retry.js';

type Fetch = typeof fetch;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * DexScreener public API. Provides market data only.
 * On rate limit it serves the last snapshot and marks it incomplete (degraded).
 */
export class DexScreenerSource implements DataSource {
  readonly name = 'dexscreener';
  readonly supports = ['getMarket'] as const;
  private last = new Map<string, SourceResult<MarketData>>();
  constructor(private opts: { baseUrl?: string; chainId?: string; fetch?: Fetch; retry?: RetryOpts } = {}) {}

  async getMarket(address: string): Promise<SourceResult<MarketData>> {
    const base = this.opts.baseUrl ?? 'https://api.dexscreener.com';
    const f = this.opts.fetch ?? fetch;
    try {
      const body = await withRetry(async (signal) => {
        const res = await f(`${base}/latest/dex/tokens/${address}`, { signal, headers: { accept: 'application/json' } });
        if (res.status === 429) throw new RateLimited('dexscreener rate limited');
        if (res.status >= 400 && res.status < 500) throw new NonRetryable(`dexscreener ${res.status}`);
        if (!res.ok) throw new Error(`dexscreener ${res.status}`);
        return (await res.json()) as unknown;
      }, { retries: 2, ...this.opts.retry });
      const out = parseDexScreener(body, address, this.opts.chainId ?? 'base');
      if (!out) return incomplete(this.name, 'no pair for this token on the configured chain');
      const r: SourceResult<MarketData> = { data: out, fetchedAt: nowIso(), source: this.name, complete: true };
      this.last.set(address, r);
      return r;
    } catch (e) {
      const prev = this.last.get(address);
      if (prev) return { ...prev, complete: false, error: `stale snapshot served: ${(e as Error).message}` };
      return incomplete(this.name, (e as Error).message);
    }
  }

  async getHolders() { return incomplete<never>(this.name, 'not provided by dexscreener'); }
  async getEarlyBuyers() { return incomplete<never>(this.name, 'not provided by dexscreener'); }
  async getFundingSource() { return incomplete<never>(this.name, 'not provided by dexscreener'); }
  async getContractFlags() { return incomplete<never>(this.name, 'not provided by dexscreener'); }
  async getLaunchMeta() { return incomplete<never>(this.name, 'not provided by dexscreener'); }
}

/** Defensive parser: picks the deepest-liquidity pair on the chain; returns null when nothing usable. */
export function parseDexScreener(body: unknown, address: string, chainId: string): MarketData | null {
  const pairs = (body as { pairs?: unknown })?.pairs;
  if (!Array.isArray(pairs)) return null;
  const want = address.toLowerCase();
  const candidates = pairs.filter((p): p is Record<string, any> =>
    !!p && typeof p === 'object' && (p as any).chainId === chainId && String((p as any).baseToken?.address ?? '').toLowerCase() === want);
  if (!candidates.length) return null;
  candidates.sort((a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0));
  const p = candidates[0]!;
  const mc = num(p.marketCap) ?? num(p.fdv);
  const liq = num(p.liquidity?.usd);
  if (mc === null || liq === null) return null;
  const buys = num(p.txns?.h24?.buys) ?? 0;
  const sells = num(p.txns?.h24?.sells) ?? 0;
  const created = num(p.pairCreatedAt);
  return {
    symbol: typeof p.baseToken?.symbol === 'string' ? p.baseToken.symbol : null,
    name: typeof p.baseToken?.name === 'string' ? p.baseToken.name : null,
    pairAddress: typeof p.pairAddress === 'string' ? p.pairAddress.toLowerCase() : null,
    priceUsd: num(p.priceUsd),
    mcUsd: mc,
    liqUsd: liq,
    vol6hUsd: num(p.volume?.h6) ?? 0,
    vol24hUsd: num(p.volume?.h24) ?? 0,
    tx24h: buys + sells,
    buys24h: buys,
    sells24h: sells,
    uniqueWallets24h: null, // DexScreener does not expose unique makers on the public API
    pairCreatedAt: created ? new Date(created).toISOString() : null,
  };
}

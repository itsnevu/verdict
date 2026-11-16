import { createPublicClient, erc20Abi, http, parseAbiItem, type PublicClient } from 'viem';
import type { DataSource, EarlyBuyerData, HolderData, SourceResult } from '../types.js';
import { incomplete, nowIso, withRetry } from './retry.js';

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const BURN = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

export interface RpcOpts {
  url?: string;
  client?: Pick<PublicClient, 'getBlockNumber' | 'getLogs' | 'readContract' | 'getCode'>;
  /** how many recent blocks to scan for Transfer logs */
  logRange?: bigint;
  chunk?: bigint;
  maxCandidates?: number;
  cacheMs?: number;
}

/**
 * Plain JSON-RPC source. Ordinary nodes have no "holders" method, so holders are
 * reconstructed from Transfer logs + balanceOf on the candidates (approximate: true).
 */
export class RpcSource implements DataSource {
  readonly name = 'rpc';
  readonly supports = ['getHolders', 'getEarlyBuyers', 'getContractFlags'] as const;
  private client: NonNullable<RpcOpts['client']> | null;
  private cache = new Map<string, { at: number; v: SourceResult<HolderData> }>();
  constructor(private o: RpcOpts = {}) {
    this.client = o.client ?? (o.url ? (createPublicClient({ transport: http(o.url, { timeout: 4000 }) }) as unknown as NonNullable<RpcOpts['client']>) : null);
  }

  private async logs(token: `0x${string}`, args?: { from?: `0x${string}` }) {
    const c = this.client!;
    const latest = await withRetry(() => c.getBlockNumber());
    const range = this.o.logRange ?? 20_000n;
    const chunk = this.o.chunk ?? 5_000n;
    const start = latest > range ? latest - range : 0n;
    const out: { from: string; to: string; value: bigint; block: bigint }[] = [];
    for (let b = start; b <= latest; b += chunk) {
      const to = b + chunk - 1n > latest ? latest : b + chunk - 1n;
      const page = await withRetry(() => c.getLogs({ address: token, event: TRANSFER, args, fromBlock: b, toBlock: to }));
      for (const l of page) out.push({ from: String(l.args.from).toLowerCase(), to: String(l.args.to).toLowerCase(), value: l.args.value ?? 0n, block: l.blockNumber ?? 0n });
    }
    return out;
  }

  async getHolders(address: string, ctx: { pairAddress?: string | null; devAddress?: string | null } = {}): Promise<SourceResult<HolderData>> {
    if (!this.client) return incomplete(this.name, 'RPC_URL not configured');
    const hit = this.cache.get(address);
    if (hit && Date.now() - hit.at < (this.o.cacheMs ?? 60_000)) return hit.v;
    try {
      const token = address as `0x${string}`;
      const c = this.client;
      const supply = await withRetry(() => c.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' }));
      if (supply === 0n) return incomplete(this.name, 'totalSupply is zero');
      const logs = await this.logs(token);
      const received = new Map<string, bigint>();
      for (const l of logs) received.set(l.to, (received.get(l.to) ?? 0n) + l.value);
      const exclude = new Set([...BURN, address, ctx.pairAddress?.toLowerCase() ?? '']);
      const cands = [...received.entries()].filter(([a]) => !exclude.has(a)).sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, this.o.maxCandidates ?? 60).map(([a]) => a);
      const balances = await Promise.all(cands.map((a) => withRetry(() => c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [a as `0x${string}`] }))));
      const held = balances.map((b, i) => ({ a: cands[i]!, b })).filter((x) => x.b > 0n).sort((x, y) => (y.b > x.b ? 1 : -1));
      const share = (v: bigint) => Number((v * 1_000_000n) / supply) / 1_000_000;
      const top10 = held.slice(0, 10).reduce((s, x) => s + x.b, 0n);
      let devShare: number | null = null;
      if (ctx.devAddress) {
        const d = await withRetry(() => c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [ctx.devAddress as `0x${string}`] }));
        devShare = share(d);
      }
      const v: SourceResult<HolderData> = {
        data: { top10Share: share(top10), devShare, holderCount: held.length, holderCount24hAgo: null, approximate: true },
        fetchedAt: nowIso(), source: this.name, complete: false,
        error: 'holders reconstructed from recent Transfer logs (approximate)',
      };
      this.cache.set(address, { at: Date.now(), v });
      return v;
    } catch (e) {
      return incomplete(this.name, (e as Error).message);
    }
  }

  async getEarlyBuyers(address: string, ctx: { pairAddress?: string | null } = {}): Promise<SourceResult<EarlyBuyerData>> {
    if (!this.client) return incomplete(this.name, 'RPC_URL not configured');
    if (!ctx.pairAddress) return incomplete(this.name, 'pair address unknown');
    try {
      const logs = await this.logs(address as `0x${string}`, { from: ctx.pairAddress as `0x${string}` });
      const buys = logs.slice(0, 50).map((l) => ({ wallet: l.to, amountUsd: 0, fundingSource: null }));
      return { data: { buys }, fetchedAt: nowIso(), source: this.name, complete: false, error: 'window-limited; funding sources need an indexer' };
    } catch (e) {
      return incomplete(this.name, (e as Error).message);
    }
  }

  async getContractFlags(address: string) {
    if (!this.client) return incomplete<never>(this.name, 'RPC_URL not configured');
    try {
      const c = this.client;
      const code = await withRetry(() => c.getCode({ address: address as `0x${string}` }));
      if (!code || code === '0x') return incomplete<never>(this.name, 'no contract code at address');
      // honeypot / sell simulation needs a router + funded fork; not possible on plain RPC
      return incomplete<never>(this.name, 'sell simulation not available on plain RPC');
    } catch (e) {
      return incomplete<never>(this.name, (e as Error).message);
    }
  }

  async getMarket() { return incomplete<never>(this.name, 'not provided by rpc'); }
  async getFundingSource() { return incomplete<never>(this.name, 'funding trace needs an indexer (debug_trace not assumed)'); }
  async getLaunchMeta() { return incomplete<never>(this.name, 'not provided by rpc'); }
}

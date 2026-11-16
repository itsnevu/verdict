import { createPublicClient, http, type PublicClient } from 'viem';

export interface ChainInfo { key: string; id: number; name: string; rpc: string; explorer: string; archiveRpc?: string; wideLogsRpc?: string }

/** EVM chains VERDICT can read. Robinhood Chain uses RPC_URL when set. Public endpoints, no keys. */
export function chainTable(robinhoodRpc?: string, robinhoodArchive?: string): Record<string, ChainInfo> {
  return {
    // archive: serves historical state (getCode at old blocks); verified honest: returns no code at block 1
    robinhood: { key: 'robinhood', id: 4663, name: 'Robinhood Chain', rpc: robinhoodRpc ?? 'https://rpc-robinhood.globalstake.io', archiveRpc: robinhoodArchive ?? 'https://robinhood.api.pocket.network,https://robinhood-mainnet.gateway.tatum.io,https://rpc.degenprotocol.io/robinhood',
      // allow eth_getLogs over 10M-block ranges (full-history scans in ~12 calls)
      wideLogsRpc: 'https://rpc.degenprotocol.io/robinhood,https://4663.rpc.thirdweb.com', explorer: 'https://robinhoodchain.blockscout.com' },
    ethereum: { key: 'ethereum', id: 1, name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io' },
    base: { key: 'base', id: 8453, name: 'Base', rpc: 'https://base-rpc.publicnode.com', explorer: 'https://basescan.org' },
    arbitrum: { key: 'arbitrum', id: 42161, name: 'Arbitrum One', rpc: 'https://arbitrum-one-rpc.publicnode.com', explorer: 'https://arbiscan.io' },
    optimism: { key: 'optimism', id: 10, name: 'OP Mainnet', rpc: 'https://optimism-rpc.publicnode.com', explorer: 'https://optimistic.etherscan.io' },
    bsc: { key: 'bsc', id: 56, name: 'BNB Chain', rpc: 'https://bsc-rpc.publicnode.com', explorer: 'https://bscscan.com' },
    polygon: { key: 'polygon', id: 137, name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', explorer: 'https://polygonscan.com' },
  };
}

/** What the skills need from a client; real viem clients satisfy it and tests can fake it. */
export type ChainClient = Pick<PublicClient, 'getBlockNumber' | 'getLogs' | 'readContract' | 'getCode' | 'getStorageAt' | 'getTransaction' | 'getTransactionReceipt' | 'call' | 'estimateGas' | 'getTransactionCount' | 'getBlock'>;

export class ChainRegistry {
  readonly chains: Record<string, ChainInfo>;
  private clients = new Map<string, ChainClient>();
  private archives = new Map<string, ChainClient>();
  constructor(robinhoodRpc?: string, private factory?: (c: ChainInfo) => ChainClient, robinhoodArchive?: string) { this.chains = chainTable(robinhoodRpc, robinhoodArchive); }

  /** Client for full-history log scans; falls back to the normal client. */
  wideLogs(key = 'robinhood'): ChainClient {
    const c = this.info(key);
    if (!c || !c.wideLogsRpc || this.factory) return this.client(key);
    const k = `${c.key}:logs`;
    let cl = this.archives.get(k);
    if (!cl) { cl = failover(c.wideLogsRpc.split(',').map((u) => createPublicClient({ transport: http(u.trim(), { timeout: 30_000, retryCount: 0 }) }) as unknown as ChainClient)); this.archives.set(k, cl); }
    return cl;
  }

  /** Client for historical reads; falls back to the normal client when no archive is known. */
  archive(key = 'robinhood'): ChainClient {
    const c = this.info(key);
    if (!c || !c.archiveRpc || this.factory) return this.client(key);
    let cl = this.archives.get(c.key);
    if (!cl) { cl = failover(c.archiveRpc.split(',').map((u) => createPublicClient({ transport: http(u.trim(), { timeout: 15_000, retryCount: 0 }) }) as unknown as ChainClient)); this.archives.set(c.key, cl); }
    return cl;
  }

  info(key = 'robinhood'): ChainInfo | null { return this.chains[key.toLowerCase()] ?? null; }

  client(key = 'robinhood'): ChainClient {
    const c = this.info(key);
    if (!c) throw new Error(`unknown chain ${key}`);
    let cl = this.clients.get(c.key);
    if (!cl) {
      cl = this.factory ? this.factory(c) : (createPublicClient({ transport: http(c.rpc, { timeout: 10_000 }) }) as unknown as ChainClient);
      this.clients.set(c.key, cl);
    }
    return cl;
  }
}

/**
 * Tries each client in turn for every call. Public archive endpoints are load-balanced and some
 * backends prune history ("historical state not available"), so one failure is not final.
 */
export function failover(clients: ChainClient[]): ChainClient {
  return new Proxy({} as ChainClient, {
    get(_t, prop: string) {
      return async (...args: unknown[]) => {
        let last: unknown;
        for (let round = 0; round < 2; round++) {
          for (const c of clients) {
            try { return await (c as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[prop]!(...args); } catch (e) { last = e; }
          }
        }
        throw last;
      };
    },
  });
}

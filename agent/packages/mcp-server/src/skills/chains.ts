import { createPublicClient, http, type PublicClient } from 'viem';

export interface ChainInfo { key: string; id: number; name: string; rpc: string; explorer: string }

/** EVM chains VERDICT can read. Robinhood Chain uses RPC_URL when set. Public endpoints, no keys. */
export function chainTable(robinhoodRpc?: string): Record<string, ChainInfo> {
  return {
    robinhood: { key: 'robinhood', id: 4663, name: 'Robinhood Chain', rpc: robinhoodRpc ?? 'https://rpc-robinhood.globalstake.io', explorer: 'https://robinhoodchain.blockscout.com' },
    ethereum: { key: 'ethereum', id: 1, name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io' },
    base: { key: 'base', id: 8453, name: 'Base', rpc: 'https://base-rpc.publicnode.com', explorer: 'https://basescan.org' },
    arbitrum: { key: 'arbitrum', id: 42161, name: 'Arbitrum One', rpc: 'https://arbitrum-one-rpc.publicnode.com', explorer: 'https://arbiscan.io' },
    optimism: { key: 'optimism', id: 10, name: 'OP Mainnet', rpc: 'https://optimism-rpc.publicnode.com', explorer: 'https://optimistic.etherscan.io' },
    bsc: { key: 'bsc', id: 56, name: 'BNB Chain', rpc: 'https://bsc-rpc.publicnode.com', explorer: 'https://bscscan.com' },
    polygon: { key: 'polygon', id: 137, name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', explorer: 'https://polygonscan.com' },
  };
}

/** What the skills need from a client; real viem clients satisfy it and tests can fake it. */
export type ChainClient = Pick<PublicClient, 'getBlockNumber' | 'getLogs' | 'readContract' | 'getCode' | 'getStorageAt' | 'getTransaction' | 'getTransactionReceipt' | 'call' | 'estimateGas'>;

export class ChainRegistry {
  readonly chains: Record<string, ChainInfo>;
  private clients = new Map<string, ChainClient>();
  constructor(robinhoodRpc?: string, private factory?: (c: ChainInfo) => ChainClient) { this.chains = chainTable(robinhoodRpc); }

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

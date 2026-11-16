import type { ContractFlags, DataSource, EarlyBuyerData, FundingData, HolderData, LaunchMeta, MarketData, SourceResult } from '../types.js';
import { incomplete, nowIso } from './retry.js';

export interface MockToken {
  market?: MarketData | null;
  holders?: HolderData | null;
  earlyBuyers?: EarlyBuyerData | null;
  contract?: ContractFlags | null;
  launch?: LaunchMeta | null;
  funding?: Record<string, string>;
}

/** In-memory source for tests, seeds and local dev. Missing keys come back `complete: false`. */
export class MockSource implements DataSource {
  constructor(public readonly name = 'mock', private tokens: Record<string, MockToken> = {}, private clock: () => string = nowIso) {}

  set(address: string, t: MockToken) { this.tokens[address.toLowerCase()] = t; }

  private get<T>(addr: string, k: keyof MockToken): SourceResult<T> {
    const t = this.tokens[addr.toLowerCase()];
    const v = t?.[k] as T | null | undefined;
    if (v === undefined || v === null) return { ...incomplete<T>(this.name, t ? `${String(k)} not available` : 'unknown token'), fetchedAt: this.clock() };
    return { data: v, fetchedAt: this.clock(), source: this.name, complete: true };
  }

  async getMarket(a: string) { return this.get<MarketData>(a, 'market'); }
  async getHolders(a: string) { return this.get<HolderData>(a, 'holders'); }
  async getEarlyBuyers(a: string) { return this.get<EarlyBuyerData>(a, 'earlyBuyers'); }
  async getContractFlags(a: string) { return this.get<ContractFlags>(a, 'contract'); }
  async getLaunchMeta(a: string) { return this.get<LaunchMeta>(a, 'launch'); }
  async getFundingSource(wallet: string): Promise<SourceResult<FundingData>> {
    for (const t of Object.values(this.tokens)) {
      const f = t.funding?.[wallet.toLowerCase()];
      if (f) return { data: { wallet, fundedBy: f }, fetchedAt: this.clock(), source: this.name, complete: true };
    }
    return { ...incomplete<FundingData>(this.name, 'no funding record'), fetchedAt: this.clock() };
  }
}

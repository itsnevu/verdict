/** Every adapter call returns this shape. `complete: false` means "do not trust as full truth". */
export interface SourceResult<T> {
  data: T | null;
  fetchedAt: string; // ISO-8601 UTC
  source: string;
  complete: boolean;
  error?: string;
}

export interface MarketData {
  symbol: string | null;
  name: string | null;
  pairAddress: string | null;
  priceUsd: number | null;
  mcUsd: number;
  liqUsd: number;
  vol6hUsd: number;
  vol24hUsd: number;
  tx24h: number;
  buys24h: number;
  sells24h: number;
  uniqueWallets24h: number | null;
  pairCreatedAt: string | null; // ISO UTC
}

export interface HolderData {
  /** share of supply held by the 10 largest holders, excluding pool / LP / burn addresses */
  top10Share: number;
  devShare: number | null;
  holderCount: number;
  holderCount24hAgo: number | null;
  /** true when reconstructed (e.g. from Transfer logs) rather than read from an index */
  approximate?: boolean;
}

export interface EarlyBuy {
  wallet: string;
  amountUsd: number;
  fundingSource: string | null;
}

export interface EarlyBuyerData {
  buys: EarlyBuy[]; // first <= 50 buys, oldest first
}

export interface FundingData {
  wallet: string;
  fundedBy: string | null;
}

export interface ContractFlags {
  honeypot: boolean | null;
  sellFails: boolean | null;
  lpLocked: boolean | null;
}

export interface LaunchMeta {
  createdAt: string | null;
  devAddress: string | null;
  launchpad: string | null;
}

/** Pluggable data source. Unsupported methods return `complete: false` with `data: null`. */
export type SourceMethod = 'getMarket' | 'getHolders' | 'getEarlyBuyers' | 'getFundingSource' | 'getContractFlags' | 'getLaunchMeta';

export interface DataSource {
  readonly name: string;
  /** methods this adapter can actually answer; others are skipped instead of counted as failures */
  readonly supports?: readonly SourceMethod[];
  getMarket(address: string): Promise<SourceResult<MarketData>>;
  getHolders(address: string, ctx?: { pairAddress?: string | null; devAddress?: string | null }): Promise<SourceResult<HolderData>>;
  getEarlyBuyers(address: string, ctx?: { pairAddress?: string | null }): Promise<SourceResult<EarlyBuyerData>>;
  getFundingSource(wallet: string): Promise<SourceResult<FundingData>>;
  getContractFlags(address: string): Promise<SourceResult<ContractFlags>>;
  getLaunchMeta(address: string): Promise<SourceResult<LaunchMeta>>;
}

export interface SourceStatus {
  name: string;
  method: string;
  fetchedAt: string;
  complete: boolean;
  error?: string;
}

/** Everything the engine needs. Built by `collectInputs`, or loaded from a fixture. */
export interface TokenInputs {
  address: string;
  now: string; // ISO UTC, the evaluation instant
  market: MarketData | null;
  marketFetchedAt: string | null;
  holders: HolderData | null;
  earlyBuyers: EarlyBuyerData | null;
  contract: ContractFlags | null;
  launch: LaunchMeta | null;
  /** coefficient of variation of trade sizes (std/mean); null when unknown */
  sizeVariance: number | null;
  sources: SourceStatus[];
  synthetic?: boolean;
}

export type Label = 'HEALTHY' | 'WATCH' | 'DECAYING' | 'COLLAPSING' | 'DEAD';

export type Flag =
  | 'PUMP_EXHAUSTED'
  | 'MC_COLLAPSED'
  | 'THIN'
  | 'INSIDER_HEAVY'
  | 'WASH_SUSPECT'
  | 'BUNDLED'
  | 'FRESH'
  | 'LOW_CONFIDENCE';

export interface BreakdownRow {
  signal: string;
  raw: number | null;
  score: number | null;
  weight: number;
  effectiveWeight: number;
  contribution: number;
  status: 'ok' | 'unavailable';
}

export interface OverrideHit {
  rule: string;
  effect: string;
}

export interface Verdict {
  address: string;
  symbol: string | null;
  score: number | null;
  baseScore: number | null;
  label: Label | null;
  confidence: number;
  flags: Flag[];
  breakdown: BreakdownRow[];
  overrides: OverrideHit[];
  lpLocked: boolean | null;
  missingSignals: string[];
  engineVersion: string;
  evaluatedAt: string;
}

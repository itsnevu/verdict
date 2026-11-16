import type { DeclaredTool, EarlyBuy, Label, ProbeResult, TokenInputs, Verdict } from '@verdictagent/core';

export interface ScoreRow {
  address: string;
  symbol: string | null;
  ts: string;
  score: number | null;
  label: Label | null;
  confidence: number;
  flags: string[];
  engineVersion: string;
  verdict: Verdict;
  brief: string;
  liqUsd: number | null;
}

export interface Watch {
  address: string;
  webhookUrl: string | null;
  watchedUntil: string;
  nextPollAt: string;
  agentId: string | null;
  idempotencyKey: string;
  argsHash: string;
}

export interface AlertRow {
  dedupeKey: string;
  address: string;
  kind: string;
  ts: string;
  payload: Record<string, unknown>;
  delivered: boolean;
}

export interface Endpoint {
  id: string;
  url: string;
  declaredTools: DeclaredTool[];
  contractTargets: string[];
  registeredAt: string;
  ownerAgentId: string | null;
  probe: ProbeResult | null;
  trust: number | null;
  idempotencyKey: string;
  argsHash: string;
}

export interface AgentCall {
  agentId: string;
  tool: string;
  address: string | null;
  ts: string;
  costUnits: number;
  durationMs: number;
  ok: boolean;
}

/** Persistence port. `MemoryStore` for tests/dev, `PgStore` (Drizzle) for production. */
export interface Store {
  saveScan(r: { inputs: TokenInputs; verdict: Verdict; brief: string; ts: string }): Promise<void>;
  saveFundingLinks(address: string, buys: EarlyBuy[], ts: string): Promise<void>;
  latestScores(q: { label?: Label; minScore?: number; limit: number }): Promise<ScoreRow[]>;
  history(address: string, sinceIso: string): Promise<ScoreRow[]>;
  /** first score at or after `atIso` */
  scoreAtOrAfter(address: string, atIso: string): Promise<ScoreRow | null>;

  getWatchByKey(idempotencyKey: string): Promise<Watch | null>;
  upsertWatch(w: Watch): Promise<void>;
  dueWatches(nowIso: string, limit: number): Promise<Watch[]>;
  setNextPoll(address: string, iso: string): Promise<void>;

  /** returns false when the dedupe key already exists */
  insertAlert(a: AlertRow): Promise<boolean>;
  listAlerts(address?: string): Promise<AlertRow[]>;

  getEndpointByKey(idempotencyKey: string): Promise<Endpoint | null>;
  getEndpoint(idOrUrl: string): Promise<Endpoint | null>;
  saveEndpoint(e: Endpoint): Promise<void>;
  searchEndpoints(q: { query?: string; minTrust?: number; limit: number }): Promise<Endpoint[]>;

  recordCall(c: AgentCall): Promise<void>;
  unitsUsedSince(agentId: string, sinceIso: string): Promise<number>;
  totalCalls(): Promise<number>;
  scanCalls(): Promise<AgentCall[]>;

  scopesFor(apiKey: string): Promise<string[]>;
  grantScopes(apiKey: string, scopes: string[]): Promise<void>;

  ping(): Promise<boolean>;
  close(): Promise<void>;
}

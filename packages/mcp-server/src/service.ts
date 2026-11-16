import { createHash } from 'node:crypto';
import {
  buildBrief, collectInputs, errors, evaluate, probeMcp, type DataSource, type ProbeResult, type SourceStatus, type TokenInputs, type Verdict,
} from '@verdictagent/core';
import type { Cache } from './cache.js';
import { assertPublicUrl, guardedFetch, type Resolver } from './net.js';
import type { Logger } from './log.js';
import { silentLogger } from './log.js';
import type { Store } from './store/types.js';

export interface ScanResult {
  verdict: Verdict;
  brief: string;
  inputs: TokenInputs;
  sources: SourceStatus[];
  cached: boolean;
}

export interface ServiceDeps {
  store: Store;
  cache: Cache;
  sources: DataSource[];
  log?: Logger;
  now?: () => Date;
  quotaPerDay?: number;
  scanCacheSeconds?: number;
  leaderboardMinCalls?: number;
  probe?: (url: string) => Promise<ProbeResult>;
  /** DNS resolver for the SSRF guard (tests inject one) */
  resolve?: Resolver;
  /** allow plain http:// for webhooks and probes (local dev only) */
  allowInsecureUrls?: boolean;
}

export const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Shared business layer: both MCP and HTTP call through here. */
export class VerdictService {
  readonly store: Store;
  readonly cache: Cache;
  readonly sources: DataSource[];
  readonly log: Logger;
  readonly now: () => Date;
  readonly quotaPerDay: number;
  readonly scanCacheSeconds: number;
  readonly leaderboardMinCalls: number;
  readonly probe: (url: string) => Promise<ProbeResult>;
  readonly checkUrl: (url: string) => Promise<URL>;
  private inflight = new Map<string, Promise<ScanResult>>();

  constructor(d: ServiceDeps) {
    this.store = d.store;
    this.cache = d.cache;
    this.sources = d.sources;
    this.log = d.log ?? silentLogger;
    this.now = d.now ?? (() => new Date());
    this.quotaPerDay = d.quotaPerDay ?? 500;
    this.scanCacheSeconds = d.scanCacheSeconds ?? 45;
    this.leaderboardMinCalls = d.leaderboardMinCalls ?? 200;
    this.checkUrl = (u) => assertPublicUrl(u, { ...(d.resolve ? { resolve: d.resolve } : {}), allowInsecure: !!d.allowInsecureUrls });
    // probes never follow redirects and never read more than 256 KB
    const capped: typeof fetch = async (u, init) => { const g = await guardedFetch(String(u), { ...init, maxBytes: 256 * 1024 }); return new Response(g.text, { status: g.status >= 200 && g.status <= 599 ? g.status : 502 }); };
    this.probe = d.probe ?? ((u) => probeMcp(u, capped));
  }

  nowIso() { return this.now().toISOString(); }

  /** Cached for `scanCacheSeconds`; concurrent scans of the same token share one fetch. */
  async scan(address: string): Promise<ScanResult> {
    const key = `scan:${address}`;
    const hit = await this.cache.get<Omit<ScanResult, 'cached'>>(key);
    if (hit) return { ...hit, cached: true };
    const running = this.inflight.get(address);
    if (running) return running;
    const p = (async () => {
      const inputs = await collectInputs(address, this.sources, () => this.nowIso());
      const verdict = evaluate(inputs);
      if (verdict.score === null && !inputs.market) {
        if (inputs.sources.every((s) => s.method !== 'getMarket' || s.error?.includes('no pair') || s.error?.includes('unknown token'))) throw errors.notFound(address);
        throw errors.insufficient(address);
      }
      const brief = buildBrief(verdict, inputs);
      const res = { verdict, brief, inputs, sources: inputs.sources };
      await this.store.saveScan({ inputs, verdict, brief, ts: inputs.now });
      if (inputs.earlyBuyers?.buys.length) await this.store.saveFundingLinks(address, inputs.earlyBuyers.buys, inputs.now);
      await this.cache.set(key, res, this.scanCacheSeconds);
      return { ...res, cached: false };
    })();
    this.inflight.set(address, p);
    try { return await p; } finally { this.inflight.delete(address); }
  }

  dayStart() {
    const d = this.now();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  }

  async budget(quotaKey: string) {
    const used = await this.store.unitsUsedSince(quotaKey, this.dayStart());
    const reset = new Date(Date.parse(this.dayStart()) + 86_400_000).toISOString();
    return { quotaKey, quotaUnits: this.quotaPerDay, usedUnits: Math.round(used * 100) / 100, remainingUnits: Math.max(0, Math.round((this.quotaPerDay - used) * 100) / 100), resetsAt: reset };
  }
}

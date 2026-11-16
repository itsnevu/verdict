import type { EarlyBuy, Label } from '@verdictagent/core';
import type { AgentCall, AlertRow, Endpoint, ScoreRow, Store, Watch } from './types.js';

/** In-process store. Same semantics as PgStore; used by tests, stdio mode and local dev. */
export class MemoryStore implements Store {
  scores: ScoreRow[] = [];
  snapshots: { address: string; ts: string; inputs: unknown }[] = [];
  funding: { address: string; wallet: string; fundedBy: string | null; ts: string }[] = [];
  watches = new Map<string, Watch>();
  alerts = new Map<string, AlertRow>();
  endpoints = new Map<string, Endpoint>();
  calls: AgentCall[] = [];
  scopes = new Map<string, string[]>();

  async saveScan(r: Parameters<Store['saveScan']>[0]) {
    this.snapshots.push({ address: r.inputs.address, ts: r.ts, inputs: r.inputs });
    this.scores.push({
      address: r.verdict.address, symbol: r.verdict.symbol, ts: r.ts, score: r.verdict.score, label: r.verdict.label,
      confidence: r.verdict.confidence, flags: r.verdict.flags, engineVersion: r.verdict.engineVersion, verdict: r.verdict, brief: r.brief, liqUsd: r.inputs.market?.liqUsd ?? null,
    });
  }
  async saveFundingLinks(address: string, buys: EarlyBuy[], ts: string) {
    for (const b of buys) this.funding.push({ address, wallet: b.wallet, fundedBy: b.fundingSource, ts });
  }
  async latestScores(q: { label?: Label; minScore?: number; limit: number }) {
    const latest = new Map<string, ScoreRow>();
    for (const s of this.scores) { const p = latest.get(s.address); if (!p || p.ts <= s.ts) latest.set(s.address, s); }
    return [...latest.values()]
      .filter((s) => (!q.label || s.label === q.label) && (q.minScore === undefined || (s.score ?? -1) >= q.minScore))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.address.localeCompare(b.address))
      .slice(0, q.limit);
  }
  async history(address: string, sinceIso: string) {
    return this.scores.filter((s) => s.address === address && s.ts >= sinceIso).sort((a, b) => a.ts.localeCompare(b.ts));
  }
  async scoreAtOrAfter(address: string, atIso: string) {
    return this.scores.filter((s) => s.address === address && s.ts >= atIso).sort((a, b) => a.ts.localeCompare(b.ts))[0] ?? null;
  }

  async getWatchByKey(owner: string, k: string) { return [...this.watches.values()].find((w) => w.ownerKey === owner && w.idempotencyKey === k) ?? null; }
  async upsertWatch(w: Watch) { this.watches.set(w.id, w); }
  async watchersOf(address: string, nowIso: string) { return [...this.watches.values()].filter((w) => w.address === address && w.watchedUntil > nowIso); }
  async dueWatches(nowIso: string, limit: number) {
    return [...this.watches.values()].filter((w) => w.nextPollAt <= nowIso && w.watchedUntil > nowIso).sort((a, b) => a.nextPollAt.localeCompare(b.nextPollAt)).slice(0, limit);
  }
  async setNextPoll(address: string, iso: string) { for (const w of this.watches.values()) if (w.address === address) w.nextPollAt = iso; }

  async insertAlert(a: AlertRow) {
    if (this.alerts.has(a.dedupeKey)) return false;
    this.alerts.set(a.dedupeKey, a);
    return true;
  }
  async listAlerts(address?: string) { return [...this.alerts.values()].filter((a) => !address || a.address === address); }

  async getEndpointByKey(owner: string, k: string) { return [...this.endpoints.values()].find((e) => e.ownerKey === owner && e.idempotencyKey === k) ?? null; }
  async getEndpoint(idOrUrl: string) { return this.endpoints.get(idOrUrl) ?? [...this.endpoints.values()].find((e) => e.url === idOrUrl) ?? null; }
  async saveEndpoint(e: Endpoint) { this.endpoints.set(e.id, e); }
  async searchEndpoints(q: { query?: string; minTrust?: number; limit: number }) {
    const needle = q.query?.toLowerCase();
    return [...this.endpoints.values()]
      .filter((e) => !needle || e.url.toLowerCase().includes(needle) || e.declaredTools.some((t) => t.name.toLowerCase().includes(needle) || (t.description ?? '').toLowerCase().includes(needle)))
      .filter((e) => q.minTrust === undefined || (e.trust ?? 0) >= q.minTrust)
      .sort((a, b) => (b.trust ?? 0) - (a.trust ?? 0) || a.url.localeCompare(b.url))
      .slice(0, q.limit);
  }

  async recordCall(c: AgentCall) { this.calls.push(c); }
  async unitsUsedSince(quotaKey: string, sinceIso: string) {
    return this.calls.filter((c) => c.quotaKey === quotaKey && c.ts >= sinceIso && c.ok).reduce((a, c) => a + c.costUnits, 0);
  }
  async totalCalls() { return this.calls.length; }
  async scanCalls() { return this.calls.filter((c) => c.tool === 'verdict_scan_token' && c.ok && c.address && c.authenticated); }

  async scopesFor(k: string) { return this.scopes.get(k) ?? []; }
  async grantScopes(k: string, s: string[]) { this.scopes.set(k, [...new Set([...(this.scopes.get(k) ?? []), ...s])]); }

  async ping() { return true; }
  async close() {}
}

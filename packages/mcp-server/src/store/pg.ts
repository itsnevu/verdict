import { and, asc, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { DeclaredTool, EarlyBuy, Label, ProbeResult, Verdict } from '@verdictagent/core';
import * as t from '../db/schema.js';
import type { AgentCall, AlertRow, Endpoint, ScoreRow, Store, Watch } from './types.js';

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);

/** Postgres store via Drizzle. Snapshots older than `retentionDays` (min 30) are pruned by `prune()`. */
export class PgStore implements Store {
  private db: NodePgDatabase<typeof t>;
  constructor(private pool: pg.Pool) { this.db = drizzle(pool, { schema: t }); }

  static async connect(url: string, migrationsFolder: string) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const s = new PgStore(pool);
    await migrate(s.db, { migrationsFolder });
    return s;
  }

  async saveScan(r: Parameters<Store['saveScan']>[0]) {
    const v = r.verdict;
    await this.db.transaction(async (tx) => {
      await tx.insert(t.tokens).values({ addr: v.address, symbol: v.symbol, firstSeen: r.ts, lastScanned: r.ts })
        .onConflictDoUpdate({ target: t.tokens.addr, set: { lastScanned: r.ts, symbol: sql`coalesce(excluded.symbol, ${t.tokens.symbol})` } });
      await tx.insert(t.snapshots).values({ addr: v.address, ts: r.ts, inputs: r.inputs });
      await tx.insert(t.scores).values({ addr: v.address, symbol: v.symbol, ts: r.ts, score: v.score, label: v.label, confidence: v.confidence, flags: v.flags, engineVersion: v.engineVersion, verdict: v, brief: r.brief, liqUsd: r.inputs.market?.liqUsd ?? null });
    });
  }
  async saveFundingLinks(address: string, buys: EarlyBuy[], ts: string) {
    if (!buys.length) return;
    await this.db.insert(t.fundingLinks).values(buys.map((b) => ({ addr: address, wallet: b.wallet, fundedBy: b.fundingSource, ts })));
  }

  private row(r: typeof t.scores.$inferSelect): ScoreRow {
    return { address: r.addr, symbol: r.symbol, ts: iso(r.ts)!, score: r.score, label: r.label as Label | null, confidence: r.confidence, flags: r.flags, engineVersion: r.engineVersion, verdict: r.verdict as Verdict, brief: r.brief, liqUsd: r.liqUsd ?? null };
  }
  async latestScores(q: { label?: Label; minScore?: number; limit: number }) {
    const res = await this.db.execute(sql`
      select distinct on (addr) * from scores order by addr, ts desc`);
    const rows = (res.rows as Record<string, unknown>[]).map((r) => this.row({
      id: r.id as number, addr: r.addr as string, symbol: r.symbol as string | null, ts: String(r.ts), score: r.score as number | null, label: r.label as string | null,
      confidence: Number(r.confidence), flags: r.flags as string[], engineVersion: r.engine_version as string, verdict: r.verdict, brief: r.brief as string, liqUsd: r.liq_usd === null || r.liq_usd === undefined ? null : Number(r.liq_usd),
    }));
    return rows
      .filter((s) => (!q.label || s.label === q.label) && (q.minScore === undefined || (s.score ?? -1) >= q.minScore))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.address.localeCompare(b.address))
      .slice(0, q.limit);
  }
  async history(address: string, sinceIso: string) {
    const rows = await this.db.select().from(t.scores).where(and(eq(t.scores.addr, address), gte(t.scores.ts, sinceIso))).orderBy(asc(t.scores.ts));
    return rows.map((r) => this.row(r));
  }
  async scoreAtOrAfter(address: string, atIso: string) {
    const [r] = await this.db.select().from(t.scores).where(and(eq(t.scores.addr, address), gte(t.scores.ts, atIso))).orderBy(asc(t.scores.ts)).limit(1);
    return r ? this.row(r) : null;
  }

  private watch(r: typeof t.watches.$inferSelect): Watch {
    return { id: r.id, address: r.addr, ownerKey: r.ownerKey, agentId: r.agentId, webhookUrl: r.webhookUrl, watchedUntil: iso(r.watchedUntil)!, nextPollAt: iso(r.nextPollAt)!, idempotencyKey: r.idemKey, argsHash: r.argsHash };
  }
  async getWatchByKey(owner: string, k: string) {
    const [r] = await this.db.select().from(t.watches).where(and(eq(t.watches.ownerKey, owner), eq(t.watches.idemKey, k))).limit(1);
    return r ? this.watch(r) : null;
  }
  async upsertWatch(w: Watch) {
    const v = { id: w.id, addr: w.address, ownerKey: w.ownerKey, agentId: w.agentId, webhookUrl: w.webhookUrl, watchedUntil: w.watchedUntil, nextPollAt: w.nextPollAt, idemKey: w.idempotencyKey, argsHash: w.argsHash };
    await this.db.insert(t.watches).values(v).onConflictDoUpdate({ target: t.watches.id, set: v });
  }
  async dueWatches(nowIso: string, limit: number) {
    const rows = await this.db.select().from(t.watches).where(and(lte(t.watches.nextPollAt, nowIso), gte(t.watches.watchedUntil, nowIso))).orderBy(asc(t.watches.nextPollAt)).limit(limit);
    return rows.map((r) => this.watch(r));
  }
  async watchersOf(address: string, nowIso: string) {
    const rows = await this.db.select().from(t.watches).where(and(eq(t.watches.addr, address), gte(t.watches.watchedUntil, nowIso)));
    return rows.map((r) => this.watch(r));
  }
  async setNextPoll(address: string, isoTs: string) { await this.db.update(t.watches).set({ nextPollAt: isoTs }).where(eq(t.watches.addr, address)); }

  async insertAlert(a: AlertRow) {
    const res = await this.db.insert(t.alerts).values({ dedupeKey: a.dedupeKey, addr: a.address, kind: a.kind, ts: a.ts, payload: a.payload, delivered: a.delivered })
      .onConflictDoNothing({ target: t.alerts.dedupeKey }).returning({ id: t.alerts.id });
    return res.length > 0;
  }
  async listAlerts(address?: string) {
    const rows = await this.db.select().from(t.alerts).where(address ? eq(t.alerts.addr, address) : undefined).orderBy(desc(t.alerts.ts)).limit(500);
    return rows.map((r) => ({ dedupeKey: r.dedupeKey, address: r.addr, kind: r.kind, ts: iso(r.ts)!, payload: r.payload as Record<string, unknown>, delivered: r.delivered }));
  }

  private ep(r: typeof t.mcpEndpoints.$inferSelect): Endpoint {
    return { id: r.id, url: r.url, declaredTools: r.declaredTools as DeclaredTool[], contractTargets: r.contractTargets, registeredAt: iso(r.registeredAt)!, ownerAgentId: r.ownerAgentId, ownerKey: r.ownerKey ?? null, probe: r.probe as ProbeResult | null, trust: r.trust, idempotencyKey: r.idempotencyKey, argsHash: r.argsHash };
  }
  async getEndpointByKey(owner: string, k: string) {
    const [r] = await this.db.select().from(t.mcpEndpoints).where(and(eq(t.mcpEndpoints.ownerKey, owner), eq(t.mcpEndpoints.idempotencyKey, k))).limit(1);
    return r ? this.ep(r) : null;
  }
  async getEndpoint(idOrUrl: string) {
    const [r] = await this.db.select().from(t.mcpEndpoints).where(or(eq(t.mcpEndpoints.id, idOrUrl), eq(t.mcpEndpoints.url, idOrUrl))).limit(1);
    return r ? this.ep(r) : null;
  }
  async saveEndpoint(e: Endpoint) {
    const v = { id: e.id, url: e.url, declaredTools: e.declaredTools, contractTargets: e.contractTargets, registeredAt: e.registeredAt, ownerAgentId: e.ownerAgentId, ownerKey: e.ownerKey, probe: e.probe, trust: e.trust, idempotencyKey: e.idempotencyKey, argsHash: e.argsHash };
    await this.db.insert(t.mcpEndpoints).values(v).onConflictDoUpdate({ target: t.mcpEndpoints.id, set: v });
  }
  async searchEndpoints(q: { query?: string; minTrust?: number; limit: number }) {
    const conds = [];
    if (q.query) conds.push(or(ilike(t.mcpEndpoints.url, `%${q.query}%`), sql`${t.mcpEndpoints.declaredTools}::text ilike ${`%${q.query}%`}`));
    if (q.minTrust !== undefined) conds.push(gte(t.mcpEndpoints.trust, q.minTrust));
    const rows = await this.db.select().from(t.mcpEndpoints).where(conds.length ? and(...conds) : undefined).orderBy(desc(t.mcpEndpoints.trust), asc(t.mcpEndpoints.url)).limit(q.limit);
    return rows.map((r) => this.ep(r));
  }

  async recordCall(c: AgentCall) {
    await this.db.insert(t.agentCalls).values({ agentId: c.agentId, tool: c.tool, addr: c.address, ts: c.ts, costUnits: c.costUnits, durationMs: Math.round(c.durationMs), ok: c.ok, quotaKey: c.quotaKey, authenticated: c.authenticated });
    await this.db.insert(t.agents).values({ id: c.agentId, firstSeen: c.ts, lastSeen: c.ts }).onConflictDoUpdate({ target: t.agents.id, set: { lastSeen: c.ts } });
  }
  async unitsUsedSince(quotaKey: string, sinceIso: string) {
    const [r] = await this.db.select({ s: sql<number>`coalesce(sum(${t.agentCalls.costUnits}), 0)` }).from(t.agentCalls)
      .where(and(eq(t.agentCalls.quotaKey, quotaKey), gte(t.agentCalls.ts, sinceIso), eq(t.agentCalls.ok, true)));
    return Number(r?.s ?? 0);
  }
  async totalCalls() {
    const [r] = await this.db.select({ n: sql<number>`count(*)` }).from(t.agentCalls);
    return Number(r?.n ?? 0);
  }
  async scanCalls() {
    const rows = await this.db.select().from(t.agentCalls).where(and(eq(t.agentCalls.tool, 'verdict_scan_token'), eq(t.agentCalls.ok, true), eq(t.agentCalls.authenticated, true)));
    return rows.filter((r) => r.addr).map((r) => ({ agentId: r.agentId, tool: r.tool, address: r.addr, ts: iso(r.ts)!, costUnits: r.costUnits, durationMs: r.durationMs, ok: r.ok, quotaKey: r.quotaKey ?? '', authenticated: r.authenticated }));
  }

  async scopesFor(k: string) {
    const [r] = await this.db.select().from(t.scopes).where(eq(t.scopes.apiKey, k)).limit(1);
    return r?.scopes ?? [];
  }
  async grantScopes(k: string, s: string[]) {
    const cur = await this.scopesFor(k);
    const next = [...new Set([...cur, ...s])];
    await this.db.insert(t.scopes).values({ apiKey: k, scopes: next, createdAt: new Date().toISOString() }).onConflictDoUpdate({ target: t.scopes.apiKey, set: { scopes: next } });
  }

  /** keep at least 30 days of snapshots */
  async prune(retentionDays = 30) {
    const days = Math.max(30, retentionDays);
    await this.db.execute(sql`delete from snapshots where ts < now() - make_interval(days => ${days})`);
  }

  async ping() {
    try { await this.pool.query('select 1'); return true; } catch { return false; }
  }
  async close() { await this.pool.end(); }
}

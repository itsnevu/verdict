import type { Store } from './store/types.js';

export interface LeaderRow { agentId: string; scans: number; eligibleScans: number; hits: number; hitRate: number }

/**
 * hit_rate = share of an agent's scanned tokens that were still HEALTHY 6 hours later.
 * Only scans older than 6h with a later score count; agents need >= minScans eligible scans.
 */
export async function leaderboard(store: Store, nowIso: string, o: { minScans?: number; minCalls?: number } = {}) {
  const minScans = o.minScans ?? 20;
  const minCalls = o.minCalls ?? 200;
  const total = await store.totalCalls();
  if (total < minCalls) return { active: false as const, totalCalls: total, activatesAt: minCalls, agents: [] as LeaderRow[] };
  const cutoff = Date.parse(nowIso) - 6 * 3_600_000;
  const by = new Map<string, LeaderRow>();
  for (const c of await store.scanCalls()) {
    const row = by.get(c.agentId) ?? { agentId: c.agentId, scans: 0, eligibleScans: 0, hits: 0, hitRate: 0 };
    row.scans++;
    by.set(c.agentId, row);
    if (Date.parse(c.ts) > cutoff || !c.address) continue;
    const later = await store.scoreAtOrAfter(c.address, new Date(Date.parse(c.ts) + 6 * 3_600_000).toISOString());
    if (!later) continue;
    row.eligibleScans++;
    if (later.label === 'HEALTHY') row.hits++;
  }
  const agents = [...by.values()]
    .filter((r) => r.eligibleScans >= minScans)
    .map((r) => ({ ...r, hitRate: Math.round((r.hits / r.eligibleScans) * 1000) / 1000 }))
    .sort((a, b) => b.hitRate - a.hitRate || b.eligibleScans - a.eligibleScans || a.agentId.localeCompare(b.agentId));
  return { active: true as const, totalCalls: total, activatesAt: minCalls, agents };
}

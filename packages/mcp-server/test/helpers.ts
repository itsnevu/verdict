import { BasedBotSource, type DataSource, type ProbeResult } from '@verdictagent/core';
import { MemoryCache } from '../src/cache.js';
import { VerdictService } from '../src/service.js';
import { fixtureSource } from '../src/sources.js';
import { MemoryStore } from '../src/store/memory.js';

export const T = {
  rushr: '0x000000000000000000000000000000000000a001',
  zolva: '0x000000000000000000000000000000000000a002',
  robot: '0x000000000000000000000000000000000000a003',
  nifty: '0x000000000000000000000000000000000000a004',
  degraded: '0x000000000000000000000000000000000000a005',
  unknown: '0x00000000000000000000000000000000deadbeef',
};

export function makeSvc(o: { sources?: DataSource[]; quota?: number; probe?: (u: string) => Promise<ProbeResult>; minCalls?: number } = {}) {
  const clock = { t: Date.parse('2026-11-16T12:00:00.000Z') };
  const now = () => new Date(clock.t);
  const store = new MemoryStore();
  const cache = new MemoryCache(() => clock.t);
  const sources = o.sources ?? [fixtureSource(() => now().toISOString()), new BasedBotSource()];
  const probe = o.probe ?? (async () => ({ reachable: true, tlsValid: true, liveTools: ['quote', 'swap'], checkedAt: now().toISOString() }));
  const svc = new VerdictService({ store, cache, sources, now, quotaPerDay: o.quota ?? 1000, probe, leaderboardMinCalls: o.minCalls ?? 200 });
  return { svc, store, cache, clock, advance: (ms: number) => { clock.t += ms; } };
}

export const KEY = 'test-key-with-scopes';
export async function withKey(svc: VerdictService, scopes = ['watch', 'registry']) {
  await svc.store.grantScopes(KEY, scopes);
  return KEY;
}

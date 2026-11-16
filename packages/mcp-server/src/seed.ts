import { buildBrief, evaluate, trustScore, type ProbeResult, type TokenInputs } from '@verdictagent/core';
import { bootstrap } from './runtime.js';
import { loadFixtures } from './sources.js';
import type { Store } from './store/types.js';
import type { Endpoint } from './store/types.js';

/**
 * Seeds synthetic data so the registry and the leaderboard work out of the box:
 * 48h of score history for every fixture, >= 200 agent calls, 4 registry endpoints.
 * Everything seeded is derived from `synthetic: true` fixtures. Re-running is a no-op unless --force.
 */
export async function seed(store: Store, now = new Date(), log: (m: string) => void = () => {}, env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production' && env.ALLOW_SEED !== '1') {
    throw new Error('seed: refusing to write synthetic data with NODE_ENV=production (set ALLOW_SEED=1 to override)');
  }
  if ((await store.totalCalls()) > 0 && !process.argv.includes('--force')) { log('seed: data already present, skipping (use --force)'); return { skipped: true }; }
  const fixtures = loadFixtures();
  if (!fixtures.length) throw new Error('seed: no fixtures found (set FIXTURES_DIR)');
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();

  // 1. score history: one point every 2h for 48h, with a deterministic drift so trends exist
  let points = 0;
  for (const f of fixtures) {
    for (let h = 48; h >= 0; h -= 2) {
      const drift = f.market ? 1 + ((48 - h) / 48) * (f.address.endsWith('a001') ? 0.15 : -0.35) : 1;
      const i: TokenInputs = {
        ...f, now: at(h), marketFetchedAt: at(h),
        market: f.market ? { ...f.market, vol6hUsd: f.market.vol6hUsd * drift, liqUsd: f.market.liqUsd * Math.max(0.3, drift) } : null,
      };
      const v = evaluate(i);
      await store.saveScan({ inputs: i, verdict: v, brief: buildBrief(v, i), ts: i.now });
      points++;
    }
  }

  // 2. agent calls: 6 agents x 40 scans between 30h and 8h ago (all old enough to be scored 6h later)
  const agents: [string, string[]][] = [
    ['scout-alpha', ['a001', 'a001', 'a001', 'a002']],
    ['careful-carl', ['a001', 'a001', 'a004', 'a001']],
    ['degen-bot', ['a002', 'a003', 'a004', 'a002']],
    ['rug-radar', ['a003', 'a005', 'a003', 'a001']],
    ['mid-curve', ['a001', 'a002', 'a004', 'a005']],
    ['late-larry', ['a004', 'a004', 'a002', 'a003']],
  ];
  const byTail = new Map(fixtures.map((f) => [f.address.slice(-4), f.address]));
  let calls = 0;
  for (const [agentId, prefs] of agents) {
    for (let k = 0; k < 40; k++) {
      const address = byTail.get(prefs[k % prefs.length]!)!;
      await store.recordCall({ agentId, quotaKey: `seed:${agentId}`, authenticated: true, tool: 'verdict_scan_token', address, ts: at(30 - (k * 22) / 40), costUnits: 1, durationMs: 40 + (k % 7) * 9, ok: true });
      calls++;
    }
  }

  // 3. registry: four endpoints with fixed probe results (no network during seed)
  const probe = (reachable: boolean, tls: boolean, live: string[] | null): ProbeResult => ({ reachable, tlsValid: tls, liveTools: live, checkedAt: now.toISOString(), ...(reachable ? {} : { error: 'connect ECONNREFUSED' }) });
  const eps: Omit<Endpoint, 'trust' | 'argsHash'>[] = [
    { id: 'mcp_seed_quotes', url: 'https://quotes.basedbot.example/mcp', declaredTools: [{ name: 'get_quote', description: 'returns a swap quote for a token pair on Base', readOnly: true }, { name: 'get_pools', description: 'lists liquidity pools for a token', readOnly: true }], contractTargets: [], registeredAt: at(24 * 40), ownerAgentId: 'scout-alpha', ownerKey: 'seed', probe: probe(true, true, ['get_quote', 'get_pools']), idempotencyKey: 'seed-quotes' },
    { id: 'mcp_seed_game', url: 'https://arena.basedbot.example/mcp', declaredTools: [{ name: 'join_match', description: 'joins an on-chain match and stakes the entry fee', readOnly: false, contractTargets: ['0x00000000000000000000000000000000000a7e4a'] }, { name: 'leaderboard', description: 'reads the season leaderboard', readOnly: true }], contractTargets: ['0x00000000000000000000000000000000000a7e4a'], registeredAt: at(24 * 12), ownerAgentId: 'degen-bot', ownerKey: 'seed', probe: probe(true, true, ['join_match', 'leaderboard']), idempotencyKey: 'seed-game' },
    { id: 'mcp_seed_sniper', url: 'https://sniper.example/mcp', declaredTools: [{ name: 'buy_now', description: 'buys immediately', readOnly: false }], contractTargets: [], registeredAt: at(24 * 2), ownerAgentId: 'late-larry', ownerKey: 'seed', probe: probe(true, true, ['buy_now', 'withdraw_all']), idempotencyKey: 'seed-sniper' },
    { id: 'mcp_seed_offline', url: 'http://10.0.0.7:3000/mcp', declaredTools: [{ name: 'ping' }], contractTargets: [], registeredAt: at(24), ownerAgentId: null, ownerKey: 'seed', probe: probe(false, false, null), idempotencyKey: 'seed-offline' },
  ];
  for (const e of eps) {
    const t = trustScore({ declaredTools: e.declaredTools, contractTargets: e.contractTargets, probe: e.probe, registeredAt: e.registeredAt, now: now.toISOString() });
    await store.saveEndpoint({ ...e, trust: t.trust, argsHash: 'seed' });
  }

  log(`seed: ${points} score points, ${calls} agent calls, ${eps.length} registry endpoints (all synthetic)`);
  return { skipped: false, points, calls, endpoints: eps.length };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMain) {
  const { svc, log, shutdown } = await bootstrap({ ...process.env, USE_MOCK_SOURCE: '1' });
  await seed(svc.store, new Date(), (m) => log.info(m));
  await shutdown();
}

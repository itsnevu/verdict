import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/http/app.js';
import { runTool } from '../src/mcp/tools.js';
import { seed } from '../src/seed.js';
import { makeSvc } from './helpers.js';

describe('seed data', () => {
  it('makes the registry and leaderboard work, and is a no-op on rerun', async () => {
    const { svc, store } = makeSvc();
    const r = await seed(store, svc.now());
    expect(r).toMatchObject({ skipped: false, calls: 240, endpoints: 4 });
    expect((await seed(store, svc.now())).skipped).toBe(true);
    await expect(seed(store, svc.now(), () => {}, { NODE_ENV: 'production' })).rejects.toThrow(/refusing/);

    const app = buildApp(svc);
    const lb = (await app.inject({ url: '/v1/agents' })).json().data;
    expect(lb.active).toBe(true);
    expect(lb.agents.length).toBeGreaterThanOrEqual(3);
    expect(['scout-alpha', 'careful-carl']).toContain(lb.agents[0].agentId);
    expect(lb.agents.at(-1).hitRate).toBeLessThan(lb.agents[0].hitRate);
    for (let i = 1; i < lb.agents.length; i++) expect(lb.agents[i - 1].hitRate).toBeGreaterThanOrEqual(lb.agents[i].hitRate);

    const search = await runTool(svc, 'verdict_registry_search', { minTrust: 0 }, { agentId: 't', apiKey: null });
    expect(search.ok).toBe(true);
    const rows = (search.envelope as { data: { url: string; trust: number }[] }).data;
    expect(rows[0]!.url).toBe('https://quotes.basedbot.example/mcp');
    expect(rows.find((x) => x.url.includes('sniper'))!.trust).toBeLessThanOrEqual(40);

    const runners = await runTool(svc, 'verdict_list_runners', { label: 'HEALTHY' }, { agentId: 't', apiKey: null });
    expect((runners.envelope as { data: unknown[] }).data.length).toBeGreaterThan(0);
    const hist = await runTool(svc, 'verdict_token_history', { address: '0x000000000000000000000000000000000000a002', hours: 48 }, { agentId: 't', apiKey: null });
    expect((hist.envelope as { data: unknown[] }).data.length).toBe(25);
  });
});

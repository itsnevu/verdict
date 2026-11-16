import { describe, expect, it } from 'vitest';
import { DexScreenerSource, RpcSource, BasedBotSource } from '@verdictagent/core';
import { buildApp } from '../src/http/app.js';
import { leaderboard } from '../src/agents.js';
import { loadConfig, parseApiKeys } from '../src/config.js';
import { buildSources, fixtureSource } from '../src/sources.js';
import { dedupeKey, evaluateAlerts } from '../src/worker/alerts.js';
import { startWorker, tick } from '../src/worker/worker.js';
import type { ScoreRow } from '../src/store/types.js';
import { KEY, T, makeSvc, withKey } from './helpers.js';

describe('HTTP API', () => {
  it('scan: envelope, cache header and X-RateLimit headers', async () => {
    const { svc } = makeSvc();
    const app = buildApp(svc);
    const r = await app.inject({ method: 'GET', url: `/v1/scan/${T.rushr}`, headers: { 'x-agent-id': 'http-agent' } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-ratelimit-limit']).toBe('30');
    expect(r.headers['x-ratelimit-remaining']).toBe('29');
    expect(r.headers['x-ratelimit-reset']).toBeDefined();
    expect(r.headers['cache-control']).toBe('public, max-age=45');
    const body = r.json();
    expect(Object.keys(body).sort()).toEqual(['_meta', 'brief', 'data', 'nextActions']);
    expect(body._meta.agentId).toBe('http-agent');
  });

  it('rate limits scans at 30/min/IP with a structured 429', async () => {
    const { svc } = makeSvc();
    const app = buildApp(svc);
    for (let i = 0; i < 30; i++) expect((await app.inject({ url: `/v1/scan/${T.rushr}` })).statusCode).toBe(200);
    const r = await app.inject({ url: `/v1/scan/${T.rushr}` });
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(r.headers['retry-after']).toBeDefined();
    expect((await app.inject({ url: `/v1/brief/${T.rushr}` })).headers['x-ratelimit-limit']).toBe('60');
  });

  it('exposes every MCP capability over HTTP', async () => {
    const { svc } = makeSvc();
    await withKey(svc);
    const app = buildApp(svc);
    const auth = { authorization: `Bearer ${KEY}` };
    const ok = async (opts: Parameters<typeof app.inject>[0]) => { const r = await app.inject(opts); expect(r.statusCode, r.body).toBe(200); return r.json(); };
    await ok({ url: `/v1/brief/${T.zolva}` });
    expect((await ok({ url: '/v1/tokens?limit=5' })).data.length).toBeGreaterThan(0);
    await ok({ url: `/v1/tokens/${T.zolva}/history?hours=3` });
    await ok({ url: `/v1/explain/${T.zolva}?signal=vol_trend` });
    await ok({ url: `/v1/compare?addresses=${T.rushr},${T.nifty}` });
    await ok({ url: '/v1/budget' });
    await ok({ method: 'POST', url: '/v1/watch', headers: auth, payload: { address: T.rushr, idempotencyKey: 'http-watch-1' } });
    await ok({ method: 'POST', url: '/v1/registry', headers: auth, payload: { url: 'https://q.example/mcp', declaredTools: [{ name: 'quote', readOnly: true }], idempotencyKey: 'http-reg-0001' } });
    await ok({ url: '/v1/registry?query=q.example' });
    await ok({ url: '/v1/registry/check?url=https://q.example/mcp' });
    const noScope = await app.inject({ method: 'POST', url: '/v1/watch', payload: { address: T.rushr, idempotencyKey: 'http-watch-2' } });
    expect(noScope.statusCode).toBe(403);
    expect(noScope.json().error.code).toBe('SCOPE_REQUIRED');
    expect((await app.inject({ url: '/v1/scan/nope' })).statusCode).toBe(400);
  });

  it('serves MCP over POST /mcp and rejects GET', async () => {
    const { svc } = makeSvc();
    const app = buildApp(svc);
    const init = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } } });
    expect(init.json().result.serverInfo.name).toBe('verdictagent');
    const note = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(note.statusCode).toBe(202);
    const call = await app.inject({ method: 'POST', url: '/mcp', headers: { 'x-agent-id': 'mcp-http' }, payload: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'verdict_scan_token', arguments: { address: T.nifty } } } });
    expect(call.json().result.structuredContent.data.flags).toContain('THIN');
    expect((await app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405);
    expect((await app.inject({ method: 'POST', url: '/mcp', headers: { 'content-type': 'application/json' }, payload: '{bad' })).statusCode).toBe(400);
  });

  it('health, page, 404', async () => {
    const { svc } = makeSvc();
    const app = buildApp(svc);
    const h = await app.inject({ url: '/v1/health' });
    expect(h.json().data).toMatchObject({ status: 'ok', db: true, cache: true });
    const empty = await app.inject({ url: '/' });
    expect(empty.headers['content-type']).toContain('text/html');
    expect(empty.body).toContain('<form');
    const page = await app.inject({ url: `/?address=${T.zolva}` });
    expect(page.body).toContain('PUMP_EXHAUSTED');
    expect(page.body).toContain('<th>contribution</th>');
    expect(page.body).toContain('<td class="mono">mock</td>');
    const bad = await app.inject({ url: '/?address=<script>' });
    expect(bad.body).not.toContain('<script>');
    expect(bad.body).toContain('INVALID_ADDRESS');
    expect((await app.inject({ url: '/nope' })).json().error.code).toBe('NOT_FOUND');
  });
});

describe('agents leaderboard', () => {
  it('stays off until 200 real calls, then ranks hit rate with >= 20 eligible scans', async () => {
    const { svc, store, advance } = makeSvc();
    const app = buildApp(svc);
    expect((await app.inject({ url: '/v1/agents' })).json().data.active).toBe(false);
    // good agent scans the healthy token, bad agent scans the dying one
    for (let i = 0; i < 110; i++) {
      await store.recordCall({ agentId: 'good', quotaKey: 'key:good', authenticated: true, tool: 'verdict_scan_token', address: T.rushr, ts: svc.nowIso(), costUnits: 1, durationMs: 1, ok: true });
      await store.recordCall({ agentId: 'bad', quotaKey: 'key:bad', authenticated: true, tool: 'verdict_scan_token', address: T.nifty, ts: svc.nowIso(), costUnits: 1, durationMs: 1, ok: true });
    }
    advance(7 * 3_600_000);
    await svc.scan(T.rushr);
    await svc.scan(T.nifty);
    advance(60_000);
    const lb = (await app.inject({ url: '/v1/agents' })).json().data;
    expect(lb.active).toBe(true);
    expect(lb.agents.map((a: { agentId: string }) => a.agentId)).toEqual(['good', 'bad']);
    expect(lb.agents[0].hitRate).toBe(1);
    expect(lb.agents[1].hitRate).toBe(0);
    const few = await leaderboard(store, svc.nowIso(), { minScans: 500 });
    expect(few.agents).toEqual([]);
  });
});

describe('worker and alerts', () => {
  const row = (o: Partial<ScoreRow> & { dev?: number }): ScoreRow => ({
    address: T.rushr, symbol: 'X', ts: '2026-11-16T12:00:00.000Z', score: 80, label: 'HEALTHY', confidence: 1, flags: [], engineVersion: '1.0.0', brief: '', liqUsd: 1000,
    verdict: { breakdown: [{ signal: 'dev_share', raw: o.dev ?? 0.02 }] } as never, ...o,
  });

  it('fires each documented rule', () => {
    expect(evaluateAlerts(row({ score: 50 }), row({ score: 75 }), null, null, null).map((a) => a.kind)).toEqual(['SCORE_DROP']);
    expect(evaluateAlerts(row({ flags: ['PUMP_EXHAUSTED'] }), null, row({}), null, null).map((a) => a.kind)).toEqual(['PUMP_EXHAUSTED']);
    expect(evaluateAlerts(row({ flags: ['PUMP_EXHAUSTED'] }), null, row({ flags: ['PUMP_EXHAUSTED'] }), null, null)).toEqual([]);
    expect(evaluateAlerts(row({ dev: 0.2 }), null, row({ dev: 0.05 }), null, null).map((a) => a.kind)).toEqual(['DEV_SHARE_UP']);
    expect(evaluateAlerts(row({ dev: 0.14 }), null, row({ dev: 0.05 }), null, null)).toEqual([]);
    expect(evaluateAlerts(row({}), row({}), null, 500, 1000).map((a) => a.kind)).toEqual(['LIQUIDITY_DROP']);
    expect(evaluateAlerts(row({}), row({}), null, 700, 1000)).toEqual([]);
    expect(evaluateAlerts(row({ score: 60 }), row({ score: 80 }), null, null, null)).toEqual([]);
  });

  it('dedupes alerts by {addr}:{kind}:{hour bucket}', async () => {
    expect(dedupeKey(T.rushr, 'SCORE_DROP', '2026-11-16T12:59:59.000Z')).toBe(`${T.rushr}:SCORE_DROP:2026-11-16T12`);
    const { svc, store, advance } = makeSvc();
    const key = await withKey(svc);
    const { runTool } = await import('../src/mcp/tools.js');
    await runTool(svc, 'verdict_watch_token', { address: T.zolva, webhookUrl: 'https://hook.example/x', idempotencyKey: 'worker-watch-1' }, { agentId: 'w', apiKey: key });
    // force the "previous" verdict to lack PUMP_EXHAUSTED so the rule fires
    for (const s of store.scores) s.flags = [];
    const delivered: unknown[] = [];
    advance(2 * 60_000 + 1);
    await svc.cache.close();
    const first = await tick(svc, { random: () => 0.5, deliver: async (_u, b) => { delivered.push(b); return true; } });
    expect(first.fired.map((f) => f.kind)).toContain('PUMP_EXHAUSTED');
    for (const s of store.scores) s.flags = [];
    advance(2 * 60_000);
    await svc.cache.close();
    const second = await tick(svc, { random: () => 0.5, deliver: async () => true });
    expect(second.fired.filter((f) => f.kind === 'PUMP_EXHAUSTED')).toHaveLength(0);
    expect([...store.alerts.values()].filter((a) => a.kind === 'PUMP_EXHAUSTED')).toHaveLength(1);
    expect(delivered).toHaveLength(first.fired.length);
  });

  it('backs off to 10 minutes for idle tokens and survives poll failures', async () => {
    const { svc, store } = makeSvc();
    await store.upsertWatch({ id: 'w-idle', ownerKey: 'o1', address: T.rushr, webhookUrl: null, watchedUntil: '2026-11-17T00:00:00.000Z', nextPollAt: '2026-11-16T11:00:00.000Z', agentId: null, idempotencyKey: 'idle-1', argsHash: 'h' });
    const realScan = svc.scan.bind(svc);
    svc.scan = async (a) => { const r = await realScan(a); return { ...r, inputs: { ...r.inputs, market: { ...r.inputs.market!, vol6hUsd: 0 } } }; };
    await tick(svc, { random: () => 0.5 });
    expect(store.watches.get('w-idle')!.nextPollAt).toBe('2026-11-16T12:10:00.000Z');
    store.watches.get('w-idle')!.nextPollAt = '2026-11-16T11:00:00.000Z';
    svc.scan = async () => { throw new Error('down'); };
    expect((await tick(svc)).fired).toEqual([]);
    expect(store.watches.get('w-idle')!.nextPollAt).toBe('2026-11-16T12:02:00.000Z');
    const w = startWorker(svc, { random: () => 0.5 });
    await w.stop();
  });
});

describe('config and sources', () => {
  it('parses env, api keys and disables adapters by name', () => {
    const cfg = loadConfig({ DISABLE_SOURCES: 'RPC, basedbot', USE_MOCK_SOURCE: '1', API_KEYS: 'k1:watch|registry,k2:watch' });
    expect(cfg.DISABLE_SOURCES).toEqual(['rpc', 'basedbot']);
    expect(parseApiKeys(cfg.API_KEYS)).toEqual([{ key: 'k1', scopes: ['watch', 'registry'] }, { key: 'k2', scopes: ['watch'] }]);
    expect(buildSources(cfg).map((s) => s.name)).toEqual(['mock', 'dexscreener']);
    // adapters without config are left out instead of costing confidence on every scan
    expect(buildSources(loadConfig({})).map((s) => s.constructor)).toEqual([DexScreenerSource]);
    expect(buildSources(loadConfig({ RPC_URL: 'https://rpc.example', BASEDBOT_BASE_URL: 'https://bb.example', BASEDBOT_LAUNCH_PATH: '/t/{address}' })).map((s) => s.constructor)).toEqual([DexScreenerSource, RpcSource, BasedBotSource]);
  });
  it('a scan still completes, degraded, with one adapter switched off', async () => {
    const cfg = loadConfig({ DISABLE_SOURCES: 'dexscreener', USE_MOCK_SOURCE: '1' });
    expect(buildSources(cfg).map((s) => s.name)).toEqual(['mock']);
    const { svc } = makeSvc({ sources: [fixtureSource(() => '2026-11-16T12:00:00.000Z')] });
    const r = await svc.scan(T.degraded);
    expect(r.verdict.score).not.toBeNull();
    expect(r.sources.some((s) => !s.complete)).toBe(true);
  });
});
